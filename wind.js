// Costruzione linee/frecce vento a partire da griglia (u,v) o (speed,dir)
// Supporta formati comuni:
// A) { nx, ny, bbox:[minLon,minLat,maxLon,maxLat], u:[...], v:[...] }
// B) { nx, ny, bbox, valuesU:[...], valuesV:[...] }
// C) { nx, ny, bbox, values:[...]} dove values è array di coppie [u,v] flattenato (u0,v0,u1,v1,...)
// Se non trova un formato gestibile, non disegna nulla.

(function () {
  function isFiniteNumber(x) {
    return typeof x === "number" && Number.isFinite(x);
  }

  function pickWindArrays(obj) {
    if (Array.isArray(obj.u) && Array.isArray(obj.v)) return { u: obj.u, v: obj.v };
    if (Array.isArray(obj.valuesU) && Array.isArray(obj.valuesV)) return { u: obj.valuesU, v: obj.valuesV };
    if (Array.isArray(obj.U) && Array.isArray(obj.V)) return { u: obj.U, v: obj.V };

    if (Array.isArray(obj.values) && obj.values.length >= 2) {
      // prova a interpretare come coppie u,v flattenate
      // se è tutto numerico e lunghezza pari, ok
      const n = obj.values.length;
      if (n % 2 === 0) {
        let ok = true;
        for (let i = 0; i < Math.min(n, 100); i++) {
          const vv = obj.values[i];
          if (vv !== null && typeof vv !== "number") { ok = false; break; }
        }
        if (ok) {
          const u = new Array(n / 2);
          const v = new Array(n / 2);
          for (let i = 0, j = 0; i < n; i += 2, j++) {
            u[j] = obj.values[i];
            v[j] = obj.values[i + 1];
          }
          return { u, v };
        }
      }
    }
    return null;
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

  function buildWindGeoJSON(obj, opts = {}) {
    const nx = obj.nx | 0;
    const ny = obj.ny | 0;
    const bbox = obj.bbox;

    if (!nx || !ny || !Array.isArray(bbox) || bbox.length !== 4) return null;

    const arrays = pickWindArrays(obj);
    if (!arrays) return null;

    const u = arrays.u;
    const v = arrays.v;
    if (!Array.isArray(u) || !Array.isArray(v)) return null;
    if (u.length < nx * ny || v.length < nx * ny) return null;

    const flipY = opts.flipY === true;
    const step = Math.max(1, opts.step | 0);
    const scale = isFiniteNumber(opts.scale) ? opts.scale : 0.06; // lunghezza freccia in gradi circa
    const features = [];

    for (let iy = 0; iy < ny; iy += step) {
      for (let ix = 0; ix < nx; ix += step) {
        const idx = iy * nx + ix;
        const uu = u[idx];
        const vv = v[idx];
        if (!isFiniteNumber(uu) || !isFiniteNumber(vv)) continue;

        const speed = Math.hypot(uu, vv);
        if (!isFiniteNumber(speed) || speed < 0.2) continue;

        const [lon, lat] = gridLonLat(bbox, nx, ny, ix, iy, flipY);

        // normalizzo la direzione e disegno un segmento proporzionale alla velocità
        const k = Math.min(1.6, Math.max(0.25, speed / 12)) * scale;
        const lon2 = lon + (uu * k);
        const lat2 = lat + (vv * k);

        features.push({
          type: "Feature",
          properties: { speed },
          geometry: { type: "LineString", coordinates: [[lon, lat], [lon2, lat2]] }
        });
      }
    }

    return { type: "FeatureCollection", features };
  }

  window.buildWindGeoJSON = buildWindGeoJSON;
})();
