/* wind.js — Leaflet canvas wind arrows overlay
   Expected grid format:
   {
     "nx": 220,
     "ny": 220,
     "bbox": [minLon, minLat, maxLon, maxLat],
     "u": [ ... nx*ny values ... ],
     "v": [ ... nx*ny values ... ]
   }
*/

(function () {
  "use strict";

  function isFiniteNumber(x) {
    const n = Number(x);
    return Number.isFinite(n);
  }

  function safeSpeedColor(speed) {
    // speed in m/s
    // returns [r,g,b,a]
    // gentle palette, readable on OSM
    const stops = [
      [0,  [80, 120, 255, 180]],
      [5,  [60, 200, 200, 190]],
      [10, [80, 220, 120, 200]],
      [15, [220, 220, 80, 210]],
      [20, [255, 170, 60, 220]],
      [30, [255, 90, 60, 230]],
      [40, [220, 60, 60, 240]]
    ];

    if (!isFiniteNumber(speed)) return [0, 0, 0, 0];
    if (speed <= stops[0][0]) return stops[0][1];
    if (speed >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];

    for (let i = 0; i < stops.length - 1; i++) {
      const s0 = stops[i][0], c0 = stops[i][1];
      const s1 = stops[i + 1][0], c1 = stops[i + 1][1];
      if (speed >= s0 && speed <= s1) {
        const t = (speed - s0) / (s1 - s0 || 1);
        const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
        const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
        const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
        const a = Math.round(c0[3] + (c1[3] - c0[3]) * t);
        return [r, g, b, a];
      }
    }
    return stops[stops.length - 1][1];
  }

  function bboxToBounds(bbox) {
    // bbox: [minLon, minLat, maxLon, maxLat]
    return L.latLngBounds(
      L.latLng(bbox[1], bbox[0]),
      L.latLng(bbox[3], bbox[2])
    );
  }

  function idxFromXY(x, y, nx) {
    return y * nx + x;
  }

  function lonFromX(x, nx, minLon, maxLon) {
    if (nx <= 1) return minLon;
    const t = x / (nx - 1);
    return minLon + t * (maxLon - minLon);
  }

  function latFromY(y, ny, minLat, maxLat) {
    // IMPORTANT:
    // We assume y=0 is the NORTH edge (maxLat), common for meteo grids.
    if (ny <= 1) return maxLat;
    const t = y / (ny - 1);
    return maxLat - t * (maxLat - minLat);
  }

  function getStrideForZoom(z) {
    // Lower stride = more arrows.
    // Mobile-friendly. Tweak if you want denser/sparser.
    if (z <= 6) return 14;
    if (z === 7) return 12;
    if (z === 8) return 10;
    if (z === 9) return 8;
    if (z === 10) return 6;
    if (z === 11) return 5;
    return 4;
  }

  const WindLayer = L.Layer.extend({
    initialize: function (grid, options) {
      this._grid = grid;
      this.options = options || {};
      this._canvas = null;
      this._ctx = null;
      this._map = null;
      this._frame = null;
    },

    onAdd: function (map) {
      this._map = map;

      this._canvas = L.DomUtil.create("canvas", "leaflet-wind-canvas");
      this._canvas.style.position = "absolute";
      this._canvas.style.top = "0";
      this._canvas.style.left = "0";
      this._canvas.style.pointerEvents = "none";

      const pane = map.getPanes().overlayPane;
      pane.appendChild(this._canvas);

      this._ctx = this._canvas.getContext("2d", { alpha: true });

      map.on("moveend zoomend resize", this._scheduleRedraw, this);

      this._reset();
      this._redraw();
    },

    onRemove: function (map) {
      map.off("moveend zoomend resize", this._scheduleRedraw, this);
      if (this._frame) cancelAnimationFrame(this._frame);
      this._frame = null;

      if (this._canvas && this._canvas.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas);
      }
      this._canvas = null;
      this._ctx = null;
      this._map = null;
    },

    _scheduleRedraw: function () {
      if (!this._map) return;
      if (this._frame) return;
      this._frame = requestAnimationFrame(() => {
        this._frame = null;
        this._reset();
        this._redraw();
      });
    },

    _reset: function () {
      if (!this._map || !this._canvas) return;
      const size = this._map.getSize();
      this._canvas.width = size.x;
      this._canvas.height = size.y;

      const pos = this._map._getMapPanePos();
      L.DomUtil.setPosition(this._canvas, pos);
    },

    _redraw: function () {
      if (!this._map || !this._ctx || !this._grid) return;

      const grid = this._grid;
      const nx = grid.nx, ny = grid.ny, bbox = grid.bbox;
      const uArr = grid.u, vArr = grid.v;

      if (!nx || !ny || !bbox || !Array.isArray(uArr) || !Array.isArray(vArr)) {
        // grid not valid -> draw nothing
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        return;
      }

      const minLon = bbox[0], minLat = bbox[1], maxLon = bbox[2], maxLat = bbox[3];
      const gridBounds = bboxToBounds(bbox);

      // If user is far away, don’t waste draw
      const viewBounds = this._map.getBounds();
      if (!viewBounds.intersects(gridBounds)) {
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        return;
      }

      const z = this._map.getZoom();
      const stride = getStrideForZoom(z);

      // arrow scale based on zoom (pixels)
      const baseLen = Math.max(10, Math.min(26, 6 + (z - 6) * 2));
      const maxLen = baseLen * 2.2;

      const ctx = this._ctx;
      ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";

      // Draw arrows only inside current view (+ small margin)
      const marginPx = 80;
      const w = this._canvas.width, h = this._canvas.height;

      for (let y = 0; y < ny; y += stride) {
        const lat = latFromY(y, ny, minLat, maxLat);

        for (let x = 0; x < nx; x += stride) {
          const i = idxFromXY(x, y, nx);

          const u = uArr[i];
          const v = vArr[i];

          if (!isFiniteNumber(u) || !isFiniteNumber(v)) continue;

          const lon = lonFromX(x, nx, minLon, maxLon);
          const p = this._map.latLngToContainerPoint([lat, lon]);

          if (p.x < -marginPx || p.y < -marginPx || p.x > w + marginPx || p.y > h + marginPx) {
            continue;
          }

          // speed in m/s
          const speed = Math.sqrt(u * u + v * v);
          if (!isFiniteNumber(speed) || speed < 0.1) continue;

          // Direction: meteorological u/v are usually east/north components.
          // On screen: +x right, +y down, so invert north component.
          const dx = u;
          const dy = -v;

          const mag = Math.sqrt(dx * dx + dy * dy) || 1;

          // length scaled by speed, clamped
          const len = Math.min(maxLen, baseLen + speed * 0.9);

          const ux = dx / mag;
          const uy = dy / mag;

          const x2 = p.x + ux * len;
          const y2 = p.y + uy * len;

          // Arrowhead
          const headLen = Math.max(5, Math.min(10, len * 0.35));
          const angle = Math.atan2(uy, ux);
          const a1 = angle + Math.PI * 0.80;
          const a2 = angle - Math.PI * 0.80;

          const hx1 = x2 + Math.cos(a1) * headLen;
          const hy1 = y2 + Math.sin(a1) * headLen;
          const hx2 = x2 + Math.cos(a2) * headLen;
          const hy2 = y2 + Math.sin(a2) * headLen;

          const col = safeSpeedColor(speed);
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${(col[3] ?? 200) / 255})`;

          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(hx1, hy1);
          ctx.moveTo(x2, y2);
          ctx.lineTo(hx2, hy2);
          ctx.stroke();
        }
      }
    }
  });

  // Public factory used by app.js
  window.createWindOverlay = function (map, grid) {
    // map is not required here, kept for compatibility with your calls
    return new WindLayer(grid, {});
  };
})();
