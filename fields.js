// fields.js
export const FIELDS = {
  temp: {
    id: "temp",
    label: "Temperatura 2m",
    filePrefix: "temp",
    // scala colori semplice ma efficace (valore, colore)
    style: {
      colorStops: [
        [-10, "#2a6bff"],
        [0, "#00c2ff"],
        [10, "#00d68f"],
        [20, "#ffd24a"],
        [30, "#ff8a3d"],
        [40, "#ff3b3b"],
      ],
    },
  },

  rain: {
    id: "rain",
    label: "Pioggia",
    filePrefix: "rain",
    style: {
      colorStops: [
        [0, "#00000000"], // trasparente
        [0.2, "#bfe7ff"],
        [1, "#5bbcff"],
        [5, "#1e88ff"],
        [15, "#0057d6"],
        [30, "#002a7a"],
      ],
    },
  },

  pres: {
    id: "pres",
    label: "Pressione",
    filePrefix: "pres",
    style: {
      colorStops: [
        [980, "#4b1dff"],
        [995, "#2a6bff"],
        [1005, "#00c2ff"],
        [1015, "#00d68f"],
        [1025, "#ffd24a"],
        [1040, "#ff8a3d"],
      ],
    },
  },
};
