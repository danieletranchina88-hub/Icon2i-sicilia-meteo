// app.js — base map OSM stabile + loader meta.json

const statusEl = document.getElementById("status");
const btnReload = document.getElementById("btnReload");
const timeSlider = document.getElementById("timeSlider");
const timeLabel = document.getElementById("timeLabel");

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
  console.log(msg);
}

// Base URL robusta per GitHub Pages project site
const BASE = new URL(".", window.location.href);
const U = (path) => new URL(path, BASE).toString();

async function fetchJson(relPath) {
  const r = await fetch(U(relPath), { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} su ${relPath}`);
  return await r.json();
}

// --- STYLE OSM (raster) SUPER STABILE
const OSM_STYLE = {
  version: 8,
  sources: {
    "osm-tiles": {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [
    {
      id: "osm-tiles",
      type: "raster",
      source: "osm-tiles"
    }
  ]
};

// --- MAPPA
const map = new maplibregl.Map({
  container: "map",
  style: OSM_STYLE,
  center: [14.0, 37.5],   // Sicilia
  zoom: 6.6,
  antialias: true
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

// --- DATI
let meta = null;

function initSlider(m) {
  // nel tuo meta c'è "times": ["+0h", "+1h", ...]
  const n = Array.isArray(m?.times) ? m.times.length : 1;

  timeSlider.min = 0;
  timeSlider.max = Math.max(0, n - 1);
  timeSlider.value = 0;

  const run = m?.run || "—";
  timeLabel.textContent = `Run: ${run} — ${m?.times?.[0] ?? "+0h"}`;
}

async function reloadAll() {
  try {
    setStatus("Carico meta.json…");
    meta = await fetchJson("data/meta.json");
    setStatus("Dati pronti ✅");

    initSlider(meta);

    // zoom sulla bbox nel meta (se presente)
    if (Array.isArray(meta?.bbox) && meta.bbox.length === 4) {
      const [w, s, e, n] = meta.bbox;
      map.fitBounds([[w, s], [e, n]], { padding: 30, duration: 600 });
    }
  } catch (e) {
    setStatus(`Errore dati: ${e.message}`);
  }
}

btnReload?.addEventListener("click", reloadAll);

timeSlider?.addEventListener("input", () => {
  if (!meta?.times) return;
  const i = Number(timeSlider.value);
  const run = meta?.run || "—";
  timeLabel.textContent = `Run: ${run} — ${meta.times[i]}`;
});

map.on("load", () => {
  // se le tile non caricano, lo vediamo nei log
  map.on("error", (e) => console.log("MAP ERROR:", e?.error?.message || e));
  reloadAll();
});
