/**
 * PlantGuard IoT — Configuration Header
 * ========================================
 * Centralized configuration for WiFi, GPIO pins, sensor thresholds,
 * and dashboard authentication credentials.
 *
 * SECURITY: This file should be added to .gitignore to prevent
 * credential leakage. Use config.h.example for reference.
 */

#ifndef CONFIG_H
#define CONFIG_H

// ─── WiFi Credentials ───
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASS       "YOUR_WIFI_PASSWORD"

// ─── GPIO Pin Definitions ───
#define SOIL_MOISTURE_PIN   34    // Analog input (ADC1_CH6)
#define I2C_SDA_PIN         21    // Shared I2C data (BME280 + BH1750)
#define I2C_SCL_PIN         22    // Shared I2C clock
#define STATUS_LED_PIN      2     // Onboard LED for connection status

// ─── Telemetry Configuration ───
#define TELEMETRY_INTERVAL_MS   2000    // Sensor polling interval (ms)
#define MAX_WS_CLIENTS          5       // Max WebSocket connections (DoS prevention)
#define WS_CLEANUP_INTERVAL_MS  1000    // WebSocket client cleanup interval

// ─── Soil Moisture Calibration ───
// Two-point calibration: dry air = ~4095, fully submerged = ~1500
#define SOIL_RAW_DRY    4095
#define SOIL_RAW_WET    1500

// ─── Alert Thresholds ───
#define SOIL_DRY_THRESHOLD      30.0f   // % — soil too dry
#define SOIL_WET_THRESHOLD      80.0f   // % — oversaturated
#define TEMP_HIGH_THRESHOLD     35.0f   // °C — overheating
#define TEMP_LOW_THRESHOLD      10.0f   // °C — too cold
#define HUMIDITY_HIGH_THRESHOLD 85.0f   // % — fungal risk
#define LIGHT_LOW_THRESHOLD     100.0f  // lux — insufficient light (daytime)

// ─── Plant Health Weights ───
#define WEIGHT_SOIL     0.40f
#define WEIGHT_TEMP     0.25f
#define WEIGHT_HUMID    0.15f
#define WEIGHT_LIGHT    0.20f

// ─── Dashboard Authentication ───
#define AUTH_ENABLED    true
#define AUTH_USERNAME   "admin"
#define AUTH_PASSWORD   "plantSecure2026!"

// ─── Server Configuration ───
#define HTTP_PORT       80
#define WS_ENDPOINT     "/ws"

#endif // CONFIG_H
