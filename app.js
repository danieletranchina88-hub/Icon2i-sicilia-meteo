/* app.js — ICON-2I Sicily viewer (Leaflet)
   Features:
   - Time slider with real date/time (run + lead hours)
   - Grid overlays for temp/pres/rain (rain as hourly from cumulative)
   - Wind particles overlay (wind.js)
   - Click inspector: shows value at clicked point for active layer
*/

(function () {
  "use strict";

  // -----------------------------
  // Config
  // -----------------------------
  const DATA_DIR = "data"; // folder in repo
  const META_URL = `${DATA_DIR}/run.json`;
  const DEFAULT_CENTER = [37.55, 14.0];
  const DEFAULT_ZOOM = 7;

  // Change this if you want to force-refresh assets from UI:
  function cacheBust() {
    // Use current timestamp for strong bust
    return `v=${Date.now()}`;
  }

  function pad3(n) {
    const s = String(n);
    return s.length >= 3 ? s : ("000" + s).slice(-3);
  }

  function isFiniteNumber(x) {
    const n = Number(x);
    return Number.isFinite(n);
  }

  // Convert JSON text that may include NaN into valid JSON (replace NaN with null).
  function parseJsonAllowNaN(text) {
    // Replace bare NaN tokens (not in strings) with null.
    // This is pragmatic, fast, and works for your dataset.
    const fixed = text.replace(/\bNaN\b/g, "null");
    return JSON.parse(fixed);
  }

  async function fetchJsonAllowNaN(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
    const text = await res.text();
    return parseJsonAllowNaN(text);
  }

  function parseRunToDate(runStr) {
    // Expected "YYYYMMDDHH" in UTC (typical NWP cycle, e.g., 2026013112)
    if (!runStr || runStr.length < 10) return null;
    const Y = Number(runStr.slice(0, 4));
    const M = Number(runStr.slice(4, 6));
    const D = Number(runStr.slice(6, 8));
    const H = Number(runStr.slice(8, 10));
    if (![Y, M, D, H].every(Number.isFinite)) return null;
    // create as UTC
    return new Date(Date.UTC(Y, M - 1, D, H, 0, 0));
  }

  function formatDateTimeLocal(date) {
    // Europe/Rome is your natural target; browser will format in local timezone.
    // If you want strict Europe/Rome regardless of user timezone, set timeZone below.
    const fmt = new Intl.DateTimeFormat("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
    return fmt.format(date);
  }

  function formatRunUTC(dateUtc) {
    const fmt = new Intl.DateTimeFormat("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC"
    });
    return `${fmt.format(dateUtc)}Z`;
  }

  // -----------------------------
  // Color scales (temp/pres/rain)
  // -----------------------------
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function lerpColor(c0, c1, t) {
    return [
      Math.round(lerp(c0[0], c1[0], t)),
      Math.round(lerp(c0[1], c1[1], t)),
      Math.round(lerp(c0[2], c1[2], t)),
      Math.round(lerp(c0[3], c1[3], t))
    ];
  }

  function rgba(c) {
    return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})`;
  }

  function tempColorC(tC) {
    // -10 .. 40 C
    const stops = [
      [-10, [60, 120, 255, 200]],
      [0,   [80, 200, 255, 210]],
      [10,  [120, 255, 170, 220]],
      [20,  [240, 240, 120, 230]],
      [30,  [255, 170, 90, 240]],
      [40,  [255, 80, 80, 250]]
    ];
    return scaleStops(tC, stops);
  }

  function presColorHpa(p) {
    // 980..1035 hPa
    const stops = [
      [980, [120, 160, 255, 180]],
      [995, [140, 220, 220, 190]],
      [1010,[180, 240, 160, 200]],
      [1020,[240, 240, 120, 210]],
      [1035,[255, 150, 90, 220]]
    ];
    return scaleStops(p, stops);
  }

  function rainColorMm(h) {
    // hourly mm (0..20+)
    const stops = [
      [0,  [0, 0, 0, 0]],
      [0.1,[120, 180, 255, 120]],
      [1,  [60, 200, 220, 170]],
      [5,  [80, 220, 120, 200]],
      [10, [240, 240, 100, 220]],
      [20, [255, 140, 80, 235]],
      [40, [255, 60, 60, 250]]
    ];
    return scaleStops(h, stops);
  }

  function scaleStops(x, stops) {
    if (!isFiniteNumber(x)) return [0,0,0,0];
    if (x <= stops[0][0]) return stops[0][1];
    if (x >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i][0], ca = stops[i][1];
      const b = stops[i + 1][0], cb = stops[i + 1][1];
      if (x >= a && x <= b) {
        const t = (x - a) / (b - a || 1);
        return lerpColor(ca, cb, t);
      }
    }
    return stops[stops.length - 1][1];
  }

  // -----------------------------
  // Grid utilities
  // -----------------------------
  function bboxToBounds(bbox) {
    return L.latLngBounds(
      L.latLng(bbox[1], bbox[0]),
      L.latLng(bbox[3], bbox[2])
    );
  }

  function lonLatToGridXY(lon, lat, grid) {
    const [minLon, minLat, maxLon, maxLat] = grid.bbox;
    const nx = grid.nx, ny = grid.ny;
    if (nx < 2 || ny < 2) return null;

    // x goes west->east (minLon->maxLon)
    const fx = (lon - minLon) / (maxLon - minLon);
    // y assumption: row 0 is NORTH (maxLat) -> row increases to SOUTH (minLat)
    const fy = (maxLat - lat) / (maxLat - minLat);

    if (!isFiniteNumber(fx) || !isFiniteNumber(fy)) return null;

    const x = fx * (nx - 1);
    const y = fy * (ny - 1);

    return { x, y };
  }

  function bilinearSample(values, nx, ny, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(nx - 1, x0 + 1);
    const y1 = Math.min(ny - 1, y0 + 1);

    if (x0 < 0 || y0 < 0 || x0 >= nx || y0 >= ny) return null;

    const i00 = y0 * nx + x0;
    const i10 = y0 * nx + x1;
    const i01 = y1 * nx + x0;
    const i11 = y1 * nx + x1;

    const v00 = values[i00];
    const v10 = values[i10];
    const v01 = values[i01];
    const v11 = values[i11];

    // if all null -> null
    const ok00 = isFiniteNumber(v00), ok10 = isFiniteNumber(v10), ok01 = isFiniteNumber(v01), ok11 = isFiniteNumber(v11);
    if (!ok00 && !ok10 && !ok01 && !ok11) return null;

    // Replace missing corners by nearest available (simple robust fallback)
    const fill = (v) => (isFiniteNumber(v) ? v : null);
    const a00 = fill(v00), a10 = fill(v10), a01 = fill(v01), a11 = fill(v11);

    // if some are null, use nearest non-null
    const nearest = (x, y) => {
      const candidates = [
        {v: a00, dx: 0, dy: 0},
        {v: a10, dx: 1, dy: 0},
        {v: a01, dx: 0, dy: 1},
        {v: a11, dx: 1, dy: 1},
      ].filter(o => o.v !== null);
      if (!candidates.length) return null;
      candidates.sort((p, q) => (Math.abs(p.dx - x) + Math.abs(p.dy - y)) - (Math.abs(q.dx - x) + Math.abs(q.dy - y)));
      return candidates[0].v;
    };

    const f00 = (a00 !== null) ? a00 : nearest(0,0);
    const f10 = (a10 !== null) ? a10 : nearest(1,0);
    const f01 = (a01 !== null) ? a01 : nearest(0,1);
    const f11 = (a11 !== null) ? a11 : nearest(1,1);
    if (![f00,f10,f01,f11].every(isFiniteNumber)) return null;

    const tx = x - x0;
    const ty = y - y0;

    const v0 = f00 * (1 - tx) + f10 * tx;
    const v1 = f01 * (1 - tx) + f11 * tx;
    return v0 * (1 - ty) + v1 * ty;
  }

  // -----------------------------
  // Canvas grid layer (temp/pres/rain)
  // -----------------------------
  const GridCanvasLayer = L.Layer.extend({
    initialize: function (grid, painterFn, options) {
      this._grid = grid;
      this._paint = painterFn;
      this.options = options || {};
      this._canvas = null;
      this._ctx = null;
      this._map = null;
      this._frame = null;
    },

    onAdd: function (map) {
      this._map = map;
      this._canvas = L.DomUtil.create("canvas", "leaflet-grid-canvas");
      this._canvas.style.position = "absolute";
      this._canvas.style.top = "0";
      this._canvas.style.left = "0";
      this._canvas.style.pointerEvents = "none";
      map.getPanes().overlayPane.appendChild(this._canvas);
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

    setGrid: function (grid) {
      this._grid = grid;
      this._scheduleRedraw();
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
      const values = grid.values;

      if (!nx || !ny || !bbox || !Array.isArray(values)) {
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        return;
      }

      const gridBounds = bboxToBounds(bbox);
      if (!this._map.getBounds().intersects(gridBounds)) {
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        return;
      }

      // Render at a resolution depending on zoom for smoother look
      const z = this._map.getZoom();
      const scale = z <= 7 ? 0.35 : z <= 9 ? 0.55 : 0.8; // internal resolution
      const w = Math.max(220, Math.floor(this._canvas.width * scale));
      const h = Math.max(220, Math.floor(this._canvas.height * scale));

      const img = this._ctx.createImageData(w, h);
      const data = img.data;

      // For each pixel, map to lat/lon then sample grid
      const sw = this._map.containerPointToLatLng([0, this._canvas.height]);
      const ne = this._map.containerPointToLatLng([this._canvas.width, 0]);

      const minLonView = sw.lng;
      const maxLonView = ne.lng;
      const minLatView = sw.lat;
      const maxLatView = ne.lat;

      for (let py = 0; py < h; py++) {
        const ty = py / (h - 1);
        const lat = maxLatView - ty * (maxLatView - minLatView);

        for (let px = 0; px < w; px++) {
          const tx = px / (w - 1);
          const lon = minLonView + tx * (maxLonView - minLonView);

          // quickly skip outside grid bbox
          const [minLon, minLat, maxLon, maxLat] = bbox;
          if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) {
            const k = (py * w + px) * 4;
            data[k + 3] = 0;
            continue;
          }

          const xy = lonLatToGridXY(lon, lat, grid);
          if (!xy) {
            const k = (py * w + px) * 4;
            data[k + 3] = 0;
            continue;
          }

          const v = bilinearSample(values, nx, ny, xy.x, xy.y);
          const col = this._paint(v);

          const k = (py * w + px) * 4;
          data[k + 0] = col[0];
          data[k + 1] = col[1];
          data[k + 2] = col[2];
          data[k + 3] = col[3] ?? 0;
        }
      }

      // Draw scaled up to full canvas
      const ctx = this._ctx;
      ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

      // crisp upscaling
      ctx.imageSmoothingEnabled = true;
      // draw
      const tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = h;
      tmp.getContext("2d").putImageData(img, 0, 0);
      ctx.drawImage(tmp, 0, 0, this._canvas.width, this._canvas.height);
    }
  });

  function createGridOverlay(grid, kind) {
    if (kind === "temp") return new GridCanvasLayer(grid, (v) => tempColorC(v));
    if (kind === "pres") return new GridCanvasLayer(grid, (v) => presColorHpa(v));
    if (kind === "rain") return new GridCanvasLayer(grid, (v) => rainColorMm(v));
    return null;
  }

  // -----------------------------
  // App state
  // -----------------------------
  const state = {
    map: null,
    meta: null,
    runDateUtc: null,
    maxHour: 0,
    hour: 0,

    activeKind: null, // "temp"|"rain"|"pres"|"wind"
    overlays: {
      temp: null,
      rain: null,
      pres: null,
      wind: null
    },

    grids: {
      temp: null,
      rain: null,
      pres: null,
      wind: null
    },

    clickMarker: null
  };

  // -----------------------------
  // UI
  // -----------------------------
  const el = {};
  function bindUI() {
    el.btnReload = document.getElementById("btnReload");
    el.metaError = document.getElementById("metaError");

    el.chkTemp = document.getElementById("chkTemp");
    el.chkRain = document.getElementById("chkRain");
    el.chkPres = document.getElementById("chkPres");
    el.chkWind = document.getElementById("chkWind");

    el.slider = document.getElementById("timeSlider");
    el.timeLabel = document.getElementById("timeLabel");
    el.timeSubLabel = document.getElementById("timeSubLabel");

    el.sourceLabel = document.getElementById("sourceLabel");
    el.inspectorLabel = document.getElementById("inspectorLabel");
    el.inspectorValue = document.getElementById("inspectorValue");

    el.btnReload.addEventListener("click", () => reloadAll(true));

    el.chkTemp.addEventListener("change", () => toggleLayer("temp", el.chkTemp.checked));
    el.chkRain.addEventListener("change", () => toggleLayer("rain", el.chkRain.checked));
    el.chkPres.addEventListener("change", () => toggleLayer("pres", el.chkPres.checked));
    el.chkWind.addEventListener("change", () => toggleLayer("wind", el.chkWind.checked));

    el.slider.addEventListener("input", async () => {
      const h = Number(el.slider.value);
      if (!Number.isFinite(h)) return;
      state.hour = h;
      updateTimeLabels();
      await updateForecastHour();
    });
  }

  function setError(msg) {
    if (!msg) {
      el.metaError.style.display = "none";
      el.metaError.textContent = "";
      return;
    }
    el.metaError.style.display = "block";
    el.metaError.textContent = msg;
  }

  function updateTimeLabels() {
    if (!state.runDateUtc) {
      el.timeLabel.textContent = "Ora previsione: —";
      el.timeSubLabel.textContent = "Run: —";
      return;
    }

    const runUtc = state.runDateUtc;
    const valid = new Date(runUtc.getTime() + state.hour * 3600 * 1000);

    el.timeLabel.textContent = `Ora previsione: ${formatDateTimeLocal(valid)} (h+${state.hour})`;
    el.timeSubLabel.textContent = `Run: ${formatRunUTC(runUtc)} — Valid: ${formatRunUTC(valid)}`;
  }

  // -----------------------------
  // Meta + loading
  // -----------------------------
  async function loadMeta(forceBust) {
    const url = forceBust ? `${META_URL}?${cacheBust()}` : `${META_URL}`;
    const meta = await fetchJsonAllowNaN(url);

    // meta expected: { run: "YYYYMMDDHH", source: "...", hours: 48 } (hours optional)
    state.meta = meta;
    state.runDateUtc = parseRunToDate(meta.run);

    // Determine max hour:
    // If meta.hours exists, use it; otherwise infer from available files by assuming 48.
    state.maxHour = Number.isFinite(Number(meta.hours)) ? Number(meta.hours) : 48;

    el.slider.min = "0";
    el.slider.max = String(state.maxHour);
    el.slider.value = String(state.hour);

    el.sourceLabel.textContent = `Fonte dati: ${meta.source || "—"} — ICON-2I open data`;
    updateTimeLabels();
  }

  function fileUrl(kind, hour, forceBust) {
    const h = pad3(hour);
    const base =
      kind === "temp" ? `${DATA_DIR}/temp_${h}.json` :
      kind === "rain" ? `${DATA_DIR}/rain_${h}.json` :
      kind === "pres" ? `${DATA_DIR}/pres_${h}.json` :
      kind === "wind" ? `${DATA_DIR}/wind_${h}.json` :
      null;
    if (!base) return null;
    return forceBust ? `${base}?${cacheBust()}` : base;
  }

  async function loadGrid(kind, hour, forceBust) {
    const url = fileUrl(kind, hour, forceBust);
    if (!url) throw new Error(`URL non valido per layer ${kind}`);
    return await fetchJsonAllowNaN(url);
  }

  async function loadRainHourly(hour, forceBust) {
    // If rain files are cumulative, compute hourly = rain(h) - rain(h-1).
    // If they are already hourly, subtraction may create negatives -> clamp to 0
    const cur = await loadGrid("rain", hour, forceBust);
    if (!cur || !Array.isArray(cur.values)) return cur;

    if (hour <= 0) return cur;

    const prev = await loadGrid("rain", hour - 1, forceBust);
    if (!prev || !Array.isArray(prev.values)) return cur;

    const out = {
      nx: cur.nx,
      ny: cur.ny,
      bbox: cur.bbox,
      values: new Array(cur.values.length)
    };

    for (let i = 0; i < cur.values.length; i++) {
      const a = cur.values[i];
      const b = prev.values[i];
      if (!isFiniteNumber(a) || !isFiniteNumber(b)) {
        out.values[i] = null;
        continue;
      }
      const d = a - b;
      out.values[i] = (d >= 0 ? d : 0);
    }
    return out;
  }

  // -----------------------------
  // Overlay management
  // -----------------------------
  function ensureClickMarker() {
    if (state.clickMarker) return;
    state.clickMarker = L.circleMarker(DEFAULT_CENTER, {
      radius: 6,
      weight: 2,
      color: "#ffffff",
      fillColor: "#2b8cff",
      fillOpacity: 0.9
    }).addTo(state.map);
    state.clickMarker.setStyle({ opacity: 0, fillOpacity: 0 });
  }

  function setClickMarker(latlng) {
    ensureClickMarker();
    state.clickMarker.setLatLng(latlng);
    state.clickMarker.setStyle({ opacity: 1, fillOpacity: 0.9 });
  }

  function toggleLayer(kind, on) {
    // enforce single active at a time? No: allow multiple, but inspector uses "activeKind"
    // Here: if you turn on one, keep others as is.

    if (on) state.activeKind = kind;

    applyOverlayVisibility(kind, on);

    // if turning off active kind, pick another enabled
    if (!on && state.activeKind === kind) {
      const candidates = [
        ["wind", el.chkWind.checked],
        ["temp", el.chkTemp.checked],
        ["rain", el.chkRain.checked],
        ["pres", el.chkPres.checked]
      ].filter(x => x[1]).map(x => x[0]);
      state.activeKind = candidates.length ? candidates[0] : null;
    }

    // Refresh inspector display (if marker already placed)
    if (state.clickMarker && state.activeKind) {
      const ll = state.clickMarker.getLatLng();
      updateInspectorAt(ll);
    }
  }

  function applyOverlayVisibility(kind, on) {
    const map = state.map;
    if (!map) return;

    const ov = state.overlays[kind];
    if (on) {
      if (ov) {
        if (!map.hasLayer(ov)) ov.addTo(map);
      }
    } else {
      if (ov && map.hasLayer(ov)) map.removeLayer(ov);
    }
  }

  function setOverlay(kind, overlay) {
    // remove old
    const map = state.map;
    if (state.overlays[kind] && map && map.hasLayer(state.overlays[kind])) {
      map.removeLayer(state.overlays[kind]);
    }
    state.overlays[kind] = overlay;
  }

  async function updateForecastHour(forceBust = false) {
    // Load only layers that are enabled (to keep it fast on mobile)
    const wants = {
      temp: el.chkTemp.checked,
      rain: el.chkRain.checked,
      pres: el.chkPres.checked,
      wind: el.chkWind.checked
    };

    // Temp
    if (wants.temp) {
      const g = await loadGrid("temp", state.hour, forceBust);
      state.grids.temp = g;
      if (!state.overlays.temp) {
        setOverlay("temp", createGridOverlay(g, "temp"));
      } else {
        state.overlays.temp.setGrid(g);
      }
      applyOverlayVisibility("temp", true);
    } else {
      applyOverla
