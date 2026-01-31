// app.js - path robusti per GitHub Pages (project site)

const statusEl = document.getElementById("status");
const btnReload = document.getElementById("btnReload");
const timeSlider = document.getElementById("timeSlider");
const timeLabel = document.getElementById("timeLabel");

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
  console.log(msg);
}

// BASE: https://danieletranchina88-hub.github.io/Icon2i-sicilia-meteo/
const BASE = new URL(".", window.location.href);

function U(path) {
  // trasforma "data/meta.json" in BASE + "data/meta.json"
  return new URL(path, BASE).toString();
}

async function fetchJson(relPath) {
  const r = await fetch(U(relPath), { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} su ${relPath}`);
  return await r.json();
}

// --- MAPPA (base)
const map = new maplibregl.Map({
  container: "map",
  style: "https://demotiles.maplibre.org/style.json",
  center: [14.0, 37.5],
  zoom: 6.5,
  antialias: true,
});
map.addControl(new maplibregl.NavigationControl(), "top-right");

// --- DATI
let meta = null;

async function loadMeta() {
  setStatus("Carico meta.json…");
  meta = await fetchJson("data/meta.json"); // ✅ MAI con "/" davanti
  setStatus("Dati pronti ✅");
  return meta;
}

function initSlider(m) {
  // Provo vari campi possibili, perché non so come scrivi il meta
  const n =
    (Array.isArray(m?.steps) && m.steps.length) ||
    (Array.isArray(m?.forecast_hours) && m.forecast_hours.length) ||
    m?.n_steps ||
    1;

  if (timeSlider) {
    timeSlider.min = 0;
    timeSlider.max = Math.max(0, n - 1);
    timeSlider.value = 0;
  }
  if (timeLabel) {
    const run = m?.run_utc || m?.run || m?.timestamp || "—";
    timeLabel.textContent = `Run: ${run}`;
  }
}

async function reloadAll() {
  try {
    const m = await loadMeta();
    initSlider(m);
  } catch (e) {
    setStatus(`meta.json non trovato: ${e.message}`);
  }
}

btnReload?.addEventListener("click", reloadAll);
timeSlider?.addEventListener("input", () => {
  if (timeLabel) timeLabel.textContent = `Ora previsione: ${timeSlider.value}`;
});

map.on("load", () => {
  reloadAll();
});
