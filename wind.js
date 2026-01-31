// Overlay vento su canvas. Supporta:
// - { nx, ny, bbox, u:[...], v:[...] }
// - { nx, ny, bbox, values:[u0,v0,u1,v1,...] }
// - gestisce null (e NaN già convertiti a null nel loader)

function createWindOverlay(map, grid, options = {}) {
  const {
    nx, ny, bbox
  } = grid;

  const bounds = [
    [bbox[1], bbox[0]], // [minLat, minLon]
    [bbox[3], bbox[2]]  // [maxLat, maxLon]
  ];

  const canvas = document.createElement("canvas");
  canvas.width = nx;
  canvas.height = ny;

  const ctx = canvas.getContext("2d", { alpha: true });

  function readUV(i) {
    // prefer u/v arrays
    if (Array.isArray(grid.u) && Array.isArray(grid.v)) {
      const u = grid.u[i];
      const v = grid.v[i];
      if (u == null || v == null) return null;
      return [u, v];
    }

    // interleaved
    if (Array.isArray(grid.values) && grid.values.length >= (nx * ny * 2)) {
      const u = grid.values[i * 2];
      const v = grid.values[i * 2 + 1];
      if (u == null || v == null) return null;
      return [u, v];
    }

    // fallback: se values è solo scalare, non è vento
    return null;
  }

  function colorForSpeed(s) {
    // s in m/s — scala semplice
    // blu (calmo) -> verde -> giallo -> arancio -> rosso (forte)
    const t = Math.max(0, Math.min(1, s / 25));
    const stops = [
      [0.00, [60, 140, 255, 160]],
      [0.35, [70, 220, 160, 180]],
      [0.60, [255, 220, 80, 190]],
      [0.80, [255, 140, 60, 210]],
      [1.00, [220, 60, 60, 220]],
    ];
    return lerpStops(stops, t, true);
  }

  function draw() {
    ctx.clearRect(0, 0, nx, ny);

    // densità frecce: più zoom -> più fitto
    const z = map.getZoom();
    const step = z <= 6 ? 10 : z <= 7 ? 8 : z <= 8 ? 6 : 5;

    // lunghezza frecce (in pixel canvas)
    const baseLen = z <= 6 ? 6 : z <= 7 ? 7 : z <= 8 ? 8 : 9;

    for (let y = 0; y < ny; y += step) {
      for (let x = 0; x < nx; x += step) {
        const i = y * nx + x;
        const uv = readUV(i);
        if (!uv) continue;

        const u = uv[0];
        const v = uv[1];

        // convenzione: se i dati sono in griglia “meteo”
        // spesso v positiva = nord. In canvas y cresce verso il basso -> invertiamo v
        const vx = u;
        const vy = -v;

        const speed = Math.hypot(vx, vy);
        if (!isFinite(speed) || speed <= 0.2) continue;

        const ang = Math.atan2(vy, vx);
        const len = baseLen + Math.min(10, speed * 0.6);

        const col = colorForSpeed(speed);
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${(col[3]/255).toFixed(3)})`;
        ctx.lineWidth = 1;

        // linea
        const x2 = x + Math.cos(ang) * len;
        const y2 = y + Math.sin(ang) * len;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // punta freccia
        const head = 3.5;
        const a1 = ang + Math.PI * 0.85;
        const a2 = ang - Math.PI * 0.85;

        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 + Math.cos(a1) * head, y2 + Math.sin(a1) * head);
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 + Math.cos(a2) * head, y2 + Math.sin(a2) * head);
        ctx.stroke();
      }
    }
  }

  const overlay = L.imageOverlay(canvas.toDataURL("image/png"), bounds, {
    opacity: 0.95,
    interactive: false
  });

  overlay.onAdd = function(mapInstance) {
    L.ImageOverlay.prototype.onAdd.call(this, mapInstance);
    draw();
    mapInstance.on("zoomend moveend", () => {
      draw();
      // aggiorna immagine
      this._image.src = canvas.toDataURL("image/png");
    });
  };

  return overlay;
}
