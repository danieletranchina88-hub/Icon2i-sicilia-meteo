(() => {
  const CACHE_V = Date.now();
  const DATA_DIR = "data";

  const statusEl = document.getElementById("status");
  const btnReload = document.getElementById("btnReload");

  const chkTemp = document.getElementById("chkTemp");
  const chkRain = document.getElementById("chkRain");
  const chkPres = document.getElementById("chkPres");
  const chkWind = document.getElementById("chkWind");

  const timeSlider = document.getElementById("timeSlider");
  const timeLabel = document.getElementById("timeLabel");
  const runLabel = document.getElementById("runLabel");
  const sourceLabel = document.getElementById("sourceLabel");

  const map = L.map("map", { zoomControl: true, attributionControl: true });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  map.setView([37.5, 14.2], 7);

  let currentIndex = 0;
  let detectedSteps = 1;

  let overlays = { temp: null, rain: null, pres: null, wind: null };

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function pad3(n) {
    return String(n).padStart(3, "0");
  }

  function safeJsonParse(text) {
    const cleaned = text
      .replace(/\bNaN\b/g, "null")
      .replace(/\bInfinity\b/g, "null")
      .replace(/\b-Infinity\b/g, "null");
    return JSON.parse(cleaned);
  }

  async function fetchText(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status} su ${url}`);
    return await r.text();
  }

  async function fetchJson(url) {
    const txt = await fetchText(url);
    return safeJsonParse(txt);
  }

  function gridBounds(bbox) {
    return [
      [bbox[1], bbox[0]],
      [bbox[3], bbox[2]]
    ];
  }

  function fitToGrid(grid) {
    if (!grid || !grid.bbox) return;
    map.fitBounds(gridBounds(grid.bbox), { padding: [20, 20] });
  }

  function removeOverlay(key) {
    if (overlays[key]) {
      map.removeLayer(overlays[key]);
      overlays[key] = null;
    }
  }

  function removeAll() {
    removeOverlay("temp");
    removeOverlay("rain");
    removeOverlay("pres");
    removeOverlay("wind");
  }

  function normalizeScalar(v) {
    if (v == null) return null;
    const n = Number(v);
    if (!isFinite(n)) return null;
    return n;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function lerpStops(stops, t, hasAlpha = false) {
    t = clamp01(t);
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (t >= t0 && t <= t1) {
        const u = (t - t0) / (t1 - t0 || 1);
        const r = Math.round(lerp(c0[0], c1[0], u));
        const g = Math.round(lerp(c0[1], c1[1], u));
        const b = Math.round(lerp(c0[2], c1[2], u));
        if (hasAlpha) {
          const a0 = (c0.length > 3 ? c0[3] : 255);
          const a1 = (c1.length > 3 ? c1[3] : 255);
          const a = Math.round(lerp(a0, a1, u));
          return [r, g, b, a];
        }
        return [r, g, b, 255];
      }
    }
    const last = stops[stops.length - 1][1];
    return [last[0], last[1], last[2], (last[3] ?? 255)];
  }

  const LAYERS = {
    temp: {
      filePrefix: "temp_",
      min: -5, max: 35,
      color: (t) => {
        const stops = [
          [0.00, [68, 1, 84, 220]],
          [0.25, [59, 82, 139, 220]],
          [0.50, [33, 145, 140, 220]],
          [0.75, [94, 201, 98, 220]],
          [1.00, [253, 231, 37, 220]],
        ];
        return lerpStops(stops, t, true);
      }
    },
    rain: {
      filePrefix: "rain_",
      min: 0, max: 50,
      color: (t) => {
        const stops = [
          [0.00, [0, 0, 0, 0]],
          [0.08, [120, 180, 255, 130]],
          [0.30, [70, 120, 255, 170]],
          [0.60, [140, 70, 255, 200]],
          [1.00, [255, 40, 180, 220]],
        ];
        return lerpStops(stops, t, true);
      }
    },
    pres: {
      filePrefix: "pres_",
      min: 980, max: 1040,
      color: (t) => {
        const stops = [
          [0.00, [120, 160, 200, 140]],
          [0.50, [220, 220, 140, 160]],
          [1.00, [255, 160, 60, 180]],
        ];
        return lerpStops(stops, t, true);
      }
    },
    wind: {
      filePrefix: "wind_"
    }
  };

  function drawScalarRaster(grid, layerCfg) {
    const { nx, ny, bbox, values } = grid;
    if (!nx || !ny || !bbox || !Array.isArray(values)) {
      throw new Error("Grid scalare non valido (nx/ny/bbox/values).");
    }

    const canvas = document.createElement("canvas");
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext("2d", { alpha: true });
    const img = ctx.createImageData(nx, ny);

    for (let i = 0; i < nx * ny; i++) {
      const raw = normalizeScalar(values[i]);
      const p = i * 4;

      if (raw == null) {
        img.data[p + 3] = 0;
        continue;
      }

      const t = (raw - layerCfg.min) / (layerCfg.max - layerCfg.min);
      const c = layerCfg.color(t);

      img.data[p + 0] = c[0];
      img.data[p + 1] = c[1];
      img.data[p + 2] = c[2];
      img.data[p + 3] = c[3] ?? 255;
    }

    ctx.putImageData(img, 0, 0);

    const bounds = gridBounds(bbox);
    return L.imageOverlay(canvas.toDataURL("image/png"), bounds, {
      opacity: 0.85,
      interactive: false
    });
  }

  async function loadGrid(prefix, stepIndex) {
    const file = `${prefix}${pad3(stepIndex)}.json`;
    const url = `${DATA_DIR}/${file}?v=${CACHE_V}`;
    return await fetchJson(url);
  }

  async function existsGrid(prefix, stepIndex) {
    const file = `${prefix}${pad3(stepIndex)}.json`;
    const url = `${DATA_DIR}/${file}?v=${CACHE_V}`;

    try {
      // HEAD spesso su GitHub Pages può essere ok, ma per sicurezza facciamo GET leggero
      const r = await fetch(url, { cache: "no-store" });
      return r.ok;
    } catch {
      return false;
    }
  }

  async function detectAvailableSteps() {
    // Proviamo a partire da 0; basta che esista almeno un layer.
    const prefixes = [LAYERS.temp.filePrefix, LAYERS.rain.filePrefix, LAYERS.pres.filePrefix, LAYERS.wind.filePrefix];

    // primo: deve esistere almeno qualcosa a 000
    let any0 = false;
    for (const p of prefixes) {
      if (await existsGrid(p, 0)) { any0 = true; break; }
    }
    if (!any0) throw new Error("Non trovo nessun file *_000.json dentro /data.");

    // poi cerchiamo il massimo step (limite di sicurezza)
    const MAX = 200;
    let lastOk = 0;

    for (let i = 0; i <= MAX; i++) {
      let any = false;
      for (const p of prefixes) {
        if (await existsGrid(p, i)) { any = true; break; }
      }
      if (any) lastOk = i;
      else break; // primo buco -> stop
    }

    return lastOk + 1; // count
  }

  function setUiMeta() {
    timeLabel.textContent = String(currentIndex);
    runLabel.textContent = `Run: —`;
    sourceLabel.textContent = `Fonte dati: —`;
  }

  async function updateLayers() {
    setStatus("");

    currentIndex = Number(timeSlider.value) || 0;
    timeLabel.textContent = String(currentIndex);

    // TEMP
    if (chkTemp.checked) {
      try {
        const grid = await loadGrid(LAYERS.temp.filePrefix, currentIndex);
        removeOverlay("temp");
        overlays.temp = drawScalarRaster(grid, LAYERS.temp);
        overlays.temp.addTo(map);
        fitToGrid(grid);
      } catch (e) {
        removeOverlay("temp");
        setStatus(`Temperatura: ${e.message}`);
      }
    } else {
      removeOverlay("temp");
    }

    // RAIN
    if (chkRain.checked) {
      try {
        const grid = await loadGrid(LAYERS.rain.filePrefix, currentIndex);
        removeOverlay("rain");
        overlays.rain = drawScalarRaster(grid, LAYERS.rain);
        overlays.rain.addTo(map);
        fitToGrid(grid);
      } catch (e) {
        removeOverlay("rain");
        setStatus(`Pioggia: ${e.message}`);
      }
    } else {
      removeOverlay("rain");
    }

    // PRES
    if (chkPres.checked) {
      try {
        const grid = await loadGrid(LAYERS.pres.filePrefix, currentIndex);
        removeOverlay("pres");
        overlays.pres = drawScalarRaster(grid, LAYERS.pres);
        overlays.pres.addTo(map);
        fitToGrid(grid);
      } catch (e) {
        removeOverlay("pres");
        setStatus(`Pressione: ${e.message}`);
      }
    } else {
      removeOverlay("pres");
    }

    // WIND
    if (chkWind.checked) {
      try {
        const grid = await loadGrid(LAYERS.wind.filePrefix, currentIndex);
        removeOverlay("wind");
        overlays.wind = createWindOverlay(map, grid);
        overlays.wind.addTo(map);
        fitToGrid(grid);
      } catch (e) {
        removeOverlay("wind");
        setStatus(`Vento: ${e.message}`);
      }
    } else {
      removeOverlay("wind");
    }
  }

  async function hardReloadData() {
    setStatus("");
    removeAll();
    setUiMeta();

    try {
      detectedSteps = await detectAvailableSteps();

      timeSlider.min = 0;
      timeSlider.max = Math.max(0, detectedSteps - 1);
      timeSlider.value = 0;

      currentIndex = 0;
      timeLabel.textContent = "0";
      runLabel.textContent = `Run: —  (+${detectedSteps} step)`;
      sourceLabel.textContent = `Fonte dati: MeteoHub / Agenzia ItaliaMeteo — ICON-2I open data`;

      await updateLayers();
    } catch (e) {
      setStatus(`Errore: ${e.message}`);
    }
  }

  btnReload.addEventListener("click", hardReloadData);
  timeSlider.addEventListener("input", updateLayers);

  chkTemp.addEventListener("change", updateLayers);
  chkRain.addEventListener("change", updateLayers);
  chkPres.addEventListener("change", updateLayers);
  chkWind.addEventListener("change", updateLayers);

  hardReloadData();
})();
