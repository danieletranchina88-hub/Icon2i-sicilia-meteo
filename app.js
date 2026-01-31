(() => {
  // CACHE BUSTER: evita “oggi vedo, domani no” su GitHub Pages
  const CACHE_V = Date.now();

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

  const map = L.map("map", {
    zoomControl: true,
    attributionControl: true
  });

  // Base map: OpenStreetMap
  const osm = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }
  ).addTo(map);

  // Parti già comodo su Sicilia
  map.setView([37.5, 14.2], 7);

  let meta = null;              // run.json
  let currentIndex = 0;         // step previsione
  let overlays = {
    temp: null,
    rain: null,
    pres: null,
    wind: null
  };

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function fmtHourLabel(i) {
    if (!meta || !meta.times || !meta.times[i]) return String(i);
    return meta.times[i];
  }

  async function fetchText(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status} su ${url}`);
    return await r.text();
  }

  function safeJsonParse(text) {
    // TRUCCO: convertiamo NaN/Infinity in null così JSON.parse non esplode.
    // (è il tuo problema principale nei layer temp/rain/pres)
    const cleaned = text
      .replace(/\bNaN\b/g, "null")
      .replace(/\bInfinity\b/g, "null")
      .replace(/\b-Infinity\b/g, "null");
    return JSON.parse(cleaned);
  }

  async function loadMeta() {
    // se hai run.json in /data
    const url = `${DATA_DIR}/run.json?v=${CACHE_V}`;
    const txt = await fetchText(url);
    return safeJsonParse(txt);
  }

  function gridBounds(bbox) {
    return [
      [bbox[1], bbox[0]], // [minLat, minLon]
      [bbox[3], bbox[2]]  // [maxLat, maxLon]
    ];
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

  function fitToGrid(grid) {
    if (!grid || !grid.bbox) return;
    const b = gridBounds(grid.bbox);
    map.fitBounds(b, { padding: [20, 20] });
  }

  function normalizeScalar(v) {
    if (v == null) return null;
    const n = Number(v);
    if (!isFinite(n)) return null;
    return n;
  }

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

    const vmin = layerCfg.min;
    const vmax = layerCfg.max;

    for (let i = 0; i < nx * ny; i++) {
      const raw = normalizeScalar(values[i]);
      const p = i * 4;

      if (raw == null) {
        img.data[p + 0] = 0;
        img.data[p + 1] = 0;
        img.data[p + 2] = 0;
        img.data[p + 3] = 0; // trasparente
        continue;
      }

      const t = (raw - vmin) / (vmax - vmin);
      const c = layerCfg.color(t);

      img.data[p + 0] = c[0];
      img.data[p + 1] = c[1];
      img.data[p + 2] = c[2];
      img.data[p + 3] = c[3] ?? 255;
    }

    ctx.putImageData(img, 0, 0);

    const bounds = gridBounds(bbox);
    const overlay = L.imageOverlay(canvas.toDataURL("image/png"), bounds, {
      opacity: 0.85,
      interactive: false
    });

    return overlay;
  }

  async function loadGrid(prefix, stepIndex) {
    const file = `${prefix}${pad3(stepIndex)}.json`;
    const url = `${DATA_DIR}/${file}?v=${CACHE_V}`;
    const txt = await fetchText(url);
    return safeJsonParse(txt);
  }

  async function updateLayers() {
    if (!meta) return;

    setStatus("");

    const idx = Number(timeSlider.value) || 0;
    currentIndex = idx;

    timeLabel.textContent = fmtHourLabel(idx);
    runLabel.textContent = `Run: ${meta.run || "—"} — ${fmtHourLabel(idx)}`;
    sourceLabel.textContent = `Fonte dati: ${meta.source || "—"}`;

    // TEMP
    if (chkTemp.checked) {
      try {
        const grid = await loadGrid(LAYERS.temp.filePrefix, idx);
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
        const grid = await loadGrid(LAYERS.rain.filePrefix, idx);
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
        const grid = await loadGrid(LAYERS.pres.filePrefix, idx);
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
        const grid = await loadGrid(LAYERS.wind.filePrefix, idx);
        removeOverlay("wind");

        // Se il file vento fosse scalare (o sbagliato), qui te ne accorgi subito
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
    try {
      meta = await loadMeta();

      // slider setup
      const n = Array.isArray(meta.times) ? meta.times.length : 1;
      timeSlider.min = 0;
      timeSlider.max = Math.max(0, n - 1);
      timeSlider.value = 0;

      timeLabel.textContent = fmtHourLabel(0);
      runLabel.textContent = `Run: ${meta.run || "—"} — ${fmtHourLabel(0)}`;
      sourceLabel.textContent = `Fonte dati: ${meta.source || "—"}`;

      // aggiorna overlay in base alle checkbox
      await updateLayers();

    } catch (e) {
      setStatus(`Errore meta: ${e.message}`);
    }
  }

  // Eventi
  btnReload.addEventListener("click", () => hardReloadData());

  timeSlider.addEventListener("input", () => {
    // update “live”
    updateLayers();
  });

  chkTemp.addEventListener("change", updateLayers);
  chkRain.addEventListener("change", updateLayers);
  chkPres.addEventListener("change", updateLayers);
  chkWind.addEventListener("change", updateLayers);

  // Avvio
  hardReloadData();
})();
