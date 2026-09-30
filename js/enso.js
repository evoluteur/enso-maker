// Enso Maker -- the Zen circle, painted in one breath with a brush.
//
// The stroke is drawn as a bundle of bristles following one path. Each
// bristle carries its own ink, which runs out along the stroke at its own
// pace, so the end of the circle breaks into dry-brush streaks the way a
// real brush does. Every enso comes from a seed, so it can be shared.

const S = 600; // drawing size
const BRISTLES = 46;
const INKS = {
  sumi: { name: "Sumi black", color: "#141414" },
  indigo: { name: "Indigo", color: "#1f2a4d" },
  vermilion: { name: "Vermilion", color: "#b3261e" },
  gold: { name: "Gold", color: "#a07a1f" },
};
const PAPERS = {
  rice: { name: "Rice paper", color: "#f3ecdc" },
  white: { name: "White", color: "#fbfaf7" },
  none: { name: "None (transparent)", color: null },
};

const opts = { seed: 1, open: 0.12, weight: 0.5, dry: 0.5, ink: "sumi", paper: "rice", seal: true };
let drawn = null; // points of a hand-drawn stroke, or null for a generated one

const $e = (id) => document.getElementById(id);

// ---------------------------------------------------------------- noise

function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
// smooth 1D noise: values at integer points, interpolated with a smoothstep
function noise1(rand, n = 64) {
  const v = Array.from({ length: n + 1 }, rand);
  return (x) => {
    const xi = Math.floor(x) % n, f = x - Math.floor(x);
    const t = f * f * (3 - 2 * f);
    return v[xi] * (1 - t) + v[xi + 1] * t;
  };
}

// ---------------------------------------------------------------- the path

// a generated enso: a wobbly circle swept clockwise from lower left
function ensoPath(rand) {
  const nz = noise1(rand), nz2 = noise1(rand);
  const start = (200 + rand() * 40) * (Math.PI / 180); // about 7 o'clock, in screen angle
  const sweep = 2 * Math.PI * (1 - opts.open) + (opts.open < 0.02 ? 0.25 : 0);
  const R = 205 + rand() * 20;
  const cx = S / 2 + (rand() - 0.5) * 14, cy = S / 2 + (rand() - 0.5) * 14;
  const squash = 0.93 + rand() * 0.1;
  const pts = [];
  const N = 220;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const a = start - sweep * t; // counter-clockwise on screen = clockwise brush from 7 o'clock up
    const r = R * (1 + 0.035 * (nz(t * 6) - 0.5) + 0.02 * Math.sin(t * 5)) * (1 + 0.03 * t);
    pts.push({ x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) * squash, t, speed: 0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.3)) + 0.2 * nz2(t * 8) });
  }
  return pts;
}

// resample a hand-drawn stroke to evenly spaced points
function resample(raw) {
  const out = [];
  let total = 0;
  for (let k = 1; k < raw.length; k++) total += Math.hypot(raw[k].x - raw[k - 1].x, raw[k].y - raw[k - 1].y);
  if (total < 20) return null;
  const N = Math.max(40, Math.min(260, Math.round(total / 5)));
  let k = 0, acc = 0;
  for (let j = 0; j <= N; j++) {
    const target = (total * j) / N;
    while (k < raw.length - 2 && acc + Math.hypot(raw[k + 1].x - raw[k].x, raw[k + 1].y - raw[k].y) < target) {
      acc += Math.hypot(raw[k + 1].x - raw[k].x, raw[k + 1].y - raw[k].y);
      k++;
    }
    const seg = Math.hypot(raw[k + 1].x - raw[k].x, raw[k + 1].y - raw[k].y) || 1;
    const f = Math.min(1, (target - acc) / seg);
    const sp = raw[k].v * (1 - f) + raw[k + 1].v * f;
    out.push({ x: raw[k].x + (raw[k + 1].x - raw[k].x) * f, y: raw[k].y + (raw[k + 1].y - raw[k].y) * f, t: j / N, speed: sp });
  }
  // smooth the positions and the speed a little
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 1; j < out.length - 1; j++) {
      out[j].x = (out[j - 1].x + 2 * out[j].x + out[j + 1].x) / 4;
      out[j].y = (out[j - 1].y + 2 * out[j].y + out[j + 1].y) / 4;
      out[j].speed = (out[j - 1].speed + 2 * out[j].speed + out[j + 1].speed) / 4;
    }
  }
  const maxV = Math.max(...out.map((p) => p.speed)) || 1;
  out.forEach((p) => (p.speed = 0.35 + 0.65 * (p.speed / maxV)));
  return out;
}

// ---------------------------------------------------------------- the brush

function brush(pts, rand) {
  const n = pts.length;
  const Wmax = 26 + opts.weight * 44; // brush width, px
  const ink = INKS[opts.ink].color;
  // normals along the path
  const nrm = pts.map((p, k) => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
  // width: pressed down at the start, fuller where the brush is slow,
  // lifting and thinning at the end
  const width = pts.map((p) => {
    const t = p.t;
    const press = t < 0.05 ? 0.75 + (t / 0.05) * 0.35 : 1.1 - 0.25 * t;
    const lift = t > 0.8 ? 1 - ((t - 0.8) / 0.2) * 0.65 : 1;
    const slow = 1.15 - 0.3 * p.speed;
    return Wmax * press * lift * slow;
  });
  let paths = "";
  for (let b = 0; b < BRISTLES; b++) {
    // position across the brush, a little irregular
    const o = (b / (BRISTLES - 1)) * 2 - 1 + (rand() - 0.5) * 0.04;
    const nz = noise1(rand);
    const load = 0.75 + rand() * 0.5; // how much ink this bristle holds
    // the edges of the brush dry first
    const edgeDry = 0.6 + 0.8 * Math.abs(o);
    const thick = (Wmax / BRISTLES) * (2.2 + rand() * 1.2);
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const d = run.map((q, j) => (j ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join("");
        paths += `<path d="${d}" stroke-width="${thick.toFixed(2)}" />`;
      }
      run = [];
    };
    for (let k = 0; k < n; k++) {
      const p = pts[k];
      // ink left on this bristle at this point of the stroke
      const used = p.t * (0.55 + opts.dry * 1.25) * edgeDry * (0.7 + 0.6 * nz(p.t * 14 + b));
      const hasInk = load - used > 0.18 + 0.25 * nz(p.t * 40 + b * 3.1) * opts.dry;
      // fast strokes skip on the paper, more so as the brush dries
      const skip = p.speed > 0.8 && nz(p.t * 60 + b) < 0.2 * opts.dry;
      if (hasInk && !skip) {
        const off = (o * width[k]) / 2;
        run.push([p.x + nrm[k][0] * off, p.y + nrm[k][1] * off]);
      } else flush();
    }
    flush();
  }
  // a pool of ink where the brush first touched the paper
  const p0 = pts[0], p1 = pts[Math.min(n - 1, 4)];
  const ang = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
  const blob = `<ellipse cx="${((p0.x + p1.x) / 2).toFixed(1)}" cy="${((p0.y + p1.y) / 2).toFixed(1)}" rx="${(width[0] * 0.62).toFixed(1)}" ry="${(width[0] * 0.5).toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${((p0.x + p1.x) / 2).toFixed(1)} ${((p0.y + p1.y) / 2).toFixed(1)})" fill="${ink}" />`;
  return `<g fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.9" filter="url(#enso-bleed)">${blob}${paths}</g>`;
}

// ---------------------------------------------------------------- the picture

function seal(rand) {
  // a small red seal (hanko) with 円, "circle", lower right
  const x = 492, y = 500, s = 48;
  return `<g transform="rotate(${((rand() - 0.5) * 4).toFixed(1)} ${x + s / 2} ${y + s / 2})" filter="url(#enso-stamp)">
    <rect x="${x}" y="${y}" width="${s}" height="${s}" rx="4" fill="#b8231c" />
    <text x="${x + s / 2}" y="${y + s / 2 + 12}" text-anchor="middle" font-size="34" font-family="'Hiragino Mincho ProN','Yu Mincho','Noto Serif CJK JP','Songti SC',serif" fill="#f6ead8">円</text></g>`;
}

function render() {
  const rand = rng(opts.seed * 7919 + 13);
  const pts = drawn || ensoPath(rand);
  const paper = PAPERS[opts.paper].color;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <defs>
    <!-- "enso-" ids: plain ones like "paper" would clash with the page's controls -->
    <filter id="enso-bleed" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${opts.seed % 1000}" result="n" />
      <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" />
    </filter>
    <filter id="enso-paper" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.035 0.6" numOctaves="3" seed="3" />
      <feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0 0.25  0 0 0 0.09 0" />
      <feComposite in2="SourceGraphic" operator="in" />
    </filter>
    <filter id="enso-stamp"><feTurbulence type="fractalNoise" baseFrequency="0.5" seed="7" /><feDisplacementMap in="SourceGraphic" scale="2.5" /></filter>
  </defs>
  ${paper ? `<rect width="${S}" height="${S}" fill="${paper}" /><rect width="${S}" height="${S}" fill="${paper}" filter="url(#enso-paper)" />` : ""}
  ${brush(pts, rand)}
  ${opts.seal ? seal(rand) : ""}
</svg>`;
  $e("art").innerHTML = svg;
  return svg;
}

// ---------------------------------------------------------------- draw your own

let drawing = null;
function artPoint(e) {
  const r = $e("art").getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * S, y: ((e.clientY - r.top) / r.height) * S, time: e.timeStamp };
}
function startDraw(e) {
  if (!$e("draw-mode").checked) return;
  e.preventDefault();
  $e("art").setPointerCapture(e.pointerId);
  drawing = [artPoint(e)];
  drawing[0].v = 0;
  $e("guide").innerHTML = "";
}
function moveDraw(e) {
  if (!drawing) return;
  const p = artPoint(e), q = drawing[drawing.length - 1];
  const dt = Math.max(1, p.time - q.time);
  p.v = Math.hypot(p.x - q.x, p.y - q.y) / dt;
  if (Math.hypot(p.x - q.x, p.y - q.y) < 2) return;
  drawing.push(p);
  // a thin guide while drawing
  $e("guide").innerHTML = `<svg viewBox="0 0 ${S} ${S}"><polyline points="${drawing.map((d) => d.x.toFixed(0) + "," + d.y.toFixed(0)).join(" ")}" fill="none" stroke="${INKS[opts.ink].color}" stroke-opacity="0.35" stroke-width="3" stroke-linecap="round" /></svg>`;
}
function endDraw() {
  if (!drawing) return;
  const pts = resample(drawing);
  drawing = null;
  $e("guide").innerHTML = "";
  if (!pts) return;
  drawn = pts;
  render();
}

// ---------------------------------------------------------------- controls

function readControls() {
  opts.open = +$e("open").value / 100;
  opts.weight = +$e("weight").value / 100;
  opts.dry = +$e("dry").value / 100;
  opts.ink = $e("ink").value;
  opts.paper = $e("paper").value;
  opts.seal = $e("seal").checked;
}
function writeUrl() {
  const u = new URL(location.href);
  u.search = "";
  if (!drawn) u.searchParams.set("seed", opts.seed);
  u.searchParams.set("open", Math.round(opts.open * 100));
  u.searchParams.set("weight", Math.round(opts.weight * 100));
  u.searchParams.set("dry", Math.round(opts.dry * 100));
  if (opts.ink !== "sumi") u.searchParams.set("ink", opts.ink);
  if (opts.paper !== "rice") u.searchParams.set("paper", opts.paper);
  if (!opts.seal) u.searchParams.set("seal", "0");
  history.replaceState(null, "", u);
}
function update() {
  readControls();
  render();
  writeUrl();
}

function download(name, href) {
  const a = document.createElement("a");
  a.download = name;
  a.href = href;
  a.click();
}
function saveSvg() {
  const svg = render();
  download(`enso-${opts.seed}.svg`, URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })));
}
function savePng() {
  const svg = render();
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = S * 2; // twice the size, for print
    c.getContext("2d").drawImage(img, 0, 0, S * 2, S * 2);
    download(`enso-${opts.seed}.png`, c.toDataURL("image/png"));
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function initEnso() {
  $e("ink").innerHTML = Object.entries(INKS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");
  $e("paper").innerHTML = Object.entries(PAPERS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");
  const q = new URLSearchParams(location.search);
  const num = (k, lo, hi) => {
    const v = parseInt(q.get(k), 10);
    return isNaN(v) ? null : Math.max(lo, Math.min(hi, v));
  };
  opts.seed = num("seed", 1, 1e9) || Math.floor(Math.random() * 1e6) + 1;
  if (num("open", 0, 40) !== null) $e("open").value = num("open", 0, 40);
  if (num("weight", 0, 100) !== null) $e("weight").value = num("weight", 0, 100);
  if (num("dry", 0, 100) !== null) $e("dry").value = num("dry", 0, 100);
  if (INKS[q.get("ink")]) $e("ink").value = q.get("ink");
  if (PAPERS[q.get("paper")]) $e("paper").value = q.get("paper");
  if (q.get("seal") === "0") $e("seal").checked = false;
  update();

  ["open", "weight", "dry", "ink", "paper", "seal"].forEach((id) => $e(id).addEventListener("input", update));
  $e("btn-new").addEventListener("click", () => {
    drawn = null;
    opts.seed = Math.floor(Math.random() * 1e6) + 1;
    update();
  });
  $e("btn-svg").addEventListener("click", saveSvg);
  $e("btn-png").addEventListener("click", savePng);
  $e("draw-mode").addEventListener("change", (e) => {
    $e("art-wrap").classList.toggle("drawing", e.target.checked);
    $e("draw-hint").textContent = e.target.checked ? "Draw a circle in one stroke: slow for a heavy line, fast for a light one." : "";
  });
  const art = $e("art");
  art.addEventListener("pointerdown", startDraw);
  art.addEventListener("pointermove", moveDraw);
  art.addEventListener("pointerup", endDraw);
  art.addEventListener("pointercancel", endDraw);
}
