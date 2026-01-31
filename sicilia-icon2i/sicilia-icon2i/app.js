const dbg = (msg) => {
  const el = document.getElementById("debug");
  if (el) el.textContent += msg + "\n";
};

dbg("App.js start");

const map = new maplibregl.Map({
  container: "map",
  style: "https://demotiles.maplibre.org/style.json",
  center: [14.0, 37.5], // Sicilia
  zoom: 6.5,
  pitch: 0,
  bearing: 0,
  antialias: true
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

map.on("load", () => {
  dbg("Map loaded");

  // Debug: disegna un rettangolo sulla Sicilia
  map.addSource("sicilia-debug", {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [12, 36], [16, 36], [16, 39], [12, 39], [12, 36]
        ]]
      }
    }
  });

  map.addLayer({
    id: "sicilia-debug-layer",
    type: "line",
    source: "sicilia-debug",
    paint: {
      "line-color": "#ff3b3b",
      "line-width": 2
    }
  });

  dbg("Debug layer added");
});

map.on("error", (e) => {
  dbg("MAP ERROR: " + e.error?.message);
});
