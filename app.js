/* ============================================================
   PlantGuard IoT — Dashboard Application
   Connects simulator engine to UI, Chart.js, and alert system.
   ============================================================ */

(function () {
  'use strict';

  // ─── DOM References ───
  const $ = (id) => document.getElementById(id);
  const statusDot = $('status-dot');
  const statusText = $('status-text');
  const btnPlayPause = $('btn-play-pause');
  const btnPPIcon = $('btn-pp-icon');
  const btnPPLabel = $('btn-pp-label');
  const virtualTimeEl = $('virtual-time');
  const virtualDayEl = $('virtual-day');
  const alertList = $('alert-list');
  const alertEmpty = $('alert-empty');
  const alertCountBadge = $('alert-count');
  const streamTerminal = $('stream-terminal');
  const btnClearStream = $('btn-clear-stream');

  // Metric elements
  const metrics = {
    soil: { val: $('val-soil'), ring: $('ring-soil'), status: $('status-soil'), card: $('card-soil') },
    temp: { val: $('val-temp'), ring: $('ring-temp'), status: $('status-temp'), card: $('card-temp') },
    light: { val: $('val-light'), ring: $('ring-light'), status: $('status-light'), card: $('card-light') },
    humid: { val: $('val-humid'), ring: $('ring-humid'), status: $('status-humid'), card: $('card-humid') }
  };

  // Health elements
  const healthScore = $('health-score');
  const healthRating = $('health-rating');
  const healthRing = $('health-ring');
  const lastWatered = $('last-watered');
  const avgScoreEl = $('avg-score');
  const pressureVal = $('pressure-val');

  // ─── Constants ───
  const RING_C = 314.16;  // 2 * PI * 50
  const HEALTH_C = 515.22; // 2 * PI * 82
  const MAX_ALERTS = 60;
  const MAX_STREAM = 80;
  const MAX_CHART_POINTS = 60;

  // ─── State ───
  let alertCount = 0;
  let chartData = { soil: [], temp: [], light: [], humid: [], labels: [] };
  let telemetryChart = null;

  // ─── Color Helpers ───
  function getSensorColor(sensor, value) {
    const ranges = {
      soil: { good: [35, 65], warn: [20, 80] },
      temp: { good: [18, 28], warn: [10, 35] },
      light: { good: [300, 900], warn: [100, 1200] },
      humid: { good: [40, 70], warn: [25, 85] }
    };
    const r = ranges[sensor];
    if (!r) return 'optimal';
    if (value >= r.good[0] && value <= r.good[1]) return 'optimal';
    if (value >= r.warn[0] && value <= r.warn[1]) return 'warning';
    return 'critical';
  }

  function getStatusLabel(sensor, value) {
    const status = getSensorColor(sensor, value);
    const labels = {
      optimal: 'Optimal',
      warning: 'Warning',
      critical: 'Critical'
    };
    return labels[status];
  }

  function getStrokeColor(status) {
    if (status === 'optimal') return '#4ade80';
    if (status === 'warning') return '#fbbf24';
    return '#f87171';
  }

  // ─── Ring Animation ───
  function setRingProgress(ringEl, percent, color) {
    const offset = RING_C - (RING_C * Math.min(100, Math.max(0, percent)) / 100);
    ringEl.style.strokeDashoffset = offset;
    ringEl.style.stroke = color;
  }

  function setHealthRing(score) {
    const offset = HEALTH_C - (HEALTH_C * Math.min(100, Math.max(0, score)) / 100);
    healthRing.style.strokeDashoffset = offset;

    let gradient = 'url(#grad-good)';
    if (score >= 80) gradient = 'url(#grad-excellent)';
    else if (score >= 60) gradient = 'url(#grad-good)';
    else if (score >= 40) gradient = 'url(#grad-fair)';
    else gradient = 'url(#grad-poor)';
    healthRing.style.stroke = gradient;
  }

  // ─── Animated Number Transition ───
  function animateValue(element, newVal, decimals = 1) {
    const current = parseFloat(element.textContent) || 0;
    const diff = newVal - current;
    if (Math.abs(diff) < 0.1) {
      element.textContent = newVal.toFixed(decimals);
      return;
    }
    const steps = 12;
    let step = 0;
    const inc = diff / steps;
    function tick() {
      step++;
      const v = current + inc * step;
      element.textContent = step >= steps ? newVal.toFixed(decimals) : v.toFixed(decimals);
      if (step < steps) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ─── Update Metrics ───
  function updateMetrics(data) {
    // Soil
    const soilStatus = getSensorColor('soil', data.soil_moisture);
    animateValue(metrics.soil.val, data.soil_moisture);
    setRingProgress(metrics.soil.ring, data.soil_moisture, getStrokeColor(soilStatus));
    metrics.soil.status.textContent = getStatusLabel('soil', data.soil_moisture);
    metrics.soil.status.className = 'metric-status ' + soilStatus;

    // Temperature (normalize to 0-100 scale for ring: 0°C=0%, 45°C=100%)
    const tempStatus = getSensorColor('temp', data.temperature);
    animateValue(metrics.temp.val, data.temperature);
    setRingProgress(metrics.temp.ring, (data.temperature / 45) * 100, getStrokeColor(tempStatus));
    metrics.temp.status.textContent = getStatusLabel('temp', data.temperature);
    metrics.temp.status.className = 'metric-status ' + tempStatus;

    // Light (normalize: 0-1500 lux range)
    const lightStatus = getSensorColor('light', data.light_lux);
    animateValue(metrics.light.val, data.light_lux, 0);
    setRingProgress(metrics.light.ring, Math.min(100, (data.light_lux / 1200) * 100), getStrokeColor(lightStatus));
    metrics.light.status.textContent = getStatusLabel('light', data.light_lux);
    metrics.light.status.className = 'metric-status ' + lightStatus;

    // Humidity
    const humidStatus = getSensorColor('humid', data.humidity);
    animateValue(metrics.humid.val, data.humidity);
    setRingProgress(metrics.humid.ring, data.humidity, getStrokeColor(humidStatus));
    metrics.humid.status.textContent = getStatusLabel('humid', data.humidity);
    metrics.humid.status.className = 'metric-status ' + humidStatus;
  }

  // ─── Update Health Panel ───
  function updateHealth(data) {
    const h = data.plant_health;
    healthScore.textContent = h.score;
    healthRating.textContent = h.rating;
    setHealthRing(h.score);

    // Color the rating text
    const ratingColors = {
      EXCELLENT: '#4ade80', GOOD: '#a3e635',
      FAIR: '#fbbf24', POOR: '#f87171'
    };
    healthRating.style.color = ratingColors[h.rating] || '#94a3b8';

    // Last watered
    if (data.last_watered_min < 1) {
      lastWatered.textContent = 'Just now';
    } else if (data.last_watered_min < 60) {
      lastWatered.textContent = `${data.last_watered_min}m ago`;
    } else {
      const hrs = Math.floor(data.last_watered_min / 60);
      const mins = data.last_watered_min % 60;
      lastWatered.textContent = `${hrs}h ${mins}m ago`;
    }

    avgScoreEl.textContent = data.avg_score;
    pressureVal.textContent = `${data.pressure} hPa`;
  }

  // ─── Chart.js Setup ───
  function initChart() {
    const ctx = $('telemetry-chart').getContext('2d');

    telemetryChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Soil %',
            data: [],
            borderColor: '#22d3ee',
            backgroundColor: 'rgba(34, 211, 238, 0.08)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            fill: true
          },
          {
            label: 'Temp °C',
            data: [],
            borderColor: '#f87171',
            backgroundColor: 'rgba(248, 113, 113, 0.06)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            fill: true
          },
          {
            label: 'Light ÷10',
            data: [],
            borderColor: '#fbbf24',
            backgroundColor: 'rgba(251, 191, 36, 0.06)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            fill: true
          },
          {
            label: 'Humid %',
            data: [],
            borderColor: '#4ade80',
            backgroundColor: 'rgba(74, 222, 128, 0.06)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#94a3b8',
              font: { family: "'Inter', sans-serif", size: 11 },
              boxWidth: 12,
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(10, 17, 40, 0.92)',
            titleColor: '#e2e8f0',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(74, 222, 128, 0.2)',
            borderWidth: 1,
            padding: 12,
            titleFont: { family: "'Orbitron', sans-serif", size: 10, weight: '600' },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            ticks: { color: '#475569', font: { family: "'JetBrains Mono', monospace", size: 9 }, maxTicksLimit: 10 },
            grid: { color: 'rgba(148, 163, 184, 0.04)' }
          },
          y: {
            ticks: { color: '#475569', font: { family: "'JetBrains Mono', monospace", size: 10 } },
            grid: { color: 'rgba(148, 163, 184, 0.05)' },
            min: 0,
            max: 110
          }
        },
        animation: { duration: 500 }
      }
    });
  }

  function updateChart(data) {
    const hour = data.virtualHour;
    const h = Math.floor(hour) % 24;
    const m = Math.floor((hour % 1) * 60);
    const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    chartData.labels.push(label);
    chartData.soil.push(data.soil_moisture);
    chartData.temp.push(data.temperature);
    chartData.light.push(Math.round(data.light_lux / 10)); // Scale down for chart
    chartData.humid.push(data.humidity);

    // Trim to max points
    if (chartData.labels.length > MAX_CHART_POINTS) {
      chartData.labels.shift();
      chartData.soil.shift();
      chartData.temp.shift();
      chartData.light.shift();
      chartData.humid.shift();
    }

    telemetryChart.data.labels = chartData.labels;
    telemetryChart.data.datasets[0].data = chartData.soil;
    telemetryChart.data.datasets[1].data = chartData.temp;
    telemetryChart.data.datasets[2].data = chartData.light;
    telemetryChart.data.datasets[3].data = chartData.humid;
    telemetryChart.update('none'); // Skip animation for performance
  }

  // ─── Alert Log ───
  function processAlerts(alerts) {
    if (!alerts || alerts.length === 0) return;

    if (alertEmpty) alertEmpty.style.display = 'none';

    alerts.forEach((alert) => {
      alertCount++;

      const item = document.createElement('div');
      item.className = `alert-item ${alert.severity}`;

      const sevEl = document.createElement('span');
      sevEl.className = 'alert-severity';
      sevEl.textContent = alert.icon;

      const content = document.createElement('div');
      content.className = 'alert-content';

      const msg = document.createElement('div');
      msg.className = 'alert-msg';
      msg.textContent = alert.message;

      const time = document.createElement('div');
      time.className = 'alert-time';
      time.textContent = new Date().toLocaleTimeString();

      content.appendChild(msg);
      content.appendChild(time);
      item.appendChild(sevEl);
      item.appendChild(content);

      alertList.insertBefore(item, alertList.firstChild);

      // Trim old alerts
      while (alertList.children.length > MAX_ALERTS) {
        alertList.removeChild(alertList.lastChild);
      }
    });

    alertCountBadge.textContent = alertCount;
  }

  // ─── Telemetry Stream ───
  function addStreamLine(data) {
    const line = document.createElement('div');
    line.className = 'stream-line';

    // Build colorized JSON
    const json = `> {"soil":${colorNum(data.soil_moisture)},"temp":${colorNum(data.temperature)},"lux":${colorNum(data.light_lux)},"humid":${colorNum(data.humidity)},"health":${colorStr(data.plant_health.rating)},"score":${colorNum(data.plant_health.score)}}`;
    line.innerHTML = json;

    streamTerminal.appendChild(line);

    // Trim
    while (streamTerminal.children.length > MAX_STREAM) {
      streamTerminal.removeChild(streamTerminal.firstChild);
    }

    // Auto-scroll
    streamTerminal.scrollTop = streamTerminal.scrollHeight;
  }

  function colorNum(v) {
    return `<span class="json-num">${v}</span>`;
  }

  function colorStr(v) {
    return `<span class="json-str">"${v}"</span>`;
  }

  // ─── Virtual Time Display ───
  function updateVirtualTime(sim) {
    virtualTimeEl.textContent = sim.getVirtualTimeString();
    virtualDayEl.textContent = sim.getDayString();
  }

  // ─── Connection Status ───
  function setConnectionStatus(state) {
    if (state === 'connected') {
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Streaming';
    } else if (state === 'paused') {
      statusDot.className = 'status-dot';
      statusText.textContent = 'Paused';
    } else {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = 'Disconnected';
    }
  }

  // ─── Main Data Handler ───
  function onTelemetry(data) {
    updateMetrics(data);
    updateHealth(data);
    updateChart(data);
    processAlerts(data.alerts);
    addStreamLine(data);
    updateVirtualTime(simulator);
  }

  // ─── Initialize Simulator ───
  const simulator = new PlantSimulator({
    interval: 1500,
    speed: 1,
    onData: onTelemetry,
    onStatusChange: setConnectionStatus
  });

  // ─── Controls ───
  let isRunning = false;

  btnPlayPause.addEventListener('click', () => {
    if (isRunning) {
      simulator.stop();
      btnPPIcon.textContent = '▶';
      btnPPLabel.textContent = 'Start';
      btnPlayPause.classList.remove('running');
    } else {
      simulator.start();
      btnPPIcon.textContent = '⏸';
      btnPPLabel.textContent = 'Pause';
      btnPlayPause.classList.add('running');
    }
    isRunning = !isRunning;
  });

  // Speed buttons
  document.querySelectorAll('.speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.speed-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const speed = parseInt(btn.dataset.speed, 10);
      simulator.setSpeed(speed);
    });
  });

  // Clear stream
  btnClearStream.addEventListener('click', () => {
    streamTerminal.innerHTML = '<div class="stream-line sys">> Stream cleared</div>';
  });

  // ─── Init ───
  initChart();
  setConnectionStatus('paused');

})();
