/**
 * PlantGuard IoT — Wokwi Simulation Sketch
 * ==========================================
 * Simplified version for Wokwi simulator using:
 * - DHT22 for temperature & humidity (instead of BME280)
 * - Potentiometer for simulated soil moisture
 * - LDR (photoresistor) for light level
 * - LED for connection status
 *
 * This sketch reads sensors and prints JSON telemetry
 * to Serial for monitoring in Wokwi's serial console.
 */

#include <DHTesp.h>

// ─── Pin Definitions ───
#define DHT_PIN         4
#define SOIL_PIN        34
#define LIGHT_PIN       35
#define STATUS_LED      2

// ─── Sensor Instances ───
DHTesp dht;

// ─── Timing ───
unsigned long lastRead = 0;
const int READ_INTERVAL = 2000;  // 2 seconds

// ─── Health Score Calculator ───
float rangeScore(float value, float optMin, float optMax, float absMin, float absMax) {
  if (value >= optMin && value <= optMax) return 100.0;
  if (value < optMin) return max(0.0f, 100.0f * (value - absMin) / (optMin - absMin));
  return max(0.0f, 100.0f * (absMax - value) / (absMax - optMax));
}

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("╔══════════════════════════════════════╗");
  Serial.println("║  PlantGuard IoT — Wokwi Simulation  ║");
  Serial.println("╚══════════════════════════════════════╝");
  Serial.println();

  // Initialize DHT22
  dht.setup(DHT_PIN, DHTesp::DHT22);
  Serial.println("[OK] DHT22 initialized on GPIO 4");

  // Analog pins
  analogReadResolution(12);
  pinMode(SOIL_PIN, INPUT);
  pinMode(LIGHT_PIN, INPUT);
  Serial.println("[OK] Analog sensors configured");

  // Status LED
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, HIGH);
  Serial.println("[OK] Status LED active");

  Serial.println();
  Serial.println("─── Telemetry Stream Active ───");
  Serial.println();
}

void loop() {
  unsigned long now = millis();

  if (now - lastRead >= READ_INTERVAL) {
    lastRead = now;

    // ─── Read Sensors ───
    float temperature = dht.getTemperature();
    float humidity    = dht.getHumidity();

    // Soil moisture: potentiometer (0-4095 → 0-100%)
    int soilRaw = analogRead(SOIL_PIN);
    float soilMoisture = map(soilRaw, 0, 4095, 0, 100);

    // Light level: LDR with voltage divider (0-4095 → 0-1500 lux approx)
    int lightRaw = analogRead(LIGHT_PIN);
    float lightLux = map(lightRaw, 0, 4095, 0, 1500);

    // ─── Calculate Health ───
    float score = rangeScore(soilMoisture, 35, 65, 5, 95) * 0.40
                + rangeScore(temperature, 18, 28, 5, 42)  * 0.25
                + rangeScore(humidity, 40, 70, 15, 95)     * 0.15
                + rangeScore(lightLux, 300, 900, 0, 1500)  * 0.20;

    int healthScore = (int)round(score);
    String rating;
    if (healthScore >= 80) rating = "EXCELLENT";
    else if (healthScore >= 60) rating = "GOOD";
    else if (healthScore >= 40) rating = "FAIR";
    else rating = "POOR";

    // ─── Build & Print JSON ───
    Serial.print("{");
    Serial.print("\"soil\":");     Serial.print(soilMoisture, 1);
    Serial.print(",\"temp\":");    Serial.print(temperature, 1);
    Serial.print(",\"humid\":");   Serial.print(humidity, 1);
    Serial.print(",\"lux\":");     Serial.print((int)lightLux);
    Serial.print(",\"health\":\""); Serial.print(rating);
    Serial.print("\",\"score\":"); Serial.print(healthScore);
    Serial.println("}");

    // Blink LED on each reading
    digitalWrite(STATUS_LED, LOW);
    delay(50);
    digitalWrite(STATUS_LED, HIGH);

    // ─── Alert Checks ───
    if (soilMoisture < 30) {
      Serial.println("[ALERT] ⚠️  Soil moisture LOW: " + String(soilMoisture, 1) + "%");
    }
    if (temperature > 35) {
      Serial.println("[ALERT] 🔥 Temperature HIGH: " + String(temperature, 1) + "°C");
    }
    if (temperature < 10) {
      Serial.println("[ALERT] ❄️  Temperature LOW: " + String(temperature, 1) + "°C");
    }
  }
}
