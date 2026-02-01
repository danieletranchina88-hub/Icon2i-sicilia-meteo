/* wind.js — Windy-like particles overlay for Leaflet
   Expected field format:
   {
     "nx": 220,
     "ny": 220,
     "bbox": [minLon, minLat, maxLon, maxLat],
     "u": [ ... nx*ny ... ],
     "v": [ ... nx*ny ... ]
   }

   Features:
   - Particle advection following u/v
   - Color by speed (0 km/h blue -> dark red high)
   - Handles nulls gracefully
*/

(function () {
  "use strict";

  function isFiniteNumber(x) {
    const n = Number(x);
    return Number.isFinite(n);
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function lerpColor(c0, c1, t) {
    return [
      Math.round(lerp(c0[0], c1[0], t)),
      Math.round(lerp(c0[1], c1[1], t)),
      Math.round(lerp(c0[2], c1[2], t)),
      Math.round(lerp(c0[3], c1[3], t))
    ];
  }

  function speedColorKmh(kmh) {
    // Blue at 0, cyan/green/yellow/orange/red, dark red for high
    const stops = [
      [0,   [40, 120, 255, 170]],
      [10,  [60, 200, 255, 180]],
      [20,  [60, 230, 170, 190]],
      [30,  [150, 240, 90, 200]],
      [50,  [240, 220, 70, 210]],
      [70,  [255, 160, 70, 220]],
      [90,  [255, 90, 60, 230]],
      [120, [120, 0, 0, 240]] // dark red
    ];

    if (!isFiniteNumber(kmh)) return [0,0,0,0];
    if (kmh <= stops[0][0]) return stops[0][1];
    if (kmh >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];

    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i][0], ca = stops[i][1];
      const b = stops[i + 1][0], cb = stops[i + 1][1];
      if (kmh >= a && kmh <= b) {
        const t = (kmh - a) / (b - a || 1);
        return lerpColor(ca, cb, t);
      }
    }
    return stops[stops.length - 1][1];
  }

  function bboxToBounds(bbox) {
    return L.latLngBounds(
      L.latLng(bbox[1], bbox[0]),
      L.latLng(bbox[3], bbox[2])
    );
  }

  function lonLatToGridXY(lon, lat, field) {
    const [minLon, minLat, maxLon, maxLat] = field.bbox;
    const nx = field.nx, ny = field.ny;
    if (nx < 2 || ny < 2) return null;

    const fx = (lon - minLon) / (maxLon - minLon);
    // y=0 is north (maxLat)
    const fy = (maxLat - lat) / (maxLat - minLat);

    if (!isFiniteNumber(fx) || !isFiniteNumber(fy)) return null;
    const x = fx * (nx - 1);
    const y = fy * (ny - 1);

    return { x, y };
  }

  function bilinearSample(arr, nx, ny, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(nx - 1, x0 + 1);
    const y1 = Math.min(ny - 1, y0 + 1);

    if (x0 < 0 || y0 < 0 || x0 >= nx || y0 >= ny) return null;

    const i00 = y0 * nx + x0;
    const i10 = y0 * nx + x1;
    const i01 = y1 * nx + x0;
    const i11 = y1 * nx + x1;

    const v00 = arr[i00], v10 = arr[i10], v01 = arr[i01], v11 = arr[i11];

    const ok00 = isFiniteNumber(v00), ok10 = isFiniteNumber(v10), ok01 = isFiniteNumber(v01), ok11 = isFiniteNumber(v11);
    if (!ok00 && !ok10 && !ok01 && !ok11) return null;

    // Simple fallback for missing corners
    const pick = (v, fallback) => (isFiniteNumber(v) ? v : fallback);

    const fallback =
      ok00 ? v00 :
      ok10 ? v10 :
      ok01 ? v01 :
      ok11 ? v11 : null;

    if (!isFiniteNumber(fallback)) return null;

    const a00 = pick(v00, fallback);
    const a10 = pick(v10, fallback);
    const a01 = pick(v01, fallback);
    const a11 = pick(v11, fallback);

    const tx = x - x0;
    const ty = y - y0;

    const v0 = a00 * (1 - tx) + a10 * tx;
    const v1 = a01 * (1 - tx) + a11 * tx;

    return v0 * (1 - ty) + v1 * ty;
  }

  function sampleWind(field, lon, lat) {
    if (!field || !Array.isArray(field.u) || !Array.isArray(field.v)) return null;
    const xy = lonLatToGridXY(lon, lat, field);
    if (!xy) return null;
    const u = bilinearSample(field.u, field.nx, field.ny, xy.x, xy.y);
    const v = bilinearSample(field.v, field.nx, field.ny, xy.x, xy.y);
    if (!isFiniteNumber(u) || !isFiniteNumber(v)) return null;
    return { u, v };
  }

  function randomIn(min, max) {
    return min + Math.random() * (max - min);
  }

  function getParticleCount(zoom, w, h) {
    // Scales with zoom and viewport area, capped for mobile performance
    const area = w * h;
    const base = Math.floor(area / 9000); // ~1 particle per 9k px
    const zFactor = zoom <= 7 ? 0.55 : zoom <= 9 ? 0.85 : 1.0;
    return clamp(Math.floor(base * zFactor), 250, 1800);
  }

  function getSpeedFactor(zoom) {
    // converts wind vector (m/s) to pixels per frame
    return zoom <= 7 ? 0.30 : zoom <= 9 ? 0.45 : 0.60;
  }

  const WindParticlesLayer = L.Layer.extend({
    initialize: function (field, options) {
      this._field = field;
      this.options = options || {};
      this._canvas = null;
      this._ctx = null;
      this._map = null;
      this._anim = null;
      this._particles = [];
      this._bounds = null;
      this._needsRebuild = true;
      this._lastT = null;
    },

    onAdd: function (map) {
      this._map = map;

      this._canvas = L.DomUtil.create("canvas", "leaflet-wind-canvas");
      this._canvas.style.position = "absolute";
      this._canvas.style.top = "0";
      this._canvas.style.left = "0";
      this._canvas.style.pointerEvents = "none";

      map.getPanes().overlayPane.appendChild(this._canvas);
      this._ctx = this._canvas.getContext("2d", { alpha: true });

      map.on("moveend zoomend resize", this._onViewChanged, this);

      this._reset();
      this._bounds = this._field && this._field.bbox ? bboxToBounds(this._field.bbox) : null;
      this._needsRebuild = true;

      this._start();
    },

    onRemove: function (map) {
      map.off("moveend zoomend resize", this._onViewChanged, this);
      this._stop();

      if (this._canvas && this._canvas.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas);
      }
      this._canvas = null;
      this._ctx = null;
      this._map = null;
      this._particles = [];
    },

    setField: function (field) {
      this._field = field;
      this._bounds = field && field.bbox ? bboxToBounds(field.bbox) : null;
      this._needsRebuild = true;
    },

    _onViewChanged: function () {
      this._reset();
      this._needsRebuild = true;
    },

    _reset: function () {
      if (!this._map || !this._canvas) return;
      const size = this._map.getSize();
      this._canvas.width = size.x;
      this._canvas.height = size.y;
      const pos = this._map._getMapPanePos();
      L.DomUtil.setPosition(this._canvas, pos);
    },

    _start: function () {
      if (this._anim) return;
      this._lastT = null;
      const tick = (t) => {
        this._anim = requestAnimationFrame(tick);
        this._drawFrame(t);
      };
      this._anim = requestAnimationFrame(tick);
    },

    _stop: function () {
      if (this._anim) cancelAnimationFrame(this._anim);
      this._anim = null;
    },

    _rebuildParticles: function () {
      const map = this._map;
      if (!map || !this._field || !this._bounds) {
        this._particles = [];
        this._needsRebuild = false;
        return;
      }

      const viewBounds = map.getBounds();
      // If out of view, clear particles to save CPU
      if (!viewBounds.intersects(this._bounds)) {
        this._particles = [];
        this._needsRebuild = false;
        return;
      }

      const size = map.getSize();
      const zoom = map.getZoom();

      const n = getParticleCount(zoom, size.x, size.y);
      this._particles = new Array(n);

      // Seed particles in view bounds, but also inside field bbox (intersection)
      const inter = viewBounds.intersects(this._bounds) ? viewBounds.intersection(this._bounds) : this._bounds;

      // Leaflet doesn't have intersection() in older builds; fallback to manual:
      const b = inter || this._bounds;
      const south = Math.max(viewBounds.getSouth(), this._bounds.getSouth());
      const north = Math.min(viewBounds.getNorth(), this._bounds.getNorth());
      const west  = Math.max(viewBounds.getWest(),  this._bounds.getWest());
      const east  = Math.min(viewBounds.getEast(),  this._bounds.getEast());

      for (let i = 0; i < n; i++) {
        this._particles[i] = this._spawnParticle(west, east, south, north);
      }

      this._needsRebuild = false;
    },

    _spawnParticle: function (west, east, south, north) {
      // Random lon/lat inside given box, with retries to avoid null wind
      let lon = 0, lat = 0;
      for (let k = 0; k < 8; k++) {
        lon = randomIn(west, east);
        lat = randomIn(south, north);
        const w = sampleWind(this._field, lon, lat);
        if (w) break;
      }
      return {
        lon, lat,
        age: Math.floor(Math.random() * 60),
        maxAge: 60 + Math.floor(Math.random() * 80)
      };
    },

    _drawFrame: function (t) {
      const map = this._map;
      const ctx = this._ctx;
      const field = this._field;
      if (!map || !ctx || !this._canvas || !field) return;

      // adaptive dt
      let dt = 16;
      if (this._lastT != null) dt = clamp(t - this._lastT, 10, 40);
      this._lastT = t;

      if (this._needsRebuild) this._rebuildParticles();

      // Fade previous frame (trail effect)
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

      // If no particles or out of bounds, nothing else
      if (!this._particles.length) return;

      const zoom = map.getZoom();
      const speedFactor = getSpeedFactor(zoom) * (dt / 16);

      const viewBounds = map.getBounds();
      const south = Math.max(viewBounds.getSouth(), this._bounds.getSouth());
      const north = Math.min(viewBounds.getNorth(), this._bounds.getNorth());
      const west  = Math.max(viewBounds.getWest(),  this._bounds.getWest());
      const east  = Math.min(viewBounds.getEast(),  this._bounds.getEast());

      ctx.lineWidth = 1.2;
      ctx.lineCap = "round";

      for (let i = 0; i < this._particles.length; i++) {
        const p = this._particles[i];

        // age + respawn
        p.age++;
        if (p.age > p.maxAge) {
          this._particles[i] = this._spawnParticle(west, east, south, north);
          continue;
        }

        // sample wind at particle position
        const w = sampleWind(field, p.lon, p.lat);
        if (!w) {
          this._particles[i] = this._spawnParticle(west, east, south, north);
          continue;
        }

        // Convert to screen points
        const p0 = map.latLngToContainerPoint([p.lat, p.lon]);

        // Convert wind to lon/lat delta
        // u eastward (m/s), v northward (m/s).
        // Approx: convert meters to degrees:
        // lat degrees per meter ~ 1/111320
        // lon degrees per meter ~ 1/(111320*cos(lat))
        const latRad = (p.lat * Math.PI) / 180;
        const cosLat = Math.max(0.2, Math.cos(latRad));

        const dLat = (w.v * speedFactor) / 111320; // degrees
        const dLon = (w.u * speedFactor) / (111320 * cosLat);

        const lon2 = p.lon + dLon;
        const lat2 = p.lat + dLat;

        // keep in bounds
        if (lon2 < west || lon2 > east || lat2 < south || lat2 > north) {
          this._particles[i] = this._spawnParticle(west, east, south, north);
          continue;
        }

        const p1 = map.latLngToContainerPoint([lat2, lon2]);

        // speed color (km/h)
        const ms = Math.sqrt(w.u * w.u + w.v * w.v);
        const kmh = ms * 3.6;
        const c = speedColorKmh(kmh);
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 200)/255})`;

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();

        // advance
        p.lon = lon2;
        p.lat = lat2;
      }
    }
  });

  // Public factory used by app.js
  window.createWindParticlesOverlay = function (map, field) {
    // map passed for compatibility; Leaflet will pass it again onAdd
    return new WindParticlesLayer(field, {});
  };
})();
