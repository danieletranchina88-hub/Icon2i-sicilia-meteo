// Config layer + scale semplici.
// Se vuoi poi scale “da Windy”, le rifiniamo dopo (ma prima serve stabilità).

const DATA_DIR = "data";

const LAYERS = {
  temp: {
    id: "temp",
    label: "Temperatura 2m",
    filePrefix: "temp_",
    unit: "°C",
    // range comodo per Sicilia, lo aggiusti dopo
    min: -5,
    max: 35,
    // palette tipo "viridis-like" semplice
    color: (t) => {
      // t in [0..1]
      const stops = [
        [0.00, [68, 1, 84]],
        [0.25, [59, 82, 139]],
        [0.50, [33, 145, 140]],
        [0.75, [94, 201, 98]],
        [1.00, [253, 231, 37]],
      ];
      return lerpStops(stops, t);
    }
  },

  rain: {
    id: "rain",
    label: "Pioggia",
    filePrefix: "rain_",
    unit: "mm",
    min: 0,
    max: 50,
    color: (t) => {
      // blu -> viola -> magenta
      const stops = [
        [0.00, [0, 0, 0, 0]],        // trasparente a 0
        [0.08, [120, 180, 255, 110]],
        [0.30, [70, 120, 255, 160]],
        [0.60, [140, 70, 255, 190]],
        [1.00, [255, 40, 180, 220]],
      ];
      return lerpStops(stops, t, true);
    }
  },

  pres: {
    id: "pres",
    label: "Pressione",
    filePrefix: "pres_",
    unit: "hPa",
    min: 980,
    max: 1040,
    color: (t) => {
      // grigio -> giallo -> arancio
      const stops = [
        [0.00, [120, 160, 200, 110]],
        [0.50, [220, 220, 140, 140]],
        [1.00, [255, 160, 60, 170]],
      ];
      return lerpStops(stops, t, true);
    }
  },

  wind: {
    id: "wind",
    label: "Vento",
    filePrefix: "wind_",
    unit: "m/s"
  }
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function lerpStops(stops, t, hasAlpha=false) {
  t = clamp01(t);
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0 || 1);
      const r = Math.round(lerp(c0[0], c1[0], u));
      const g = Math.round(lerp(c0[1], c1[1], u));
      const b = Math.round(lerp(c0[2], c1[2], u));
      if (hasAlpha) {
        const a0 = (c0.length > 3 ? c0[3] : 255);
        const a1 = (c1.length > 3 ? c1[3] : 255);
        const a = Math.round(lerp(a0, a1, u));
        return [r, g, b, a];
      }
      return [r, g, b, 255];
    }
  }
  const last = stops[stops.length - 1][1];
  if (hasAlpha) return [last[0], last[1], last[2], (last[3] ?? 255)];
  return [last[0], last[1], last[2], 255];
}

function pad3(n) {
  return String(n).padStart(3, "0");
}
