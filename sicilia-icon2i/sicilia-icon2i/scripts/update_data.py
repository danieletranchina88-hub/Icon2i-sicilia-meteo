import re
import json
import os
from datetime import datetime
import requests
import numpy as np
import xarray as xr

BASE = "https://meteohub.agenziaitaliameteo.it/nwp/ICON-2I_SURFACE_PRESSURE_LEVELS/"
OUTDIR = "data"

# Bounding box Sicilia
SICILY_BBOX = (12.25, 36.40, 15.70, 38.35)  # minLon, minLat, maxLon, maxLat

# Risoluzione griglia esportata per il web (più alto = più pesante)
NX = 220
NY = 220

# Tentativi nomi cartelle (MeteoHub usa cartelle per variabile; possono variare)
CANDIDATES = {
    "temp": ["T_2M", "T2M", "T_2M_S", "T_2M_2", "T_2M_K"],  # temperatura 2m
    "pres": ["PMSL", "PMSL_S", "PPMSL", "PSL", "PS"],       # pressione (meglio MSLP, ma PS spesso c'è)
    "rain": ["TOT_PREC", "TP", "RAIN_GSP", "RAIN_CON", "RR"], # pioggia/precipitazione
    "u10":  ["U_10M", "U10M", "U_10M_S", "U"],
    "v10":  ["V_10M", "V10M", "V_10M_S", "V"],
}

def fetch_text(url: str) -> str:
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.text

def list_dirs(index_html: str):
    # cattura pattern: 2026013112/ oppure ALB_RAD/
    return re.findall(r'href="([^"]+/)"', index_html)

def pick_latest_run():
    html = fetch_text(BASE)
    runs = [d.strip("/") for d in list_dirs(html) if re.match(r"^\d{10}/$", d)]
    if not runs:
        raise RuntimeError("Non trovo run nella pagina indice.")
    runs_sorted = sorted(runs)
    return runs_sorted[-1]

def list_run_vars(run: str):
    html = fetch_text(f"{BASE}{run}/")
    dirs = [d.strip("/") for d in list_dirs(html) if d.endswith("/")]
    # filtra solo cartelle variabili (evita ../)
    dirs = [d for d in dirs if d != ".."]
    return dirs

def find_var_dir(var_dirs, wanted_list):
    s = set(var_dirs)
    for w in wanted_list:
        if w in s:
            return w
    # fallback: match case-insensitive
    low = {d.lower(): d for d in var_dirs}
    for w in wanted_list:
        if w.lower() in low:
            return low[w.lower()]
    return None

def first_grib_in_dir(run: str, var_dir: str):
    html = fetch_text(f"{BASE}{run}/{var_dir}/")
    files = re.findall(r'href="([^"]+\.grib)"', html)
    if not files:
        raise RuntimeError(f"Nessun .grib in {run}/{var_dir}/")
    # molti casi hanno un file unico per tutte le ore; se ce ne sono più, prendi il primo.
    return files[0]

def open_grib_as_xarray(url: str):
    # Scarica localmente per cfgrib (più stabile)
    os.makedirs("tmp", exist_ok=True)
    local = os.path.join("tmp", os.path.basename(url))
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(local, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024*256):
                if chunk:
                    f.write(chunk)

    # Prova ad aprire il GRIB; cfgrib spesso crea più dataset (surface/heightAboveGround ecc).
    # Noi prendiamo il primo dataset che contiene un DataArray numerico.
    ds = xr.open_dataset(local, engine="cfgrib")
    return ds

def bbox_subset(ds):
    minLon, minLat, maxLon, maxLat = SICILY_BBOX

    # coordinate possibili: latitude/longitude oppure lat/lon
    lon_name = "longitude" if "longitude" in ds.coords else ("lon" if "lon" in ds.coords else None)
    lat_name = "latitude" if "latitude" in ds.coords else ("lat" if "lat" in ds.coords else None)
    if lon_name is None or lat_name is None:
        raise RuntimeError(f"Coordinate lat/lon non trovate nel dataset: {list(ds.coords)}")

    lons = ds[lon_name]
    lats = ds[lat_name]

    # gestisce lat decrescente
    lat_slice = slice(maxLat, minLat) if (lats[0] > lats[-1]) else slice(minLat, maxLat)
    sub = ds.sel({lon_name: slice(minLon, maxLon), lat_name: lat_slice})
    return sub, lon_name, lat_name

def pick_main_var(ds):
    # prende la prima variabile data-like
    for v in ds.data_vars:
        arr = ds[v]
        if np.issubdtype(arr.dtype, np.number):
            return v
    raise RuntimeError(f"Nessuna variabile numerica trovata. data_vars={list(ds.data_vars)}")

def resample_to_fixed_grid(arr, lon_name, lat_name):
    minLon, minLat, maxLon, maxLat = SICILY_BBOX

    lon_new = np.linspace(minLon, maxLon, NX, dtype=np.float32)
    lat_new = np.linspace(maxLat, minLat, NY, dtype=np.float32)  # dall'alto verso il basso per coerenza rendering

    out = arr.interp({lon_name: lon_new, lat_name: lat_new})
    return lon_new, lat_new, out

def extract_time_dim(arr):
    # ICON spesso ha time + step; dipende dal file.
    # Noi proviamo a ottenere una dimensione temporale “unica” e a produrre N step.
    time_dims = [d for d in arr.dims if d in ("time", "step", "valid_time")]
    if not time_dims:
        # single field
        return [arr], ["t0"]
    if "valid_time" in arr.dims:
        times = arr["valid_time"].values
        frames = [arr.isel(valid_time=i) for i in range(arr.sizes["valid_time"])]
        labels = [str(np.datetime_as_string(t, unit="h")) for t in times]
        return frames, labels

    # fallback: se c'è step, costruisci label con step index
    if "step" in arr.dims:
        n = arr.sizes["step"]
        frames = [arr.isel(step=i) for i in range(n)]
        labels = [f"+{i}h" for i in range(n)]
        return frames, labels

    if "time" in arr.dims:
        n = arr.sizes["time"]
        frames = [arr.isel(time=i) for i in range(n)]
        labels = [f"time[{i}]" for i in range(n)]
        return frames, labels

    # ultimo caso
    return [arr], ["t0"]

def save_field(kind, t_index, lon_new, lat_new, values2d):
    os.makedirs(OUTDIR, exist_ok=True)
    obj = {
        "nx": int(NX),
        "ny": int(NY),
        "bbox": [SICILY_BBOX[0], SICILY_BBOX[1], SICILY_BBOX[2], SICILY_BBOX[3]],
        "values": values2d.astype(np.float32).ravel().tolist()
    }
    path = os.path.join(OUTDIR, f"{kind}_{t_index:03d}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f)

def save_wind(t_index, lon_new, lat_new, u2d, v2d):
    os.makedirs(OUTDIR, exist_ok=True)
    obj = {
        "nx": int(NX),
        "ny": int(NY),
        "bbox": [SICILY_BBOX[0], SICILY_BBOX[1], SICILY_BBOX[2], SICILY_BBOX[3]],
        "u": u2d.astype(np.float32).ravel().tolist(),
        "v": v2d.astype(np.float32).ravel().tolist()
    }
    path = os.path.join(OUTDIR, f"wind_{t_index:03d}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f)

def main():
    print(f"[INFO] Base: {BASE}")
    run = pick_latest_run()
    print(f"[INFO] Latest run: {run}")

    var_dirs = list_run_vars(run)
    print(f"[INFO] Vars found (sample): {var_dirs[:20]} ... total={len(var_dirs)}")

    chosen = {}
    for key, candidates in CANDIDATES.items():
        d = find_var_dir(var_dirs, candidates)
        chosen[key] = d
        print(f"[INFO] Pick {key}: {d} (candidates={candidates})")

    missing = [k for k,v in chosen.items() if v is None]
    if missing:
        raise RuntimeError(
            "Non trovo alcune variabili nelle cartelle del run. Mancano: "
            + ", ".join(missing)
            + "\nGuarda il log 'Vars found' e aggiungi il nome corretto in CANDIDATES."
        )

    # Costruisci URL GRIB (primo file nella cartella)
    urls = {}
    for k, d in chosen.items():
        grib_name = first_grib_in_dir(run, d)
        urls[k] = f"{BASE}{run}/{d}/{grib_name}"
        print(f"[INFO] URL {k}: {urls[k]}")

    # Apri e prepara TEMP
    ds_t = open_grib_as_xarray(urls["temp"])
    sub_t, lon_name, lat_name = bbox_subset(ds_t)
    vname_t = pick_main_var(sub_t)
    arr_t = sub_t[vname_t]
    frames_t, labels_t = extract_time_dim(arr_t)

    # Pressione
    ds_p = open_grib_as_xarray(urls["pres"])
    sub_p, lon_name_p, lat_name_p = bbox_subset(ds_p)
    vname_p = pick_main_var(sub_p)
    arr_p = sub_p[vname_p]
    frames_p, labels_p = extract_time_dim(arr_p)

    # Pioggia
    ds_r = open_grib_as_xarray(urls["rain"])
    sub_r, lon_name_r, lat_name_r = bbox_subset(ds_r)
    vname_r = pick_main_var(sub_r)
    arr_r = sub_r[vname_r]
    frames_r, labels_r = extract_time_dim(arr_r)

    # Vento
    ds_u = open_grib_as_xarray(urls["u10"])
    sub_u, lon_name_u, lat_name_u = bbox_subset(ds_u)
    vname_u = pick_main_var(sub_u)
    arr_u = sub_u[vname_u]
    frames_u, labels_u = extract_time_dim(arr_u)

    ds_v = open_grib_as_xarray(urls["v10"])
    sub_v, lon_name_v, lat_name_v = bbox_subset(ds_v)
    vname_v = pick_main_var(sub_v)
    arr_v = sub_v[vname_v]
    frames_v, labels_v = extract_time_dim(arr_v)

    # Decide quante ore esportare (allinea sul minimo comune)
    n = min(len(frames_t), len(frames_p), len(frames_r), len(frames_u), len(frames_v), 49)  # max 49 step ~ 2 giorni
    print(f"[INFO] Export steps: {n}")

    # label tempo: preferisci temp, altrimenti +h
    times = labels_t[:n] if len(labels_t) >= n else [f"+{i}h" for i in range(n)]

    os.makedirs(OUTDIR, exist_ok=True)

    for i in range(n):
        # temp: spesso in Kelvin -> converti a °C se sembra Kelvin
        lon_new, lat_new, t_i = resample_to_fixed_grid(frames_t[i], lon_name, lat_name)
        t_vals = t_i.values.astype(np.float32)
        if np.nanmean(t_vals) > 120:  # euristica Kelvin
            t_vals = t_vals - 273.15

        lon_new, lat_new, p_i = resample_to_fixed_grid(frames_p[i], lon_name_p, lat_name_p)
        p_vals = p_i.values.astype(np.float32)
        # se Pa -> hPa
        if np.nanmean(p_vals) > 20000:
            p_vals = p_vals / 100.0

        lon_new, lat_new, r_i = resample_to_fixed_grid(frames_r[i], lon_name_r, lat_name_r)
        r_vals = r_i.values.astype(np.float32)

        lon_new, lat_new, u_i = resample_to_fixed_grid(frames_u[i], lon_name_u, lat_name_u)
        u_vals = u_i.values.astype(np.float32)

        lon_new, lat_new, v_i = resample_to_fixed_grid(frames_v[i], lon_name_v, lat_name_v)
        v_vals = v_i.values.astype(np.float32)

        save_field("temp", i, lon_new, lat_new, t_vals)
        save_field("pres", i, lon_new, lat_new, p_vals)
        save_field("rain", i, lon_new, lat_new, r_vals)
        save_wind(i, lon_new, lat_new, u_vals, v_vals)

        print(f"[INFO] Saved t={i}")

    meta = {
        "run": run,
        "generated_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "times": times,
        "bbox": list(SICILY_BBOX),
        "nx": NX,
        "ny": NY,
        "source": "MeteoHub / Agenzia ItaliaMeteo — ICON-2I open data"
    }
    with open(os.path.join(OUTDIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f)

    print("[OK] meta.json scritto.")

if __name__ == "__main__":
    main()
