// Config dei layer e dei file nel folder /data
// I tuoi file sembrano: temp_000.json, rain_000.json, pres_000.json, wind_000.json

window.ICON2I_FIELDS = {
  temp: {
    id: "temp",
    label: "Temperatura 2m",
    filePrefix: "temp_",
    unit: "°C",
    // se i valori sono Kelvin metti true e verrà convertito in °C
    kelvinToC: false,
    // range colori indicativo per auto-normalizzazione
    clamp: { min: -5, max: 35 }
  },
  rain: {
    id: "rain",
    label: "Pioggia",
    filePrefix: "rain_",
    unit: "mm",
    clamp: { min: 0, max: 30 }
  },
  pres: {
    id: "pres",
    label: "Pressione",
    filePrefix: "pres_",
    unit: "hPa",
    // se nei file è in kPa o altro la lasciamo com'è; al bisogno si aggiusta
    clamp: { min: 980, max: 1040 }
  },
  wind: {
    id: "wind",
    label: "Vento",
    filePrefix: "wind_",
    unit: "m/s"
  }
};
