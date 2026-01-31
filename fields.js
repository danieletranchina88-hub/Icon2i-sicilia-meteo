// fields.js
// Definisce i layer scalari e le palette.
// I tuoi file in /data sono: temp_000.json, rain_000.json, pres_000.json ...

window.FIELDS = {
  temp: {
    label: "Temperatura 2m",
    prefix: "data/temp_",
    unit: "°C",
    // range “ragionevole” per la Sicilia (puoi cambiare)
    vmin: -2,
    vmax: 35,
    palette: [
      [0, 0, 130],
      [0, 70, 200],
      [0, 170, 230],
      [60, 220, 170],
      [170, 240, 80],
      [255, 220, 0],
      [255, 140, 0],
      [230, 50, 0],
      [150, 0, 0]
    ]
  },

  rain: {
    label: "Pioggia",
    prefix: "data/rain_",
    unit: "mm",
    vmin: 0,
    vmax: 30,
    palette: [
      [0, 0, 0, 0],     // trasparente per 0
      [160, 220, 255],
      [80, 180, 255],
      [0, 130, 255],
      [0, 80, 220],
      [0, 50, 160],
      [120, 0, 170]
    ]
  },

  pres: {
    label: "Pressione",
    prefix: "data/pres_",
    unit: "hPa",
    // I tuoi valori sembrano essere già in hPa (tipo 994–999)
    vmin: 980,
    vmax: 1035,
    palette: [
      [70, 0, 120],
      [0, 70, 200],
      [0, 170, 230],
      [80, 220, 150],
      [230, 240, 80],
      [255, 170, 0],
      [230, 60, 0]
    ]
  }
};
