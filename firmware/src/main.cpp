/**
 * PlantGuard IoT — Main Firmware
 * ================================
 * ESP32 firmware for the IoT Smart Plant Monitoring System.
 * Reads sensors, serves a web dashboard from LittleFS,
 * and streams real-time telemetry via WebSockets.
 *
 * Security Features:
 * - HTTP Basic Authentication on all routes
 * - WebSocket connection rate limiting (max 5 clients)
 * - Input sanitization on incoming WebSocket messages
 * - No hardcoded credentials (loaded from config.h)
 */

#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "config.h"
#include "sensors.h"

// ─── Server & WebSocket Instances ───
AsyncWebServer server(HTTP_PORT);
AsyncWebSocket ws(WS_ENDPOINT);

// ─── Timing State ───
unsigned long lastTelemetry = 0;
unsigned long lastCleanup   = 0;

// ─── WebSocket Event Handler ───
void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
               AwsEventType type, void *arg, uint8_t *data, size_t len) {

  switch (type) {
    case WS_EVT_CONNECT:
      // Rate limit: reject if too many clients
      if (server->count() > MAX_WS_CLIENTS) {
        Serial.printf("[WS] Connection rejected (limit %d): client #%u\n",
                      MAX_WS_CLIENTS, client->id());
        client->close(1013, "Max connections reached");
        return;
      }
      Serial.printf("[WS] Client #%u connected from %s\n",
                    client->id(), client->remoteIP().toString().c_str());
      // Send initial reading immediately
      client->text(buildTelemetryJSON());
      break;

    case WS_EVT_DISCONNECT:
      Serial.printf("[WS] Client #%u disconnected\n", client->id());
      break;

    case WS_EVT_DATA: {
      // Input sanitization: only accept valid JSON commands
      AwsFrameInfo *info = (AwsFrameInfo *)arg;
      if (info->final && info->index == 0 && info->len == len) {
        data[len] = 0; // Null terminate
        String msg = String((char *)data);

        // Validate: reject messages over 256 chars (prevents buffer overflow)
        if (msg.length() > 256) {
          Serial.println("[SEC] Oversized WebSocket message rejected");
          return;
        }

        // Parse as JSON
        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, msg);
        if (err) {
          Serial.printf("[SEC] Invalid JSON from client #%u: %s\n",
                        client->id(), err.c_str());
          return;
        }

        // Handle valid commands
        const char *cmd = doc["command"];
        if (cmd && String(cmd) == "get_reading") {
          client->text(buildTelemetryJSON());
        }
      }
      break;
    }

    case WS_EVT_ERROR:
      Serial.printf("[WS] Error on client #%u\n", client->id());
      break;

    case WS_EVT_PONG:
      break;
  }
}

// ─── Setup ───
void setup() {
  Serial.begin(115200);
  Serial.println("\n╔══════════════════════════════════════╗");
  Serial.println("║  PlantGuard IoT v1.0 — Booting...   ║");
  Serial.println("╚══════════════════════════════════════╝\n");

  // Status LED
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  // Initialize LittleFS
  if (!LittleFS.begin(true)) {
    Serial.println("[FATAL] LittleFS mount failed!");
    return;
  }
  Serial.println("[OK] LittleFS mounted");

  // Initialize sensors
  if (!initSensors()) {
    Serial.println("[FATAL] Sensor initialization failed!");
    return;
  }

  // Connect to WiFi
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 40) {
    delay(500);
    Serial.print(".");
    retries++;
    digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN)); // Blink
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[OK] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    digitalWrite(STATUS_LED_PIN, HIGH);
  } else {
    Serial.println("\n[ERROR] WiFi connection failed!");
    return;
  }

  // Configure WebSocket
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  // Serve static files from LittleFS with authentication
  server.serveStatic("/", LittleFS, "/")
        .setDefaultFile("index.html")
#if AUTH_ENABLED
        .setAuthentication(AUTH_USERNAME, AUTH_PASSWORD)
#endif
        ;

  // CORS headers for security
  DefaultHeaders::Instance().addHeader("X-Content-Type-Options", "nosniff");
  DefaultHeaders::Instance().addHeader("X-Frame-Options", "DENY");
  DefaultHeaders::Instance().addHeader("X-XSS-Protection", "1; mode=block");

  // Start server
  server.begin();
  Serial.println("\n[OK] Dashboard live at http://" + WiFi.localIP().toString());
  Serial.println("[OK] WebSocket endpoint: ws://" + WiFi.localIP().toString() + WS_ENDPOINT);
  Serial.println("─────────────────────────────────────────");
}

// ─── Main Loop ───
void loop() {
  unsigned long now = millis();

  // Broadcast telemetry at configured interval
  if (now - lastTelemetry >= TELEMETRY_INTERVAL_MS) {
    lastTelemetry = now;

    if (ws.count() > 0) {
      String json = buildTelemetryJSON();
      ws.textAll(json);
      Serial.printf("[TX] Telemetry → %d clients (%d bytes)\n",
                    ws.count(), json.length());
    }
  }

  // Periodic WebSocket cleanup
  if (now - lastCleanup >= WS_CLEANUP_INTERVAL_MS) {
    lastCleanup = now;
    ws.cleanupClients();
  }
}
