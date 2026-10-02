// JARVIS core — the living particle sphere of the voice screen.
// WebGL for the particles (9k points, additive glow), Canvas 2D for aura,
// HUD rings, bezel, dust and the data links to context cards. Falls back to
// 2D particles when WebGL is unavailable. Pure rendering: no network, no DOM
// building beyond its own two canvases.

const LOOKS = {
  idle: { amp: 0.05, speed: 0.16, twist: 0, ripple: 0, pulse: 0, glow: 0.55, k: 1, c0: "#A8ECFF", c1: "#2E8BFF", c2: "#6A5CFF", g: "#2F6BFF" },
  listening: { amp: 0.055, speed: 0.22, twist: 0, ripple: 1, pulse: 0, glow: 0.85, k: 1.06, c0: "#F4FDFF", c1: "#64D2FF", c2: "#0A84FF", g: "#36BFFF" },
  thinking: { amp: 0.035, speed: 0.4, twist: 1, ripple: 0, pulse: 0, glow: 0.65, k: 0.94, c0: "#F0D4FF", c1: "#A07CFF", c2: "#4FA8FF", g: "#7E4DFF" },
  speaking: { amp: 0.05, speed: 0.24, twist: 0, ripple: 0, pulse: 1, glow: 0.9, k: 1.02, c0: "#FFF3D6", c1: "#FFB340", c2: "#4FB7FF", g: "#FF9534" },
};
const CARD_COLORS = { event: [255, 138, 31], mail: [47, 91, 255], task: [48, 209, 88], contact: [100, 210, 255], file: [125, 122, 255], finance: [255, 214, 10], weather: [90, 200, 250], place: [255, 55, 95], list: [18, 184, 134], news: [174, 174, 178], note: [255, 214, 10] };

const hexCache = {};
const hex = (h) => (hexCache[h] ??= [(parseInt(h.slice(1), 16) >> 16) & 255, (parseInt(h.slice(1), 16) >> 8) & 255, parseInt(h.slice(1), 16) & 255]);
const mix = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

const VS = `
attribute vec4 aA;
attribute vec4 aB;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uR, uT, uAmp, uRipple, uPulse, uLevel, uMorph, uRot, uTilt, uDpr, uScale, uGain, uAsm;
uniform vec3 uC0, uC1, uC2, uPtr;
varying vec3 vCol;
varying float vA;
vec3 rotY(vec3 p, float a) { float c = cos(a); float s = sin(a); return vec3(p.x * c + p.z * s, p.y, p.z * c - p.x * s); }
vec3 rotX(vec3 p, float a) { float c = cos(a); float s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
vec3 rotZ(vec3 p, float a) { float c = cos(a); float s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }
void main() {
  vec3 p = aA.xyz;
  float sd = aA.w;
  float d = 1.0 + uAmp * (1.4 * sin(p.x * 3.1 + uT * 1.25 + sd * 2.0) * sin(p.y * 2.6 - uT * 1.05) + 0.7 * sin(p.z * 4.2 + uT * 0.85));
  vec3 s = rotX(rotY(p, uRot), uTilt);
  float fr = 1.0 - s.z;
  d += uRipple * uLevel * 0.17 * sin(fr * 9.0 - uT * 12.0) * exp(-fr * 1.15);
  d += uPulse * uLevel * 0.15 * (0.5 + 0.5 * sin(p.y * 8.0 - uT * 9.0 + sd * 3.0));
  s *= d;
  float idx = aB.y;
  float sp = idx < 0.5 ? 0.9 : (idx < 1.5 ? -0.7 : 0.55);
  float ang = aB.x + uT * sp;
  vec3 r = vec3(cos(ang), (sd - 0.5) * 0.05, sin(ang)) * aB.z;
  if (idx < 0.5) { r = rotX(r, 1.15); } else if (idx < 1.5) { r = rotZ(rotX(r, 1.2), 1.05); } else { r = rotZ(rotX(r, 1.2), -1.05); }
  r = rotX(rotY(r, uT * 0.15), uTilt * 0.6);
  vec3 q = mix(s, r, uMorph);
  vec3 sc3 = normalize(vec3(sin(sd * 91.7), cos(sd * 53.3), sin(sd * 27.1 + 1.0)) + 0.001) * (2.0 + fract(sd * 13.7) * 3.6);
  sc3 = rotY(sc3, uT * 0.35);
  float as = clamp(uAsm * 1.7 - fract(sd * 7.3) * 0.7, 0.0, 1.0);
  as = as * as * (3.0 - 2.0 * as);
  q = mix(sc3, q, as);
  float per = 1.0 / (1.0 - q.z * 0.24);
  vec2 sc = uCenter + q.xy * uR * per;
  vec2 dv = sc - uPtr.xy;
  float dd = dot(dv, dv);
  if (dd > 0.01) { sc += normalize(dv) * uPtr.z * 26.0 * exp(-dd / 1800.0); }
  gl_Position = vec4(sc.x / uRes.x * 2.0 - 1.0, 1.0 - sc.y / uRes.y * 2.0, 0.0, 1.0);
  float depth = clamp((q.z + 1.0) * 0.5, 0.0, 1.0);
  float tw = 0.72 + 0.28 * sin(uT * 1.7 + sd * 37.0);
  vA = (0.06 + 0.94 * depth) * tw * uGain * (0.35 + 0.65 * as);
  float u = aB.w;
  vCol = u < 0.5 ? mix(uC0, uC1, u * 2.0) : mix(uC1, uC2, (u - 0.5) * 2.0);
  float big = sd > 0.985 ? 2.8 : 1.0;
  if (sd > 0.985) { vA *= 1.8; }
  gl_PointSize = (1.6 + 2.6 * depth) * uScale * uDpr * big;
}`;
const FS = `
precision mediump float;
varying vec3 vCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float a = exp(-r * r * 4.0) * vA;
  gl_FragColor = vec4(vCol * a, a);
}`;

export class Core {
  /**
   * @param {HTMLElement} host   positioned container; canvases fill it
   * @param {HTMLElement} anchor element whose box defines where the sphere sits (center + diameter)
   */
  constructor(host, anchor, opts = {}) {
    this.host = host;
    this.anchor = anchor;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.N = opts.particles ?? (navigator.hardwareConcurrency >= 6 ? 9000 : 6000);
    this.cv = Object.assign(document.createElement("canvas"), { className: "core-cv", ariaHidden: "true" });
    this.gcv = Object.assign(document.createElement("canvas"), { className: "core-cv", ariaHidden: "true" });
    host.prepend(this.cv, this.gcv);
    this.ctx = this.cv.getContext("2d");
    this.target = { orb: "idle", compact: false, card: "" };
    this.level = 0;
    this.extLevel = null;
    this.rot = Math.random() * 6.28;
    this.phase = new Float32Array(12);
    this.links = [];
    this.spark = [];
    this.asm = 1;
    this.push = 0; this.px = 0; this.py = 0; this.rotOff = 0; this.tiltOff = 0;
    this.cardGlow = 0; this.cardCol = [255, 138, 31];
    this.p = null;
    this.ptr = null;
    this.t0 = performance.now();
    this.last = this.t0;
    this.resize();
    this.initPoints();
    try { this.gl = this.initGl(); } catch { this.gl = null; }
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    const loop = (now) => { this.raf = requestAnimationFrame(loop); this.frame(now); };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.cv.remove();
    this.gcv.remove();
    try { this.gl?.gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* ignore */ }
  }

  /** orb: idle|listening|thinking|speaking · compact: sphere moved up for cards · card: kind of the open card */
  set(t) { Object.assign(this.target, t); }
  /** Real audio level 0..1 from the mic or the voice (null = simulate). */
  setLevel(v) { this.extLevel = v; }
  boot() { this.asm = 0; }
  pointer(x, y) { this.ptr = { x, y, t: performance.now() }; }
  pointerOut() { this.ptr = null; }

  /** Particle stream from the sphere to a point (host coordinates), e.g. a card. */
  link(ex, ey, spread = 300) {
    const p = this.p;
    if (!p || this.reduced) return;
    for (let k = 0; k < 72; k++) {
      const a = Math.PI * (0.1 + Math.random() * 0.8);
      const sx = p.cx + Math.cos(a) * p.R * 0.92;
      const sy = p.cy + Math.sin(a) * p.R * 0.92;
      const tx = ex + (Math.random() - 0.5) * spread;
      const ty = ey + Math.random() * 28;
      this.links.push({ sx, sy, ex: tx, ey: ty, mx: sx + (Math.random() - 0.5) * 170, my: (sy + ty) / 2 + (Math.random() - 0.5) * 90, d: Math.random() * 0.4, life: 0.75 + Math.random() * 0.5, u: 0 });
    }
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.cv, this.gcv]) {
      c.width = Math.round(this.W * this.dpr);
      c.height = Math.round(this.H * this.dpr);
    }
    if (this.dust) for (const d of this.dust) { d.x = Math.random() * this.W; d.y = Math.random() * this.H; }
  }

  initPoints() {
    const N2 = 1500;
    const golden = Math.PI * (3 - Math.sqrt(5));
    this.pts = new Float32Array(N2 * 4);
    this.band = new Uint8Array(N2);
    const groups = Array.from({ length: 12 }, () => []);
    for (let k = 0; k < N2; k++) {
      const y = 1 - (k / (N2 - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const o = k * 4;
      this.pts[o] = Math.cos(k * golden) * r; this.pts[o + 1] = y; this.pts[o + 2] = Math.sin(k * golden) * r; this.pts[o + 3] = Math.random();
      this.band[k] = Math.min(11, Math.floor((y + 1) * 6));
      groups[Math.floor(Math.min(0.999, Math.max(0, ((1 - y) / 2) * 0.7 + Math.random() * 0.3)) * 12)].push(k);
    }
    this.groups = groups.map((a) => Uint16Array.from(a));
    this.dust = Array.from({ length: 42 }, () => ({ x: Math.random() * this.W, y: Math.random() * this.H, z: 0.25 + Math.random() * 0.75, a: Math.random() }));
    const spr = document.createElement("canvas");
    spr.width = spr.height = 32;
    const sg = spr.getContext("2d");
    const grd = sg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.22, "rgba(255,255,255,0.6)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    sg.fillStyle = grd;
    sg.fillRect(0, 0, 32, 32);
    this.spr = spr;
  }

  initGl() {
    const gl = this.gcv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
    if (!gl) return null;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error("link");
    const N = this.N;
    const A = new Float32Array(N * 4);
    const B = new Float32Array(N * 4);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < N; k++) {
      const y = 1 - (k / (N - 1)) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const o = k * 4;
      A[o] = Math.cos(k * golden) * rr; A[o + 1] = y; A[o + 2] = Math.sin(k * golden) * rr; A[o + 3] = Math.random();
      const idx = k % 3;
      B[o] = Math.random() * Math.PI * 2; B[o + 1] = idx; B[o + 2] = 1.0 + idx * 0.15 + (Math.random() - 0.5) * 0.07;
      B[o + 3] = Math.min(0.999, Math.max(0, ((1 - y) / 2) * 0.7 + Math.random() * 0.3));
    }
    gl.useProgram(pr);
    for (const [name, data] of [["aA", A], ["aB", B]]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);
    }
    const loc = {};
    for (const n of ["uRes", "uCenter", "uR", "uT", "uAmp", "uRipple", "uPulse", "uLevel", "uMorph", "uRot", "uTilt", "uDpr", "uScale", "uGain", "uAsm", "uC0", "uC1", "uC2", "uPtr"]) loc[n] = gl.getUniformLocation(pr, n);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    return { gl, pr, loc, gain: Math.min(1, (1500 / N) * 4.2) };
  }

  /** Where the anchor says the sphere should be. */
  geometry() {
    const h = this.host.getBoundingClientRect();
    const a = this.anchor.getBoundingClientRect();
    return { cx: a.left - h.left + a.width / 2, cy: a.top - h.top + a.height / 2, R: Math.max(20, a.width / 2) };
  }

  voice(t, kind) {
    const f = kind === "speaking" ? 1 : 1.25;
    const a = Math.abs(Math.sin(t * 6.3 * f) * Math.sin(t * 2.2 * f + 1.1));
    const b = Math.abs(Math.sin(t * 13.1 * f + 0.4)) * 0.3;
    const gate = 0.6 + 0.4 * Math.sin(t * 1.3 * f + 2);
    return Math.min(1, (a + b) * gate);
  }

  frame(now) {
    if (document.hidden) { this.last = now; return; }
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const t = (now - this.t0) / 1000;
    try {
      this.step(dt, t);
      this.draw(dt, t);
      if (this.gl) {
        try { this.drawGl(t); } catch { this.gl = null; }
      }
    } catch { /* rendering must never break the app */ }
  }

  step(dt, t) {
    const s = this.target;
    const l = LOOKS[s.orb] ?? LOOKS.idle;
    const geo = this.geometry();
    const tg = {
      amp: l.amp, speed: this.reduced ? l.speed * 0.3 : l.speed, twist: l.twist, ripple: l.ripple, pulse: l.pulse, glow: l.glow,
      R: geo.R * l.k, cx: geo.cx, cy: geo.cy, morph: s.orb === "thinking" ? 1 : 0,
      ring: s.compact ? 0.15 : s.orb === "thinking" ? 0 : 1, bezel: s.compact ? 0 : 1,
      c0: hex(l.c0), c1: hex(l.c1), c2: hex(l.c2), g: hex(l.g),
    };
    if (!this.p) this.p = { ...tg, c0: tg.c0.slice(), c1: tg.c1.slice(), c2: tg.c2.slice(), g: tg.g.slice() };
    const p = this.p;
    const k1 = 1 - Math.exp(-dt * 3.2);
    const k2 = 1 - Math.exp(-dt * 5);
    const k3 = 1 - Math.exp(-dt * 2.4);
    for (const key of ["amp", "speed", "twist", "ripple", "pulse", "glow", "ring", "bezel"]) p[key] += (tg[key] - p[key]) * k1;
    p.morph += (tg.morph - p.morph) * (1 - Math.exp(-dt * 2.6));
    p.R += (tg.R - p.R) * k2;
    p.cx += (tg.cx - p.cx) * k2;
    p.cy += (tg.cy - p.cy) * k2;
    for (let j = 0; j < 3; j++) for (const key of ["c0", "c1", "c2", "g"]) p[key][j] += (tg[key][j] - p[key][j]) * k3;
    this.asm = Math.min(1, this.asm + dt / 2.3);
    const near = !!(this.ptr && performance.now() - this.ptr.t < 1500);
    this.push += ((near ? 1 : 0) - this.push) * (1 - Math.exp(-dt * 4));
    if (near) { this.px = this.ptr.x; this.py = this.ptr.y; }
    this.rotOff += ((near ? (this.ptr.x - p.cx) / 160 : 0) - this.rotOff) * (1 - Math.exp(-dt * 2));
    this.tiltOff += ((near ? (this.ptr.y - p.cy) / 420 : 0) - this.tiltOff) * (1 - Math.exp(-dt * 2));
    this.rot += dt * p.speed;
    for (let b = 0; b < 12; b++) this.phase[b] += dt * p.twist * (b % 2 ? 1 : -1) * (0.55 + 0.1 * b);
    const active = s.orb === "listening" || s.orb === "speaking";
    const target = !active ? 0 : this.extLevel != null ? Math.min(1, this.extLevel * 1.6) : this.voice(t, s.orb);
    this.level += (target - this.level) * (1 - Math.exp(-dt * 14));
    this.cardGlow += ((s.card ? 1 : 0) - this.cardGlow) * (1 - Math.exp(-dt * 2));
    const cc = CARD_COLORS[s.card] ?? CARD_COLORS.event;
    for (let j = 0; j < 3; j++) this.cardCol[j] += (cc[j] - this.cardCol[j]) * (1 - Math.exp(-dt * 2.5));
  }

  draw(dt, t) {
    const ctx = this.ctx;
    const p = this.p;
    const { W, H } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    const lv = this.level;

    const ar = p.R * 3.3;
    let g = ctx.createRadialGradient(p.cx, p.cy, 0, p.cx, p.cy, ar);
    g.addColorStop(0, rgba(p.g, 0.32 * p.glow * (1 + 0.4 * lv) * (0.25 + 0.75 * this.asm)));
    g.addColorStop(0.38, rgba(p.g, 0.11 * p.glow));
    g.addColorStop(1, rgba(p.g, 0));
    ctx.fillStyle = g;
    ctx.fillRect(p.cx - ar, p.cy - ar, ar * 2, ar * 2);

    if (this.cardGlow > 0.01) {
      const fr = Math.min(420, W * 0.85);
      const fg = ctx.createRadialGradient(W / 2, H + 30, 0, W / 2, H + 30, fr);
      fg.addColorStop(0, rgba(this.cardCol, 0.32 * this.cardGlow));
      fg.addColorStop(1, rgba(this.cardCol, 0));
      ctx.fillStyle = fg;
      ctx.fillRect(W / 2 - fr, H + 30 - fr, fr * 2, fr * 2);
    }

    ctx.fillStyle = rgba(p.c0, 1);
    for (const d of this.dust) {
      d.y -= dt * (5 + 9 * d.z);
      d.x += Math.sin(t * 0.35 + d.a * 6.2) * dt * 3;
      if (d.y < -6) { d.y = H + 6; d.x = Math.random() * W; }
      ctx.globalAlpha = (0.08 + 0.2 * d.z) * (0.6 + 0.4 * Math.sin(t * 1.4 + d.a * 9));
      const ds = 0.7 + d.z * 1.1;
      ctx.fillRect(d.x, d.y, ds, ds);
    }

    this.drawHud(t);

    const ir = p.R * (1.08 + 0.22 * lv * p.pulse);
    g = ctx.createRadialGradient(p.cx, p.cy, 0, p.cx, p.cy, ir);
    g.addColorStop(0, rgba(mix(p.c0, [255, 255, 255], 0.35), 0.5 * p.glow));
    g.addColorStop(0.45, rgba(p.c1, 0.15 * p.glow));
    g.addColorStop(1, rgba(p.c1, 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(p.cx - ir, p.cy - ir, ir * 2, ir * 2);

    ctx.globalAlpha = 0.3 * p.glow * (1 - p.morph) * this.asm;
    ctx.strokeStyle = rgba(p.c0, 1);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.R * 1.07, 0, Math.PI * 2);
    ctx.stroke();
    if (p.pulse > 0.02) {
      ctx.lineCap = "round";
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2 + t * 0.06 + Math.sin(t * 0.7 + k) * 0.05;
        const r0 = p.R * 1.08;
        const r1 = p.R * (2.1 + 0.6 * Math.sin(t * 1.3 + k * 1.7) + 0.6 * lv);
        const x0 = p.cx + Math.cos(a) * r0, y0 = p.cy + Math.sin(a) * r0;
        const x1 = p.cx + Math.cos(a) * r1, y1 = p.cy + Math.sin(a) * r1;
        const gx = ctx.createLinearGradient(x0, y0, x1, y1);
        gx.addColorStop(0, rgba(p.c1, 0.26 * p.pulse * (0.45 + 0.55 * lv)));
        gx.addColorStop(1, rgba(p.c1, 0));
        ctx.globalAlpha = 1;
        ctx.strokeStyle = gx;
        ctx.lineWidth = 1.5 + (k % 3) * 1.6;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }

    if (!this.gl) this.draw2dParticles(t, lv);

    const L = this.links;
    if (L.length) {
      ctx.lineCap = "round";
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = rgba(mix(p.c0, [255, 255, 255], 0.3), 1);
      for (let k = L.length - 1; k >= 0; k--) {
        const q = L[k];
        if (q.d > 0) { q.d -= dt; continue; }
        q.u += dt / q.life;
        if (q.u >= 1) { L.splice(k, 1); continue; }
        const e = q.u < 0.5 ? 2 * q.u * q.u : 1 - Math.pow(-2 * q.u + 2, 2) / 2;
        const e0 = Math.max(0, e - 0.1);
        const bez = (u) => [(1 - u) * (1 - u) * q.sx + 2 * (1 - u) * u * q.mx + u * u * q.ex, (1 - u) * (1 - u) * q.sy + 2 * (1 - u) * u * q.my + u * u * q.ey];
        const [ax, ay] = bez(e);
        const [bx, by] = bez(e0);
        ctx.globalAlpha = Math.sin(q.u * Math.PI) * 0.85;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        ctx.drawImage(this.spr, ax - 4, ay - 4, 8, 8);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  draw2dParticles(t, lv) {
    const ctx = this.ctx;
    const p = this.p;
    const pts = this.pts;
    const tilt = 0.36 + Math.sin(t * 0.19) * 0.07 + this.tiltOff;
    const cb = Math.cos(tilt), sb = Math.sin(tilt);
    const scale = p.R / 104;
    for (let b = 0; b < 12; b++) {
      const u = b / 11;
      const col = u < 0.5 ? mix(p.c0, p.c1, u * 2) : mix(p.c1, p.c2, (u - 0.5) * 2);
      ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      for (const i of this.groups[b]) {
        const o = i * 4;
        const x = pts[o], y = pts[o + 1], z = pts[o + 2], sd = pts[o + 3];
        const a = this.rot + this.rotOff + this.phase[this.band[i]];
        const ca = Math.cos(a), sa = Math.sin(a);
        const x1 = x * ca + z * sa;
        const z1 = z * ca - x * sa;
        const y2 = y * cb - z1 * sb;
        const z2 = y * sb + z1 * cb;
        let d = 1 + p.amp * (1.4 * Math.sin(x * 3.1 + t * 1.25 + sd * 2) * Math.sin(y * 2.6 - t * 1.05) + 0.7 * Math.sin(z * 4.2 + t * 0.85));
        const fr = 1 - z2;
        if (p.ripple > 0.01) d += p.ripple * lv * 0.17 * Math.sin(fr * 9 - t * 12) * Math.exp(-fr * 1.15);
        if (p.pulse > 0.01) d += p.pulse * lv * 0.15 * (0.5 + 0.5 * Math.sin(y * 8 - t * 9 + sd * 3));
        const per = 1 / (1 - z2 * d * 0.24);
        const depth = (z2 + 1) * 0.5;
        const sz = (0.85 + depth * 1.55) * scale * 1.1 + 0.25;
        ctx.globalAlpha = (0.1 + depth * 0.9) * (0.72 + 0.28 * Math.sin(t * 1.7 + sd * 37)) * this.asm;
        ctx.fillRect(p.cx + x1 * d * p.R * per - sz / 2, p.cy + y2 * d * p.R * per - sz / 2, sz, sz);
      }
    }
  }

  drawHud(t) {
    const ctx = this.ctx;
    const p = this.p;
    const col = rgba(p.c0, 1);
    if (p.ring * this.asm > 0.02) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      const rings = [
        { k: 1.42, f: 0.26, rot: -0.42 + 0.06 * Math.sin(t * 0.21), sp: 0.8, dash: [] },
        { k: 1.6, f: 0.16, rot: 0.5 + 0.05 * Math.sin(t * 0.17 + 1), sp: -0.55, dash: [2, 7] },
      ];
      for (const r of rings) {
        const rx = p.R * r.k, ry = rx * r.f;
        ctx.setLineDash(r.dash);
        ctx.globalAlpha = 0.22 * p.ring * this.asm;
        ctx.beginPath();
        ctx.ellipse(p.cx, p.cy, rx, ry, r.rot, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.5 * p.ring * this.asm;
        ctx.beginPath();
        ctx.ellipse(p.cx, p.cy, rx, ry, r.rot, 0, Math.PI);
        ctx.stroke();
        const th = t * r.sp;
        const ex = Math.cos(th) * rx, ey = Math.sin(th) * ry;
        const x = p.cx + ex * Math.cos(r.rot) - ey * Math.sin(r.rot);
        const y = p.cy + ex * Math.sin(r.rot) + ey * Math.cos(r.rot);
        const front = Math.sin(th) > 0;
        ctx.globalAlpha = (front ? 0.95 : 0.35) * p.ring * this.asm;
        const sz = front ? 12 : 8;
        ctx.drawImage(this.spr, x - sz / 2, y - sz / 2, sz, sz);
      }
      ctx.setLineDash([]);
    }
    if (p.bezel > 0.02) {
      const br = p.R * 1.72;
      ctx.save();
      ctx.translate(p.cx, p.cy);
      ctx.rotate(t * 0.025);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.14 * p.bezel;
      ctx.beginPath();
      const ticks = Math.floor(120 * Math.min(1, this.asm * 1.25));
      for (let k = 0; k < ticks; k++) {
        if (k % 10 === 0) continue;
        const a = (k / 120) * Math.PI * 2;
        ctx.moveTo(Math.cos(a) * br, Math.sin(a) * br);
        ctx.lineTo(Math.cos(a) * (br + 4), Math.sin(a) * (br + 4));
      }
      ctx.stroke();
      ctx.globalAlpha = 0.4 * p.bezel;
      ctx.beginPath();
      for (let k = 0; k < Math.floor(12 * Math.min(1, this.asm * 1.25)); k++) {
        const a = (k / 12) * Math.PI * 2;
        ctx.moveTo(Math.cos(a) * (br - 2), Math.sin(a) * (br - 2));
        ctx.lineTo(Math.cos(a) * (br + 9), Math.sin(a) * (br + 9));
      }
      ctx.stroke();
      if (p.twist > 0.03) {
        ctx.globalAlpha = 0.85 * p.twist * p.bezel;
        ctx.lineWidth = 2;
        const st = t * 2.4;
        ctx.beginPath(); ctx.arc(0, 0, br - 8, st, st + 0.8); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, br - 8, st + Math.PI, st + Math.PI + 0.45); ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawGl(t) {
    const { gl, pr, loc: L, gain } = this.gl;
    const p = this.p;
    gl.viewport(0, 0, this.gcv.width, this.gcv.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pr);
    gl.uniform2f(L.uRes, this.W, this.H);
    gl.uniform2f(L.uCenter, p.cx, p.cy);
    gl.uniform1f(L.uR, p.R);
    gl.uniform1f(L.uT, t);
    gl.uniform1f(L.uAmp, p.amp);
    gl.uniform1f(L.uRipple, p.ripple);
    gl.uniform1f(L.uPulse, p.pulse);
    gl.uniform1f(L.uLevel, this.level);
    gl.uniform1f(L.uMorph, p.morph);
    gl.uniform1f(L.uRot, this.rot + this.rotOff);
    gl.uniform1f(L.uTilt, 0.36 + Math.sin(t * 0.19) * 0.07 + this.tiltOff);
    gl.uniform1f(L.uDpr, this.dpr);
    gl.uniform1f(L.uScale, Math.max(0.7, p.R / 104));
    gl.uniform1f(L.uGain, gain * (0.85 + 0.3 * p.glow));
    gl.uniform1f(L.uAsm, this.asm);
    gl.uniform3f(L.uC0, p.c0[0] / 255, p.c0[1] / 255, p.c0[2] / 255);
    gl.uniform3f(L.uC1, p.c1[0] / 255, p.c1[1] / 255, p.c1[2] / 255);
    gl.uniform3f(L.uC2, p.c2[0] / 255, p.c2[1] / 255, p.c2[2] / 255);
    gl.uniform3f(L.uPtr, this.px, this.py, this.push);
    gl.drawArrays(gl.POINTS, 0, this.N);
  }
}
