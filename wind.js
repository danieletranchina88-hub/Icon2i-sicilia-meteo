export function buildWindGeoJSON(meta, windObj, sampleStep = 10) {
  // windObj atteso: { u: [...], v: [...] } oppure {U:[...],V:[...]}
  const u = windObj.u ?? windObj.U;
  const v = windObj.v ?? windObj.V;

  if (!u || !v) {
    throw new Error("File vento: mancano array u/v (o U/V).");
  }

  const nx = meta.nx;
  const ny = meta.ny;
  const [w, s, e, n] = meta.bbox;
  const dx = (e - w) / nx;
  const dy = (n - s) / ny;

  const features = [];

  for (let j = 0; j < ny; j += sampleStep) {
    for (let i = 0; i < nx; i += sampleStep) {
      const idx = j * nx + i;

      const uu = u[idx];
      const vv = v[idx];
      if (uu == null || vv == null || Number.isNaN(uu) || Number.isNaN(vv)) continue;

      const lon = w + (i + 0.5) * dx;
      const lat = s + (j + 0.5) * dy;

      // Piccola freccia: linea dal punto verso la direzione del vento
      const scale = 0.02; // regolabile: più grande = frecce più lunghe
      const lon2 = lon + uu * scale;
      const lat2 = lat + vv * scale;

      const spd = Math.sqrt(uu * uu + vv * vv);

      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[lon, lat], [lon2, lat2]],
        },
        properties: { spd },
      });
    }
  }

  return { type: "FeatureCollection", features };
}
