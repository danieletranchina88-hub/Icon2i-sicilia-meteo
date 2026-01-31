export const FIELDS = {
  temp: {
    id: "temp",
    label: "Temperatura 2m",
    filePrefix: "temp",         // temp_000.json
    unit: "°C",
    style: {
      circleRadius: 3,
      circleOpacity: 0.85,
      // Interpolazione colore: adattabile
      colorStops: [
        [-5,  "#2c3e9e"],
        [0,   "#2f7eea"],
        [5,   "#2fd3f5"],
        [10,  "#3ee68b"],
        [15,  "#b5f14a"],
        [20,  "#ffd24a"],
        [25,  "#ff8a3d"],
        [30,  "#ff3b3b"],
        [35,  "#a30000"],
      ],
    },
  },

  rain: {
    id: "rain",
    label: "Pioggia",
    filePrefix: "rain",         // rain_000.json
    unit: "mm",
    style: {
      circleRadius: 3,
      circleOpacity: 0.80,
      colorStops: [
        [0,    "#00000000"],
        [0.1,  "#7ad3ff"],
        [0.5,  "#2a9df4"],
        [2,    "#0066ff"],
        [5,    "#00c853"],
        [10,   "#ffd600"],
        [20,   "#ff6d00"],
        [40,   "#d50000"],
      ],
    },
  },

  pres: {
    id: "pres",
    label: "Pressione",
    filePrefix: "pres",         // pres_000.json
    unit: "hPa",
    style: {
      circleRadius: 3,
      circleOpacity: 0.80,
      colorStops: [
        [980,  "#6a00ff"],
        [995,  "#2a6bff"],
        [1010, "#00c2ff"],
        [1020, "#00d68f"],
        [1030, "#ffd24a"],
        [1040, "#ff8a3d"],
        [1050, "#ff3b3b"],
      ],
    },
  },
};
