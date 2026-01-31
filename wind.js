function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export class WindParticles {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.map = map;
    this.ctx = canvas.getContext("2d");
    this.running = false;

    this.particles = [];
    this.maxParticles = 12000;   // mobile ok se non esageri
    this.fade = 0.08;           // scia
    this.speedFactor = 0.015;   // velocità particelle

    this.wind = null;           // { nx, ny, bbox, u:Float32Array, v:Float32Array }
  }

  setWindField(windField) {
    this.wind = windField;
    this.resetParticles();
  }

  resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = this.map.getContainer().getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resetParticles() {
    this.particles = [];
    if (!this.wind) return;

    // Spawn particelle dentro bbox Sicilia (in pixel).
    const [minLon, minLat, maxLon, maxLat] = this.wind.bbox;
    const pNW = this.map.project([minLon, maxLat]);
    const pSE = this.map.project([maxLon, minLat]);

    const x0 = Math.min(pNW.x, pSE.x);
    const y0 = Math.min(pNW.y, pSE.y);
    const x1 = Math.max(pNW.x, pSE.x);
    const y1 = Math.max(pNW.y, pSE.y);

    const n = this.maxParticles;
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: x0 + Math.random() * (x1 - x0),
        y: y0 + Math.random() * (y1 - y0),
        age: Math.random() * 100
      });
    }
  }

  start() {
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
  }

  sampleUVAtPixel(x, y) {
    // pixel -> lon/lat
    const ll = this.map.unproject([x, y]);
    const lon = ll.lng;
    const lat = ll.lat;

    const w = this.wind;
    const [minLon, minLat, maxLon, maxLat] = w.bbox;
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return null;

    // lon/lat -> grid index (bilineare)
    const fx = ((lon - minLon) / (maxLon - minLon)) * (w.nx - 1);
    const fy = ((maxLat - lat) / (maxLat - minLat)) * (w.ny - 1);

    const x0 = clamp(Math.floor(fx), 0, w.nx - 2);
    const y0 = clamp(Math.floor(fy), 0, w.ny - 2);
    const tx = fx - x0;
    const ty = fy - y0;

    const i00 = y0 * w.nx + x0;
    const i10 = y0 * w.nx + (x0 + 1);
    const i01 = (y0 + 1) * w.nx + x0;
    const i11 = (y0 + 1) * w.nx + (x0 + 1);

    const u = (1-ty)*((1-tx)*w.u[i00] + tx*w.u[i10]) + ty*((1-tx)*w.u[i01] + tx*w.u[i11]);
    const v = (1-ty)*((1-tx)*w.v[i00] + tx*w.v[i10]) + ty*((1-tx)*w.v[i01] + tx*w.v[i11]);

    return { u, v };
  }

  loop() {
    if (!this.running) return;
    if (!this.wind) {
      requestAnimationFrame(() => this.loop());
      return;
    }

    const ctx = this.ctx;

    // fade
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(0,0,0,${this.fade})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1;

    for (const p of this.particles) {
      p.age += 1;
      if (p.age > 160) {
        p.age = 0;
        // respawn vicino centro vista
        const rect = this.map.getContainer().getBoundingClientRect();
        p.x = Math.random() * rect.width;
        p.y = Math.random() * rect.height;
        continue;
      }

      const uv = this.sampleUVAtPixel(p.x, p.y);
      if (!uv) {
        p.age = 999;
        continue;
      }

      const x2 = p.x + uv.u * this.speedFactor * 60;
      const y2 = p.y - uv.v * this.speedFactor * 60;

      const spd = Math.hypot(uv.u, uv.v);
      const a = clamp(spd / 20, 0.08, 0.55);

      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      p.x = x2;
      p.y = y2;
    }

    requestAnimationFrame(() => this.loop());
  }
          }
