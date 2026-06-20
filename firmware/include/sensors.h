/**
 * PlantGuard IoT — Sensor Abstraction Layer
 * ===========================================
 * Provides a clean API for reading BME280 (temp/humidity/pressure),
 * BH1750 (light), and capacitive soil moisture sensor values.
 * Includes calibration, health scoring, and JSON serialization.
 */

#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_BME280.h>
#include <BH1750.h>
#include <ArduinoJson.h>
#include "config.h"

// ─── Sensor Instances ───
Adafruit_BME280 bme;
BH1750 lightMeter;

// ─── Sensor State ───
struct SensorData {
  float soilMoisture;
  float temperature;
  float humidity;
  float pressure;
  float lightLux;
  int   healthScore;
  String healthRating;
  String alerts;
};

// ─── Initialize All Sensors ───
bool initSensors() {
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  // BME280 — Temperature, Humidity, Pressure
  if (!bme.begin(0x76)) {
    Serial.println("[ERROR] BME280 not found at 0x76, trying 0x77...");
    if (!bme.begin(0x77)) {
      Serial.println("[ERROR] BME280 initialization failed!");
      return false;
    }
  }
  Serial.println("[OK] BME280 initialized");

  // BH1750 — Light Sensor
  if (!lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
    Serial.println("[ERROR] BH1750 initialization failed!");
    return false;
  }
  Serial.println("[OK] BH1750 initialized");

  // Soil Moisture — Analog Pin
  analogReadResolution(12); // 12-bit ADC (0-4095)
  pinMode(SOIL_MOISTURE_PIN, INPUT);
  Serial.println("[OK] Soil moisture sensor configured on GPIO " + String(SOIL_MOISTURE_PIN));

  return true;
}

// ─── Read Soil Moisture (calibrated %) ───
float readSoilMoisture() {
  int rawValue = analogRead(SOIL_MOISTURE_PIN);
  // Map with two-point calibration: dry(4095)=0%, wet(1500)=100%
  float percent = map(rawValue, SOIL_RAW_DRY, SOIL_RAW_WET, 0, 100);
  return constrain(percent, 0.0f, 100.0f);
}

// ─── Read BME280 ───
float readTemperature() { return bme.readTemperature(); }
float readHumidity()    { return bme.readHumidity(); }
float readPressure()    { return bme.readPressure() / 100.0F; } // hPa

// ─── Read BH1750 ───
float readLightLevel()  { return lightMeter.readLightLevel(); }

// ─── Range Score Calculator ───
float rangeScore(float value, float optMin, float optMax, float absMin, float absMax) {
  if (value >= optMin && value <= optMax) return 100.0f;
  if (value < optMin) return max(0.0f, 100.0f * (value - absMin) / (optMin - absMin));
  return max(0.0f, 100.0f * (absMax - value) / (absMax - optMax));
}

// ─── Calculate Plant Health Score ───
void calcHealthScore(float soil, float temp, float humid, float light,
                     int &score, String &rating) {
  float s = rangeScore(soil, 35, 65, 5, 95) * WEIGHT_SOIL
          + rangeScore(temp, 18, 28, 5, 42) * WEIGHT_TEMP
          + rangeScore(humid, 40, 70, 15, 95) * WEIGHT_HUMID
          + rangeScore(light, 300, 900, 0, 1500) * WEIGHT_LIGHT;

  score = (int)round(s);
  if (score >= 80) rating = "EXCELLENT";
  else if (score >= 60) rating = "GOOD";
  else if (score >= 40) rating = "FAIR";
  else rating = "POOR";
}

// ─── Build JSON Telemetry Payload ───
String buildTelemetryJSON() {
  float soil  = readSoilMoisture();
  float temp  = readTemperature();
  float humid = readHumidity();
  float pres  = readPressure();
  float light = readLightLevel();

  int healthScore;
  String healthRating;
  calcHealthScore(soil, temp, humid, light, healthScore, healthRating);

  // Build JSON using ArduinoJson
  JsonDocument doc;
  doc["timestamp"]     = millis();
  doc["soil_moisture"]  = round(soil * 10) / 10.0;
  doc["temperature"]    = round(temp * 10) / 10.0;
  doc["humidity"]       = round(humid * 10) / 10.0;
  doc["pressure"]       = round(pres * 10) / 10.0;
  doc["light_lux"]      = (int)round(light);

  JsonObject health = doc["plant_health"].to<JsonObject>();
  health["score"]  = healthScore;
  health["rating"] = healthRating;

  // Generate alerts
  JsonArray alerts = doc["alerts"].to<JsonArray>();

  if (soil < SOIL_DRY_THRESHOLD) {
    JsonObject a = alerts.add<JsonObject>();
    a["severity"] = (soil < 20) ? "critical" : "warning";
    a["sensor"]   = "soil";
    a["message"]  = "Soil moisture low: " + String(soil, 1) + "%";
  }
  if (soil > SOIL_WET_THRESHOLD) {
    JsonObject a = alerts.add<JsonObject>();
    a["severity"] = "warning";
    a["sensor"]   = "soil";
    a["message"]  = "Soil oversaturated: " + String(soil, 1) + "%";
  }
  if (temp > TEMP_HIGH_THRESHOLD) {
    JsonObject a = alerts.add<JsonObject>();
    a["severity"] = "critical";
    a["sensor"]   = "temp";
    a["message"]  = "Temperature too high: " + String(temp, 1) + "°C";
  }
  if (temp < TEMP_LOW_THRESHOLD) {
    JsonObject a = alerts.add<JsonObject>();
    a["severity"] = "critical";
    a["sensor"]   = "temp";
    a["message"]  = "Temperature too low: " + String(temp, 1) + "°C";
  }

  String output;
  serializeJson(doc, output);
  return output;
}

#endif // SENSORS_H
