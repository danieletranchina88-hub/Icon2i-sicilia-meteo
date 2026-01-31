// app.js
// Gestisce: mappa Leaflet, cache-busting, caricamento meta, slider, layer scalari raster + vento.

(function () {
  const $ = (id) => document.getElementById(id);

  const statusEl = $("status");
  const runLabel = $("runLabel");
  const hourLabel = $("hourLabel");
  const hourSlider = $("hourSlider");
  const reloadBtn = $("reloadBtn");

  let version = Date.now();          // cache-buster
  let meta = null;                   // data/meta.json
  let activeKey = null;              // "temp" | "rain" | "pres" | "wind"
  let activeLayer = null;            // Leaflet layer corrente

  // Mappa
  const map = L.map("map", {
    zoomControl: true,
    preferCanvas: true
  });

  // Base OSM (come mi hai chiesto)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(map);

  // Inquadra Sicilia circa
  map.setView([37.4, 14.1], 7);

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg || "";
    statusEl.className = "status" + (isError ? " error" : "");
  }

  function pad3(n) {
    return String(n).padStart(3, "0");
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
    return await res.text();
  }

  async function loadJSONSanitized(url) {
    // scarico come testo e sostituisco NaN/Infinity con null così diventa JSON valido
    const raw = await fetchText(url);
    const fixed = raw
      .replace(/\bNaN\b/g, "null")
      .replace(/\bInfinity\b/g, "null")
      .replace(/\b-Infinity\b/g, "null");
    return JSON.parse(fixed);
  }

  function clearActiveLayer() {
    if (activeLayer) {
      map.removeLayer(activeLayer);
      activeLayer = null;
    }
  }

  // Palette: interpolazione tra colori
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }

  function colorFromPalette(palette, t) {
    if (!palette || palette.length === 0) return [0, 0, 0, 0];
    t = clamp01(t);

    // palette può contenere anche RGBA (4 componenti) per rain
    const n = palette.length;
    const x = t * (n - 1);
    const i = Math.floor(x);
    const f = x - i;

    const c0 = palette[i];
    const c1 = palette[Math.min(n - 1, i + 1)];

    const r0 = c0[0], g0 = c0[1], b0 = c0[2], a0 = (c0.length === 4 ? c0[3] : 255);
    const r1 = c1[0], g1 = c1[1], b1 = c1[2], a1 = (c1.length === 4 ? c1[3] : 255);

    const r = Math.round(r0 + (r1 - r0) * f);
    const g = Math.round(g0 + (g1 - g0) * f);
    const b = Math.round(b0 + (b1 - b0) * f);
    const a = Math.round(a0 + (a1 - a0) * f);

    return [r, g, b, a];
  }

  function renderScalarToDataURL(json, fieldCfg) {
    const nx = json.nx;
    const ny = json.ny;
    const values = json.values || [];
    const bbox = json.bbox;

    if (!nx || !ny || !bbox || bbox.length !== 4) {
      throw new Error("JSON layer: manca nx/ny/bbox");
    }

    const canvas = document.createElement("canvas");
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext("2d", { willReadFrequently: false });

    const img = ctx.createImageData(nx, ny);
    const data = img.data;

    const vmin = fieldCfg.vmin;
    const vmax = fieldCfg.vmax;
    const pal = fieldCfg.palette;

    // Assunzione: l’array è row-major e parte dal “nord” (y=0 -> maxLat).
    // Leaflet imageOverlay si aspetta che la riga 0 dell’immagine sia in alto (nord). Quindi così va bene.
    // Se un domani ti accorgi che è capovolta, basta invertire il calcolo di srcY (ma ora non lo faccio a caso).
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        const v = values[i];

        const p = (y * nx + x) * 4;

        if (v === null || v === undefined || !isFinite(v)) {
          data[p + 0] = 0;
          data[p + 1] = 0;
          data[p + 2] = 0;
          data[p + 3] = 0; // trasparente
          continue;
        }

        const t = (v - vmin) / (vmax - vmin);
        const [r, g, b, a] = colorFromPalette(pal, t);

        data[p + 0] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = a;
      }
    }

    ctx.putImageData(img, 0, 0);

    // un po’ di smoothing visivo per evitare look “a griglia”
    // (Leaflet poi scala l’immagine durante lo zoom)
    const url = canvas.toDataURL("image/png");
    return { url, bbox };
  }

  async function showScalarLayer(key, hourIdx) {
    const cfg = window.FIELDS[key];
    if (!cfg) throw new Error(`Layer sconosciuto: ${key}`);

    const file = cfg.prefix + pad3(hourIdx) + ".json";
    const url = `${file}?v=${version}`;

    setStatus(`Carico ${cfg.label} (${pad3(hourIdx)})…`);

    const json = await loadJSONSanitized(url);

    const rendered = renderScalarToDataURL(json, cfg);
    const bbox = rendered.bbox;

    const bounds = L.latLngBounds(
      [bbox[1], bbox[0]], // minLat, minLon
      [bbox[3], bbox[2]]  // maxLat, maxLon
    );

    const overlay = L.imageOverlay(rendered.url, bounds, {
      opacity: 0.72,
      interactive: false
    });

    clearActiveLayer();
    activeLayer = overlay.addTo(map);

    setStatus("");
  }

  async function showWindLayer(hourIdx) {
    const file = "data/wind_" + pad3(hourIdx) + ".json";
    const url = `${file}?v=${version}`;

    setStatus(`Carico Vento (${pad3(hourIdx)})…`);

    const json = await loadJSONSanitized(url);

    const layer = window.createWindLayer(json, map);

    clearActiveLayer();
    activeLayer = layer.addTo(map);

    setStatus("");
  }

  function getSelectedKey() {
    const r = document.querySelector('input[name="layer"]:checked');
    return r ? r.value : null;
  }

  function updateHourLabel() {
    const idx = Number(hourSlider.value || 0);
    if (meta && Array.isArray(meta.times) && meta.times[idx]) {
      hourLabel.textContent = meta.times[idx];
    } else {
      hourLabel.textContent = String(idx);
    }
  }

  async function loadMeta() {
    // Se non esiste meta.json, il sito funziona lo stesso, solo slider “base”
    const url = `data/meta.json?v=${version}`;
    try {
      const m = await loadJSONSanitized(url);
      meta = m;
      if (meta.run) runLabel.textContent = meta.run;
      if (meta.times && meta.times.length) {
        hourSlider.max = String(meta.times.length - 1);
      } else {
        hourSlider.max = "47";
      }
    } catch (e) {
      meta = null;
      runLabel.textContent = "—";
      hourSlider.max = "47";
    }
    updateHourLabel();
  }

  async function refreshCurrent() {
    const key = getSelectedKey();
    activeKey = key;

    if (!key) {
      clearActiveLayer();
      return;
    }

    const hourIdx = Number(hourSlider.value || 0);

    try {
      if (key === "wind") {
        await showWindLayer(hourIdx);
      } else {
        await showScalarLayer(key, hourIdx);
      }
    } catch (e) {
      clearActiveLayer();
      setStatus(String(e.message || e), true);
      console.error(e);
    }
  }

  function wireUI() {
    document.querySelectorAll('input[name="layer"]').forEach((el) => {
      el.addEventListener("change", () => {
        refreshCurrent();
      });
    });

    hourSlider.addEventListener("input", () => {
      updateHourLabel();
    });

    hourSlider.addEventListener("change", () => {
      refreshCurrent();
    });

    reloadBtn.addEventListener("click", async () => {
      // cache-busting “forte”
      version = Date.now();
      setStatus("Ricarico (forzo cache)…");
      await loadMeta();
      await refreshCurrent();
      setStatus("");
    });
  }

  async function boot() {
    wireUI();
    await loadMeta();

    // Layer di default (metti quello che vuoi)
    $("layerWind").checked = true;
    activeKey = "wind";

    await refreshCurrent();
  }

  boot();
})();
