// Campi e prefissi file REALI in /data/
// Esempio: data/temp_000.json, data/rain_012.json, ecc.

export const FIELDS = {
  temp: {
    id: "temp",
    label: "Temperatura 2m",
    prefix: "temp",
    unit: "°C"
  },
  rain: {
    id: "rain",
    label: "Pioggia",
    prefix: "rain",
    unit: "mm"
  },
  pres: {
    id: "pres",
    label: "Pressione",
    prefix: "pres",
    unit: "hPa"
  },
  wind: {
    id: "wind",
    label: "Vento",
    prefix: "wind",
    unit: "m/s"
  }
};

export function pad3(n) {
  return String(n).padStart(3, "0");
}

export function fileFor(fieldId, lead) {
  const f = FIELDS[fieldId];
  return `data/${f.prefix}_${pad3(lead)}.json`;
}
