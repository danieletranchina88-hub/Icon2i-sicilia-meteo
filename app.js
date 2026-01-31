import { FIELDS } from "./fields.js";
import { buildWindGeoJSON } from "./wind.js";

// 🔁 AUMENTA questo numero ogni volta che aggiorni (bypass cache)
const VERSION = 999;

// ✅ Se i layer sembrano “capovolti”, lascia true.
// Se noti che diventa peggio, metti false.
const FLIP_Y = true;

const BASE = ".";

const els = {
  btnReload: document.getElementById("btnReload"),
  status: document.getElementById("status"),
  hour: document.getElementById("hour"),
  hourLabel: document.getElementById("hourLabel"),
  runLabel: document.getElementById("runLabel"),
  srcLabel: document.getElementById("srcLabel"),

  chkTemp: document.getElementById("chkTemp"),
  chkRain: document.getElementById("chkRain"),
  chkPres: document.getElementById("chkPres"),
  chkWind: document.getElementById("chkWind"),
};

let map;
let meta = null;
let hourIndex = 0;

const active = {
  temp: false,
  rain: false,
  pres: false,
  wind: false,
};

function setStatus(msg = "", isError = false) {
  if (!els.status) return;
  els.status.style.color = isError ? "#ffb1b1" : "#bfe7c5";
  els.status.textContent = msg;
}

function q(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${VERSION}`;
}

async function fetchText(url) {
  const res = await fetch(q(url), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
  return await res.text();
}

// accetta JSON che contiene NaN/Infinity (li sostituisce con null)
function safeJsonParse(text) {
  const cleaned = text
    .replace(/\bNaN\b/g, "null")
    .replace(/\bInfinity\b/g, "null")
    .replace(/\b-Infinity\b/g, "null");
  return JSON.parse(cleaned);
}

async function loadMeta() {
  const txt = await fetchText(`${BASE}/data/meta.json`);
  const m = safeJsonParse(txt);

  if (!m.times || !Array.isArray(m.times)) throw new Error("meta.json: manca 'times' (array).");
  if (!m.bbox || m.bbox.length !== 4) throw new Error("meta.json: manca 'bbox' [W,S,E,N].");
  if (!m.nx || !m.ny) throw new Error("meta.json: mancano 'nx' e/o 'ny'.");

  // normalizza bbox
  let [w, s, e, n] = m.bbox;
  if (w > e) [w, e] = [e, w];
  if (s > n) [s, n] = [n, s];
  m.bbox = [w, s, e, n];

  return m;
}

function initMap() {
  const style = {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        ],
        tileSize: 256,
        attribution: "© OpenStreetMap © CARTO",
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "carto" }],
  };

  map = new maplibregl.Map({
    container: "map",
    style,
    center: [14.0, 37.4],
    zoom: 6.3,
    attributionControl: true,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

/**
 * JSON layer -> punti GeoJSON.
 * Supporta:
 * - { values: [...] }
 * - { data: [...] }
 * - array puro [...]
 */
function getValuesArray(obj) {
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.values)) return obj.values;
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.vals)) return obj.vals;
  // ultimo tentativo: se l’oggetto ha una sola proprietà array
  for (const k of Object.keys(obj)) {
    if (Array.isArray(obj[k])) return obj[k];
  }
  return null;
}

function buildPointsGeoJSON(layerObj, metaObj) {
  const nx = metaObj.nx;
  const ny = metaObj.ny;
  const [w, s, e, n] = metaObj.bbox;

  const dx = (e - w) / nx;
  const dy = (n - s) / ny;

  const values = getValuesArray(layerObj);
  if (!values) throw new Error("Formato layer: non trovo l'array dei valori (values/data/array).");
  if (values.length < nx * ny) throw new Error(`Valori insufficienti: ${values.length} < ${nx * ny}`);

  const features = [];
  const step = 1; // se vuoi alleggerire su mobile: 2 o 3

  for (let j = 0; j < ny; j += step) {
    for (let i = 0; i < nx; i += step) {
      const jj = FLIP_Y ? (ny - 1 - j) : j;
      const idx = jj * nx + i;

      const v = values[idx];
      if (v == null || Number.isNaN(v)) continue;

      const lon = w + (i + 0.5) * dx;
      const lat = s + (j + 0.5) * dy;

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { v },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

function ensureFieldLayer(fieldKey) {
  const def = FIELDS[fieldKey];
  if (!def) throw new Error(`FIELDS: manca definizione per ${fieldKey}`);

  const sourceId = `src_${def.id}`;
  const layerId = `lyr_${def.id}`;

  if (map.getLayer(layerId)) return;

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  const stops = def.style?.colorStops;
  if (!stops || !Array.isArray(stops) || stops.length < 2) {
    throw new Error(`FIELDS.${fieldKey}.style.colorStops non valido`);
  }

  // gradient per heatmap-density (0..1)
  const minV = stops[0][0];
  const maxV = stops[stops.length - 1][0];
  const pairs = [];
  for (const [val, col] of stops) {
    const t = (val - minV) / (maxV - minV || 1);
    pairs.push(Math.min(1, Math.max(0, t)), col);
  }

  map.addLayer({
    id: layerId,
    type: "heatmap",
    source: sourceId,
    paint: {
      "heatmap-weight": [
        "interpolate",
        ["linear"],
        ["get", "v"],
        minV, 0,
        maxV, 1
      ],
      "heatmap-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5, 12,
        7, 22,
        9, 35,
        11, 55
      ],
      "heatmap-opacity": 0.85,
      "heatmap-intensity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5, 0.8,
        10, 1.3
      ],
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0, "rgba(0,0,0,0)",
        ...pairs
      ],
    },
  });
}

async function updateField(fieldKey) {
  const def = FIELDS[fieldKey];
  ensureFieldLayer(fieldKey);

  const sourceId = `src_${def.id}`;
  const hh = pad3(hourIndex);
  const url = `${BASE}/data/${def.filePrefix}_${hh}.json`;

  const txt = await fetchText(url);
  const obj = safeJsonParse(txt);
  const gj = buildPointsGeoJSON(obj, meta);

  map.getSource(sourceId).setData(gj);
}

function ensureWindLayer() {
  const sourceId = "src_wind";
  const layerId = "lyr_wind";

  if (map.getLayer(layerId)) return;

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  map.addLayer({
    id: layerId,
    type: "line",
    source: sourceId,
    paint: {
      "line-width": 1.6,
      "line-opacity": 0.9,
      "line-color": [
        "interpolate", ["linear"], ["get", "spd"],
        0,  "#2a6bff",
        5,  "#00c2ff",
        10, "#00d68f",
        15, "#ffd24a",
        20, "#ff8a3d",
        30, "#ff3b3b",
      ],
    },
  });
}

async function updateWind() {
  ensureWindLayer();

  const hh = pad3(hourIndex);
  const url = `${BASE}/data/wind_${hh}.json`;

  const txt = await fetchText(url);
  const obj = safeJsonParse(txt);

  const gj = buildWindGeoJSON(meta, obj, 10);
  map.getSource("src_wind").setData(gj);
}

function setHourUI(idx) {
  hourIndex = idx;
  if (els.hour) els.hour.value = String(idx);
  if (els.hourLabel) els.hourLabel.textContent = String(idx);

  const t = meta?.times?.[idx] ?? `+${idx}h`;
  if (els.runLabel) els.runLabel.textContent = `Run: ${meta?.run ?? "—"} — ${t}`;
}

async function refreshActiveLayers() {
  if (!meta) return;

  try {
    setStatus("Carico layer…", false);
    if (active.temp) await updateField("temp");
    if (active.rain) await updateField("rain");
    if (active.pres) await updateField("pres");
    if (active.wind) await updateWind();
    setStatus("", false);
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

function clearLayerByDef(def) {
  const sourceId = `src_${def.id}`;
  const src = map.getSource(sourceId);
  if (src) src.setData({ type: "FeatureCollection", features: [] });
}

function wireUI() {
  els.btnReload?.addEventListener("click", async () => {
    try {
      setStatus("Scarico meta.json…", false);
      meta = await loadMeta();

      if (els.hour) {
        els.hour.min = "0";
        els.hour.max = String(Math.max(0, meta.times.length - 1));
      }
      setHourUI(Math.min(hourIndex, meta.times.length - 1));

      if (els.srcLabel) {
        els.srcLabel.textContent = `Fonte dati: ${meta.source ?? "MeteoHub / Agenzia ItaliaMeteo — ICON-2I open data"}`;
      }

      await refreshActiveLayers();
      setStatus("", false);
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  });

  els.hour?.addEventListener("input", async (ev) => {
    setHourUI(Number(ev.target.value || 0));
    await refreshActiveLayers();
  });

  els.chkTemp?.addEventListener("change", async (ev) => {
    active.temp = ev.target.checked;
    if (!active.temp) clearLayerByDef(FIELDS.temp);
    await refreshActiveLayers();
  });

  els.chkRain?.addEventListener("change", async (ev) => {
    active.rain = ev.target.checked;
    if (!active.rain) clearLayerByDef(FIELDS.rain);
    await refreshActiveLayers();
  });

  els.chkPres?.addEventListener("change", async (ev) => {
    active.pres = ev.target.checked;
    if (!active.pres) clearLayerByDef(FIELDS.pres);
    await refreshActiveLayers();
  });

  els.chkWind?.addEventListener("change", async (ev) => {
    active.wind = ev.target.checked;
    if (!active.wind) {
      const src = map.getSource("src_wind");
      if (src) src.setData({ type: "FeatureCollection", features: [] });
    }
    await refreshActiveLayers();
  });
}

function boot() {
  initMap();

  map.on("load", async () => {
    wireUI();

    try {
      setStatus("Boot…", false);
      meta = await loadMeta();

      if (els.hour) {
        els.hour.min = "0";
        els.hour.max = String(Math.max(0, meta.times.length - 1));
      }
      setHourUI(0);

      if (els.srcLabel) {
        els.srcLabel.textContent = `Fonte dati: ${meta.source ?? "MeteoHub / Agenzia ItaliaMeteo — ICON-2I open data"}`;
      }

      setStatus("", false);
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  });
}

boot();
