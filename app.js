/* =========================
   CONFIG
========================= */
const DATA_DIR = "./data"; // deve esistere: /data/temp_000.json ecc.
const CACHE_BUST = () => `v=${Date.now()}`;

/* File naming */
const FILES = {
  temp: (h) => `${DATA_DIR}/temp_${String(h).padStart(3, "0")}.json`,
  pres: (h) => `${DATA_DIR}/pres_${String(h).padStart(3, "0")}.json`,
  rain: (h) => `${DATA_DIR}/rain_${String(h).padStart(3, "0")}.json`,
  wind: (h) => `${DATA_DIR}/wind_${String(h).padStart(3, "0")}.json`,
  runMeta:   () => `${DATA_DIR}/run.json`, // opzionale
};

/* =========================
   UI refs
========================= */
const el = {
  btnReload: document.getElementById("btnReload"),
  chkTemp: document.getElementById("chkTemp"),
  chkRain: document.getElementById("chkRain"),
  chkPres: document.getElementById("chkPres"),
  chkWind: document.getElementById("chkWind"),
  sliderHour: document.getElementById("sliderHour"),
  lblTime: document.getElementById("lblTime"),
  lblRun: document.getElementById("lblRun"),
  lblStatus: document.getElementById("lblStatus"),
  lblPoint: document.getElementById("lblPoint"),
  lblValue: document.getElementById("lblValue"),
};

/* =========================
   Map init
========================= */
const map = L.map("map", {
  zoomControl: true,
  preferCanvas: true,
});

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
});
osm.addTo(map);

/* Sicilia-ish view */
map.setView([37.55, 14.25], 7);

/* =========================
   Helpers
========================= */
function setStatus(msg) {
  el.lblStatus.textContent = msg;
}

function safeNumber(x) {
  if (x === null || x === undefined) return null;
  if (Number.isNaN(x)) return null;
  if (x === "NaN") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function parseRunToDateUTC(runStr) {
  // runStr: "YYYYMMDDHH" in UTC
  if (!runStr || runStr.length !== 10) return null;
  const y = Number(runStr.slice(0, 4));
  const m = Number(runStr.slice(4, 6)) - 1;
  const d = Number(runStr.slice(6, 8));
  const h = Number(runStr.slice(8, 10));
  return new Date(Date.UTC(y, m, d, h, 0, 0));
}

function formatDateRome(dt) {
  // Visualizza in Europe/Rome
  const fmt = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return fmt.format(dt);
}

/* Bilinear sampling on regular lat/lon grid */
function bilinearSample(grid, lon, lat) {
  // grid: {nx, ny, bbox:[lonMin, latMin, lonMax, latMax], values:Array}
  // values are row-major from north->south? unknown. We handle both by trying "lat reversed" consistently.
  const { nx, ny, bbox } = grid;
  const values = grid.values;
  const lonMin = bbox[0], latMin = bbox[1], lonMax = bbox[2], latMax = bbox[3];

  if (lon < lonMin || lon > lonMax || lat < latMin || lat > latMax) return null;

  // x: 0..nx-1
  const x = (lon - lonMin) / (lonMax - lonMin) * (nx - 1);

  // Many grids are stored top->bottom (north->south). bbox latMin..latMax is bottom..top.
  // We'll map lat to y with north at y=0.
  const yNorth = (latMax - lat) / (latMax - latMin) * (ny - 1);

  const x0 = Math.floor(x), x1 = Math.min(x0 + 1, nx - 1);
  const y0 = Math.floor(yNorth), y1 = Math.min(y0 + 1, ny - 1);

  const dx = x - x0;
  const dy = yNorth - y0;

  function v(ix, iy) {
    const idx = iy * nx + ix;
    const n = safeNumber(values[idx]);
    return n;
  }

  const v00 = v(x0, y0); const v10 = v(x1, y0);
  const v01 = v(x0, y1); const v11 = v(x1, y1);

  // If too many nulls, return null
  const candidates = [v00, v10, v01, v11].filter(x => x !== null);
  if (candidates.length < 2) return null;

  // Replace nulls with nearest available to avoid holes on coasts
  const fill = (a, b, c, d) => {
    const arr = [a, b, c, d];
    const first = arr.find(z => z !== null);
    return first === undefined ? null : first;
  };
  const f00 = v00 ?? fill(v10, v01, v11, null);
  const f10 = v10 ?? fill(v00, v11, v01, null);
  const f01 = v01 ?? fill(v00, v11, v10, null);
  const f11 = v11 ?? fill(v10, v01, v00, null);

  const i0 = f00 * (1 - dx) + f10 * dx;
  const i1 = f01 * (1 - dx) + f11 * dx;
  return i0 * (1 - dy) + i1 * dy;
}

/* =========================
   Color ramps
========================= */
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(t) { return Math.max(0, Math.min(1, t)); }

function rampBlueToRed(t) {
  // blu -> ciano -> verde -> giallo -> arancio -> rosso scuro
  t = clamp01(t);
  const stops = [
    { t: 0.00, c: [0, 80, 255, 210] },   // blue
    { t: 0.20, c: [0, 200, 255, 210] },  // cyan
    { t: 0.40, c: [0, 220, 120, 210] },  // green
    { t: 0.60, c: [255, 230, 0, 215] },  // yellow
    { t: 0.78, c: [255, 140, 0, 220] },  // orange
    { t: 1.00, c: [170, 0, 0, 235] },    // dark red
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const u = (t - a.t) / (b.t - a.t || 1);
  return [
    Math.round(lerp(a.c[0], b.c[0], u)),
    Math.round(lerp(a.c[1], b.c[1], u)),
    Math.round(lerp(a.c[2], b.c[2], u)),
    Math.round(lerp(a.c[3], b.c[3], u)),
  ];
}

function rampTempC(v) {
  // -5..40°C
  const t = clamp01((v - (-5)) / (40 - (-5)));
  return rampBlueToRed(t);
}

function rampPresHpa(v) {
  // 980..1040 hPa
  const t = clamp01((v - 980) / (1040 - 980));
  return rampBlueToRed(t);
}

function rampRainMmH(v) {
  // 0..20 mm/h
  const t = clamp01(v / 20);
  // per pioggia: più “freddo” all’inizio, poi rosso
  return rampBlueToRed(t);
}

/* =========================
   Canvas scalar layer
========================= */
function makeScalarCanvasLayer({ name, getGrid, valueToRgba, valueLabel }) {
  let layer = null;

  const ScalarLayer = L.Layer.extend({
    onAdd: function(map) {
      this._map = map;
      this._canvas = L.DomUtil.create("canvas", "scalar-canvas");
      this._canvas.style.position = "absolute";
      this._canvas.style.pointerEvents = "none";
      const pane = map.getPanes().overlayPane;
      pane.appendChild(this._canvas);

      this._ctx = this._canvas.getContext("2d", { willReadFrequently: false });

      map.on("moveend zoomend resize", this._redraw, this);
      this._redraw();
    },
    onRemove: function(map) {
      map.off("moveend zoomend resize", this._redraw, this);
      if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
      this._map = null;
      this._canvas = null;
      this._ctx = null;
    },
    _redraw: function() {
      if (!this._map || !this._canvas || !this._ctx) return;
      const size = this._map.getSize();
      this._canvas.width = size.x;
      this._canvas.height = size.y;

      const grid = getGrid();
      if (!grid) return;

      // Performance: render on a smaller offscreen buffer then scale up
      const maxDim = 520; // mobile-friendly
      const scale = Math.min(1, maxDim / Math.max(size.x, size.y));
      const w = Math.max(2, Math.round(size.x * scale));
      const h = Math.max(2, Math.round(size.y * scale));

      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const octx = off.getContext("2d");

      const img = octx.createImageData(w, h);
      const data = img.data;

      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const px = (i / (w - 1)) * size.x;
          const py = (j / (h - 1)) * size.y;
          const ll = this._map.containerPointToLatLng([px, py]);

          const val = bilinearSample(grid, ll.lng, ll.lat);
          const idx = (j * w + i) * 4;

          if (val === null) {
            data[idx + 3] = 0;
            continue;
          }

          const rgba = valueToRgba(val);
          data[idx + 0] = rgba[0];
          data[idx + 1] = rgba[1];
          data[idx + 2] = rgba[2];
          data[idx + 3] = rgba[3];
        }
      }

      octx.putImageData(img, 0, 0);

      this._ctx.clearRect(0, 0, size.x, size.y);
      this._ctx.imageSmoothingEnabled = true;
      this._ctx.drawImage(off, 0, 0, size.x, size.y);
    }
  });

  layer = new ScalarLayer();

  return {
    name,
    layer,
    valueLabel, // function(val) -> string
    getValueAtLatLng: (latlng) => {
      const grid = getGrid();
      if (!grid) return null;
      return bilinearSample(grid, latlng.lng, latlng.lat);
    }
  };
}

/* =========================
   Wind layer (leaflet-velocity)
========================= */
function makeWindLayer({ getWindGrid, speedToColorScale }) {
  let velocityLayer = null;

  function buildVelocityData(wind) {
    // expected wind: {nx, ny, bbox, u, v}
    const nx = wind.nx, ny = wind.ny;
    const [lonMin, latMin, lonMax, latMax] = wind.bbox;

    // Leaflet-velocity expects GRIB-like headers
    const headerBase = {
      lo1: lonMin,
      la1: latMax,      // north
      lo2: lonMax,
      la2: latMin,      // south
      dx: (lonMax - lonMin) / (nx - 1),
      dy: (latMax - latMin) / (ny - 1),
      nx,
      ny,
      refTime: new Date().toISOString(),
      forecastTime: 0,
      gridDefinitionTemplate: 0,
    };

    const uComp = {
      header: {
        ...headerBase,
        parameterCategory: 2,
        parameterNumber: 2,
        parameterNumberName: "eastward_wind",
        parameterUnit: "m.s-1",
      },
      data: wind.u.map(x => (safeNumber(x) ?? null)),
    };

    const vComp = {
      header: {
        ...headerBase,
        parameterCategory: 2,
        parameterNumber: 3,
        parameterNumberName: "northward_wind",
        parameterUnit: "m.s-1",
      },
      data: wind.v.map(x => (safeNumber(x) ?? null)),
    };

    return [uComp, vComp];
  }

  function makeColorScale() {
    // leaflet-velocity uses an array of [value, color] pairs (m/s)
    // Convert km/h scale idea to m/s for rendering.
    // 0 km/h -> 0 m/s ; 100 km/h -> 27.78 m/s
    const pts = [];
    const maxMs = 28;
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const ms = (i / steps) * maxMs;
      const t = i / steps;
      const rgba = rampBlueToRed(t);
      const color = `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3]/255})`;
      pts.push([ms, color]);
    }
    return pts;
  }

  return {
    ensureOnMap: () => {
      if (velocityLayer) return velocityLayer;

      const scale = makeColorScale();

      velocityLayer = L.velocityLayer({
        displayValues: false,
        displayOptions: { velocityType: "Wind" },
        data: [],
        velocityScale: 0.02,   // particle speed
        particleAge: 60,
        particleMultiplier: 1 / 220, // density
        frameRate: 20,
        lineWidth: 2,
        colorScale: scale,
      });

      return velocityLayer;
    },
    setData: (windGrid) => {
      const layer = velocityLayer;
      if (!layer) return;
      if (!windGrid) return;

      if (!Array.isArray(windGrid.u) || !Array.isArray(windGrid.v)) {
        setStatus("Vento: manca u/v nel JSON (serve u e v).");
        return;
      }
      if (windGrid.u.length !== windGrid.v.length) {
        setStatus("Vento: u e v hanno lunghezze diverse.");
        return;
      }

      const data = buildVelocityData(windGrid);
      layer.setData(data);
    },
    getValueAtLatLng: (latlng) => {
      const wind = getWindGrid();
      if (!wind || !wind.u || !wind.v) return null;
      // velocità = sqrt(u^2+v^2) (m/s)
      const u = bilinearSample({ ...wind, values: wind.u, nx: wind.nx, ny: wind.ny, bbox: wind.bbox }, latlng.lng, latlng.lat);
      const v = bilinearSample({ ...wind, values: wind.v, nx: wind.nx, ny: wind.ny, bbox: wind.bbox }, latlng.lng, latlng.lat);
      if (u === null || v === null) return null;
      return Math.sqrt(u*u + v*v);
    }
  };
}

/* =========================
   State + data cache
========================= */
let runStr = null;          // "YYYYMMDDHH"
let runDateUTC = null;
let maxHour = 0;
let currentHour = 0;

const cache = {
  temp: new Map(),
  pres: new Map(),
  rain: new Map(),  // stored as original (likely accum)
  wind: new Map(),
};

function activeLayerName() {
  if (el.chkWind.checked) return "wind";
  if (el.chkTemp.checked) return "temp";
  if (el.chkRain.checked) return "rain";
  if (el.chkPres.checked) return "pres";
  return null;
}

/* =========================
   Fetchers
========================= */
async function fetchJson(url) {
  const full = `${url}?${CACHE_BUST()}`;
  const r = await fetch(full, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} su ${url}`);
  return await r.json();
}

async function loadMeta() {
  // Prova a leggere data/run.json, se non esiste non deve spaccare tutto.
  try {
    const meta = await fetchJson(FILES.runMeta());
    // meta possibili:
    // { "run": "2026013112", "hours": 48, "source": "..." }
    if (meta && meta.run) {
      runStr = String(meta.run);
      runDateUTC = parseRunToDateUTC(runStr);
    }
    if (meta && meta.hours) {
      maxHour = Math.max(0, Number(meta.hours) - 1);
    }
    const src = meta && meta.source ? String(meta.source) : "MeteoHub / Agenzia ItaliaMeteo — ICON-2I open data";
    setStatus("OK");
    return src;
  } catch (e) {
    // fallback: prova a dedurre run dal nome in pagina precedente: NON si può senza lista directory,
    // quindi usiamo un fallback "run sconosciuto" ma i layer possono comunque caricarsi se i file esistono.
    runStr = null;
    runDateUTC = null;
    maxHour = 47; // default
    setStatus("Meta assente: uso fallback ore 0..47");
    return "MeteoHub / Agenzia ItaliaMeteo — ICON-2I open data";
  }
}

async function getGrid(kind, hour) {
  const m = cache[kind];
  if (m.has(hour)) return m.get(hour);

  const url =
    kind === "temp" ? FILES.temp(hour) :
    kind === "pres" ? FILES.pres(hour) :
    kind === "rain" ? FILES.rain(hour) :
    kind === "wind" ? FILES.wind(hour) : null;

  if (!url) return null;

  const json = await fetchJson(url);
  m.set(hour, json);
  return json;
}

/* =========================
   Layers
========================= */
let scalarTemp = null;
let scalarPres = null;
let scalarRain = null;

let wind = null;

function rainHourlyFromAccum(rainNow, rainPrev) {
  // rainNow.values may contain NaN at coast; handle nulls gracefully
  if (!rainNow || !rainNow.values) return null;
  if (!rainPrev || !rainPrev.values) return rainNow; // hour 0
  const out = {
    nx: rainNow.nx,
    ny: rainNow.ny,
    bbox: rainNow.bbox,
    values: new Array(rainNow.values.length),
  };
  for (let i = 0; i < out.values.length; i++) {
    const a = safeNumber(rainNow.values[i]);
    const b = safeNumber(rainPrev.values[i]);
    if (a === null && b === null) { out.values[i] = null; continue; }
    if (a === null && b !== null) { out.values[i] = null; continue; }
    if (a !== null && b === null) { out.values[i] = a; continue; }
    const d = a - b;
    out.values[i] = (Number.isFinite(d) ? Math.max(0, d) : null);
  }
  return out;
}

async function ensureLayers() {
  scalarTemp = makeScalarCanvasLayer({
    name: "temp",
    getGrid: () => cache.temp.get(currentHour) || null,
    valueToRgba: (v) => rampTempC(v),
    valueLabel: (v) => `${v.toFixed(1)} °C`,
  });

  scalarPres = makeScalarCanvasLayer({
    name: "pres",
    getGrid: () => cache.pres.get(currentHour) || null,
    valueToRgba: (v) => rampPresHpa(v),
    valueLabel: (v) => `${v.toFixed(1)} hPa`,
  });

  scalarRain = makeScalarCanvasLayer({
    name: "rain",
    getGrid: () => cache.rainHourly?.get(currentHour) || null,
    valueToRgba: (v) => rampRainMmH(v),
    valueLabel: (v) => `${v.toFixed(2)} mm/h`,
  });

  // wind layer
  wind = makeWindLayer({
    getWindGrid: () => cache.wind.get(currentHour) || null,
  });

  // init rainHourly map
  if (!cache.rainHourly) cache.rainHourly = new Map();
}

function clearAllOverlays() {
  // remove scalar layers if present
  if (scalarTemp?.layer && map.hasLayer(scalarTemp.layer)) map.removeLayer(scalarTemp.layer);
  if (scalarPres?.layer && map.hasLayer(scalarPres.layer)) map.removeLayer(scalarPres.layer);
  if (scalarRain?.layer && map.hasLayer(scalarRain.layer)) map.removeLayer(scalarRain.layer);

  // remove wind
  const w = wind?.ensureOnMap?.();
  if (w && map.hasLayer(w)) map.removeLayer(w);
}

function syncOverlayVisibility() {
  clearAllOverlays();

  // Exclusive-ish: se selezioni vento, gli altri si spengono automaticamente per non fare casino
  // (se vuoi sovrapporre in futuro lo facciamo, ma ora ti serve stabile)
  const any = el.chkWind.checked || el.chkTemp.checked || el.chkRain.checked || el.chkPres.checked;
  if (!any) return;

  if (el.chkWind.checked) {
    const wLayer = wind.ensureOnMap();
    wLayer.addTo(map);
    wind.setData(cache.wind.get(currentHour) || null);
    return;
  }

  if (el.chkTemp.checked) scalarTemp.layer.addTo(map);
  if (el.chkRain.checked) scalarRain.layer.addTo(map);
  if (el.chkPres.checked) scalarPres.layer.addTo(map);
}

/* =========================
   Click readout
========================= */
function updatePointReadout(latlng) {
  const name = activeLayerName();
  if (!name) {
    el.lblPoint.textContent = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
    el.lblValue.textContent = "— (attiva un layer)";
    return;
  }

  el.lblPoint.textContent = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;

  if (name === "temp") {
    const v = scalarTemp.getValueAtLatLng(latlng);
    el.lblValue.textContent = v === null ? "—" : scalarTemp.valueLabel(v);
  } else if (name === "pres") {
    const v = scalarPres.getValueAtLatLng(latlng);
    el.lblValue.textContent = v === null ? "—" : scalarPres.valueLabel(v);
  } else if (name === "rain") {
    const v = scalarRain.getValueAtLatLng(latlng);
    el.lblValue.textContent = v === null ? "—" : scalarRain.valueLabel(v);
  } else if (name === "wind") {
    const ms = wind.getValueAtLatLng(latlng);
    if (ms === null) {
      el.lblValue.textContent = "—";
    } else {
      const kmh = ms * 3.6;
      el.lblValue.textContent = `${kmh.toFixed(1)} km/h`;
    }
  }
}

/* =========================
   Time slider label
========================= */
function refreshTimeLabel() {
  if (runDateUTC) {
    const dt = new Date(runDateUTC.getTime() + currentHour * 3600 * 1000);
    el.lblTime.textContent = `${formatDateRome(dt)}  (+${currentHour}h)`;
    el.lblRun.textContent = runStr;
  } else {
    el.lblTime.textContent = `+${currentHour}h`;
    el.lblRun.textContent = "—";
  }
}

/* =========================
   Loading pipeline
========================= */
async function loadHourData(hour) {
  currentHour = hour;
  el.sliderHour.value = String(hour);
  refreshTimeLabel();

  // load scalar grids
  const [t, p, r, w] = await Promise.allSettled([
    getGrid("temp", hour),
    getGrid("pres", hour),
    getGrid("rain", hour),
    getGrid("wind", hour),
  ]);

  // store successful ones
  if (t.status === "fulfilled") cache.temp.set(hour, t.value);
  if (p.status === "fulfilled") cache.pres.set(hour, p.value);
  if (r.status === "fulfilled") cache.rain.set(hour, r.value);
  if (w.status === "fulfilled") cache.wind.set(hour, w.value);

  // compute hourly rain (difference)
  try {
    const rainNow = cache.rain.get(hour) || null;
    const rainPrev = hour > 0 ? (cache.rain.get(hour - 1) || await getGrid("rain", hour - 1)) : null;
    const hourly = rainHourlyFromAccum(rainNow, rainPrev);
    if (hourly) cache.rainHourly.set(hour, hourly);
  } catch (e) {
    // ignore
  }

  // update overlays
  syncOverlayVisibility();
}

/* =========================
   UI behaviors (exclusive toggles)
========================= */
function setExclusive(active) {
  // active one true, others false
  el.chkTemp.checked = (active === "temp");
  el.chkRain.checked = (active === "rain");
  el.chkPres.checked = (active === "pres");
