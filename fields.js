export function resizeCanvasToMap(canvas, map) {
  const c = canvas;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = map.getContainer().getBoundingClientRect();
  c.width = Math.floor(rect.width * dpr);
  c.height = Math.floor(rect.height * dpr);
  c.style.width = `${rect.width}px`;
  c.style.height = `${rect.height}px`;
  return { dpr, width: rect.width, height: rect.height };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Color ramp semplice (non “artistica”, ma chiara e leggibile).
 * Restituisce [r,g,b,a] 0..255
 */
export function colorize(kind, value) {
  if (value == null || Number.isNaN(value)) return [0,0,0,0];

  if (kind === "temp") {
    // °C: -5..40
    const t = clamp((value + 5) / 45, 0, 1);
    return [Math.floor(lerp(40, 255, t)), Math.floor(lerp(120, 60, t)), Math.floor(lerp(255, 40, t)), 180];
  }

  if (kind === "rain") {
    // mm/h: 0..20
    const t = clamp(value / 20, 0, 1);
    return [30, Math.floor(lerp(30, 220, t)), 255, Math.floor(lerp(0, 210, t))];
  }

  if (kind === "pres") {
    // hPa: 980..1035
    const t = clamp((value - 980) / 55, 0, 1);
    return [Math.floor(lerp(255, 40, t)), Math.floor(lerp(255, 240, t)), Math.floor(lerp(80, 255, t)), 170];
  }

  return [255,255,255,140];
}

/**
 * Disegna una griglia lat/lon (regolare) ritagliata su Sicilia.
 * dataGrid: { nx, ny, bbox:[minLon,minLat,maxLon,maxLat], values: Float32Array (ny*nx) }
 */
export function drawGridToCanvas(ctx, map, kind, dataGrid, opacity=1) {
  const { nx, ny, bbox, values } = dataGrid;
  const [minLon, minLat, maxLon, maxLat] = bbox;

  // Disegniamo pixel-per-cell su un ImageData intermedio, poi lo “piazziamo” georeferenziato.
  // Per georef: trasformiamo i 4 angoli bbox in pixel map e ricampioniamo.
  const pNW = map.project([minLon, maxLat]);
  const pSE = map.project([maxLon, minLat]);

  const x0 = Math.min(pNW.x, pSE.x);
  const y0 = Math.min(pNW.y, pSE.y);
  const x1 = Math.max(pNW.x, pSE.x);
  const y1 = Math.max(pNW.y, pSE.y);

  const w = Math.max(1, Math.floor(x1 - x0));
  const h = Math.max(1, Math.floor(y1 - y0));

  const img = ctx.createImageData(w, h);
  const out = img.data;

  for (let j = 0; j < h; j++) {
    const lat = maxLat - (j / (h - 1)) * (maxLat - minLat);
    const gj = clamp(Math.floor((1 - (lat - minLat) / (maxLat - minLat)) * (ny - 1)), 0, ny - 1);

    for (let i = 0; i < w; i++) {
      const lon = minLon + (i / (w - 1)) * (maxLon - minLon);
      const gi = clamp(Math.floor(((lon - minLon) / (maxLon - minLon)) * (nx - 1)), 0, nx - 1);

      const v = values[gj * nx + gi];
      const [r,g,b,a] = colorize(kind, v);
      const k = (j * w + i) * 4;
      out[k+0] = r;
      out[k+1] = g;
      out[k+2] = b;
      out[k+3] = Math.floor(a * opacity);
    }
  }

  ctx.putImageData(img, x0, y0);
}
