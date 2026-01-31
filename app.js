(() => {
  const F = window.ICON2I_FIELDS;

  // Se ti sembra “capovolto”, cambia qui:
  // true  = interpreta values come righe che vanno da N→S (flip per metterle in lat corretta)
  // false = interpreta values come righe che vanno da S→N
  const FLIP_Y = true;

  // Cache busting: ogni fetch aggiunge ?v=timestamp
  function bust(url) {
    const v = Date.now().toString(36);
    return url.includes("?") ? `${url}&v=${v}` : `${url}?v=${v}`;
  }

  function setStatus(msg, isErr = false) {
    const el = document.getElementById("status");
    el.textContent = msg || "";
    el.classList.toggle("err", !!isErr);
  }

  function pad3(n) {
    return String(n).padStart(3, "0");
  }

  async function fetchText(url) {
    const res = await fetch(bust(url), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
    return await res.text();
  }

  // PARSE ROBUSTO: trasforma token NaN in null prima del JSON.parse
  function safeJsonParse(text) {
    // sostituisce NaN "nudi" con null (anche in array lunghi)
    // è volutamente semplice: se mai ti finisse la stringa "NaN" in un campo testuale, qui verrebbe cambiata.
    // ma nei tuoi file è un valore numerico, quindi va benissimo.
    const cleaned = text.replace(/\bNaN\b/g, "null");
    return JSON.parse(cleaned);
  }

  async function loadGrid(prefix, hour) {
    const url = `./data/${prefix}${pad3(hour)}.json`;
    const text = await fetchText(url);
    return safeJsonParse(text);
  }

  function gridLonLat(bbox, nx, ny, ix, iy, flipY) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const fx = nx <= 1 ? 0 : ix / (nx - 1);
    const fy = ny <= 1 ? 0 : iy / (ny - 1);
    const y = flipY ? (1 - fy) : fy;
    const lon = minLon + fx * (maxLon - minLon);
    const lat = minLat + y * (maxLat - minLat);
    return [lon, lat];
  }

  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }

  function toPointsGeoJSON(grid, field) {
    const nx = grid.nx | 0;
    const ny = grid.ny | 0;
    const bbox = grid.bbox;
    let values = grid.values;

    if (!nx || !ny || !Array.isArray(bbox) || bbox.length !== 4) {
      throw new Error("Griglia non valida (nx/ny/bbox)");
    }
    if (!Array.isArray(values) || values.length < nx * ny) {
      throw new Error("values mancanti o lunghezza errata");
    }

    // normalizzazioni opzionali
    if (field && field.kelvinToC) {
      values = values.map(v => (typeof v === "number" ? (v - 273.15) : v));
    }

    const clampMin = field?.clamp?.min;
    const clampMax = field?.clamp?.max;

    // se non hai clamp, prova a stimare min/max su un campione
    let vmin = Number.isFinite(clampMin) ? clampMin : Infinity;
    let vmax = Number.isFinite(clampMax) ? clampMax : -Infinity;

    if (!Number.isFinite(clampMin) || !Number.isFinite(clampMax)) {
      const step = Math.max(1, Math.floor((nx * ny) / 3500));
      for (let i = 0; i < nx * ny; i += step) {
        const v = values[i];
        if (typeof v === "number" && Number.isFinite(v)) {
          if (v < vmin) vmin = v;
          if (v > vmax) vmax = v;
        }
      }
      if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmin === vmax) {
        vmin = 0; vmax = 1;
      }
    } else {
      vmin = clampMin;
      vmax = clampMax;
      if (vmin === vmax) vmax = vmin + 1;
    }

    const features = [];
    const total = nx * ny;

    // densità: su mobile se è troppo pesante, aumentiamo lo step
    let step = 1;
    if (total > 60000) step = 2;
    if (total > 120000) step = 3;

    for (let iy = 0; iy < ny; iy += step) {
      for (let ix = 0; ix < nx; ix += step) {
        const idx = iy * nx + ix;
        const v = values[idx];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;

        const [lon, lat] = gridLonLat(bbox, nx, ny, ix, iy, FLIP_Y);
        const t = clamp01((v - vmin) / (vmax - vmin));

        features.push({
          type: "Feature",
          properties: { value: v, t },
          geometry: { type: "Point", coordinates: [lon, lat] }
        });
      }
    }

    return { type: "FeatureCollection", features };
  }

  function ensureSource(map, id, data) {
    if (map.getSource(id)) {
      map.getSource(id).setData(data);
      return;
    }
    map.addSource(id, { type: "geojson", data });
  }

  function ensureHeatLayer(map, layerId, sourceId) {
    if (map.getLayer(layerId)) return;

    map.addLayer({
      id: layerId,
      type: "heatmap",
      source: sourceId,
      paint: {
        // più “liscio” e meno puntini
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 18, 6, 28, 8, 45, 10, 70, 12, 95],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 8, 1.1, 12, 1.4],
        "heatmap-opacity": 0.78,
        "heatmap-weight": 1,
        "heatmap-color": [
          "interpolate", ["linear"], ["get", "t"],
          0.00, "rgba(0,0,0,0)",
          0.10, "rgba(0, 80, 255, 0.35)",
          0.25, "rgba(0, 190, 255, 0.55)",
          0.40, "rgba(0, 255, 180, 0.60)",
          0.55, "rgba(120, 255, 60, 0.65)",
          0.70, "rgba(255, 230, 0, 0.70)",
          0.85, "rgba(255, 120, 0, 0.75)",
          1.00, "rgba(255, 0, 0, 0.80)"
        ]
      }
    });
  }

  function ensureWindLayer(map) {
    const srcId = "wind-src";
    const layerId = "wind-layer";

    if (map.getLayer(layerId)) return;

    map.addLayer({
      id: layerId,
      type: "line",
      source: srcId,
      paint: {
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 8, 2.0, 12, 2.8],
        "line-opacity": 0.75,
        "line-color": [
          "interpolate", ["linear"], ["get", "speed"],
          0, "rgba(0, 140, 255, 0.85)",
          5, "rgba(0, 255, 170, 0.85)",
          10, "rgba(255, 230, 0, 0.85)",
          15, "rgba(255, 120, 0, 0.85)",
          22, "rgba(255, 0, 0, 0.85)"
        ]
      }
    });
  }

  function setOnly(map, which) {
    const heatIds = ["temp-layer", "rain-layer", "pres-layer"];
    const windId = "wind-layer";

    for (const id of heatIds) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", (id.startsWith(which) ? "visible" : "none"));
    }
    if (map.getLayer(windId)) {
      map.setLayoutProperty(windId, "visibility", which === "wind" ? "visible" : "none");
    }
  }

  function fileCountFor(prefix) {
    // se hai 48 ore (000-047) lascia 47 come max nello slider.
    // se in futuro metti più file, aumenta max nello slider in index.html.
    return 48;
  }

  async function tryLoadRunMeta() {
    // opzionale: se hai un file tipo data/run.json o data/meta.json
    // Se non c'è, non è un errore.
    const candidates = ["./data/run.json", "./data/meta.json"];
    for (const url of candidates) {
      try {
        const text = await fetchText(url);
        const obj = safeJsonParse(text);
        return obj;
      } catch (_) {}
    }
    return null;
  }

  const state = {
    map: null,
    hour: 0,
    active: null, // "temp" | "rain" | "pres" | "wind"
    run: null
  };

  function ui() {
    return {
      chkTemp: document.getElementById("chkTemp"),
      chkRain: document.getElementById("chkRain"),
      chkPres: document.getElementById("chkPres"),
      chkWind: document.getElementById("chkWind"),
      hour: document.getElementById("hour"),
      hourLabel: document.getElementById("hourLabel"),
      runLabel: document.getElementById("runLabel"),
      plusLabel: document.getElementById("plusLabel"),
      btnReload: document.getElementById("btnReload")
    };
  }

  function setChecks(active) {
    const u = ui();
    u.chkTemp.checked = active === "temp";
    u.chkRain.checked = active === "rain";
    u.chkPres.checked = active === "pres";
    u.chkWind.checked = active === "wind";
  }

  function setRunLabels(meta) {
    const u = ui();
    if (meta && meta.run) {
      u.runLabel.textContent = String(meta.run);
    } else {
      u.runLabel.textContent = "—";
    }
    u.plusLabel.textContent = `+${state.hour}h`;
  }

  async function renderActive() {
    const map = state.map;
    const hour = state.hour;

    if (!state.active) {
      setStatus("");
      return;
    }

    setStatus("Caricamento…");
    try {
      if (state.active === "wind") {
        const grid = await loadGrid(F.wind.filePrefix, hour);

        const geo = window.buildWindGeoJSON(grid, {
          flipY: FLIP_Y,
          step: 6,      // densità frecce: 4 più fitto, 6 più leggero
          scale: 0.06   // lunghezza
        });

        if (!geo) throw new Error("Formato vento non riconosciuto (manca u/v)");
        ensureSource(map, "wind-src", geo);
        ensureWindLayer(map);
        setOnly(map, "wind");
        setStatus("");
        return;
      }

      const field = state.active === "temp" ? F.temp : state.active === "rain" ? F.rain : F.pres;
      const prefix = field.filePrefix;

      const grid = await loadGrid(prefix, hour);
      const geo = toPointsGeoJSON(grid, field);

      const srcId = `${state.active}-src`;
      const layerId = `${state.active}-layer`;

      ensureSource(map, srcId, geo);
      ensureHeatLayer(map, layerId, srcId);

      setOnly(map, state.active);
      setStatus("");
    } catch (e) {
      setStatus(`Layer non disponibile: ${e.message}`, true);
      // nasconde layer attivo se errore per evitare roba “mezza”
      if (state.active === "wind") {
        if (map.getLayer("wind-layer")) map.setLayoutProperty("wind-layer", "visibility", "none");
      } else {
        const lid = `${state.active}-layer`;
        if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", "none");
      }
    }
  }

  function bindUI() {
    const u = ui();

    const onPick = async (active) => {
      state.active = active;
      setChecks(active);
      setRunLabels(state.run);
      await renderActive();
    };

    u.chkTemp.addEventListener("change", () => onPick(u.chkTemp.checked ? "temp" : null));
    u.chkRain.addEventListener("change", () => onPick(u.chkRain.checked ? "rain" : null));
    u.chkPres.addEventListener("change", () => onPick(u.chkPres.checked ? "pres" : null));
    u.chkWind.addEventListener("change", () => onPick(u.chkWind.checked ? "wind" : null));

    u.hour.addEventListener("input", async () => {
      state.hour = parseInt(u.hour.value, 10) || 0;
      u.hourLabel.textContent = String(state.hour);
      setRunLabels(state.run);
      await renderActive();
    });

    u.btnReload.addEventListener("click", async () => {
      // “hard refresh” interno: ricarica run/meta e poi ridisegna
      setStatus("Ricarico…");
      state.run = await tryLoadRunMeta();
      setRunLabels(state.run);
      await renderActive();
      setStatus("");
    });

    // init labels
    state.hour = parseInt(u.hour.value, 10) || 0;
    u.hourLabel.textContent = String(state.hour);
  }

  function initMap() {
    // Basemap OpenStreetMap (tiles). È OSM “classico”.
    // Se vuoi un altro stile, si cambia qui.
    const style = {
      version: 8,
      sources: {
        osm: {
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
        { id: "osm", type: "raster", source: "osm" }
      ]
    };

    const map = new maplibregl.Map({
      container: "map",
      style,
      center: [14.0, 37.5],
      zoom: 6.3,
      minZoom: 4,
      maxZoom: 12
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // migliora rendering su mobile
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    return map;
  }

  async function start() {
    setStatus("");
    state.run = await tryLoadRunMeta();
    setRunLabels(state.run);

    state.map = initMap();
    bindUI();

    state.map.on("load", async () => {
      // niente layer attivo all’avvio: lasciamo l’utente scegliere
      setStatus("");
    });
  }

  start();
})();
