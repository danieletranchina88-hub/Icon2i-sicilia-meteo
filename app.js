import maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@3.6.2/dist/maplibre-gl.esm.js";

const map = new maplibregl.Map({
  container: "map",
  style: "https://demotiles.maplibre.org/style.json",
  center: [14.2, 37.5],
  zoom: 6
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

let currentLayerId = null;

// === UTILS ===
function pad(n) {
  return String(n).padStart(3, "0");
}

function clearLayer() {
  if (currentLayerId && map.getLayer(currentLayerId)) {
    map.removeLayer(currentLayerId);
    map.removeSource(currentLayerId);
    currentLayerId = null;
  }
}

// === LOAD FIELD ===
async function loadField(prefix, hour) {
  clearLayer();

  const file = `data/${prefix}_${pad(hour)}.json`;
  console.log("Loading:", file);

  let json;
  try {
    const res = await fetch(file);
    json = await res.json();
  } catch (e) {
    alert("Errore caricamento dati");
    return;
  }

  // FILTRA I NaN (QUESTO ERA IL BUG)
  const features = json.lats.map((lat, i) => {
    const val = json.values[i];
    const lon = json.lons[i];

    if (!isFinite(val) || !isFinite(lat) || !isFinite(lon)) return null;

    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lon, lat]
      },
      properties: { value: val }
    };
  }).filter(Boolean);

  const geojson = {
    type: "FeatureCollection",
    features
  };

  currentLayerId = `layer-${prefix}`;

  map.addSource(currentLayerId, {
    type: "geojson",
    data: geojson
  });

  map.addLayer({
    id: currentLayerId,
    type: "circle",
    source: currentLayerId,
    paint: {
      "circle-radius": 4,
      "circle-opacity": 0.75,
      "circle-color": [
        "interpolate",
        ["linear"],
        ["get", "value"],
        -10, "#2c7bb6",
         0, "#abd9e9",
        10, "#ffffbf",
        20, "#fdae61",
        30, "#d7191c"
      ]
    }
  });
}

// === UI ===
const slider = document.getElementById("hour");
const tempBox = document.getElementById("temp");

function update() {
  if (tempBox.checked) {
    loadField("temp", slider.value);
  } else {
    clearLayer();
  }
}

slider.addEventListener("input", update);
tempBox.addEventListener("change", update);

console.log("APP READY");
