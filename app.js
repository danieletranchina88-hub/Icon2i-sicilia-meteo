import { FIELDS } from "./fields.js";
import { buildWindGeoJSON } from "./wind.js";

// 🔁 Se cambi qualunque cosa e vuoi bypass cache mobile, aumenta VERSION (8, 9, 10...)
const VERSION = 7;

// Base URL (repo pages). Con percorso relativo funziona sia locale che su GitHub Pages.
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

// Stato layer attivi
const active = {
  temp: false,
  rain: false,
  pres: false,
  wind: false,
};

function setStatus(msg = "", isError = false) {
  els.status.style.color = isError ? "#ffb1b1" : "#bfe7c5";
  els.status.textContent = msg;
}

function q(url) {
  // cache bust per ogni fetch
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${VERSION}`;
}

async function fetchText(url) {
  const res = await fetch(q(url), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
  return await res.text();
}

function safeJsonParse(text) {
  // Se dentro ci sono NaN (che rende il JSON invalido), li trasformo in null
  // così il parse non esplode.
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

  return m;
}

function initMap() {
  // Stile MapLibre: raster basemap CARTO (molto più stabile su mobile di OSM diretto)
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
    layers: [
      {
        id: "basemap",
        type: "raster",
        source: "carto",
      },
    ],
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

function buildPointsGeoJSON(fieldValues, metaObj) {
  const nx = metaObj.nx;
  const ny = metaObj.ny;
  const [w, s, e, n] = metaObj.bbox;

  const dx = (e - w) / nx;
  const dy = (n - s) / ny;

  const values = fieldValues.values ?? fieldValues.vals ?? fieldValues.data ?? fieldValues;
  if (!Array.isArray(values)) throw new Error("Formato layer: manca array 'values' (o equivalente).");

  if (values.length < nx * ny) {
    throw new Error(`Valori insufficienti: ${values.length} < ${nx * ny}`);
  }

  const features = [];
  // Campionamento per non distruggere il telefono (220x220 = 48400 punti ok, ma meglio alleggerire)
  const step = 2; // aumenta a 3/4 se vuoi più leggero

  for (let j = 0; j < ny; j += step) {
    for (let i = 0; i < nx; i += step) {
      const idx = j * nx + i;
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
  const sourceId = `src_${def.id}`;
  const layerId = `lyr_${def.id}`;

  if (map.getLayer(layerId)) return;

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  // circle-color con interpolate
  const stops = def.style.colorStops;
  const colorExpr = ["interpolate", ["linear"], ["get", "v"]];
  for (const [val, col] of stops) colorExpr.push(val, col);

  map.addLayer({
    id: layerId,
    type: "circle",
    source: sourceId,
    paint: {
      "circle-radius": def.style.circleRadius,
      "circle-opacity": def.style.circleOpacity,
      "circle-color": colorExpr,
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
      "line-width": 1.5,
      "line-opacity": 0.9,
      // Colore in base alla velocità
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
  els.hour.value = String(idx);
  els.hourLabel.textContent = String(idx);
  if (meta?.times?.[idx]) {
    const t = meta.times[idx];
    // Mostro anche +xh se il tuo meta.times è già del tipo "+0h"
    els.runLabel.textContent = `Run: ${meta.run ?? "—"} — ${t}`;
  } else {
    els.runLabel.textContent = `Run: ${meta?.run ?? "—"} — +${idx}h`;
  }
}

async function refreshActiveLayers() {
  if (!meta) return;

  setStatus("Carico layer…", false);

  try {
    if (active.temp) await updateField("temp");
    if (active.rain) await updateField("rain");
    if (active.pres) await updateField("pres");
    if (active.wind) await updateWind();

    setStatus("", false);
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

function wireUI() {
  els.btnReload.addEventListener("click", async () => {
    try {
      setStatus("Scarico meta.json…", false);
      meta = await loadMeta();

      // Aggiorno slider
      els.hour.min = "0";
      els.hour.max = String(Math.max(0, meta.times.length - 1));
      setHourUI(Math.min(hourIndex, meta.times.length - 1));

      els.srcLabel.textContent = `Fonte dati: ${meta.source ?? "MeteoHub / Agenzia ItaliaMeteo (ICON-2I open data)"}`;

      setStatus("Meta OK. Ora carico i layer selezionati…", false);
      await refreshActiveLayers();
      setStatus("", false);
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  });

  els.hour.addEventListener("input", async (ev) => {
    const idx = Number(ev.target.value || 0);
    setHourUI(idx);
    await refreshActiveLayers();
  });

  els.chkTemp.addEventListener("change", async (ev) => {
    active.temp = ev.target.checked;
    if (!active.temp && map.getLayer("lyr_temp")) {
      map.getSource("src_temp").setData({ type: "FeatureCollection", features: [] });
    }
    await refreshActiveLayers();
  });

  els.chkRain.addEventListener("change", async (ev) => {
    active.rain = ev.target.checked;
    if (!active.rain && map.getLayer("lyr_rain")) {
      map.getSource("src_rain").setData({ type: "FeatureCollection", features: [] });
    }
    await refreshActiveLayers();
  });

  els.chkPres.addEventListener("change", async (ev) => {
    active.pres = ev.target.checked;
    if (!active.pres && map.getLayer("lyr_pres")) {
      map.getSource("src_pres").setData({ type: "FeatureCollection", features: [] });
    }
    await refreshActiveLayers();
  });

  els.chkWind.addEventListener("change", async (ev) => {
    active.wind = ev.target.checked;
    if (!active.wind && map.getLayer("lyr_wind")) {
      map.getSource("src_wind").setData({ type: "FeatureCollection", features: [] });
    }
    await refreshActiveLayers();
  });
}

function boot() {
  initMap();

  map.on("load", async () => {
    wireUI();

    // Carico meta subito (così lo slider non resta “morto”)
    try {
      setStatus("Boot…", false);
      meta = await loadMeta();

      els.hour.min = "0";
      els.hour.max = String(Math.max(0, meta.times.length - 1));

      // Provo a leggere l'hour da URL: ?h=10
      const u = new URL(location.href);
      const h = Number(u.searchParams.get("h") ?? 0);
      setHourUI(Math.min(Math.max(0, h), meta.times.length - 1));

      els.srcLabel.textContent = `Fonte dati: ${meta.source ?? "MeteoHub / Agenzia ItaliaMeteo (ICON-2I open data)"}`;
      els.runLabel.textContent = `Run: ${meta.run ?? "—"} — ${meta.times?.[hourIndex] ?? `+${hourIndex}h`}`;

      setStatus("", false);
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  });
}

boot();
