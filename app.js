import { FIELDS, fileFor, pad3 } from "./fields.js";
import { startWind, stopWind } from "./wind.js";

const statusEl = document.getElementById("status");
const leadEl = document.getElementById("lead");
const leadLabelEl = document.getElementById("leadLabel");
const runLabelEl = document.getElementById("runLabel");
const sourceLabelEl = document.getElementById("sourceLabel");
const btnReload = document.getElementById("reload");

const chkTemp = document.getElementById("chk-temp");
const chkRain = document.getElementById("chk-rain");
const chkPres = document.getElementById("chk-pres");
const chkWind = document.getElementById("chk-wind");

let meta = null;
let currentLead = 0;
let activeRaster = null; // { fieldId, canvasId }
let windOn = false;

function setStatus(msg, ok = true) {
  statusEl.textContent = msg || "";
  statusEl.style.color = ok ? "rgba(255,255,255,0.9)" : "rgba(255,120,120,1)";
}

function makeMap() {
  // basemap più pulita
  const map = new maplibregl.Map({
    container: "map",
    style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    center: [14.0, 37.5],
    zoom: 6.2,
    maxZoom: 10,
    minZoom: 5
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  return map;
}

const map = makeMap();

async function loadMeta() {
  const res = await fetch("data/meta.json", { cache: "no-store" });
  if (!res.ok) throw new Error("meta.json non trovato");
  meta = await res.json();

  // meta.times può essere ["+0h","+1h"...] o numeri
  const maxLead = (meta.times && meta.times.length) ? meta.times.length - 1 : 48;

  leadEl.max = String(maxLead);
  if (currentLead > maxLead) currentLead = 0;
  leadEl.value = String(currentLead);

  runLabelEl.textContent = `Run: ${meta.run ?? "—"} — ${meta.times?.[currentLead] ?? `+${currentLead}h`}`;
  sourceLabelEl.textContent = `Fonte dati: ${meta.source ?? "—"}`;

  leadLabelEl.textContent = String(currentLead);

  setStatus("Dati pronti ✅", true);
}

function removeRaster() {
  if (!activeRaster) return;
  const srcId = `src-${activeRaster.fieldId}`;
  const layerId = `lyr-${activeRaster.fieldId}`;
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  if (map.getSource(srcId)) map.removeSource(srcId);
  activeRaster = null;
}

async function loadFieldAsRaster(fieldId, lead) {
  removeRaster();

  const url = fileFor(fieldId, lead);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Layer non disponibile: HTTP ${res.status} su ${url}`);

  const json = await res.json();

  // Atteso: { nx, ny, bbox:[minLon,minLat,maxLon,maxLat], values:[...] }
  // oppure { values: [...] } con bbox, nx, ny
  const nx = json.nx;
  const ny = json.ny;
  const bbox = json.bbox;
  const values = json.values || json.data || null;

  if (!nx || !ny || !bbox || !values) {
    throw new Error(`Formato non valido in ${url}`);
  }

  // crea canvas raster
  const cvs = document.createElement("canvas");
  cvs.width = nx;
  cvs.height = ny;
  const ctx = cvs.getContext("2d", { willReadFrequently: true });
  const img = ctx.createImageData(nx, ny);

  // scala valori -> colore (semplice, ma visibile)
  // per migliorare palette si può fare dopo
  let vmin = Infinity, vmax = -Infinity;
  for (const v of values) {
    if (v == null) continue;
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  if (!isFinite(vmin) || !isFinite(vmax) || vmin === vmax) {
    throw new Error(`Valori non validi (tutti null?) in ${url}`);
  }

  // colore: gradiente blu->rosso
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const o = i * 4;
    if (v == null) {
      img.data[o+3] = 0;
      continue;
    }
    const t = (v - vmin) / (vmax - vmin);
    const r = Math.round(255 * t);
    const b = Math.round(255 * (1 - t));
    img.data[o] = r;
    img.data[o+1] = 80;
    img.data[o+2] = b;
    img.data[o+3] = 160; // trasparenza
  }

  ctx.putImageData(img, 0, 0);

  const [minLon, minLat, maxLon, maxLat] = bbox;
  const coordinates = [
    [minLon, maxLat],
    [maxLon, maxLat],
    [maxLon, minLat],
    [minLon, minLat]
  ];

  const srcId = `src-${fieldId}`;
  const layerId = `lyr-${fieldId}`;

  if (!map.isStyleLoaded()) {
    await new Promise(resolve => map.once("load", resolve));
  }

  map.addSource(srcId, {
    type: "image",
    url: cvs.toDataURL("image/png"),
    coordinates
  });

  map.addLayer({
    id: layerId,
    type: "raster",
    source: srcId,
    paint: {
      "raster-opacity": 0.75
    }
  });

  activeRaster = { fieldId };
}

function setChecksOffExcept(exceptId) {
  if (exceptId !== "temp") chkTemp.checked = false;
  if (exceptId !== "rain") chkRain.checked = false;
  if (exceptId !== "pres") chkPres.checked = false;
  if (exceptId !== "wind") chkWind.checked = false;
}

async function applySelection() {
  const lead = Number(leadEl.value);
  currentLead = lead;

  leadLabelEl.textContent = String(lead);
  runLabelEl.textContent = `Run: ${meta?.run ?? "—"} — ${meta?.times?.[lead] ?? `+${lead}h`}`;

  // vento
  if (chkWind.checked) {
    setChecksOffExcept("wind");
    removeRaster();
    try {
      setStatus("Carico vento…");
      windOn = true;
      await startWind(map, fileFor("wind", lead));
      setStatus("Vento OK ✅");
    } catch (e) {
      windOn = false;
      stopWind();
      setStatus(String(e.message || e), false);
    }
    return;
  } else {
    if (windOn) {
      windOn = false;
      stopWind();
    }
  }

  // raster meteo
  let fieldId = null;
  if (chkTemp.checked) fieldId = "temp";
  if (chkRain.checked) fieldId = "rain";
  if (chkPres.checked) fieldId = "pres";

  if (!fieldId) {
    removeRaster();
    setStatus("");
    return;
  }

  setChecksOffExcept(fieldId);

  try {
    setStatus(`Carico ${FIELDS[fieldId].label}…`);
    await loadFieldAsRaster(fieldId, lead);
    setStatus(`${FIELDS[fieldId].label} OK ✅`);
  } catch (e) {
    setStatus(String(e.message || e), false);
  }
}

btnReload.addEventListener("click", async () => {
  try {
    setStatus("Aggiorno meta…");
    await loadMeta();
    await applySelection();
  } catch (e) {
    setStatus(String(e.message || e), false);
  }
});

leadEl.addEventListener("input", () => {
  // aggiorna label in tempo reale
  leadLabelEl.textContent = String(leadEl.value);
});
leadEl.addEventListener("change", applySelection);

chkTemp.addEventListener("change", applySelection);
chkRain.addEventListener("change", applySelection);
chkPres.addEventListener("change", applySelection);
chkWind.addEventListener("change", applySelection);

map.on("load", async () => {
  try {
    setStatus("Carico meta…");
    await loadMeta();
    setStatus("Dati pronti ✅");
  } catch (e) {
    setStatus(String(e.message || e), false);
  }
});
