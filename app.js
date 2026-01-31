import { resizeCanvasToMap, drawGridToCanvas } from "./fields.js";
import { WindParticles } from "./wind.js";

const statusEl = document.getElementById("status");
const btnReload = document.getElementById("btnReload");

const chkTemp = document.getElementById("chkTemp");
const chkRain = document.getElementById("chkRain");
const chkPres = document.getElementById("chkPres");
const chkWind = document.getElementById("chkWind");

const slider = document.getElementById("timeSlider");
const timeLabel = document.getElementById("timeLabel");

const fieldCanvas = document.getElementById("fieldCanvas");
const windCanvas = document.getElementById("windCanvas");

const sicilyBounds = [
  [12.25, 36.40],
  [15.70, 38.35]
];

const map = new maplibregl.Map({
  container: "map",
  style: "https://demotiles.maplibre.org/style.json",
  center: [14.0, 37.5],
  zoom: 6.8,
  maxBounds: sicilyBounds,
  minZoom: 6.2,
  maxZoom: 11.5
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

const wind = new WindParticles(windCanvas, map);

let meta = null;              // data/meta.json
let fieldsByTime = {};        // cache fields

function setStatus(msg) { statusEl.textContent = msg; }

async function loadMeta() {
  // La Action genera data/meta.json
  const res = await fetch("./data/meta.json", { cache: "no-store" });
  if (!res.ok) throw new Error("meta.json non trovato. Hai fatto girare la GitHub Action?");
  return res.json();
}

async function loadField(kind, tIndex) {
  const key = `${kind}:${tIndex}`;
  if (fieldsByTime[key]) return fieldsByTime[key];

  const file = `./data/${kind}_${String(tIndex).padStart(3,"0")}.json`;
  const res = await fetch(file, { cache: "no-store" });
  if (!res.ok) throw new Error(`File mancante: ${file}`);
  const obj = await res.json();

  // ricostruisci Float32Array dai numeri
  obj.values = new Float32Array(obj.values);
  fieldsByTime[key] = obj;
  return obj;
}

async function loadWind(tIndex) {
  const key = `wind:${tIndex}`;
  if (fieldsByTime[key]) return fieldsByTime[key];

  const file = `./data/wind_${String(tIndex).padStart(3,"0")}.json`;
  const res = await fetch(file, { cache: "no-store" });
  if (!res.ok) throw new Error(`File mancante: ${file}`);
  const obj = await res.json();

  obj.u = new Float32Array(obj.u);
  obj.v = new Float32Array(obj.v);
  fieldsByTime[key] = obj;
  return obj;
}

function clearCanvas(canvas, map) {
  const ctx = canvas.getContext("2d");
  const { dpr } = resizeCanvasToMap(canvas, map);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

async function render() {
  if (!meta) return;
  const t = Number(slider.value);

  // resize canvas
  const fctx = fieldCanvas.getContext("2d");
  const { dpr } = resizeCanvasToMap(fieldCanvas, map);
  fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fctx.clearRect(0, 0, fieldCanvas.width, fieldCanvas.height);

  if (chkTemp.checked) {
    const g = await loadField("temp", t);
    drawGridToCanvas(fctx, map, "temp", g, 1.0);
  }
  if (chkRain.checked) {
    const g = await loadField("rain", t);
    drawGridToCanvas(fctx, map, "rain", g, 1.0);
  }
  if (chkPres.checked) {
    const g = await loadField("pres", t);
    drawGridToCanvas(fctx, map, "pres", g, 1.0);
  }

  if (chkWind.checked) {
    wind.resize();
    const w = await loadWind(t);
    wind.setWindField(w);
    if (!wind.running) wind.start();
  } else {
    wind.stop();
    clearCanvas(windCanvas, map);
  }

  const label = meta.times?.[t] ?? `t=${t}`;
  timeLabel.textContent = `Run: ${meta.run} — ${label}`;
}

async function reloadAll() {
  try {
    setStatus("Carico meta…");
    meta = await loadMeta();

    slider.min = 0;
    slider.max = (meta.times?.length ?? 1) - 1;
    slider.value = 0;

    fieldsByTime = {};
    setStatus(`OK: run ${meta.run}`);
    await render();
  } catch (e) {
    console.error(e);
    setStatus(String(e.message || e));
  }
}

btnReload.addEventListener("click", reloadAll);
slider.addEventListener("input", () => render());
chkTemp.addEventListener("change", () => render());
chkRain.addEventListener("change", () => render());
chkPres.addEventListener("change", () => render());
chkWind.addEventListener("change", () => render());

map.on("load", async () => {
  await reloadAll();
});

map.on("move", () => render());
map.on("zoom", () => render());
window.addEventListener("resize", () => render());
