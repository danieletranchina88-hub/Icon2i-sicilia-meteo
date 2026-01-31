// app.js — OSM base + layer meteo su canvas + slider + vento particelle
// Funziona su GitHub Pages "project site" (quindi con /Icon2i-sicilia-meteo/)

// ====== CONFIG: QUI si adatta ai NOMI dei file che hai in /data ======
// Nomi attesi (uno per ora di previsione, 0..N-1):
// - data/t2m_000.json, data/t2m_001.json, ...
// - data/rain_000.json, ...
// - data/pres_000.json, ...
// - data/wind_000.json, ... (con u e v)
//
// Se i tuoi file si chiamano diversamente (es: temp_000.json), cambia questi prefix.
const FILE_PREFIX = {
  t2m: "t2m",     // temperatura 2m
  rain: "rain",   // pioggia
  pres: "pres",   // pressione
  wind: "wind"    // vento (u,v)
};

// Padding numerico step -> 000,001,002...
const pad3 = (n) => String(n).padStart(3, "0");

// ====== Helpers ======
const $ = (id) => document.getElementById(id);
const chkTemp = $("chkTemp");
const chkRain = $("chkRain");
const chkPres = $("chkPres");
const chkWind = $("chkWind");
const btnReload = $("btnReload");
const statusEl = $("status");
const timeSlider = $("timeSlider");
const timeLabel = $("timeLabel");

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
  console.log(msg);
}

const BASE = new URL(".", window.location.href);
const U = (rel) => new URL(rel, BASE).toString();

async function fetchJson(relPath) {
  const r = await fetch(U(relPath), { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} su ${relPath}`);
  return await r.json();
}

// ====== Base map (OSM raster) ======
const OSM_STYLE = {
  version: 8,
  sources: {
    "osm": {
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
  layers: [{ id: "osm", type: "raster", source: "osm" }]
};

const map = new maplibregl.Map({
  container: "map",
  style: OSM_STYLE,
  center: [14.0, 37.5],
  zoom: 6.6,
  antialias: true
});
map.addControl(new maplibregl.NavigationControl(), "top-right");

// ====== Canvas overlay ======
const fieldCanvas = $("fieldCanvas");
const windCanvas = $("windCanvas");
const fieldCtx = fieldCanvas.getContext("2d");
const windCtx = windCanvas.getContext("2d");

function resizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  const w = map.getCanvas().clientWidth;
  const h = map.getCanvas().clientHeight;

  fieldCanvas.width = Math.round(w * dpr);
  fieldCanvas.height = Math.round(h * dpr);
  fieldCanvas.style.width = w + "px";
  fieldCanvas.style.height = h + "px";
  fieldCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  windCanvas.width = Math.round(w * dpr);
  windCanvas.height = Math.round(h * dpr);
  windCanvas.style.width = w + "px";
  windCanvas.style.height = h + "px";
  windCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

map.on("resize", resizeCanvases);
window.addEventListener("resize", resizeCanvases);

// ====== Stato dati ======
let meta = null;
let step = 0;

// Cache: evita di riscaricare sempre
const cache = new Map(); // key: `${field}_${step}` -> json

function key(field, s) { return `${field}_${s}`; }

async function loadField(field, s) {
  const k = key(field, s);
  if (cache.has(k)) return cache.get(k);

  const filename = `data/${FILE_PREFIX[field]}_${pad3(s)}.json`;
  const js = await fetchJson(filename);
  cache.set(k, js);
  return js;
}

// ====== Colormap semplici (senza dipendenze) ======
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function lerp(a,b,t){ return a + (b-a)*t; }

function colorRamp(t) {
  // ramp blu->ciano->verde->giallo->rosso
  t = clamp01(t);
  let r=0,g=0,b=0;

  if (t < 0.25) { // blu -> ciano
    const u = t/0.25;
    r = 0; g = Math.round(lerp(64, 255, u)); b = 255;
  } else if (t < 0.5) { // ciano -> verde
    const u = (t-0.25)/0.25;
    r = 0; g = 255; b = Math.round(lerp(255, 0, u));
  } else if (t < 0.75) { // verde -> giallo
    const u = (t-0.5)/0.25;
    r = Math.round(lerp(0, 255, u)); g = 255; b = 0;
  } else { // giallo -> rosso
    const u = (t-0.75)/0.25;
    r = 255; g = Math.round(lerp(255, 0, u)); b = 0;
  }
  return [r,g,b,180]; // alpha 180 per vedere base map sotto
}

// ====== Disegno griglia su mappa ======
// Formato atteso file griglia:
// {
//   "nx": 220, "ny": 220,
//   "bbox": [W,S,E,N],
//   "data": [ ... nx*ny valori ... ],
//   "min": <opz>, "max": <opz>
// }
function drawGrid(grid, valueToColor) {
  fieldCtx.clearRect(0, 0, fieldCanvas.clientWidth, fieldCanvas.clientHeight);

  const nx = grid.nx ?? meta.nx;
  const ny = grid.ny ?? meta.ny;
  const bbox = grid.bbox ?? meta.bbox;
  const arr = grid.data;

  if (!nx || !ny || !bbox || !arr || arr.length !== nx*ny) {
    setStatus("Dati griglia non compatibili (nx/ny/bbox/data).");
    return;
  }

  const [W,S,E,N] = bbox;

  // calcolo min/max (se non forniti)
  let vmin = (grid.min ?? null);
  let vmax = (grid.max ?? null);
  if (vmin === null || vmax === null) {
    vmin = Infinity; vmax = -Infinity;
    for (let i=0;i<arr.length;i++){
      const v = arr[i];
      if (v == null || Number.isNaN(v)) continue;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmin===vmax) {
      vmin = 0; vmax = 1;
    }
  }

  // Offscreen canvas a risoluzione dati
  const off = document.createElement("canvas");
  off.width = nx;
  off.height = ny;
  const octx = off.getContext("2d");
  const img = octx.createImageData(nx, ny);

  // Nota: assumo ordine row-major: y da 0..ny-1, x da 0..nx-1
  // e che y=0 corrisponda al "N" (spesso nei grid). Se risulta capovolta, invertiamo.
  for (let y=0;y<ny;y++){
    for (let x=0;x<nx;x++){
      const idx = y*nx + x;
      const v = arr[idx];
      const t = (v - vmin) / (vmax - vmin);
      const [r,g,b,a] = valueToColor(t, v, vmin, vmax);

      const iy = y; // se capovolta: (ny-1-y)
      const p = (iy*nx + x) * 4;
      img.data[p+0] = r;
      img.data[p+1] = g;
      img.data[p+2] = b;
      img.data[p+3] = a;
    }
  }
  octx.putImageData(img, 0, 0);

  // Proietta bbox in pixel schermo e disegna offscreen scalato
  const pNW = map.project([W, N]);
  const pSE = map.project([E, S]);
  const x0 = pNW.x, y0 = pNW.y;
  const w = (pSE.x - pNW.x);
  const h = (pSE.y - pNW.y);

  fieldCtx.imageSmoothingEnabled = true;
  fieldCtx.drawImage(off, x0, y0, w, h);
}

// ====== Vento: particelle ======
// Formato atteso vento:
// {
//  "nx":220,"ny":220,"bbox":[W,S,E,N],
//  "u":[...nx*ny...], "v":[...nx*ny...]
// }
let windAnim = null;

function stopWind() {
  if (windAnim) {
    cancelAnimationFrame(windAnim);
    windAnim = null;
  }
  windCtx.clearRect(0,0, windCanvas.clientWidth, windCanvas.clientHeight);
}

function startWind(wind) {
  stopWind();

  const nx = wind.nx ?? meta.nx;
  const ny = wind.ny ?? meta.ny;
  const bbox = wind.bbox ?? meta.bbox;
  const Uarr = wind.u;
  const Varr = wind.v;

  if (!nx || !ny || !bbox || !Uarr || !Varr || Uarr.length!==nx*ny || Varr.length!==nx*ny) {
    setStatus("Vento: dati non compatibili (u/v).");
    return;
  }

  const [W,S,E,N] = bbox;

  // Bilinear sample su griglia in coordinate lon/lat
  function sampleWind(lon, lat) {
    const fx = (lon - W) / (E - W) * (nx - 1);
    const fy = (N - lat) / (N - S) * (ny - 1); // N->0

    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(nx-1, x0+1);
    const y1 = Math.min(ny-1, y0+1);
    const tx = fx - x0, ty = fy - y0;

    const i00 = y0*nx + x0;
    const i10 = y0*nx + x1;
    const i01 = y1*nx + x0;
    const i11 = y1*nx + x1;

    const u = lerp(lerp(Uarr[i00], Uarr[i10], tx), lerp(Uarr[i01], Uarr[i11], tx), ty);
    const v = lerp(lerp(Varr[i00], Varr[i10], tx), lerp(Varr[i01], Varr[i11], tx), ty);
    return {u, v};
  }

  // Particelle in lon/lat, poi proiettate in pixel
  const particles = [];
  const count = 1800;              // quantità particelle (alza se vuoi più densità)
  const speed = 0.012;             // step base (adatta in base ai tuoi u/v)
  const lifeMax = 90;

  function randLon() { return W + Math.random()*(E-W); }
  function randLat() { return S + Math.random()*(N-S); }

  for (let i=0;i<count;i++){
    particles.push({ lon: randLon(), lat: randLat(), life: Math.random()*lifeMax });
  }

  windCtx.globalCompositeOperation = "source-over";

  function frame() {
    // fade per effetto scia
    windCtx.fillStyle = "rgba(0,0,0,0.06)";
    windCtx.fillRect(0,0, windCanvas.clientWidth, windCanvas.clientHeight);

    windCtx.lineWidth = 1;

    for (const p of particles) {
      p.life -= 1;
      if (p.life <= 0) {
        p.lon = randLon(); p.lat = randLat(); p.life = lifeMax;
        continue;
      }

      const wv = sampleWind(p.lon, p.lat);
      if (!Number.isFinite(wv.u) || !Number.isFinite(wv.v)) {
        p.life = 0; continue;
      }

      const lon2 = p.lon + wv.u * speed;
      const lat2 = p.lat + wv.v * speed;

      // se esce bbox -> respawn
      if (lon2 < W || lon2 > E || lat2 < S || lat2 > N) {
        p.life = 0; continue;
      }

      const a = map.project([p.lon, p.lat]);
      const b = map.project([lon2, lat2]);

      const sp = Math.sqrt(wv.u*wv.u + wv.v*wv.v);
      const t = clamp01(sp / 15); // scala (adatta se serve)
      const [r,g,bcol] = colorRamp(t);
      windCtx.strokeStyle = `rgba(${r},${g},${bcol},0.7)`;

      windCtx.beginPath();
      windCtx.moveTo(a.x, a.y);
      windCtx.lineTo(b.x, b.y);
      windCtx.stroke();

      p.lon = lon2; p.lat = lat2;
    }

    windAnim = requestAnimationFrame(frame);
  }

  frame();
}

// ====== Logica layer ======
async function redraw() {
  // ridimensiona canvas all’avvio e ad ogni redraw (sicuro su mobile)
  resizeCanvases();

  // Campo (temperatura/pioggia/pressione): disegno UNO solo alla volta (priorità)
  // Se vuoi overlay multipli, si può fare, ma prima facciamolo funzionare bene.
  try {
    if (chkTemp?.checked) {
      const g = await loadField("t2m", step);
      drawGrid(g, (t, v, vmin, vmax) => colorRamp(t));
    } else if (chkRain?.checked) {
      const g = await loadField("rain", step);
      drawGrid(g, (t, v) => {
        // pioggia: più trasparente a valori bassi
        const [r,gc,bc,a] = colorRamp(t);
        const alpha = Math.round(lerp(30, 200, clamp01(t)));
        return [r,gc,bc,alpha];
      });
    } else if (chkPres?.checked) {
      const g = await loadField("pres", step);
      drawGrid(g, (t) => colorRamp(t));
    } else {
      fieldCtx.clearRect(0,0, fieldCanvas.clientWidth, fieldCanvas.clientHeight);
    }

    // Vento
    if (chkWind?.checked) {
      const w = await loadField("wind", step);
      startWind(w);
    } else {
      stopWind();
    }

  } catch (e) {
    // Se qui fallisce, significa che il file per quello step/campo non esiste o ha formato diverso.
    setStatus(`Layer non disponibile: ${e.message}`);
    fieldCtx.clearRect(0,0, fieldCanvas.clientWidth, fieldCanvas.clientHeight);
    stopWind();
  }
}

// ====== Init ======
async function reloadAll() {
  try {
    setStatus("Carico meta.json…");
    meta = await fetchJson("data/meta.json");
    setStatus("Dati pronti ✅");

    // Slider basato su meta.times (il TUO meta)
    const n = Array.isArray(meta.times) ? meta.times.length : 1;
    timeSlider.min = 0;
    timeSlider.max = Math.max(0, n - 1);
    step = 0;
    timeSlider.value = 0;

    // Etichetta
    const run = meta.run ?? "—";
    timeLabel.textContent = `Run: ${run} — ${meta.times?.[0] ?? "+0h"}`;

    // Zoom sulla bbox
    if (Array.isArray(meta.bbox) && meta.bbox.length === 4) {
      const [W,S,E,N] = meta.bbox;
      map.fitBounds([[W,S],[E,N]], { padding: 30, duration: 600 });
    }

    // ridisegna
    await redraw();

  } catch (e) {
    setStatus(`Errore dati: ${e.message}`);
  }
}

btnReload?.addEventListener("click", reloadAll);

timeSlider?.addEventListener("input", async () => {
  if (!meta?.times) return;
  step = Number(timeSlider.value);
  const run = meta.run ?? "—";
  timeLabel.textContent = `Run: ${run} — ${meta.times[step]}`;
  await redraw();
});

chkTemp?.addEventListener("change", redraw);
chkRain?.addEventListener("change", redraw);
chkPres?.addEventListener("change", redraw);
chkWind?.addEventListener("change", redraw);

// quando muovi/zoom, ridisegna overlay per restare allineato
map.on("move", () => {
  // ridisegno leggero: solo i canvas
  // (evito fetch: usa cache)
  redraw();
});
map.on("zoom", () => redraw());
map.on("load", () => reloadAll());
