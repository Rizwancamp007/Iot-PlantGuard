/* ============================================================
   PlantGuard IoT — Sensor Simulation Engine
   Generates realistic synthetic plant telemetry data
   with day/night cycles, watering events, and edge cases.
   ============================================================ */

class PlantSimulator {
  constructor(options = {}) {
    this.intervalMs = options.interval || 1500;
    this.speed = options.speed || 1;
    this.onData = options.onData || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});

    // Virtual time state (seconds within a day, 0 = midnight)
    this.virtualSeconds = 6 * 3600; // Start at 6:00 AM
    this.dayCount = 1;
    this.tickCount = 0;

    // Sensor state (persistent between ticks for realistic continuity)
    this.soilMoisture = 52 + (Math.random() - 0.5) * 10;
    this.lastWateredAgo = 0; // minutes ago (virtual)
    this.wateringJustHappened = false;

    // History for averaging
    this.healthHistory = [];

    // Timer
    this._timerId = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.onStatusChange('connected');
    this._schedule();
  }

  stop() {
    this.running = false;
    if (this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
    this.onStatusChange('paused');
  }

  setSpeed(multiplier) {
    this.speed = Math.max(1, Math.min(20, multiplier));
  }

  _schedule() {
    if (!this.running) return;
    this._timerId = setTimeout(() => {
      this._tick();
      this._schedule();
    }, this.intervalMs);
  }

  _tick() {
    this.tickCount++;

    // Advance virtual time: each tick = ~10 virtual minutes * speed
    const virtualAdvance = 600 * this.speed; // 10 min in seconds
    this.virtualSeconds += virtualAdvance;
    this.lastWateredAgo += (virtualAdvance / 60);

    // Day rollover
    if (this.virtualSeconds >= 86400) {
      this.virtualSeconds -= 86400;
      this.dayCount++;
    }

    const hour = this.virtualSeconds / 3600;
    const data = this._generateReadings(hour);

    this.onData(data);
  }

  _generateReadings(hour) {
    // --- Temperature ---
    // Sinusoidal: min ~17°C at 5 AM, max ~31°C at 2 PM
    const tempBase = 24 + 7 * Math.sin((hour - 8) * Math.PI / 12);
    const temperature = Math.round((tempBase + this._noise(0.6)) * 10) / 10;

    // --- Humidity ---
    // Inversely correlated with temperature
    const humidBase = 78 - (temperature - 17) * 2.2;
    const humidity = Math.round(Math.max(28, Math.min(92, humidBase + this._noise(1.5))) * 10) / 10;

    // --- Light (Lux) ---
    // Bell curve: 0 at night, peaks ~1100 lux at 1 PM
    let lightLux = 0;
    if (hour >= 5.5 && hour <= 20) {
      const peak = 13;
      const spread = 3.8;
      lightLux = 1100 * Math.exp(-0.5 * Math.pow((hour - peak) / spread, 2));
      lightLux += this._noise(40);

      // Cloud simulation: random dips
      if (Math.random() < 0.08) {
        lightLux *= 0.4 + Math.random() * 0.3;
      }
    }
    lightLux = Math.round(Math.max(0, lightLux));

    // --- Soil Moisture ---
    // Gradual evaporation + watering events
    const evapRate = 0.25 + (temperature > 28 ? 0.15 : 0) + (lightLux > 800 ? 0.1 : 0);
    this.soilMoisture -= evapRate * this.speed * 0.3;
    this.soilMoisture += this._noise(0.15);

    // Watering event: when too dry, or random chance when below 40%
    this.wateringJustHappened = false;
    if (this.soilMoisture < 20 || (this.soilMoisture < 38 && Math.random() < 0.06)) {
      this.soilMoisture = 62 + Math.random() * 15;
      this.lastWateredAgo = 0;
      this.wateringJustHappened = true;
    }

    this.soilMoisture = Math.max(5, Math.min(95, this.soilMoisture));
    const soilMoisture = Math.round(this.soilMoisture * 10) / 10;

    // --- Pressure ---
    const pressure = Math.round((1013.25 + this._noise(3)) * 10) / 10;

    // --- Plant Health Score ---
    const health = this._calcHealth(soilMoisture, temperature, humidity, lightLux);
    this.healthHistory.push(health.score);
    if (this.healthHistory.length > 144) this.healthHistory.shift(); // ~24h at 10-min intervals

    const avgScore = this.healthHistory.length > 0
      ? Math.round(this.healthHistory.reduce((a, b) => a + b, 0) / this.healthHistory.length)
      : health.score;

    // --- Alerts ---
    const alerts = this._checkAlerts(soilMoisture, temperature, humidity, lightLux);

    return {
      timestamp: Date.now(),
      virtualHour: hour,
      virtualDay: this.dayCount,
      soil_moisture: soilMoisture,
      temperature: temperature,
      humidity: humidity,
      light_lux: lightLux,
      pressure: pressure,
      plant_health: health,
      avg_score: avgScore,
      last_watered_min: Math.round(this.lastWateredAgo),
      watering_event: this.wateringJustHappened,
      alerts: alerts,
      tick: this.tickCount
    };
  }

  _calcHealth(soil, temp, humid, light) {
    const soilScore = this._rangeScore(soil, 35, 65, 5, 95);
    const tempScore = this._rangeScore(temp, 18, 28, 5, 42);
    const humidScore = this._rangeScore(humid, 40, 70, 15, 95);
    const lightScore = this._rangeScore(light, 300, 900, 0, 1500);

    const score = Math.round(
      soilScore * 0.40 +
      tempScore * 0.25 +
      humidScore * 0.15 +
      lightScore * 0.20
    );

    let rating, gradient;
    if (score >= 80) { rating = 'EXCELLENT'; gradient = 'grad-excellent'; }
    else if (score >= 60) { rating = 'GOOD'; gradient = 'grad-good'; }
    else if (score >= 40) { rating = 'FAIR'; gradient = 'grad-fair'; }
    else { rating = 'POOR'; gradient = 'grad-poor'; }

    return { score, rating, gradient };
  }

  _rangeScore(value, optMin, optMax, absMin, absMax) {
    if (value >= optMin && value <= optMax) return 100;
    if (value < optMin) {
      return Math.max(0, 100 * (value - absMin) / (optMin - absMin));
    }
    return Math.max(0, 100 * (absMax - value) / (absMax - optMax));
  }

  _checkAlerts(soil, temp, humid, light) {
    const alerts = [];

    if (soil < 25) {
      alerts.push({ severity: 'critical', icon: '🚨', sensor: 'soil',
        message: `Soil moisture critically low at ${soil}% — Water immediately!` });
    } else if (soil < 35) {
      alerts.push({ severity: 'warning', icon: '⚠️', sensor: 'soil',
        message: `Soil moisture dropping: ${soil}% — Consider watering soon` });
    } else if (soil > 85) {
      alerts.push({ severity: 'warning', icon: '⚠️', sensor: 'soil',
        message: `Soil oversaturated at ${soil}% — Risk of root rot` });
    }

    if (this.wateringJustHappened) {
      alerts.push({ severity: 'info', icon: '💧', sensor: 'soil',
        message: `Watering event detected — Soil replenished to ${soil}%` });
    }

    if (temp > 35) {
      alerts.push({ severity: 'critical', icon: '🔥', sensor: 'temp',
        message: `Temperature spike: ${temp}°C — Move plant to shade` });
    } else if (temp > 30) {
      alerts.push({ severity: 'warning', icon: '🌡️', sensor: 'temp',
        message: `Temperature elevated: ${temp}°C — Monitor closely` });
    } else if (temp < 10) {
      alerts.push({ severity: 'critical', icon: '❄️', sensor: 'temp',
        message: `Temperature too low: ${temp}°C — Risk of frost damage` });
    }

    if (light < 50 && this.virtualSeconds / 3600 > 7 && this.virtualSeconds / 3600 < 18) {
      alerts.push({ severity: 'warning', icon: '🌑', sensor: 'light',
        message: `Very low light during daytime: ${light} lux — Check obstruction` });
    }

    if (humid > 88) {
      alerts.push({ severity: 'warning', icon: '💦', sensor: 'humid',
        message: `Humidity very high: ${humid}% — Risk of fungal growth` });
    }

    return alerts;
  }

  _noise(amplitude) {
    // Box-Muller for more natural Gaussian noise
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z * amplitude * 0.5;
  }

  getVirtualTimeString() {
    const totalMinutes = Math.floor(this.virtualSeconds / 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    return `${String(h12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${ampm}`;
  }

  getDayString() {
    return `Day ${this.dayCount}`;
  }
}

// Export for use in app.js
window.PlantSimulator = PlantSimulator;
