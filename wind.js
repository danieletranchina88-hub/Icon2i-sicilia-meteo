// wind.js
// Layer vento a frecce. Assume JSON tipo:
// { nx, ny, bbox:[minLon,minLat,maxLon,maxLat], values:[u0,v0,u1,v1,...] }
// Se i tuoi wind_###.json hanno struttura diversa dimmelo e lo adatto.

(function () {
  function lerp(a, b, t) { return a + (b - a) * t; }

  function speedToColor(s) {
    // semplice scala: blu -> verde -> giallo -> arancio -> rosso
    if (!isFinite(s)) return "rgba(0,0,0,0)";
    if (s < 3) return "rgba(80,140,255,0.8)";
    if (s < 6) return "rgba(80,220,170,0.8)";
    if (s < 9) return "rgba(230,240,80,0.85)";
    if (s < 12) return "rgba(255,170,0,0.85)";
    return "rgba(230,60,0,0.85)";
  }

  function idxUV(i) { return i * 2; }

  function makeWindLayer(json, map) {
    const nx = json.nx;
    const ny = json.ny;
    const bbox = json.bbox;

    const minLon = bbox[0], minLat = bbox[1], maxLon = bbox[2], maxLat = bbox[3];
    const values = json.values || [];

    const group = L.layerGroup();

    // campionamento: se vuoi più fitto diminuisci step
    // se vuoi più “pulito” aumenta step
    const step = Math.max(4, Math.floor(Math.min(nx, ny) / 35));

    for (let y = 0; y < ny; y += step) {
      for (let x = 0; x < nx; x += step) {
        const i = y * nx + x;
        const k = idxUV(i);
        const u = values[k];
        const v = values[k + 1];

        if (!isFinite(u) || !isFinite(v)) continue;

        const lon = lerp(minLon, maxLon, x / (nx - 1));
        const lat = lerp(maxLat, minLat, y / (ny - 1)); // y=0 è “nord”
        const p0 = L.latLng(lat, lon);

        const s = Math.sqrt(u * u + v * v);
        const scale = 0.08; // “quanto lunga” la freccia
        const dLat = v * scale;
        const dLon = u * scale;

        const p1 = L.latLng(lat + dLat, lon + dLon);

        const line = L.polyline([p0, p1], {
          color: speedToColor(s),
          weight: 2,
          opacity: 0.9,
          interactive: false
        });

        group.addLayer(line);
      }
    }

    return group;
  }

  window.createWindLayer = function (json, map) {
    return makeWindLayer(json, map);
  };
})();
