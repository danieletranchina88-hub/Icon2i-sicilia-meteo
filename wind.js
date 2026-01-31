// Vento particelle (semplice) con canvas sopra la mappa.
// Si aspetta che i file wind_XXX.json contengano:
// { nx, ny, bbox:[minLon,minLat,maxLon,maxLat], u:[...], v:[...] }
// oppure { nx, ny, bbox, valuesU, valuesV }
// Se i tuoi wind_XXX hanno una struttura diversa, dimmelo e lo adatto.

let canvas, ctx;
let particles = [];
let running = false;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.id = "windCanvas";
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");

  const resize = () => {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  };
  window.addEventListener("resize", resize);
  resize();
}

function rand(a, b) { return a + Math.random() * (b - a); }

function initParticles(count) {
  particles = new Array(count).fill(0).map(() => ({
    x: rand(0, window.innerWidth),
    y: rand(0, window.innerHeight),
    age: Math.floor(rand(0, 100))
  }));
}

function parseWind(json) {
  // Provo varie chiavi possibili
  const nx = json.nx;
  const ny = json.ny;
  const bbox = json.bbox;

  // u/v
  const u = json.u || json.valuesU || json.u10 || null;
  const v = json.v || json.valuesV || json.v10 || null;

  // fallback (se hai un unico array "values" e dentro ci sono oggetti)
  return { nx, ny, bbox, u, v };
}

function bilinearSample(grid, nx, ny, gx, gy) {
  // gx, gy in coordinate griglia (0..nx-1, 0..ny-1)
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, nx - 1);
  const y1 = Math.min(y0 + 1, ny - 1);
  const tx = gx - x0, ty = gy - y0;

  const i00 = y0 * nx + x0;
  const i10 = y0 * nx + x1;
  const i01 = y1 * nx + x0;
  const i11 = y1 * nx + x1;

  const v00 = grid[i00], v10 = grid[i10], v01 = grid[i01], v11 = grid[i11];

  // se manca qualcosa → null
  if (v00 == null || v10 == null || v01 == null || v11 == null) return null;

  const a = v00 * (1 - tx) + v10 * tx;
  const b = v01 * (1 - tx) + v11 * tx;
  return a * (1 - ty) + b * ty;
}

function stepParticles(map, wind) {
  // fading
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "rgba(0,0,0,1)";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1;

  const { nx, ny, bbox, u, v } = wind;
  if (!nx || !ny || !bbox || !u || !v) return;

  const [minLon, minLat, maxLon, maxLat] = bbox;

  for (const p of particles) {
    p.age++;
    if (p.age > 140) {
      p.x = rand(0, window.innerWidth);
      p.y = rand(0, window.innerHeight);
      p.age = 0;
      continue;
    }

    // pixel -> lon/lat
    const ll = map.unproject([p.x, p.y]);
    const lon = ll.lng, lat = ll.lat;

    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) {
      p.x = rand(0, window.innerWidth);
      p.y = rand(0, window.innerHeight);
      p.age = 0;
      continue;
    }

    // lon/lat -> griglia
    const gx = (lon - minLon) / (maxLon - minLon) * (nx - 1);
    const gy = (maxLat - lat) / (maxLat - minLat) * (ny - 1); // y invertita

    const uu = bilinearSample(u, nx, ny, gx, gy);
    const vv = bilinearSample(v, nx, ny, gx, gy);
    if (uu == null || vv == null) {
      p.age = 200;
      continue;
    }

    // velocità in pixel: scala empirica
    const speed = 0.8;
    const dx = uu * speed;
    const dy = -vv * speed;

    const x2 = p.x + dx;
    const y2 = p.y + dy;

    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = "rgba(120, 200, 255, 0.9)";
    ctx.stroke();

    p.x = x2;
    p.y = y2;

    if (p.x < 0 || p.x > window.innerWidth || p.y < 0 || p.y > window.innerHeight) {
      p.x = rand(0, window.innerWidth);
      p.y = rand(0, window.innerHeight);
      p.age = 0;
    }
  }
}

export async function startWind(map, url) {
  ensureCanvas();
  initParticles(1800);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
  const json = await res.json();
  const wind = parseWind(json);

  running = true;
  const loop = () => {
    if (!running) return;
    stepParticles(map, wind);
    requestAnimationFrame(loop);
  };
  loop();
}

export function stopWind() {
  running = false;
  if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
}
