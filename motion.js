'use strict';
// GenLayer — "What if freelance disputes could be resolved onchain?"
// Deterministic canvas motion graphic: renderFrame(t) draws any moment of the timeline.

const W = 1920, H = 1080, FPS = 60, DURATION = 72;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');

const COL = {
  pink: '#ff87ff', purple: '#dc00ff', cyan: '#3ef0ff', red: '#ff3d81',
  white: '#ffffff', deep: '#0b0016', violet: '#7a2cff',
};
const GRAD = [COL.pink, COL.purple];

// ---------------------------------------------------------------- math
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const P = (t, a, b) => clamp((t - a) / (b - a));
const TAU = Math.PI * 2;
const E = {
  lin: x => x,
  inCubic: x => x * x * x,
  outCubic: x => 1 - Math.pow(1 - x, 3),
  inOutCubic: x => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outQuart: x => 1 - Math.pow(1 - x, 4),
  outExpo: x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: x => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  inOutExpo: x => (x <= 0 ? 0 : x >= 1 ? 1 : x < .5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  outBack: x => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  outElastic: x => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - .75) * TAU / 3) + 1),
};
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; }
// visibility envelope: eases in at tin, out at tout
function vis(t, tin, tout, din = .45, dout = .35) {
  return Math.min(E.outCubic(P(t, tin, tin + din)), 1 - E.inCubic(P(t, tout, tout + dout)));
}

// ---------------------------------------------------------------- timeline fx registries
const CUES = [];      // sound design cues, consumed by audio.py
const IMPACTS = [];   // camera shake
const FLASHES = [];
const GLITCHES = [];
function cue(t, type, v = 1, extra = {}) { CUES.push(Object.assign({ t: +t.toFixed(3), type, v }, extra)); }
function impact(t, amp = 1, snd = 'impact') { IMPACTS.push({ t, amp }); if (snd) cue(t, snd, amp); }
function flash(t, dur = .35, color = '255,255,255', a = .9) { FLASHES.push({ t, dur, color, a }); }
function glitch(t, dur = .25, amt = 1, snd = true) { GLITCHES.push({ t, dur, amt }); if (snd) cue(t, 'glitch', amt, { dur }); }

// ---------------------------------------------------------------- canvas helpers
function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
function tint(src, style, w, h) {
  const c = mk(w || src.width, h || src.height), x = c.getContext('2d');
  x.drawImage(src, 0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = typeof style === 'function' ? style(x, c) : style;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}
function linGrad(c, x0, y0, x1, y1, stops) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  return g;
}
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

const TXT = new Map();
function layout(text, font, ls) {
  const k = font + '|' + ls + '|' + text;
  let v = TXT.get(k);
  if (v) return v;
  ctx.save(); ctx.font = font;
  const chars = [...text], pos = [], ws = [];
  let s = '';
  for (let i = 0; i < chars.length; i++) { pos.push(ctx.measureText(s).width + ls * i); ws.push(ctx.measureText(chars[i]).width); s += chars[i]; }
  const total = ctx.measureText(text).width + ls * Math.max(0, chars.length - 1);
  ctx.restore();
  v = { chars, pos, ws, total };
  TXT.set(k, v);
  return v;
}
function textW(text, size, family = 'Unbounded', weight = 900, ls = 0) { return layout(text, `${weight} ${size}px "${family}"`, ls).total; }
function fit(text, maxW, size, family = 'Unbounded', weight = 900, ls = 0) {
  const w = textW(text, size, family, weight, ls);
  return w > maxW ? Math.floor(size * maxW / w) : size;
}

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*<>/=+';
// Kinetic text. Each character animates individually.
function ktext(text, x, y, o = {}) {
  const size = o.size || 80, fam = o.family || 'Unbounded', wt = o.weight || 900, ls = o.ls || 0;
  const font = `${wt} ${size}px "${fam}"`;
  const L = layout(text, font, ls);
  const t = o.t ?? 99, dur = o.dur ?? .55, st = o.stagger ?? .03, type = o.type || 'rise';
  let x0 = x;
  if (o.align === 'center') x0 = x - L.total / 2; else if (o.align === 'right') x0 = x - L.total;
  ctx.save();
  const base = ctx.globalAlpha * (o.alpha ?? 1);
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = o.baseline || 'alphabetic';
  if (o.glow) { ctx.shadowColor = o.glowColor || COL.purple; ctx.shadowBlur = o.glow; }
  const n = L.chars.length;
  for (let i = 0; i < n; i++) {
    const ch = L.chars[i];
    if (ch === ' ') continue;
    const order = o.reverse ? n - 1 - i : o.random ? hash(i * 7.7 + text.length) * n : i;
    const li = t - order * st;
    if (li <= 0) continue;
    const p = clamp(li / dur);
    let q = 0;
    if (o.out != null) { q = clamp((t - o.out - order * (o.ostagger ?? .012)) / (o.odur ?? .3)); if (q >= 1) continue; }
    let dx = 0, dy = 0, sc = 1, rot = 0, a = 1, glyph = ch;
    switch (type) {
      case 'rise': { const e = E.outCubic(p); dy = (1 - e) * size * .75; rot = (1 - e) * .3; a = e; break; }
      case 'pop': { const e = E.outBack(p); sc = Math.max(0, e); a = clamp(p * 3); break; }
      case 'drop': { const e = E.outBack(p); dy = -(1 - e) * size * 1.3; a = clamp(p * 2.5); break; }
      case 'zoom': { const e = E.outExpo(p); sc = lerp(3.2, 1, e); a = e; break; }
      case 'decode': { a = clamp(p * 5); if (p < 1) glyph = GLYPHS[Math.floor(hash(i * 13.1 + Math.floor(t * 30)) * GLYPHS.length)]; break; }
      case 'slide': { const e = E.outExpo(p); dx = (1 - e) * -size * 1.5; a = e; break; }
      case 'fade': { a = E.outCubic(p); break; }
    }
    if (q > 0) { const e = E.inCubic(q); dy -= e * size * .7; a *= 1 - e; }
    if (a <= 0.003) continue;
    if (o.jitter) { dx += (hash(i + Math.floor(t * 20)) - .5) * o.jitter; dy += (hash(i * 3 + Math.floor(t * 20)) - .5) * o.jitter * .5; }
    const cx = x0 + L.pos[i] + L.ws[i] / 2;
    ctx.save();
    ctx.translate(cx + dx, y + dy);
    if (rot) ctx.rotate(rot);
    if (sc !== 1) ctx.scale(sc, sc);
    if (o.rgb) {
      ctx.save(); ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = base * a * .85;
      ctx.fillStyle = '#ff0060'; ctx.fillText(glyph, -o.rgb, 0);
      ctx.fillStyle = '#00e5ff'; ctx.fillText(glyph, o.rgb, 0);
      ctx.restore();
    }
    ctx.globalAlpha = base * a;
    if (o.grad) ctx.fillStyle = linGrad(ctx, x0 - cx, -size, x0 + L.total - cx, 0, o.grad);
    else ctx.fillStyle = o.fill || '#fff';
    if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.strokeW || 2; ctx.strokeText(glyph, 0, 0); }
    else ctx.fillText(glyph, 0, 0);
    ctx.restore();
  }
  ctx.restore();
  return L.total;
}

// neon line: path builder is called once, stroked in layers
function neon(build, color, w = 4, alpha = 1, core = true) {
  ctx.save();
  const base = ctx.globalAlpha * alpha;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  build();
  ctx.strokeStyle = color;
  ctx.globalAlpha = base * .14; ctx.lineWidth = w * 5.5; ctx.stroke();
  ctx.globalAlpha = base * .3; ctx.lineWidth = w * 2.6; ctx.stroke();
  ctx.globalAlpha = base; ctx.lineWidth = w; ctx.stroke();
  if (core) { ctx.globalAlpha = base * .85; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, w * .35); ctx.stroke(); }
  ctx.restore();
}
function panel(x, y, w, h, o = {}) {
  ctx.save();
  ctx.globalAlpha *= (o.a ?? 1);
  rrect(x, y, w, h, o.r ?? 26);
  ctx.fillStyle = linGrad(ctx, x, y, x, y + h, o.fill || ['rgba(70,0,120,0.62)', 'rgba(18,0,40,0.82)']);
  ctx.fill();
  const s = linGrad(ctx, x, y, x + w, y + h, [o.c1 || COL.pink, o.c2 || COL.purple]);
  ctx.strokeStyle = s;
  ctx.lineWidth = 10; ctx.globalAlpha *= .18; ctx.stroke();
  ctx.globalAlpha /= .18; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();
}
function pill(text, x, y, o = {}) {
  const size = o.size || 26, fam = o.family || 'JetBrains Mono', wt = o.weight || 700, ls = o.ls ?? 2;
  const tw = textW(text, size, fam, wt, ls), padX = o.padX ?? size * .9, h = o.h || size * 2.1;
  const w = tw + padX * 2 + (o.icon ? h * .8 : 0);
  const x0 = o.align === 'left' ? x : x - w / 2;
  ctx.save();
  ctx.globalAlpha *= o.a ?? 1;
  ctx.translate(x0 + w / 2, y); ctx.scale(o.sc ?? 1, o.sc ?? 1); ctx.translate(-w / 2, 0);
  rrect(0, -h / 2, w, h, h / 2);
  ctx.fillStyle = o.bg || 'rgba(30,0,60,0.85)'; ctx.fill();
  neon(() => rrect(0, -h / 2, w, h, h / 2), o.color || COL.pink, 2.5, 1, false);
  let tx = padX;
  if (o.icon) { o.icon(padX + h * .25, 0, h * .55, o.color || COL.pink); tx += h * .8; }
  ktext(text, tx, 0, { size, family: fam, weight: wt, fill: o.textColor || '#fff', ls, baseline: 'middle', t: o.t ?? 99, type: o.type || 'fade', stagger: .015, dur: .3 });
  ctx.restore();
  return w;
}

// ---------------------------------------------------------------- icon paths
function pPerson(x, y, s) { ctx.beginPath(); ctx.arc(x, y - s * .2, s * .2, 0, TAU); ctx.moveTo(x - s * .38, y + s * .42); ctx.bezierCurveTo(x - s * .38, y + s * .06, x + s * .38, y + s * .06, x + s * .38, y + s * .42); }
function pCheck(x, y, s) { ctx.beginPath(); ctx.moveTo(x - s * .42, y + s * .02); ctx.lineTo(x - s * .12, y + s * .32); ctx.lineTo(x + s * .45, y - s * .32); }
function pX(x, y, s) { ctx.beginPath(); ctx.moveTo(x - s * .35, y - s * .35); ctx.lineTo(x + s * .35, y + s * .35); ctx.moveTo(x + s * .35, y - s * .35); ctx.lineTo(x - s * .35, y + s * .35); }
function pHex(x, y, r, rot = 0) { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = rot + i * TAU / 6 + Math.PI / 6; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); }
function pLock(x, y, s, open = 0) {
  ctx.beginPath();
  ctx.roundRect(x - s * .42, y - s * .05, s * .84, s * .62, s * .1);
  ctx.moveTo(x - s * .26, y - s * .05);
  ctx.lineTo(x - s * .26, y - s * .28 - open * s * .25);
  ctx.arc(x, y - s * .28 - open * s * .25, s * .26, Math.PI, 0);
  ctx.lineTo(x + s * .26, y - s * .05 - open * s * .25 + (open ? -s * .1 : 0));
}
function pGlobe(x, y, s) { ctx.beginPath(); ctx.arc(x, y, s * .45, 0, TAU); ctx.moveTo(x - s * .45, y); ctx.lineTo(x + s * .45, y); ctx.moveTo(x, y - s * .45); ctx.ellipse(x, y, s * .2, s * .45, 0, -Math.PI / 2, Math.PI * 1.5); }
function pBook(x, y, s) { ctx.beginPath(); ctx.moveTo(x, y - s * .3); ctx.quadraticCurveTo(x - s * .25, y - s * .42, x - s * .48, y - s * .32); ctx.lineTo(x - s * .48, y + s * .38); ctx.quadraticCurveTo(x - s * .25, y + s * .28, x, y + s * .4); ctx.quadraticCurveTo(x + s * .25, y + s * .28, x + s * .48, y + s * .38); ctx.lineTo(x + s * .48, y - s * .32); ctx.quadraticCurveTo(x + s * .25, y - s * .42, x, y - s * .3); ctx.lineTo(x, y + s * .4); }
function pBolt(x1, y1, x2, y2, seed, segs = 9, amp = 40) {
  ctx.beginPath(); ctx.moveTo(x1, y1);
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
  for (let i = 1; i < segs; i++) { const f = i / segs, o = (hash(seed + i * 9.13) - .5) * 2 * amp; ctx.lineTo(x1 + dx * f + nx * o, y1 + dy * f + ny * o); }
  ctx.lineTo(x2, y2);
}
function iconGlobe(x, y, s, c) { neon(() => pGlobe(x, y, s), c, 2.5, 1, false); }
function iconBook(x, y, s, c) { neon(() => pBook(x, y, s), c, 2.5, 1, false); }

// filled check / cross badges
function badge(kind, x, y, r, a = 1, sc = 1) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha *= a; ctx.translate(x, y); ctx.scale(sc, sc);
  const c = kind === 'ok' ? COL.cyan : kind === 'no' ? COL.red : COL.pink;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = kind === 'ok' ? 'rgba(0,70,90,0.85)' : 'rgba(90,0,40,0.85)'; ctx.fill();
  neon(() => { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); }, c, 2.5, 1, false);
  if (kind === 'ok') neon(() => pCheck(0, 0, r * 1.15), c, Math.max(2.5, r * .16));
  else if (kind === 'no') neon(() => pX(0, 0, r * 1.05), c, Math.max(2.5, r * .16));
  else { ctx.font = `800 ${r * 1.2}px "JetBrains Mono"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = c; ctx.fillText('?', 0, r * .05); }
  ctx.restore();
}

function avatar(x, y, r, color, label, o = {}) {
  const a = o.a ?? 1;
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.translate(x + (o.shake ? (hash(Math.floor(o.t * 40) + x) - .5) * o.shake : 0), y);
  ctx.scale(o.sc ?? 1, o.sc ?? 1);
  // halo
  ctx.globalCompositeOperation = 'lighter';
  drawSprite(SPR[color === COL.red ? 'red' : color === COL.cyan ? 'cyan' : 'purple'], 0, 0, r * 4.2, .55);
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = linGrad(ctx, 0, -r, 0, r, ['rgba(60,0,100,0.95)', 'rgba(12,0,28,0.95)']); ctx.fill();
  neon(() => { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); }, color, 5);
  // rotating dashed ring
  ctx.save(); ctx.rotate((o.t || 0) * .8); ctx.setLineDash([14, 18]);
  neon(() => { ctx.beginPath(); ctx.arc(0, 0, r * 1.18, 0, TAU); }, color, 2, .7, false);
  ctx.restore();
  neon(() => pPerson(0, r * .05, r * 1.15), color, 5);
  if (o.icon === 'laptop') neon(() => { ctx.beginPath(); ctx.roundRect(r * .2, r * .2, r * .62, r * .4, 4); ctx.moveTo(r * .1, r * .66); ctx.lineTo(r * .92, r * .66); }, COL.cyan, 3.5);
  if (o.icon === 'case') neon(() => { ctx.beginPath(); ctx.roundRect(r * .22, r * .26, r * .6, r * .4, 5); ctx.moveTo(r * .42, r * .26); ctx.lineTo(r * .42, r * .16); ctx.lineTo(r * .62, r * .16); ctx.lineTo(r * .62, r * .26); }, COL.cyan, 3.5);
  if (label) ktext(label, 0, r + 58, { size: 26, family: 'JetBrains Mono', weight: 700, fill: color, align: 'center', ls: 5, t: o.lt ?? 99, type: 'decode', stagger: .03, dur: .3 });
  ctx.restore();
}

function coin(x, y, r, a = 1, rot = 0) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha *= a; ctx.translate(x, y);
  const sx = Math.max(.08, Math.abs(Math.cos(rot)));
  ctx.scale(sx, 1);
  ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.pink, 0, 0, r * 4, .35); ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = linGrad(ctx, -r, -r, r, r, ['#ffc4ff', COL.pink, COL.purple]); ctx.fill();
  ctx.lineWidth = r * .1; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * .72, 0, TAU); ctx.lineWidth = r * .07; ctx.strokeStyle = 'rgba(80,0,120,0.55)'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `900 ${r * 1.05}px "Unbounded"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('$', 0, r * .06);
  ctx.restore();
}

function fileCard(x, y, w, h, label, o = {}) {
  ctx.save(); ctx.globalAlpha *= o.a ?? 1; ctx.translate(x, y); ctx.rotate(o.rot || 0); ctx.scale(o.sc ?? 1, o.sc ?? 1);
  const f = w * .26, c = o.color || COL.pink;
  ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2 - f, -h / 2); ctx.lineTo(w / 2, -h / 2 + f); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath();
  ctx.fillStyle = linGrad(ctx, 0, -h / 2, 0, h / 2, ['rgba(80,0,130,0.95)', 'rgba(25,0,55,0.95)']); ctx.fill();
  neon(() => { ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2 - f, -h / 2); ctx.lineTo(w / 2, -h / 2 + f); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); ctx.moveTo(w / 2 - f, -h / 2); ctx.lineTo(w / 2 - f, -h / 2 + f); ctx.lineTo(w / 2, -h / 2 + f); }, c, 3);
  ctx.fillStyle = 'rgba(255,135,255,0.45)';
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.roundRect(-w * .32, -h * .12 + i * h * .13, w * (i === 3 ? .4 : .64), h * .05, 3); ctx.fill(); }
  if (label) { ctx.fillStyle = '#fff'; ctx.font = `800 ${w * .13}px "JetBrains Mono"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 0, -h * .3); }
  ctx.restore();
}

function vault(x, y, s, o = {}) {
  ctx.save(); ctx.globalAlpha *= o.a ?? 1; ctx.translate(x, y); ctx.scale(o.sc ?? 1, o.sc ?? 1);
  ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.purple, 0, 0, s * 3, .5); ctx.globalCompositeOperation = 'source-over';
  rrect(-s / 2, -s / 2, s, s, s * .14);
  ctx.fillStyle = linGrad(ctx, 0, -s / 2, 0, s / 2, ['rgba(80,0,140,0.95)', 'rgba(20,0,45,0.95)']); ctx.fill();
  neon(() => rrect(-s / 2, -s / 2, s, s, s * .14), COL.pink, 4);
  neon(() => rrect(-s * .4, -s * .4, s * .8, s * .8, s * .1), COL.purple, 2, .8, false);
  // door dial
  const open = o.open || 0;
  if (open > 0) { ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.pink, 0, 0, s * 1.4, open); drawSprite(SPR.white, 0, 0, s * .6, open * .7); ctx.globalCompositeOperation = 'source-over'; }
  ctx.save(); ctx.scale(1 - open * .85, 1); ctx.rotate(o.dial || 0);
  neon(() => { ctx.beginPath(); ctx.arc(0, 0, s * .26, 0, TAU); }, COL.cyan, 4);
  neon(() => { ctx.beginPath(); for (let i = 0; i < 3; i++) { const a = i * TAU / 3; ctx.moveTo(Math.cos(a) * s * .06, Math.sin(a) * s * .06); ctx.lineTo(Math.cos(a) * s * .34, Math.sin(a) * s * .34); } }, COL.cyan, 4);
  ctx.beginPath(); ctx.arc(0, 0, s * .06, 0, TAU); ctx.fillStyle = COL.cyan; ctx.fill();
  ctx.restore();
  // feet
  ctx.fillStyle = COL.purple; ctx.fillRect(-s * .38, s / 2, s * .14, s * .06); ctx.fillRect(s * .24, s / 2, s * .14, s * .06);
  ctx.restore();
}

function aiChip(x, y, s, t, a = 1, color = COL.cyan) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha *= a; ctx.translate(x, y);
  ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.cyan, 0, 0, s * 3.5, .5 + .2 * Math.sin(t * 6)); ctx.globalCompositeOperation = 'source-over';
  neon(() => { ctx.beginPath(); for (let i = 0; i < 4; i++) { const o = -s * .3 + i * s * .2; ctx.moveTo(o, -s * .5); ctx.lineTo(o, -s * .66); ctx.moveTo(o, s * .5); ctx.lineTo(o, s * .66); ctx.moveTo(-s * .5, o); ctx.lineTo(-s * .66, o); ctx.moveTo(s * .5, o); ctx.lineTo(s * .66, o); } }, color, 3);
  rrect(-s / 2, -s / 2, s, s, s * .12); ctx.fillStyle = 'rgba(0,40,60,0.95)'; ctx.fill();
  neon(() => rrect(-s / 2, -s / 2, s, s, s * .12), color, 4);
  ctx.fillStyle = '#fff'; ctx.font = `900 ${s * .34}px "Unbounded"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('AI', 0, s * .02);
  ctx.restore();
}

// ---------------------------------------------------------------- assets
const IMG = {}, SPR = {};
let FACELESS, LOGO_GRAD, LOGO_WHITE, LOGO_PINK, LOGO_PTS = [];
let FACE, fctx, FX, fxc, MASKC, GRID_PAT, SCAN_PAT, NOISE = [], VIGNETTE, BUF, bctx, HOLO, hctx;
const LOGO_TINTS = {};
const CH = { w: 1140, h: 1528, sx: 190, sy: 200, sw: 810, sh: 665 };

function loadImg(k, src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => { IMG[k] = i; res(); }; i.onerror = () => rej(new Error(src)); i.src = src; });
}
function sprite(rgb, size = 256) {
  const c = mk(size, size), x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(.25, `rgba(${rgb},.45)`); g.addColorStop(.6, `rgba(${rgb},.1)`); g.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return c;
}
function drawSprite(s, x, y, d, a = 1) { if (a <= 0) return; const ga = ctx.globalAlpha; ctx.globalAlpha = ga * a; ctx.drawImage(s, x - d / 2, y - d / 2, d, d); ctx.globalAlpha = ga; }
function logoTint(color) { if (!LOGO_TINTS[color]) LOGO_TINTS[color] = tint(IMG.logo, color); return LOGO_TINTS[color]; }

async function setup() {
  await Promise.all([
    loadImg('front', 'assets/char_front.png'), loadImg('side', 'assets/char_side.png'), loadImg('back', 'assets/char_back.png'),
    loadImg('logo', 'assets/logo_white.png'), loadImg('mask', 'assets/screen_mask.png'),
  ]);
  await Promise.all([
    document.fonts.load('900 80px "Unbounded"'), document.fonts.load('700 80px "Unbounded"'), document.fonts.load('400 80px "Unbounded"'),
    document.fonts.load('700 40px "Space Grotesk"'), document.fonts.load('500 40px "Space Grotesk"'),
    document.fonts.load('700 40px "JetBrains Mono"'), document.fonts.load('400 40px "JetBrains Mono"'), document.fonts.load('800 40px "JetBrains Mono"'),
  ]);
  SPR.purple = sprite('220,0,255'); SPR.pink = sprite('255,135,255'); SPR.cyan = sprite('62,240,255');
  SPR.red = sprite('255,40,110'); SPR.white = sprite('255,255,255'); SPR.violet = sprite('122,44,255');

  // logos
  const L = IMG.logo;
  LOGO_GRAD = tint(L, (x, c) => linGrad(x, 0, 0, c.width * .6, c.height, ['#ffc6ff', COL.pink, COL.purple]));
  LOGO_WHITE = tint(L, '#fff');
  LOGO_PINK = tint(L, COL.pink);
  {
    const c = mk(L.width, L.height), x = c.getContext('2d'); x.drawImage(L, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let s = 1;
    while (LOGO_PTS.length < 420) {
      s++; const px = Math.floor(hash(s * 1.37) * c.width), py = Math.floor(hash(s * 2.71) * c.height);
      if (d[(py * c.width + px) * 4 + 3] > 160) LOGO_PTS.push([px / c.width - .5, py / c.height - .5]);
    }
  }

  // face screen
  MASKC = mk(CH.sw, CH.sh); MASKC.getContext('2d').drawImage(IMG.mask, -CH.sx, -CH.sy);
  FACE = mk(CH.sw, CH.sh); fctx = FACE.getContext('2d');
  FX = mk(CH.sw, CH.sh); fxc = FX.getContext('2d');
  const gp = mk(13, 13), gx = gp.getContext('2d'); gx.fillStyle = 'rgba(0,0,0,1)'; gx.fillRect(9.5, 0, 3.5, 13); gx.fillRect(0, 9.5, 13, 3.5);
  GRID_PAT = fxc.createPattern(gp, 'repeat');
  FACELESS = mk(CH.w, CH.h);
  {
    const x = FACELESS.getContext('2d'); x.drawImage(IMG.front, 0, 0);
    const scr = mk(CH.w, CH.h), sx = scr.getContext('2d');
    sx.fillStyle = screenGrad(sx); sx.fillRect(0, 0, CH.w, CH.h);
    sx.globalCompositeOperation = 'destination-in'; sx.drawImage(IMG.mask, 0, 0);
    x.drawImage(scr, 0, 0);
  }
  // post fx
  const sp = mk(4, 4), spx = sp.getContext('2d'); spx.fillStyle = 'rgba(0,0,0,0.22)'; spx.fillRect(0, 0, 4, 1);
  SCAN_PAT = ctx.createPattern(sp, 'repeat');
  for (let k = 0; k < 4; k++) {
    const n = mk(256, 256), nx = n.getContext('2d'), id = nx.createImageData(256, 256);
    for (let i = 0; i < id.data.length; i += 4) { const v = hash(i * .013 + k * 91.7) * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    nx.putImageData(id, 0, 0); NOISE.push(n);
  }
  VIGNETTE = mk(W, H);
  { const x = VIGNETTE.getContext('2d'), g = x.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * 1.05); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
  BUF = mk(W, H); bctx = BUF.getContext('2d');
  HOLO = mk(900, 1300); hctx = HOLO.getContext('2d');
}
function screenGrad(c) {
  const g = c.createLinearGradient(0, 250, 0, 560);
  g.addColorStop(0, 'rgb(35,106,128)'); g.addColorStop(1, 'rgb(27,35,58)');
  return g;
}

// ---------------------------------------------------------------- character face
// keyframes: [time, eyes, mouth, color]
const FACEK = [];
function face(t, eyes, mouth = 'w', color = '#00ffff') { FACEK.push([t, eyes, mouth, color]); }
function faceAt(t) {
  let k = FACEK[0];
  for (const f of FACEK) { if (f[0] <= t) k = f; else break; }
  const since = t - k[0];
  const ph = (t + .7) % 3.3;
  const blink = ph < .16 ? 1 - Math.sin(ph / .16 * Math.PI) * .92 : 1;
  return { eyes: k[1], mouth: k[2], color: k[3], blink, glitch: since < .16 ? 1 - since / .16 : 0, lx: noise1(t * .7) * .8, ly: noise1(t * .5 + 9) * .4, t };
}

function renderFace(f) {
  const c = fxc;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, CH.sw, CH.sh);
  c.setTransform(1, 0, 0, 1, -CH.sx, -CH.sy);
  c.fillStyle = f.color; c.strokeStyle = f.color;
  c.lineCap = 'round'; c.lineJoin = 'round';
  // screen logo
  if (f.logo !== false) c.drawImage(logoTint(f.color), 591 - 98, 265, 196, 184);
  const eyes = f.eyes, b = f.blink;
  const glyphEyes = { q: '?', bang: '!', dollar: '$' };
  for (const side of [-1, 1]) {
    const cx = side < 0 ? 410 : 785, cy = 560;
    c.save();
    if (glyphEyes[eyes]) {
      const pulse = 1 + .06 * Math.sin(f.t * 10 + side);
      c.translate(cx, cy); c.scale(pulse, pulse * (.25 + .75 * b));
      c.font = '800 300px "JetBrains Mono"'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(glyphEyes[eyes], 0, 8);
      c.restore(); continue;
    }
    c.translate(cx, cy); c.scale(1, b); c.translate(-cx, -cy);
    if (side > 0) { c.translate(1195, 0); c.scale(-1, 1); }
    const e = eyes === 'wink' ? (side > 0 ? 'happy' : 'dot') : eyes;
    switch (e) {
      case 'cool':
        c.beginPath(); c.moveTo(315, 462); c.lineTo(505, 582); c.bezierCurveTo(492, 628, 455, 652, 405, 652); c.bezierCurveTo(350, 652, 316, 590, 315, 462); c.fill(); break;
      case 'angry':
        c.beginPath(); c.moveTo(318, 488); c.lineTo(510, 590); c.bezierCurveTo(495, 632, 458, 650, 410, 650); c.bezierCurveTo(352, 650, 320, 600, 318, 488); c.fill(); break;
      case 'happy':
        c.lineWidth = 46; c.beginPath(); c.moveTo(325, 610); c.quadraticCurveTo(410, 470, 495, 610); c.stroke(); break;
      case 'dot': {
        const ox = (f.lx || 0) * 30 * (side > 0 ? -1 : 1), oy = (f.ly || 0) * 22;
        c.beginPath(); c.ellipse(410 + ox, 560 + oy, 64, 76, 0, 0, TAU); c.fill(); break;
      }
      case 'wow':
        c.lineWidth = 34; c.beginPath(); c.arc(410, 560, 68, 0, TAU); c.stroke(); break;
      case 'x':
        c.lineWidth = 40; c.beginPath(); c.moveTo(345, 495); c.lineTo(475, 625); c.moveTo(475, 495); c.lineTo(345, 625); c.stroke(); break;
      case 'check':
        c.lineWidth = 42; c.beginPath(); c.moveTo(335, 565); c.lineTo(392, 622); c.lineTo(490, 500); c.stroke(); break;
      case 'heart': {
        const s = 1 + .12 * Math.max(0, Math.sin(f.t * 9));
        c.translate(410, 565); c.scale(s, s);
        c.beginPath(); c.moveTo(0, 70); c.bezierCurveTo(-110, -5, -70, -95, 0, -45); c.bezierCurveTo(70, -95, 110, -5, 0, 70); c.fill(); break;
      }
      case 'scan': {
        const ox = Math.sin(f.t * 5) * 55 * (side > 0 ? -1 : 1);
        c.beginPath(); c.roundRect(410 - 70 + ox, 560 - 26, 140, 52, 26); c.fill();
        c.globalAlpha = .35; c.beginPath(); c.roundRect(410 - 70 - ox * .4, 560 - 26, 140, 52, 26); c.fill(); break;
      }
      case 'load': {
        const r = f.t * 7;
        c.lineWidth = 32; c.beginPath(); c.arc(410, 560, 62, r * (side > 0 ? -1 : 1), r * (side > 0 ? -1 : 1) + 4.2); c.stroke(); break;
      }
    }
    c.restore();
  }
  // mouth
  c.save();
  switch (f.mouth) {
    case 'w':
      c.beginPath(); c.moveTo(458, 694); c.quadraticCurveTo(520, 800, 598, 658); c.quadraticCurveTo(530, 712, 458, 694); c.fill();
      c.beginPath(); c.moveTo(738, 694); c.quadraticCurveTo(676, 800, 598, 658); c.quadraticCurveTo(666, 712, 738, 694); c.fill(); break;
    case 'o': c.lineWidth = 20; c.beginPath(); c.ellipse(598, 718, 32, 40, 0, 0, TAU); c.stroke(); break;
    case 'flat': c.lineWidth = 22; c.beginPath(); c.moveTo(530, 718); c.lineTo(666, 718); c.stroke(); break;
    case 'frown': c.lineWidth = 22; c.beginPath(); c.moveTo(520, 742); c.quadraticCurveTo(598, 672, 676, 742); c.stroke(); break;
    case 'grin': c.beginPath(); c.moveTo(500, 690); c.lineTo(696, 690); c.quadraticCurveTo(696, 778, 598, 778); c.quadraticCurveTo(500, 778, 500, 690); c.fill(); break;
  }
  c.restore();
  // LED grid
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-atop';
  c.globalAlpha = .42; c.fillStyle = GRID_PAT; c.fillRect(0, 0, CH.sw, CH.sh);
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';

  // compose screen
  const s = fctx;
  s.setTransform(1, 0, 0, 1, -CH.sx, -CH.sy);
  s.globalCompositeOperation = 'source-over';
  s.fillStyle = screenGrad(s); s.fillRect(CH.sx, CH.sy, CH.sw, CH.sh);
  s.setTransform(1, 0, 0, 1, 0, 0);
  if (f.glitch > 0) {
    for (let i = 0; i < 10; i++) {
      const y0 = i * CH.sh / 10, dx = (hash(i + Math.floor(f.t * 60)) - .5) * 70 * f.glitch;
      s.drawImage(FX, 0, y0, CH.sw, CH.sh / 10, dx, y0, CH.sw, CH.sh / 10);
    }
    s.globalAlpha = .5 * f.glitch; s.fillStyle = f.color;
    for (let i = 0; i < 6; i++) s.fillRect(0, hash(i * 3 + Math.floor(f.t * 60)) * CH.sh, CH.sw, 3 + hash(i) * 8);
    s.globalAlpha = 1;
  } else s.drawImage(FX, 0, 0);
  // bloom-ish pass
  s.globalCompositeOperation = 'lighter'; s.globalAlpha = .28; s.drawImage(FX, -3, -3, CH.sw + 6, CH.sh + 6); s.globalAlpha = 1;
  s.globalCompositeOperation = 'source-over';
  // glare
  const gl = s.createRadialGradient(CH.sw * .3, CH.sh * .18, 10, CH.sw * .3, CH.sh * .18, CH.sw * .45);
  gl.addColorStop(0, 'rgba(255,255,255,0.13)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  s.fillStyle = gl; s.fillRect(0, 0, CH.sw, CH.sh);
  s.fillStyle = SCAN_PAT; s.globalAlpha = .7; s.fillRect(0, 0, CH.sw, CH.sh); s.globalAlpha = 1;
  s.globalCompositeOperation = 'destination-in'; s.drawImage(MASKC, 0, 0);
  s.globalCompositeOperation = 'source-over';
}

// paints character with feet at local origin into context c
function paintChar(c, o, t) {
  const view = o.view || 'front';
  const img = view === 'front' ? FACELESS : IMG[view];
  const s = o.h / CH.h;
  c.save();
  c.scale(s * (o.sx ?? 1) * (o.flip ? -1 : 1), s * (o.sy ?? 1));
  c.drawImage(img, -img.width / 2, -img.height);
  if (view === 'front') {
    const f = faceAt(t);
    if (o.eyes) f.eyes = o.eyes;
    renderFace(f);
    c.drawImage(FACE, -img.width / 2 + CH.sx, -img.height + CH.sy);
    const chest = o.chest ?? (.35 + .25 * Math.sin(t * 4));
    if (chest > 0) {
      c.globalCompositeOperation = 'lighter'; c.globalAlpha *= chest;
      c.drawImage(LOGO_PINK, -img.width / 2 + 465, -img.height + 928, 264, 248);
    }
  }
  c.restore();
}
// o: {x, y(feet), h, view, rot, sx, sy, alpha, holo, flip, shadow, disc}
function drawCharacter(o, t) {
  const a = o.alpha ?? 1;
  if (a <= 0) return;
  const s = o.h / CH.h;
  ctx.save();
  if (o.shadow !== false) {
    ctx.globalAlpha = a * .55;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.ellipse(o.x, o.groundY ?? o.y, o.h * .26 * (o.shadowScale ?? 1), o.h * .04 * (o.shadowScale ?? 1), 0, 0, TAU); ctx.fill();
  }
  if (o.disc) {
    const gy = o.groundY ?? o.y;
    ctx.globalAlpha = a * o.disc;
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(SPR.purple, o.x, gy, o.h * 1.0, .6);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.translate(o.x, gy); ctx.scale(1, .22);
    neon(() => { ctx.beginPath(); ctx.arc(0, 0, o.h * .36, 0, TAU); }, COL.pink, 5 / .22 * .22 * 4);
    ctx.rotate(t * .9); ctx.setLineDash([30, 40]);
    neon(() => { ctx.beginPath(); ctx.arc(0, 0, o.h * .46, 0, TAU); }, COL.purple, 10, .8, false);
    ctx.restore();
  }
  ctx.globalAlpha = a;
  if (o.holo > 0) {
    const iw = CH.w * s + 80, ih = CH.h * s + 80;
    if (HOLO.width < iw || HOLO.height < ih) { HOLO.width = Math.ceil(iw); HOLO.height = Math.ceil(ih); }
    const hc = hctx;
    hc.setTransform(1, 0, 0, 1, 0, 0); hc.globalCompositeOperation = 'source-over'; hc.globalAlpha = 1;
    hc.clearRect(0, 0, HOLO.width, HOLO.height);
    hc.translate(iw / 2, ih - 40);
    paintChar(hc, o, t);
    hc.setTransform(1, 0, 0, 1, 0, 0);
    hc.globalCompositeOperation = 'source-atop';
    hc.globalAlpha = o.holo * .75;
    hc.fillStyle = linGrad(hc, 0, 0, 0, ih, [COL.cyan, COL.purple, COL.pink]); hc.fillRect(0, 0, iw, ih);
    hc.globalAlpha = 1; hc.globalCompositeOperation = 'destination-out';
    hc.fillStyle = `rgba(0,0,0,${.55 * o.holo})`;
    const off = (t * 120) % 6;
    for (let y = off; y < ih; y += 6) hc.fillRect(0, y, iw, 2.5);
    hc.globalCompositeOperation = 'source-over';
    ctx.translate(o.x, o.y); ctx.rotate(o.rot || 0);
    const slices = 14;
    for (let i = 0; i < slices; i++) {
      const y0 = i * ih / slices, dx = (hash(i * 5 + Math.floor(t * 30)) - .5) * 40 * o.holo * (hash(i + Math.floor(t * 12)) > .6 ? 1 : 0);
      ctx.drawImage(HOLO, 0, y0, iw, ih / slices + 1, -iw / 2 + dx, -ih + 40 + y0, iw, ih / slices + 1);
    }
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * .35 * o.holo;
    ctx.drawImage(HOLO, -iw / 2 - 6, -ih + 40);
  } else {
    ctx.translate(o.x, o.y); ctx.rotate(o.rot || 0);
    paintChar(ctx, o, t);
  }
  ctx.restore();
}
// turnaround spin: angle in quarter turns -> view & scaleX
function spinView(q) {
  const k = ((Math.round(q) % 4) + 4) % 4;
  const sx = Math.max(.04, Math.abs(Math.cos(Math.PI * (q - Math.round(q)))));
  return { view: ['front', 'side', 'back', 'side'][k], flip: k === 3, sx };
}

// ---------------------------------------------------------------- background
let MOOD = 0; // 0 calm purple, 1 danger red
function moodAt(t) { return Math.max(vis(t, 15.2, 17.6, .3, .5), 0) * 1; }
function drawBG(t) {
  MOOD = moodAt(t);
  ctx.fillStyle = linGrad(ctx, 0, 0, 0, H, ['#0b0020', '#14002e', '#06000e']);
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  const orbs = [[.18, .3, 'purple', 1300], [.82, .25, 'violet', 1200], [.5, .85, 'pink', 1400], [.7, .6, 'purple', 900]];
  orbs.forEach(([ox, oy, k, d], i) => {
    const x = W * ox + Math.sin(t * .23 + i * 2) * 180, y = H * oy + Math.cos(t * .19 + i) * 120;
    drawSprite(SPR[k], x, y, d * (1 + .08 * Math.sin(t * .6 + i)), .28 * (1 - MOOD * .6));
    if (MOOD > 0) drawSprite(SPR.red, x, y, d, .3 * MOOD);
  });
  ctx.globalCompositeOperation = 'source-over';
  drawGrid(t);
  drawStars(t);
}
function drawGrid(t) {
  const hz = H * .64, vpx = W / 2;
  const c = MOOD > .01 ? `rgba(255,${Math.round(lerp(0, 40, MOOD))},${Math.round(lerp(255, 110, MOOD))},` : 'rgba(220,0,255,';
  ctx.save();
  ctx.beginPath(); ctx.rect(0, hz, W, H - hz); ctx.clip();
  ctx.fillStyle = linGrad(ctx, 0, hz, 0, H, ['rgba(30,0,60,0.0)', 'rgba(20,0,40,0.55)']); ctx.fillRect(0, hz, W, H - hz);
  ctx.globalCompositeOperation = 'lighter';
  const K = (H - hz) * 1.15, speed = 1.4, fr = (t * speed) % 1;
  ctx.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const z = .9 + i - fr;
    if (z <= .05) continue;
    const y = hz + K / z;
    if (y > H + 4) continue;
    const a = clamp(1 - z / 26) * .5;
    ctx.strokeStyle = c + a + ')';
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  for (let j = -24; j <= 24; j++) {
    const xb = vpx + j * 150;
    const a = .35 * (1 - Math.abs(j) / 26);
    const g = ctx.createLinearGradient(0, hz, 0, H); g.addColorStop(0, c + '0)'); g.addColorStop(1, c + a + ')');
    ctx.strokeStyle = g;
    ctx.beginPath(); ctx.moveTo(vpx + j * 6, hz); ctx.lineTo(xb + (xb - vpx) * .6, H); ctx.stroke();
  }
  ctx.restore();
  // horizon glow
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = linGrad(ctx, 0, hz - 60, 0, hz + 60, ['rgba(220,0,255,0)', `rgba(255,${Math.round(lerp(135, 60, MOOD))},255,0.35)`, 'rgba(220,0,255,0)']);
  ctx.fillRect(0, hz - 60, W, 120);
  ctx.fillStyle = 'rgba(255,190,255,0.55)'; ctx.fillRect(0, hz - 1, W, 2);
  ctx.restore();
}
function drawStars(t) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 150; i++) {
    const sp = 10 + hash(i * 3.3) * 40;
    const x = (hash(i * 1.1) * W + Math.sin(t * .3 + i) * 20) % W;
    const y = ((hash(i * 2.2) * H - t * sp) % H + H) % H;
    const tw = .35 + .65 * Math.abs(Math.sin(t * (1 + hash(i) * 3) + i));
    const s = 1 + hash(i * 4.4) * 2.6;
    ctx.globalAlpha = tw * (.35 + hash(i * 5.5) * .5);
    ctx.fillStyle = i % 5 === 0 ? COL.cyan : i % 2 ? COL.pink : '#fff';
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
}
function drawRays(x, y, t, a = 1, color = 'purple', n = 14, len = 1400) {
  if (a <= 0) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(x, y); ctx.rotate(t * .25);
  for (let i = 0; i < n; i++) {
    ctx.rotate(TAU / n);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    const c = color === 'pink' ? '255,135,255' : color === 'cyan' ? '62,240,255' : '220,0,255';
    g.addColorStop(0, `rgba(${c},${.35 * a})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, -len * .06); ctx.lineTo(len, len * .06); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
function ring(x, y, r, w, color, a) {
  if (a <= 0 || r <= 0) return;
  neon(() => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }, color, w, a);
}
// burst of particles from a point, deterministic
function burst(x, y, lt, seed, n = 40, speed = 900, color = COL.pink, life = 1.1, grav = 900) {
  if (lt < 0 || lt > life) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const ang = hash(seed + i * 1.7) * TAU, sp = speed * (.3 + hash(seed + i * 2.3) * .7);
    const px = x + Math.cos(ang) * sp * lt, py = y + Math.sin(ang) * sp * lt + grav * lt * lt * .5;
    const a = 1 - lt / life, s = 3 + hash(seed + i) * 7;
    ctx.globalAlpha = a;
    ctx.fillStyle = i % 3 === 0 ? COL.cyan : i % 3 === 1 ? COL.pink : '#fff';
    ctx.save(); ctx.translate(px, py); ctx.rotate(lt * 8 + i); ctx.fillRect(-s / 2, -s / 4, s, s / 2); ctx.restore();
  }
  ctx.restore();
}
function caption(text, lt, tin, tout, o = {}) {
  const a = vis(lt, tin, tout, .3, .25);
  if (a <= 0) return;
  const y = o.y ?? 960, size = o.size ?? 40;
  ctx.save();
  ktext(text, W / 2, y, { size, family: 'Space Grotesk', weight: 500, fill: '#f4e6ff', align: 'center', t: lt - tin, type: 'rise', stagger: .008, dur: .4, out: tout - tin - .12, odur: .14, ostagger: 0, alpha: 1, ...(o.k || {}) });
  ctx.restore();
}

// ================================================================ SCENES
const SCENES = [];
function scene(s, e, fn) { SCENES.push({ s, e, fn }); }

// ---------- 1. Logo intro  0 - 3
cue(0, 'riser', 1, { dur: .95 });
impact(.95, 1.1);
flash(.95, .4);
cue(1.3, 'type', .6, { dur: .7 });
cue(2.55, 'whoosh', 1, { dur: .45 });
flash(3.0, .3, '255,135,255', .8);
scene(0, 3, (lt, t) => {
  const cx = W / 2, cy = 450, LH = 340, LWd = LH * IMG.logo.width / IMG.logo.height;
  const zoom = 1 + E.inExpo(P(lt, 2.55, 3)) * 7;
  const fade = 1 - E.inCubic(P(lt, 2.7, 3));
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(zoom, zoom); ctx.translate(-cx, -cy);
  ctx.globalAlpha = fade;
  // converging particles
  const pc = P(lt, 0, .95);
  if (lt < 1.25) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    LOGO_PTS.forEach(([u, v], i) => {
      const tx = cx + u * LWd, ty = cy + v * LH;
      const ang = hash(i * 3.1) * TAU, dist = 700 + hash(i * 5.3) * 900;
      const sx = cx + Math.cos(ang) * dist, sy = cy + Math.sin(ang) * dist * .6;
      const e = E.inOutCubic(clamp(pc * 1.1 - hash(i) * .1));
      const x = lerp(sx, tx, e), y = lerp(sy, ty, e);
      const sw = (1 - e) * 60 + 2;
      ctx.globalAlpha = (lt < .95 ? clamp(pc * 3) : 1 - P(lt, .95, 1.25));
      ctx.strokeStyle = i % 3 ? COL.pink : COL.purple; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (sx - tx) * sw / 2000, y + (sy - ty) * sw / 2000); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    });
    ctx.restore();
  }
  // energy core before reveal
  ctx.globalCompositeOperation = 'lighter';
  drawSprite(SPR.purple, cx, cy, 300 + pc * 900, pc * .8);
  drawSprite(SPR.white, cx, cy, 80 + pc * 200, pc * .6 * (lt < .95 ? 1 : 0));
  ctx.globalCompositeOperation = 'source-over';
  if (lt >= .95) {
    const k = lt - .95;
    drawRays(cx, cy, t, .7 * E.outCubic(P(k, 0, .5)), 'purple', 16, 1500);
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(SPR.purple, cx, cy, 1100, .5);
    drawSprite(SPR.pink, cx, cy, 420, .22 + .06 * Math.sin(t * 8));
    ctx.globalCompositeOperation = 'source-over';
    for (let r = 0; r < 3; r++) {
      const rk = P(k, r * .12, r * .12 + .9);
      ring(cx, cy, E.outExpo(rk) * (900 + r * 300), 6 * (1 - rk) + 1, r === 1 ? COL.cyan : COL.pink, 1 - rk);
    }
    const s = lerp(1.6, 1, E.outElastic(P(k, 0, .9)));
    const shake = (1 - P(k, 0, .4)) * 18;
    ctx.save();
    ctx.translate(cx + (hash(Math.floor(t * 60)) - .5) * shake, cy); ctx.scale(s, s);
    ctx.drawImage(LOGO_GRAD, -LWd / 2, -LH / 2, LWd, LH);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fade * (1 - P(k, 0, .5));
    ctx.drawImage(LOGO_WHITE, -LWd / 2, -LH / 2, LWd, LH);
    ctx.restore();
    ctx.globalAlpha = fade;
    ktext('GENLAYER', cx, cy + 290, { size: 76, ls: 26, align: 'center', grad: ['#fff', COL.pink], t: lt - 1.25, type: 'decode', stagger: .05, dur: .35, glow: 30 });
    ktext('// INTELLIGENT CONTRACTS × FREELANCE', cx, cy + 360, { size: 26, family: 'JetBrains Mono', weight: 700, ls: 6, fill: COL.pink, align: 'center', t: lt - 1.6, type: 'decode', stagger: .015, dur: .25 });
  }
  ctx.restore();
});

// ---------- 2. Hook  3 - 8
face(0, 'cool');
face(3.0, 'cool');
face(4.55, 'q', 'o');
face(6.2, 'cool', 'w');
cue(3.0, 'drop', 1); impact(3.0, .8, null);
cue(3.0, 'pop', .6); cue(3.25, 'pop', .7); cue(3.55, 'pop', .8); cue(4.0, 'pop', .8);
cue(3.45, 'whoosh', .7, { dur: .4 });
impact(3.88, .7, 'land');
impact(4.5, 1.1);
glitch(4.5, .2, .8, false);
cue(7.55, 'whoosh', .9, { dur: .45 });
glitch(7.75, .25, 1);
scene(3, 8, (lt, t) => {
  const out = 4.5;
  const x = 130;
  ktext('WHAT IF', x, 285, { size: 40, family: 'JetBrains Mono', weight: 800, ls: 12, fill: COL.pink, t: lt, type: 'decode', stagger: .05, dur: .3, out, ostagger: .01 });
  ctx.save(); ctx.globalAlpha = vis(lt, .05, out, .4, .3); ctx.fillStyle = COL.pink; ctx.fillRect(x, 305, 280 * E.outExpo(P(lt, .1, .7)), 4); ctx.restore();
  ktext('FREELANCE', x, 430, { size: 112, t: lt - .25, type: 'rise', stagger: .028, out: out + .05 });
  ktext('DISPUTES', x, 560, { size: 112, grad: GRAD, t: lt - .55, type: 'rise', stagger: .028, out: out + .1, glow: 30 });
  ktext('COULD BE RESOLVED', x, 650, { size: 52, weight: 700, fill: '#f0dcff', t: lt - 1.0, type: 'slide', stagger: .018, out: out + .15 });
  const og = 1 - P(lt, 1.5, 2.2);
  ktext('ONCHAIN?', x, 830, { size: 150, grad: ['#ffffff', COL.pink, COL.purple], t: lt - 1.5, type: 'zoom', stagger: .035, dur: .5, out: out + .2, rgb: 4 + og * 18, glow: 50, glowColor: COL.purple, jitter: og * 14 });
  // underline sweep
  const uw = E.outExpo(P(lt, 1.9, 2.5)) * textW('ONCHAIN?', 150);
  ctx.save(); ctx.globalAlpha = vis(lt, 1.9, out + .2, .3, .3);
  ctx.fillStyle = linGrad(ctx, x, 0, x + uw, 0, [COL.pink, COL.purple]); ctx.fillRect(x, 862, uw, 10);
  ctx.restore();
  // character drop & bounce
  const land = .88;
  let cy = 960, sx = 1, sy = 1, rot = 0;
  if (lt < land) { const p = P(lt, .35, land); cy = lerp(-200, 960, E.inCubic(p)); sy = 1.12; sx = .92; }
  else {
    const k = lt - land;
    const sq = Math.exp(-k * 7) * Math.cos(k * 22);
    sy = 1 - .16 * sq; sx = 1 + .12 * sq;
    cy = 960 + Math.sin((lt - land) * 2.4) * -12 * clamp(k * 2);
    rot = Math.sin(lt * 1.6) * .025;
  }
  const exit = E.inExpo(P(lt, out + .25, out + .6));
  cy -= exit * 1400;
  if (lt > .35) drawCharacter({ x: 1490, y: cy, groundY: 960, h: 760, sx, sy, rot, disc: clamp((lt - land) * 3) * (1 - exit), shadowScale: lt < land ? P(lt, .35, land) : 1 }, t);
  if (lt > land) burst(1490, 960, lt - land, 77, 36, 700, COL.pink, .9, 600);
  // speech glyph around character at question
  if (lt > 1.55 && lt < out + .3) {
    const a = vis(lt, 1.55, out, .3, .3);
    ktext('?', 1800, 330 + Math.sin(lt * 3) * 10, { size: 140, grad: GRAD, align: 'center', t: lt - 1.55, type: 'pop', dur: .5, alpha: a, glow: 30 });
    ktext('?', 1210, 300 + Math.sin(lt * 3 + 1) * 10, { size: 80, fill: COL.pink, align: 'center', t: lt - 1.7, type: 'pop', dur: .5, alpha: a * .8 });
  }
});

// ---------- 3. The problem  8 - 18
impact(8.0, .7, 'drop');
impact(8.55, 1, 'impact');
glitch(8.55, .22, .9, false);
cue(9.55, 'whoosh', .6, { dur: .35 });
cue(9.95, 'pop', .8); cue(10.15, 'pop', .9);
cue(10.6, 'whoosh', 1, { dur: .8 });
cue(11.8, 'land', .5);
impact(12.3, 1.2, 'stamp');
cue(13.6, 'coin', .7); cue(13.75, 'coin', .7); cue(13.9, 'coin', .7);
impact(14.1, .6, 'lock');
cue(14.65, 'pop', 1);
cue(15.2, 'zap', 1, { dur: .5 });
impact(15.45, 1.6, 'impact');
glitch(15.45, .35, 1.4, false);
flash(15.45, .25, '255,40,110', .7);
glitch(17.7, .3, 1.2);
face(15.5, 'bang', 'frown', '#ff3d81');
face(16.6, 'angry', 'frown', '#ff3d81');
scene(8, 18, (lt, t) => {
  // A: title
  if (lt < 2.1) {
    const out = 1.55;
    ktext('FREELANCING HAS A', W / 2, 440, { size: 70, align: 'center', weight: 700, t: lt, type: 'rise', stagger: .02, out, odur: .3 });
    const og = 1 - P(lt, .55, 1.0);
    const s = 1 + E.inExpo(P(lt, out, out + .45)) * 3;
    ctx.save(); ctx.translate(W / 2, 600); ctx.scale(s, s); ctx.globalAlpha = 1 - P(lt, out, out + .45);
    ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.red, 0, -40, 1200, .45 * clamp((lt - .55) * 4)); ctx.globalCompositeOperation = 'source-over';
    ktext('PROBLEM', 0, 0, { size: 190, align: 'center', grad: ['#fff', '#ff9ad0', COL.red], t: lt - .55, type: 'zoom', stagger: .03, dur: .4, rgb: 4 + og * 20, glow: 50, glowColor: COL.red, jitter: og * 18 });
    ctx.restore();
    ktext("that most people don't talk about enough", W / 2, 700, { size: 32, family: 'JetBrains Mono', weight: 400, fill: COL.pink, align: 'center', t: lt - .95, type: 'decode', stagger: .012, dur: .2, out, odur: .25 });
    return;
  }
  // B: stage
  const k = lt - 1.9;
  const dim = 1 - .65 * E.outCubic(P(k, 5.5, 5.9));
  const exitA = 1 - P(k, 7.8, 8.1);
  const fx = 430, cxl = 1490, ay = 480;
  const shake = P(k, 5.2, 5.5) * 10;
  ctx.save(); ctx.globalAlpha = dim * exitA;
  // connection path
  ctx.save(); ctx.setLineDash([10, 16]); ctx.lineDashOffset = -t * 60;
  neon(() => { ctx.beginPath(); ctx.moveTo(fx + 150, ay); ctx.quadraticCurveTo(W / 2, ay - 210, cxl - 150, ay); }, COL.purple, 2.5, .6 * clamp((k - .3) * 3), false);
  ctx.restore();
  const fsc = E.outBack(P(k, 0, .45)), csc = E.outBack(P(k, .2, .65));
  avatar(fx, ay, 118, COL.pink, 'FREELANCER', { sc: fsc, t, lt: k - .1, icon: 'laptop', shake: k > 5.3 ? shake : 0 });
  avatar(cxl, ay, 118, COL.purple, 'CLIENT', { sc: csc, t, lt: k - .3, icon: 'case', shake: k > 5.3 ? shake : 0 });
  // flying deliverable
  const fp = P(k, .7, 1.9);
  if (k > .6) {
    const e = E.inOutCubic(fp);
    const px = lerp(fx + 60, 1235, e), py = lerp(ay - 20, ay + 30, e) - Math.sin(e * Math.PI) * 280;
    if (fp > 0 && fp < 1) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 1; i < 14; i++) {
        const e2 = E.inOutCubic(clamp(fp - i * .018));
        const qx = lerp(fx + 60, 1235, e2), qy = lerp(ay - 20, ay + 30, e2) - Math.sin(e2 * Math.PI) * 280;
        drawSprite(SPR.pink, qx, qy, 60 - i * 3, .5 * (1 - i / 14));
      }
      ctx.restore();
    }
    const land = P(k, 1.9, 2.2);
    const rot = fp < 1 ? Math.sin(e * Math.PI) * -.5 : Math.sin(land * Math.PI * 3) * .06 * (1 - land);
    fileCard(px, py, 150, 186, 'WORK', { sc: lerp(.4, 1, E.outBack(clamp(fp * 3))), rot, color: COL.pink });
    // stamp
    if (k > 2.4) {
      const sp = P(k, 2.4, 2.65);
      const s = lerp(3.2, 1, E.inCubic(sp));
      ctx.save(); ctx.translate(1235, ay + 30); ctx.rotate(-.22); ctx.scale(s, s); ctx.globalAlpha *= clamp(sp * 3);
      rrect(-205, -50, 410, 100, 14);
      ctx.fillStyle = 'rgba(70,0,30,0.88)'; ctx.fill();
      neon(() => rrect(-205, -50, 410, 100, 14), COL.red, 5);
      ktext('NOT GOOD ENOUGH', 0, 2, { size: 34, align: 'center', fill: '#ffd0e4', baseline: 'middle', weight: 900, ls: 1 });
      ctx.restore();
      if (k > 2.65) burst(1235, ay + 30, k - 2.65, 31, 30, 800, COL.red, .7, 400);
    }
  }
  // coins + lock (refused payment)
  if (k > 3.6) {
    for (let i = 0; i < 3; i++) {
      const cp = P(k, 3.6 + i * .15, 3.95 + i * .15);
      coin(cxl - 70 + i * 70, ay - 205 + (1 - E.outBack(cp)) * -80, 34, cp, 0);
    }
    const lp = P(k, 3.95, 4.2);
    const ly = lerp(ay - 520, ay - 222, E.outBack(lp));
    if (lp > 0) {
      ctx.save(); ctx.globalAlpha *= lp;
      ctx.fillStyle = 'rgba(40,0,20,0.9)'; ctx.beginPath(); ctx.roundRect(cxl - 38, ly - 3, 76, 54, 8); ctx.fill();
      neon(() => pLock(cxl, ly, 90, 1 - E.outBack(P(k, 4.1, 4.3))), COL.red, 5);
      ctx.restore();
      pill('PAYMENT REFUSED', cxl, ay - 330, { color: COL.red, size: 24, sc: E.outBack(P(k, 4.2, 4.5)), a: clamp((k - 4.2) * 5) });
    }
  }
  // speech bubble freelancer
  if (k > 4.7) {
    const bp = E.outBack(P(k, 4.7, 5.0));
    ctx.save(); ctx.translate(fx + 40, ay - 250); ctx.scale(bp, bp);
    rrect(-170, -55, 340, 110, 55); ctx.fillStyle = 'rgba(60,0,100,0.95)'; ctx.fill();
    neon(() => { rrect(-170, -55, 340, 110, 55); ctx.moveTo(-60, 52); ctx.lineTo(-90, 105); ctx.lineTo(-20, 54); }, COL.pink, 4);
    ktext('I DISAGREE!', 0, 2, { size: 36, align: 'center', baseline: 'middle', fill: '#fff' });
    ctx.restore();
  }
  // lightning
  if (k > 5.3 && k < 7.9) {
    const a = clamp((k - 5.3) * 5) * (.6 + .4 * hash(Math.floor(t * 30)));
    const seed = Math.floor(t * 18);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    neon(() => pBolt(fx + 130, ay, cxl - 130, ay, seed, 12, 55), COL.red, 4, a);
    neon(() => pBolt(fx + 130, ay, cxl - 130, ay, seed + 50, 10, 35), COL.pink, 2, a * .7);
    ctx.restore();
  }
  ctx.restore();
  // DISPUTE slam
  if (k > 5.5) {
    const dk = k - 5.5;
    const s = lerp(4, 1, E.outExpo(P(dk, 0, .35)));
    const a = clamp(dk * 6) * exitA;
    ctx.save();
    ctx.globalAlpha = a;
    // cracks
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const ang = hash(i * 4.4) * TAU, len = 300 + hash(i * 8.8) * 600, p = E.outExpo(P(dk, 0, .4));
      neon(() => pBolt(W / 2, 470, W / 2 + Math.cos(ang) * len * p, 470 + Math.sin(ang) * len * p * .7, i * 31, 7, 26), COL.red, 2, .55);
    }
    drawSprite(SPR.red, W / 2, 470, 1500, .55);
    ctx.restore();
    ctx.translate(W / 2, 520); ctx.scale(s, s);
    const jit = (1 - P(dk, 0, .6)) * 20 + 2;
    ktext('DISPUTE', 0, 0, { size: 230, align: 'center', grad: ['#ffffff', '#ffb3d6', COL.red], rgb: 6 + jit * .6, glow: 60, glowColor: COL.red, jitter: jit });
    ctx.restore();
  }
  // corner character reacting
  if (k > 5.6) {
    const up = E.outBack(P(k, 5.6, 6.0)) * (1 - E.inCubic(P(k, 7.7, 8.0)));
    drawCharacter({ x: 1700, y: 1080 + 330 - up * 330 + Math.sin(t * 30) * 3, h: 520, shadow: false, rot: -.08 + Math.sin(t * 25) * .015 }, t);
  }
  caption('The freelancer delivers the work.', k, .6, 2.3);
  caption("…but the client says it's not good enough.", k, 2.4, 3.5);
  caption('The client refuses to pay.', k, 3.6, 4.6);
  caption('The freelancer disagrees.', k, 4.7, 5.4);
  caption('…and a simple project turns into a dispute.', k, 5.6, 7.8, { k: { fill: '#ffd0e4' } });
});

// ---------- 4. Smart contract limits  18 - 25
cue(18.0, 'drop', .6);
cue(18.05, 'type', .5, { dur: .5 });
cue(18.7, 'type', .8, { dur: 1.6 });
[20.3, 20.7].forEach(t => cue(t, 'tick', 1));
[21.4, 21.8, 22.2].forEach(t => cue(t, 'error', 1));
impact(22.85, 1, 'impact');
glitch(22.85, .2, .7, false);
cue(24.55, 'whoosh', 1, { dur: .45 });
glitch(24.75, .25, 1);
const CODE = [
  [['contract ', 'k'], ['Escrow', 'f'], [' {', 'p']],
  [['  if ', 'k'], ['(deadline_met &&', 'p']],
  [['      file_uploaded', 'p'], [') {', 'p']],
  [['    release', 'f'], ['(payment);', 'p']],
  [['  }', 'p']],
  [['}', 'p']],
];
scene(18, 25, (lt, t) => {
  const out = 6.6;
  ktext('// TRADITIONAL SMART CONTRACTS', 110, 150, { size: 28, family: 'JetBrains Mono', weight: 700, ls: 4, fill: COL.pink, t: lt, type: 'decode', stagger: .015, dur: .25, out, odur: .2 });
  ktext('CONDITIONS MET', 110, 240, { size: 64, t: lt - .15, type: 'rise', stagger: .02, out });
  const w1 = textW('CONDITIONS MET', 64);
  ktext('→ PAYMENT RELEASED', 110 + w1 + 30, 240, { size: 64, grad: GRAD, t: lt - .4, type: 'rise', stagger: .02, out: out + .05 });
  const a = vis(lt, .5, out, .5, .3);
  // code panel
  ctx.save(); ctx.globalAlpha = a; ctx.translate(0, (1 - E.outCubic(P(lt, .5, 1))) * 60);
  panel(110, 320, 800, 470);
  [COL.red, '#ffbd2e', COL.cyan].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(150 + i * 32, 356, 9, 0, TAU); ctx.fill(); });
  ktext('escrow.sol', 510, 362, { size: 22, family: 'JetBrains Mono', weight: 400, fill: 'rgba(255,255,255,0.5)', align: 'center' });
  ctx.fillStyle = 'rgba(255,135,255,0.15)'; ctx.fillRect(110, 385, 800, 1.5);
  const chars = Math.floor(Math.max(0, lt - .7) * 42);
  let used = 0;
  ctx.font = '700 32px "JetBrains Mono"'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  const colors = { k: COL.purple, f: COL.cyan, p: '#f6e8ff' };
  let lastX = 150, lastY = 450;
  CODE.forEach((line, li) => {
    let x = 150; const y = 450 + li * 54;
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillText(String(li + 1), 120 - 4, y);
    for (const [seg, kind] of line) {
      const take = clamp(chars - used, 0, seg.length); used += seg.length;
      if (take <= 0) continue;
      const s = seg.slice(0, take);
      ctx.fillStyle = kind === 'k' && li === 0 ? COL.pink : colors[kind];
      if (kind === 'k') ctx.fillStyle = COL.pink;
      ctx.fillText(s, x, y); x += ctx.measureText(s).width; lastX = x; lastY = y;
    }
  });
  if (Math.floor(t * 3) % 2 === 0) { ctx.fillStyle = COL.pink; ctx.fillRect(lastX + 4, lastY - 28, 16, 34); }
  // release badge
  if (lt > 2.55) badge('ok', 790, 612, 26, clamp((lt - 2.55) * 5), E.outBack(P(lt, 2.55, 2.85)));
  ctx.restore();

  // checklist panel
  ctx.save(); ctx.globalAlpha = a; ctx.translate(0, (1 - E.outCubic(P(lt, .7, 1.2))) * 60);
  panel(970, 320, 840, 470);
  ktext('CAN CODE EVALUATE…', 1010, 380, { size: 24, family: 'JetBrains Mono', weight: 700, ls: 4, fill: COL.pink, t: lt - .9, type: 'decode', stagger: .02, dur: .2 });
  const rows = [
    ['Deadline met?', 2.3, 'ok'], ['File uploaded?', 2.7, 'ok'],
    ['Design meets the brief?', 3.4, 'q'], ['Article follows the requirements?', 3.8, 'q'], ['Deliverable matches the agreement?', 4.2, 'q'],
  ];
  rows.forEach(([label, tt, kind], i) => {
    const y = 450 + i * 70;
    const ra = clamp((lt - (tt - .6)) * 4);
    if (ra <= 0) return;
    ctx.save(); ctx.globalAlpha *= ra; ctx.translate((1 - E.outCubic(ra)) * 40, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.roundRect(1000, y - 34, 780, 58, 14); ctx.fill();
    ktext(label, 1030, y + 6, { size: 30, family: 'Space Grotesk', weight: 500, fill: '#f6e8ff' });
    if (lt > tt) {
      if (kind === 'ok') badge('ok', 1735, y - 5, 22, 1, E.outBack(P(lt, tt, tt + .3)));
      else {
        const g = 1 - P(lt, tt, tt + .5);
        ktext('???', 1740, y + 8, { size: 34, family: 'JetBrains Mono', weight: 800, fill: COL.red, align: 'right', rgb: 3 + g * 8 + (lt > 4.8 ? 3 * hash(Math.floor(t * 20) + i) : 0), jitter: g * 12 + (lt > 4.8 ? 4 : 0), t: lt - tt, type: 'pop', stagger: .05 });
      }
    }
    ctx.restore();
  });
  ctx.restore();
  // big question
  const qa = vis(lt, 4.85, out, .4, .3);
  if (qa > 0) {
    ktext('BUT HOW DOES A CONTRACT JUDGE', W / 2, 878, { size: 46, align: 'center', weight: 700, t: lt - 4.85, type: 'rise', stagger: .012, out, odur: .25 });
    ktext('QUALITY?', W / 2, 1000, { size: 74, align: 'center', grad: ['#fff', COL.pink, COL.purple], t: lt - 5.25, type: 'zoom', stagger: .04, out: out + .05, glow: 40, rgb: 3 });
  }
});

// ---------- 5. GenLayer reveal  25 - 31
impact(25.0, 1.5, 'drop');
flash(25.0, .5, '255,255,255', 1);
cue(25.0, 'impact', 1.3);
cue(25.3, 'shimmer', 1, { dur: 1.7 });
impact(27.0, .8, 'land');
cue(27.6, 'whoosh', .7, { dur: .4 });
cue(28.0, 'pop', .9); cue(28.4, 'pop', 1);
cue(30.55, 'whoosh', 1, { dur: .45 });
flash(31.0, .3, '255,135,255', .7);
face(25.0, 'load', 'none');
face(27.0, 'happy', 'grin');
face(28.6, 'cool', 'w');
scene(25, 31, (lt, t) => {
  const cx = W / 2, out = 5.6;
  const zoomOut = E.inExpo(P(lt, out, 6));
  ctx.save(); ctx.translate(cx, 600); ctx.scale(1 + zoomOut * 2, 1 + zoomOut * 2); ctx.translate(-cx, -600); ctx.globalAlpha = 1 - zoomOut;
  drawRays(cx, 620, t, .8 * vis(lt, 0, 99, .6), 'purple', 18, 1600);
  ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.purple, cx, 650, 1300, .6); drawSprite(SPR.cyan, cx, 700, 600, .25 * clamp(lt - 1.5)); ctx.globalCompositeOperation = 'source-over';
  // top titles phase A
  const outA = 2.55;
  ktext('THIS IS WHERE', cx, 140, { size: 30, family: 'JetBrains Mono', weight: 700, ls: 10, fill: COL.pink, align: 'center', t: lt - .1, type: 'decode', stagger: .03, dur: .25, out: outA });
  ktext('GENLAYER', cx, 280, { size: 140, align: 'center', grad: ['#ffffff', COL.pink, COL.purple], t: lt - .25, type: 'zoom', stagger: .04, dur: .5, glow: 50, rgb: 3, out: outA + .05 });
  ktext('GETS INTERESTING', cx, 352, { size: 40, align: 'center', weight: 700, ls: 6, fill: '#f6e8ff', t: lt - .7, type: 'rise', stagger: .02, out: outA + .1 });
  // phase B
  ktext('INTELLIGENT CONTRACTS', cx, 210, { size: 92, align: 'center', grad: ['#ffffff', COL.pink, COL.purple], t: lt - 2.75, type: 'rise', stagger: .022, glow: 40, out: out - .1 });
  ktext('Evaluate work against written specifications & evidence', cx, 285, { size: 36, family: 'Space Grotesk', weight: 500, fill: '#f0dcff', align: 'center', t: lt - 3.1, type: 'rise', stagger: .006, out: out - .1, odur: .25 });
  // character holo spin
  const sp = P(lt, .3, 2.0);
  const q = E.outCubic(sp) * 8;
  const sv = spinView(q);
  const land = lt > 2.0 ? lt - 2.0 : 0;
  const bounce = land > 0 ? Math.exp(-land * 6) * Math.cos(land * 20) : 0;
  const holo = 1 - E.outCubic(P(lt, 1.5, 2.1));
  const appear = E.outCubic(P(lt, .3, .7));
  drawCharacter({ x: cx, y: 1000 - (lt < 2 ? (1 - E.outCubic(sp)) * 40 : 0), groundY: 1000, h: 600 * lerp(.6, 1, appear), view: sv.view, flip: sv.flip, sx: sv.sx * (1 + bounce * .1), sy: 1 - bounce * .12, holo, alpha: appear, disc: .5 + .5 * clamp(land * 3) }, t);
  if (lt > 2.0) { burst(cx, 700, lt - 2.0, 501, 60, 1100, COL.pink, 1.1, 300); ring(cx, 650, E.outExpo(P(lt, 2, 2.9)) * 700, 5, COL.cyan, 1 - P(lt, 2, 2.9)); }
  // scan beam during holo
  if (holo > 0 && lt > .3) {
    const by = lerp(1000, 400, (lt * 1.5) % 1);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = holo * .8;
    ctx.fillStyle = linGrad(ctx, 0, by - 30, 0, by + 30, ['rgba(62,240,255,0)', 'rgba(62,240,255,0.7)', 'rgba(62,240,255,0)']);
    ctx.fillRect(cx - 300, by - 30, 600, 60);
    ctx.restore();
  }
  // feature chips with connectors
  const chips = [
    { x: 400, y: 640, t0: 3.0, l1: 'AI-POWERED', l2: 'REASONING', c: COL.cyan, ax: cx - 230, icon: 'ai' },
    { x: 1520, y: 640, t0: 3.4, l1: 'DECENTRALIZED', l2: 'VALIDATOR CONSENSUS', c: COL.pink, ax: cx + 230, icon: 'nodes' },
  ];
  chips.forEach(ch => {
    const p = P(lt, ch.t0, ch.t0 + .45);
    if (p <= 0) return;
    const a = p * (1 - P(lt, out - .3, out));
    const lp = E.outCubic(P(lt, ch.t0, ch.t0 + .4));
    const ex = lerp(ch.ax, ch.x + (ch.x < cx ? 230 : -230), lp);
    neon(() => { ctx.beginPath(); ctx.moveTo(ch.ax, 690); ctx.lineTo(ex, 690); ctx.lineTo(ex, ch.y + 50 > 690 ? 690 : ch.y); }, ch.c, 2.5, a, false);
    // pulse along line
    const pu = (lt * 1.2 + (ch.x < cx ? 0 : .5)) % 1;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.white, lerp(ex, ch.ax, pu), 690, 40, a); ctx.restore();
    ctx.save(); ctx.globalAlpha *= a; ctx.translate(ch.x, ch.y); const s = E.outBack(p); ctx.scale(s, s);
    panel(-230, -95, 460, 190, { c1: ch.c, c2: COL.purple });
    if (ch.icon === 'ai') aiChip(-150, 0, 76, t, 1);
    else {
      ctx.save(); ctx.translate(-150, 0);
      for (let i = 0; i < 5; i++) { const an = i * TAU / 5 + t; const nx = Math.cos(an) * 38, ny = Math.sin(an) * 38; neon(() => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(nx, ny); }, COL.pink, 1.5, .7, false); ctx.beginPath(); ctx.arc(nx, ny, 9, 0, TAU); ctx.fillStyle = i % 2 ? COL.cyan : COL.pink; ctx.fill(); }
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.restore();
    }
    const csz = Math.min(30, fit(ch.l1, 290, 30), fit(ch.l2, 290, 30));
    ktext(ch.l1, -80, -12, { size: csz, weight: 900, fill: '#fff', t: lt - ch.t0 - .1, type: 'decode', stagger: .02, dur: .2 });
    ktext(ch.l2, -80, 30, { size: csz, weight: 900, fill: ch.c, t: lt - ch.t0 - .2, type: 'decode', stagger: .02, dur: .2 });
    ctx.restore();
  });
  ctx.restore();
});

// ---------- 6. How it works  31 - 49
const STEPS = [
  { title: 'AGREE ON THE TERMS', desc: 'Scope, deliverables, deadline & acceptance criteria — agreed upfront.', eyes: 'happy', mouth: 'w' },
  { title: 'DEPOSIT INTO ESCROW', desc: 'The client locks the payment into an escrow contract.', eyes: 'dollar', mouth: 'grin' },
  { title: 'SUBMIT THE WORK', desc: 'The freelancer submits the deliverable + supporting evidence.', eyes: 'load', mouth: 'o' },
  { title: 'INTELLIGENT EVALUATION', desc: 'The Intelligent Contract checks it against the agreed requirements.', eyes: 'scan', mouth: 'flat' },
  { title: 'VALIDATOR CONSENSUS', desc: 'Validators independently assess the outcome and reach consensus.', eyes: 'check', mouth: 'w' },
  { title: 'PAYMENT RELEASED', desc: 'Or the contract follows a predefined dispute process.', eyes: 'heart', mouth: 'grin' },
];
const S6 = 31, STEP_D = 3;
cue(31.0, 'whoosh', .8, { dur: .5 });
STEPS.forEach((s, i) => {
  const t0 = S6 + i * STEP_D;
  face(t0 + .15, s.eyes, s.mouth);
  cue(t0 + .1, 'pop', 1.1); cue(t0 + .05, 'whoosh', .5, { dur: .3 });
});
// step-specific sfx
[.55, .85, 1.15, 1.45].forEach(d => cue(S6 + d, 'tick', .9)); cue(S6 + 1.95, 'scribble', 1, { dur: .5 }); cue(S6 + 2.4, 'chime', .7);
[0, 1, 2, 3, 4].forEach(i => cue(S6 + 3 + .55 + i * .2, 'coin', .8)); impact(S6 + 3 + 1.75, .6, 'lock');
cue(S6 + 6 + .4, 'whoosh', .7, { dur: .4 }); cue(S6 + 6 + .7, 'whoosh', .7, { dur: .4 }); cue(S6 + 6 + .6, 'riser', .5, { dur: 1.4 }); cue(S6 + 6 + 2.05, 'chime', 1);
cue(S6 + 9 + .4, 'scan', 1, { dur: 1.6 }); [1.2, 1.5, 1.8].forEach(d => cue(S6 + 9 + d, 'tick', 1)); impact(S6 + 9 + 2.2, .5, 'chime');
[0, 1, 2, 3, 4, 5].forEach(i => cue(S6 + 12 + .45 + i * .2, 'tick', .9)); impact(S6 + 12 + 1.85, .8, 'impact');
cue(S6 + 15 + .4, 'riser', .6, { dur: .5 }); [0, 1, 2, 3, 4, 5, 6, 7].forEach(i => cue(S6 + 15 + .7 + i * .1, 'coin', .6)); impact(S6 + 15 + 1.6, .7, 'chime');
cue(48.55, 'whoosh', 1, { dur: .45 });
glitch(48.8, .22, 1);

function stepIllustration(i, sl, t, a) {
  const cx = 1255, cy = 615;
  ctx.save(); ctx.globalAlpha *= a;
  const sc = lerp(.92, 1, E.outCubic(P(sl, 0, .5))) * lerp(1, .92, E.inCubic(P(sl, 2.65, 3)));
  ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
  if (i === 0) {
    // agreement document between two parties
    const dash = (x1, x2, c) => { ctx.save(); ctx.setLineDash([8, 12]); ctx.lineDashOffset = -t * 50; neon(() => { ctx.beginPath(); ctx.moveTo(x1, cy); ctx.lineTo(x2, cy); }, c, 2, .7, false); ctx.restore(); };
    dash(930, 1060, COL.pink); dash(1450, 1580, COL.purple);
    avatar(860, cy, 72, COL.pink, 'FREELANCER', { sc: E.outBack(P(sl, .05, .4)), t, lt: sl });
    avatar(1650, cy, 72, COL.purple, 'CLIENT', { sc: E.outBack(P(sl, .15, .5)), t, lt: sl - .1 });
    const dy = (1 - E.outBack(P(sl, .1, .5))) * 80;
    ctx.save(); ctx.translate(0, dy); ctx.globalAlpha *= clamp(sl * 4);
    panel(1065, 390, 380, 450, { r: 20 });
    ktext('AGREEMENT', 1255, 445, { size: 28, align: 'center', grad: GRAD, ls: 3 });
    ctx.fillStyle = 'rgba(255,135,255,0.25)'; ctx.fillRect(1095, 465, 320, 2);
    ['SCOPE', 'DELIVERABLES', 'DEADLINE', 'ACCEPTANCE CRITERIA'].forEach((r, j) => {
      const y = 515 + j * 62, tt = .55 + j * .3;
      ctx.beginPath(); ctx.roundRect(1095, y - 20, 34, 34, 8); ctx.strokeStyle = 'rgba(255,135,255,0.6)'; ctx.lineWidth = 2; ctx.stroke();
      if (sl > tt) neon(() => pCheck(1112, y - 3, 30), COL.cyan, 4, clamp((sl - tt) * 6));
      ktext(r, 1145, y + 6, { size: 21, family: 'JetBrains Mono', weight: 700, fill: sl > tt ? '#fff' : 'rgba(255,255,255,0.55)' });
    });
    // signature
    const sp = P(sl, 1.95, 2.45);
    if (sp > 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(1100, 740, 310 * sp, 80); ctx.clip();
      neon(() => { ctx.beginPath(); ctx.moveTo(1110, 790); for (let x = 0; x <= 290; x += 6) ctx.lineTo(1110 + x, 790 - Math.sin(x * .07) * 18 * Math.sin(x * .013 + 1) - x * .05); }, COL.pink, 3);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,135,255,0.35)'; ctx.fillRect(1100, 806, 310, 2);
    ctx.restore();
    if (sl > 2.45) { burst(1255, 790, sl - 2.45, 911, 26, 600, COL.cyan, .6, 300); }
  } else if (i === 1) {
    // client -> coins -> vault
    avatar(860, cy, 80, COL.purple, 'CLIENT', { sc: E.outBack(P(sl, .05, .4)), t, lt: sl });
    const vsc = E.outBack(P(sl, .1, .5));
    const locked = sl > 1.75;
    vault(1420, cy - 10, 280, { sc: vsc, dial: E.outBack(P(sl, 1.45, 1.8)) * Math.PI * 1.5 + (sl < 1.45 ? sl * .6 : 0) });
    for (let j = 0; j < 5; j++) {
      const p = P(sl, .45 + j * .2, .95 + j * .2);
      if (p <= 0 || p >= 1) continue;
      const e = E.inOutCubic(p);
      coin(lerp(950, 1400, e), lerp(cy - 20, cy - 10, e) - Math.sin(e * Math.PI) * 220, 34, 1, e * 9);
    }
    if (locked) {
      const lp = E.outBack(P(sl, 1.75, 2.05));
      ctx.save(); ctx.translate(1420, cy - 230); ctx.scale(lp, lp);
      ctx.fillStyle = 'rgba(0,40,60,0.9)'; ctx.beginPath(); ctx.roundRect(-36, -3, 72, 52, 8); ctx.fill();
      neon(() => pLock(0, 0, 84, 0), COL.cyan, 5);
      ctx.restore();
      pill('FUNDS SECURED IN ESCROW', 1420, cy + 220, { color: COL.cyan, size: 22, sc: E.outBack(P(sl, 1.9, 2.2)), a: clamp((sl - 1.9) * 5) });
      ring(1420, cy - 10, E.outExpo(P(sl, 1.75, 2.4)) * 400, 4, COL.cyan, 1 - P(sl, 1.75, 2.4));
    }
  } else if (i === 2) {
    // freelancer uploads deliverable + evidence into the chain box
    avatar(860, cy, 80, COL.pink, 'FREELANCER', { sc: E.outBack(P(sl, .05, .4)), t, lt: sl, icon: 'laptop' });
    const bx = 1460, by = cy - 20;
    const bsc = E.outBack(P(sl, .1, .5));
    ctx.save(); ctx.translate(bx, by); ctx.scale(bsc, bsc);
    pHex(0, 0, 150, 0); ctx.fillStyle = 'rgba(40,0,80,0.9)'; ctx.fill();
    neon(() => pHex(0, 0, 150, 0), COL.pink, 4);
    ctx.save(); ctx.rotate(t * .5); ctx.setLineDash([12, 14]); neon(() => pHex(0, 0, 182, 0), COL.purple, 2, .7, false); ctx.restore();
    ctx.drawImage(LOGO_GRAD, -50, -60, 100, 94);
    ktext('ONCHAIN', 0, 72, { size: 22, family: 'JetBrains Mono', weight: 800, ls: 5, fill: COL.pink, align: 'center' });
    ctx.restore();
    [['WORK', .4, -60], ['EVIDENCE', .75, 60]].forEach(([lab, t0, off]) => {
      const p = P(sl, t0, t0 + .9);
      if (p <= 0) return;
      const e = E.inOutCubic(p);
      const x = lerp(960, bx, e), y = lerp(cy + off, by, e) - Math.sin(e * Math.PI) * 120;
      fileCard(x, y, 110, 136, lab === 'WORK' ? 'WORK' : 'PROOF', { sc: lerp(1, .2, E.inCubic(p)), a: 1 - E.inCubic(clamp((p - .8) * 5)), rot: Math.sin(e * Math.PI) * .3, color: lab === 'WORK' ? COL.pink : COL.cyan });
    });
    // progress bar
    const pr = E.inOutCubic(P(sl, .5, 2.0));
    const px = 1180, pw = 560, py = cy + 215;
    ctx.save(); ctx.globalAlpha *= clamp((sl - .4) * 4);
    rrect(px, py - 12, pw, 24, 12); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
    rrect(px, py - 12, Math.max(24, pw * pr), 24, 12); ctx.fillStyle = linGrad(ctx, px, 0, px + pw, 0, [COL.pink, COL.purple, COL.cyan]); ctx.fill();
    ktext(pr >= 1 ? 'SUBMITTED ✓' : `UPLOADING ${Math.floor(pr * 100)}%`, px + pw / 2, py + 58, { size: 22, family: 'JetBrains Mono', weight: 800, ls: 4, fill: pr >= 1 ? COL.cyan : COL.pink, align: 'center' });
    ctx.restore();
    if (sl > 2.0) burst(bx, by, sl - 2.0, 333, 30, 700, COL.cyan, .7, 200);
  } else if (i === 3) {
    // submission vs requirements with AI in the middle
    const lx = 960, rx = 1555;
    const d1 = E.outBack(P(sl, .05, .45)), d2 = E.outBack(P(sl, .15, .55));
    ctx.save(); ctx.translate(lx, cy); ctx.scale(d1, d1);
    panel(-150, -190, 300, 380, { r: 18 });
    ktext('SUBMISSION', 0, -145, { size: 22, family: 'JetBrains Mono', weight: 800, ls: 3, fill: COL.pink, align: 'center' });
    ctx.fillStyle = 'rgba(255,135,255,0.3)';
    for (let j = 0; j < 7; j++) { ctx.beginPath(); ctx.roundRect(-115, -100 + j * 38, j % 3 === 2 ? 140 : 230, 12, 6); ctx.fill(); }
    // scan beam
    if (sl > .4 && sl < 2.2) {
      const by = -180 + ((sl - .4) * 1.4 % 1) * 360;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = linGrad(ctx, 0, by - 26, 0, by + 26, ['rgba(62,240,255,0)', 'rgba(62,240,255,0.65)', 'rgba(62,240,255,0)']);
      ctx.fillRect(-150, by - 26, 300, 52);
      ctx.fillStyle = COL.cyan; ctx.fillRect(-150, by - 1.5, 300, 3);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    ctx.save(); ctx.translate(rx, cy); ctx.scale(d2, d2);
    panel(-170, -190, 340, 380, { r: 18, c1: COL.cyan });
    ktext('REQUIREMENTS', 0, -145, { size: 22, family: 'JetBrains Mono', weight: 800, ls: 3, fill: COL.cyan, align: 'center' });
    ['Matches the brief', 'Covers key points', 'Meets the spec'].forEach((r, j) => {
      const y = -70 + j * 85, tt = 1.2 + j * .3;
      ktext(r, -135, y + 8, { size: 23, family: 'Space Grotesk', weight: 700, fill: '#fff' });
      if (sl > tt) badge('ok', 128, y, 20, 1, E.outBack(P(sl, tt, tt + .3)));
    });
    ctx.restore();
    // AI chip + neural links
    const ap = E.outBack(P(sl, .25, .6));
    const links = [[lx + 150, cy - 120], [lx + 150, cy], [lx + 150, cy + 120], [rx - 170, cy - 70], [rx - 170, cy + 15], [rx - 170, cy + 100]];
    links.forEach(([x, y], j) => {
      const la = clamp((sl - .4) * 3);
      neon(() => { ctx.beginPath(); ctx.moveTo(1257, cy); ctx.bezierCurveTo((1257 + x) / 2, cy, (1257 + x) / 2, y, x, y); }, j < 3 ? COL.pink : COL.cyan, 2, la * .6, false);
      const u = (sl * 1.3 + j * .17) % 1;
      const bx = Math.pow(1 - u, 3) * x + 3 * Math.pow(1 - u, 2) * u * ((1257 + x) / 2) + 3 * (1 - u) * u * u * ((1257 + x) / 2) + u * u * u * 1257;
      const byy = Math.pow(1 - u, 3) * y + 3 * Math.pow(1 - u, 2) * u * y + 3 * (1 - u) * u * u * cy + u * u * u * cy;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.white, bx, byy, 34, la); ctx.restore();
    });
    ctx.save(); ctx.translate(1257, cy); ctx.scale(ap, ap); aiChip(0, 0, 110, t, 1); ctx.restore();
    if (sl > 2.2) {
      pill('MEETS THE CRITERIA', 1257, cy + 255, { color: COL.cyan, size: 24, sc: E.outBack(P(sl, 2.2, 2.5)), icon: (x, y, s, c) => neon(() => pCheck(x, y, s), c, 3) });
      ring(1257, cy, E.outExpo(P(sl, 2.2, 2.8)) * 500, 4, COL.cyan, 1 - P(sl, 2.2, 2.8));
    }
  } else if (i === 4) {
    // validators around the proposed outcome
    const n = 6, rx = 360, ry = 215;
    const hp = E.outBack(P(sl, .05, .45));
    const done = sl > 1.85;
    for (let j = 0; j < n; j++) {
      const an = -Math.PI / 2 + j * TAU / n + Math.sin(t * .5) * .05;
      const x = cx + Math.cos(an) * rx, y = cy + Math.sin(an) * ry;
      const on = sl > .45 + j * .2;
      const np = E.outBack(P(sl, .1 + j * .05, .45 + j * .05));
      neon(() => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); }, on ? COL.cyan : COL.purple, 2, np * (on ? .8 : .35), false);
      if (on) { const u = (sl * 1.6 + j * .3) % 1; ctx.save(); ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.cyan, lerp(x, cx, u), lerp(y, cy, u), 40, .9); ctx.restore(); }
      ctx.save(); ctx.translate(x, y); ctx.scale(np, np);
      ctx.globalCompositeOperation = 'lighter'; drawSprite(on ? SPR.cyan : SPR.purple, 0, 0, 200, .5); ctx.globalCompositeOperation = 'source-over';
      pHex(0, 0, 48); ctx.fillStyle = on ? 'rgba(0,50,70,0.95)' : 'rgba(40,0,70,0.95)'; ctx.fill();
      neon(() => pHex(0, 0, 48), on ? COL.cyan : COL.purple, 3.5);
      if (on) neon(() => pCheck(0, 0, 44), COL.cyan, 5, clamp((sl - (.45 + j * .2)) * 6));
      else { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '800 18px "JetBrains Mono"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('V' + (j + 1), 0, 0); }
      ctx.restore();
    }
    ctx.save(); ctx.translate(cx, cy); ctx.scale(hp * (done ? 1 + .06 * Math.exp(-(sl - 1.85) * 5) : 1), hp);
    ctx.globalCompositeOperation = 'lighter'; drawSprite(done ? SPR.cyan : SPR.pink, 0, 0, 420, .6); ctx.globalCompositeOperation = 'source-over';
    pHex(0, 0, 110, Math.PI / 6); ctx.fillStyle = 'rgba(50,0,90,0.95)'; ctx.fill();
    neon(() => pHex(0, 0, 110, Math.PI / 6), done ? COL.cyan : COL.pink, 5);
    ktext('PROPOSED', 0, -6, { size: 19, family: 'JetBrains Mono', weight: 800, ls: 3, fill: '#fff', align: 'center' });
    ktext('OUTCOME', 0, 22, { size: 19, family: 'JetBrains Mono', weight: 800, ls: 3, fill: done ? COL.cyan : COL.pink, align: 'center' });
    ctx.restore();
    if (done) {
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
      ring(0, 0, rx, 4, COL.cyan, 1 - P(sl, 1.85, 2.6) * .7);
      ctx.restore();
      ring(cx, cy, E.outExpo(P(sl, 1.85, 2.6)) * 700, 5, COL.cyan, 1 - P(sl, 1.85, 2.6));
      pill('CONSENSUS REACHED', cx, cy + 300, { color: COL.cyan, size: 24, sc: E.outBack(P(sl, 1.9, 2.2)), icon: (x, y, s, c) => neon(() => pCheck(x, y, s), c, 3) });
    }
  } else if (i === 5) {
    // escrow opens -> coins stream to freelancer; dispute branch
    const vx = 1000, fx = 1580, fy = cy - 60;
    const open = E.outCubic(P(sl, .35, .75));
    vault(vx, cy - 20, 260, { sc: E.outBack(P(sl, .0, .35)), open, dial: open * 3 });
    const hop = sl > 1.6 ? Math.abs(Math.sin((sl - 1.6) * 9)) * 22 * Math.exp(-(sl - 1.6) * 2) : 0;
    avatar(fx, fy - hop, 84, COL.pink, 'FREELANCER', { sc: E.outBack(P(sl, .1, .45)), t, lt: sl });
    for (let j = 0; j < 10; j++) {
      const p = P(sl, .7 + j * .08, 1.35 + j * .08);
      if (p <= 0 || p >= 1) continue;
      const e = E.inOutCubic(p);
      coin(lerp(vx + 60, fx - 40, e), lerp(cy - 20, fy, e) - Math.sin(e * Math.PI) * 200, 26, 1, e * 12 + j);
    }
    if (sl > 1.6) {
      burst(fx, fy, sl - 1.6, 777, 50, 900, COL.pink, 1.1, 700);
      ktext('+ PAID', fx, fy - 140 - E.outCubic(P(sl, 1.6, 2.2)) * 30, { size: 46, align: 'center', grad: [COL.cyan, '#fff'], t: sl - 1.6, type: 'pop', glow: 30, glowColor: COL.cyan });
    }
    // dispute branch
    const da = clamp((sl - 1.0) * 3) * .75;
    if (da > 0) {
      ctx.save(); ctx.setLineDash([8, 12]); ctx.lineDashOffset = -t * 40;
      neon(() => { ctx.beginPath(); ctx.moveTo(vx + 40, cy + 120); ctx.quadraticCurveTo(vx + 120, cy + 240, 1370, cy + 240); }, COL.purple, 2, da, false);
      ctx.restore();
      pill('OR → DISPUTE PROCESS', 1580, cy + 240, { color: COL.purple, size: 20, a: da, textColor: 'rgba(255,255,255,0.8)' });
    }
  }
  ctx.restore();
}

scene(31, 49, (lt, t) => {
  const i = Math.min(5, Math.floor(lt / STEP_D)), sl = lt - i * STEP_D;
  const exitAll = E.inCubic(P(lt, 17.6, 18));
  ctx.save(); ctx.globalAlpha = 1 - exitAll;
  // header
  ktext('HOW IT COULD WORK', 90, 110, { size: 26, family: 'JetBrains Mono', weight: 800, ls: 8, fill: COL.pink, t: lt, type: 'decode', stagger: .03, dur: .25 });
  ctx.fillStyle = COL.pink; ctx.fillRect(90, 128, 120 * E.outExpo(P(lt, .2, .8)), 3);
  // giant outlined number
  const numA = vis(sl, 0, 2.7, .4, .3);
  ctx.save(); ctx.globalAlpha *= numA * .16;
  ktext('0' + (i + 1), 1860, 1000 + (1 - E.outCubic(P(sl, 0, .5))) * 120, { size: 470, align: 'right', stroke: COL.pink, strokeW: 3 });
  ctx.restore();
  // character guide
  const enter = E.outBack(P(lt, 0, .6));
  const hop = sl < .4 && i > 0 ? Math.sin(sl / .4 * Math.PI) * 40 : 0;
  drawCharacter({ x: lerp(-300, 340, enter), y: 905 - hop - Math.sin(t * 2.2) * 8, groundY: 905, h: 590, disc: 1, rot: Math.sin(t * 1.4) * .03, sy: 1 + (sl < .1 && i > 0 ? -.08 : 0) }, t);
  // step texts
  const s = STEPS[i];
  const ta = vis(sl, 0, 2.7, .3, .3);
  ctx.save(); ctx.globalAlpha *= ta;
  ktext(`STEP 0${i + 1} / 06`, 700, 200, { size: 26, family: 'JetBrains Mono', weight: 800, ls: 6, fill: COL.cyan, t: sl, type: 'decode', stagger: .03, dur: .2 });
  const tsize = fit(s.title, 1140, 66);
  ktext(s.title, 700, 285, { size: tsize, grad: ['#ffffff', COL.pink], t: sl - .08, type: 'rise', stagger: .018, out: 2.7, odur: .25, glow: 24 });
  ktext(s.desc, 700, 342, { size: 30, family: 'Space Grotesk', weight: 500, fill: 'rgba(246,232,255,0.85)', t: sl - .25, type: 'fade', stagger: .004, dur: .3 });
  ctx.restore();
  stepIllustration(i, sl, t, vis(sl, 0, 2.7, .25, .3));
  // progress rail
  const rx0 = 700, rx1 = 1820, ry = 1000;
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(rx0, ry - 2, rx1 - rx0, 4);
  const prog = clamp((lt + .0) / (STEP_D * 5)) ;
  const pw = (rx1 - rx0) * Math.min(1, (i + E.outCubic(P(sl, 0, .6))) / 5);
  ctx.fillStyle = linGrad(ctx, rx0, 0, rx1, 0, [COL.pink, COL.purple, COL.cyan]); ctx.fillRect(rx0, ry - 2, pw, 4);
  for (let j = 0; j < 6; j++) {
    const x = rx0 + (rx1 - rx0) * j / 5;
    const on = j <= i, cur = j === i;
    ctx.save(); ctx.translate(x, ry);
    if (cur) { ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.pink, 0, 0, 120, .8); ctx.globalCompositeOperation = 'source-over'; }
    ctx.beginPath(); ctx.arc(0, 0, cur ? 15 : 10, 0, TAU); ctx.fillStyle = on ? (cur ? '#fff' : COL.pink) : 'rgba(60,20,90,1)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = on ? COL.pink : 'rgba(255,135,255,0.4)'; ctx.stroke();
    ctx.restore();
  }
  void prog;
  ctx.restore();
});

// ---------- 7. Why it matters  49 - 56
impact(49.0, 1, 'drop');
cue(49.0, 'pop', .8); cue(49.35, 'pop', 1);
cue(50.75, 'whoosh', .8, { dur: .4 });
cue(51.0, 'whoosh', .6, { dur: .3 }); cue(51.3, 'whoosh', .6, { dur: .3 });
cue(51.8, 'tick', 1); cue(52.1, 'tick', 1); impact(52.3, .5, 'error'); impact(52.6, .5, 'error');
cue(53.6, 'shimmer', .6, { dur: 1 });
cue(55.55, 'whoosh', 1, { dur: .45 });
glitch(55.8, .22, 1);
face(49.0, 'wow', 'o');
scene(49, 56, (lt, t) => {
  if (lt < 1.95) {
    const out = 1.6;
    ktext('WHY DOES THIS', W / 2, 450, { size: 80, align: 'center', weight: 700, t: lt, type: 'rise', stagger: .02, out });
    ktext('MATTER?', W / 2, 640, { size: 190, align: 'center', grad: ['#fff', COL.pink, COL.purple], t: lt - .35, type: 'zoom', stagger: .04, dur: .45, glow: 50, rgb: 4, out: out + .05, odur: .3 });
    drawCharacter({ x: 1760, y: 1080 + 250 - E.outBack(P(lt, .4, .8)) * 250 + E.inCubic(P(lt, 1.5, 1.9)) * 300, h: 480, shadow: false, rot: -.12 }, t);
    return;
  }
  const k = lt - 1.95, out = 4.65;
  ktext("FREELANCE WORK ISN'T SIMPLY", W / 2, 170, { size: 52, align: 'center', weight: 700, t: k, type: 'rise', stagger: .012, out });
  ktext('YES OR NO', W / 2, 260, { size: 84, align: 'center', grad: GRAD, t: k - .25, type: 'zoom', stagger: .04, glow: 34, out: out + .05 });
  const cards = [
    { x: 600, t0: .0, title: 'DESIGN', ok: 'Technically complete', no: 'Misses the brief', icon: 'pen' },
    { x: 1320, t0: .3, title: 'ARTICLE', ok: 'Meets the word count', no: 'Misses essential points', icon: 'doc' },
  ];
  cards.forEach((c, j) => {
    const p = P(k, c.t0, c.t0 + .5);
    if (p <= 0) return;
    const fl = E.outBack(p);
    const ex = 1 - E.inCubic(P(k, out, out + .35));
    ctx.save(); ctx.translate(c.x, 590); ctx.scale(Math.max(.01, fl) * ex, ex); ctx.globalAlpha *= clamp(p * 3) * ex;
    panel(-320, -230, 640, 450, { r: 28 });
    // icon
    ctx.save(); ctx.translate(-220, -130);
    if (c.icon === 'pen') neon(() => { ctx.beginPath(); ctx.moveTo(-26, 30); ctx.lineTo(-18, 6); ctx.lineTo(18, -30); ctx.lineTo(30, -18); ctx.lineTo(-6, 18); ctx.closePath(); ctx.moveTo(-26, 30); ctx.lineTo(30, 30); }, COL.pink, 3.5);
    else neon(() => { ctx.beginPath(); ctx.roundRect(-24, -32, 48, 64, 6); ctx.moveTo(-12, -14); ctx.lineTo(12, -14); ctx.moveTo(-12, 0); ctx.lineTo(12, 0); ctx.moveTo(-12, 14); ctx.lineTo(4, 14); }, COL.pink, 3.5);
    ctx.restore();
    ktext(c.title, -160, -112, { size: 50, grad: ['#fff', COL.pink] });
    ctx.fillStyle = 'rgba(255,135,255,0.2)'; ctx.fillRect(-270, -60, 540, 2);
    const r1 = .7 + j * .3, r2 = 1.25 + j * .3;
    if (k > r1) {
      const a = E.outCubic(P(k, r1, r1 + .3));
      ctx.save(); ctx.globalAlpha *= a; ctx.translate((1 - a) * 30, 0);
      badge('ok', -235, 15, 28, 1, E.outBack(P(k, r1, r1 + .3)));
      ktext(c.ok, -185, 26, { size: 32, family: 'Space Grotesk', weight: 700, fill: '#fff' });
      ctx.restore();
    }
    if (k > r2) {
      const a = E.outCubic(P(k, r2, r2 + .3));
      const sh = (1 - P(k, r2, r2 + .4)) * 14;
      ctx.save(); ctx.globalAlpha *= a; ctx.translate((1 - a) * 30 + (hash(Math.floor(t * 50) + j) - .5) * sh, 0);
      badge('no', -235, 120, 28, 1, E.outBack(P(k, r2, r2 + .3)));
      ktext(c.no, -185, 131, { size: 32, family: 'Space Grotesk', weight: 700, fill: '#ffc2db' });
      ctx.restore();
    }
    ctx.restore();
  });
  ktext('Intelligent, evidence-based contracts open the door', W / 2, 920, { size: 38, family: 'Space Grotesk', weight: 500, fill: '#f6e8ff', align: 'center', t: k - 1.65, type: 'rise', stagger: .007, out: out, odur: .25 });
  ktext('to evaluating exactly this kind of nuance.', W / 2, 972, { size: 38, family: 'Space Grotesk', weight: 700, fill: COL.pink, align: 'center', t: k - 1.85, type: 'rise', stagger: .007, out: out + .05, odur: .25 });
});

// ---------- 8. More use cases  56 - 60
cue(56.0, 'drop', .7); cue(56.05, 'type', .6, { dur: .6 });
[56.45, 56.75, 57.05, 57.35].forEach(t => cue(t, 'pop', 1));
cue(59.55, 'whoosh', 1, { dur: .45 });
flash(60.0, .25, '255,135,255', .6);
scene(56, 60, (lt, t) => {
  const cx = W / 2, cy = 590, out = 3.55;
  const ex = E.inExpo(P(lt, out, 4));
  ctx.save(); ctx.translate(cx, cy); ctx.scale(1 - ex * .5, 1 - ex * .5); ctx.translate(-cx, -cy); ctx.globalAlpha = 1 - ex;
  ktext('THE SAME CONCEPT COULD EXTEND TO', cx, 150, { size: 28, family: 'JetBrains Mono', weight: 800, ls: 6, fill: COL.pink, align: 'center', t: lt, type: 'decode', stagger: .012, dur: .2 });
  drawRays(cx, cy, t, .5, 'pink', 12, 900);
  const lp = E.outBack(P(lt, .05, .5));
  ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.purple, cx, cy, 700, .8); ctx.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.translate(cx, cy); ctx.scale(lp, lp);
  for (let r = 0; r < 3; r++) { ctx.save(); ctx.rotate(t * (r % 2 ? -.6 : .4) + r); ctx.setLineDash([20 + r * 10, 26]); neon(() => { ctx.beginPath(); ctx.arc(0, 0, 150 + r * 38, 0, TAU); }, r === 1 ? COL.cyan : COL.pink, 2, .6, false); ctx.restore(); }
  ctx.drawImage(LOGO_GRAD, -90, -84, 180, 169);
  ctx.restore();
  const items = [
    ['BOUNTIES', 520, 360, .4], ['GRANTS', 1400, 360, .7],
    ['SERVICE AGREEMENTS', 500, 830, 1.0], ['AI AGENT ⇄ AI AGENT', 1420, 830, 1.3],
  ];
  items.forEach(([label, x, y, t0], j) => {
    const p = P(lt, t0, t0 + .45);
    if (p <= 0) return;
    const e = E.outBack(p);
    const fx = lerp(cx, x, E.outExpo(p)), fy = lerp(cy, y, E.outExpo(p)) + Math.sin(t * 2 + j) * 8;
    neon(() => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(fx, fy); }, j % 2 ? COL.cyan : COL.pink, 2, .55 * clamp(p * 2), false);
    const u = (t * .9 + j * .25) % 1;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.white, lerp(cx, fx, u), lerp(cy, fy, u), 36, clamp(p * 2)); ctx.restore();
    pill(label, fx, fy, { size: 34, family: 'Unbounded', weight: 900, ls: 2, h: 96, padX: 44, color: j % 2 ? COL.cyan : COL.pink, sc: e, t: lt - t0, type: 'decode' });
  });
  ctx.restore();
});

// ---------- 9. Caveats  60 - 64
cue(60.0, 'drop', .6);
[60.55, 60.85, 61.15, 61.45].forEach(t => cue(t, 'tick', .9));
cue(61.9, 'type', .5, { dur: 1 });
cue(63.55, 'whoosh', .8, { dur: .45 });
face(60.0, 'dot', 'flat');
face(61.9, 'dot', 'w');
scene(60, 64, (lt, t) => {
  const out = 3.55;
  ktext('OF COURSE, IT STILL NEEDS', 140, 220, { size: 58, t: lt, type: 'rise', stagger: .016, out, grad: ['#fff', COL.pink] });
  const items = ['Clear evaluation criteria', 'Reliable evidence', 'Safeguards against biased decisions', 'A fair appeal process'];
  items.forEach((it, j) => {
    const t0 = .45 + j * .3, y = 340 + j * 100;
    const a = vis(lt, t0, out + j * .03, .35, .3);
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a; ctx.translate((1 - E.outCubic(P(lt, t0, t0 + .35))) * -60, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.roundRect(140, y - 42, 1050, 80, 18); ctx.fill();
    ctx.fillStyle = linGrad(ctx, 0, y - 42, 0, y + 38, [COL.pink, COL.purple]); ctx.fillRect(140, y - 42, 6, 80);
    ktext(String(j + 1).padStart(2, '0'), 180, y + 12, { size: 28, family: 'JetBrains Mono', weight: 800, fill: COL.pink });
    ktext(it, 260, y + 14, { size: 40, family: 'Space Grotesk', weight: 700, fill: '#fff' });
    badge('ok', 1140, y - 2, 22, clamp((lt - t0 - .15) * 5), E.outBack(P(lt, t0 + .15, t0 + .45)));
    ctx.restore();
  });
  const na = vis(lt, 1.9, out, .4, .3);
  ctx.save(); ctx.globalAlpha *= na;
  ctx.fillStyle = COL.pink; ctx.fillRect(140, 790, 4, 92);
  ktext("AI consensus doesn't guarantee every decision is correct —", 170, 820, { size: 25, family: 'JetBrains Mono', weight: 400, fill: 'rgba(246,232,255,0.8)', t: lt - 1.9, type: 'decode', stagger: .006, dur: .15 });
  ktext("and it doesn't automatically replace legal dispute resolution.", 170, 866, { size: 25, family: 'JetBrains Mono', weight: 400, fill: 'rgba(246,232,255,0.8)', t: lt - 2.1, type: 'decode', stagger: .006, dur: .15 });
  ctx.restore();
  const ce = E.outBack(P(lt, .2, .8)), cx = E.inCubic(P(lt, out, out + .45));
  drawCharacter({ x: lerp(2200, 1560, ce) + cx * 700, y: 900 + Math.sin(t * 2) * 8, groundY: 900, h: 600, disc: 1, rot: -.05 + Math.sin(t * 1.3) * .03 }, t);
  if (lt > 1.0 && lt < out) { const a = vis(lt, 1.0, out - .2, .3, .2); ktext('…', 1790, 330, { size: 90, fill: COL.pink, align: 'center', alpha: a, t: lt - 1, type: 'pop', stagger: .1 }); }
});

// ---------- 10. Outro  64 - 72
cue(64.0, 'pad', 1, { dur: 3.5 });
[64.05, 64.55, 65.05].forEach(t => cue(t, 'pop', .7));
cue(65.6, 'riser', 1.2, { dur: 1.9 });
impact(67.5, 1.6, 'drop');
cue(67.5, 'impact', 1.6);
flash(67.5, .6, '255,255,255', 1);
cue(67.9, 'whoosh', .6, { dur: .4 }); cue(68.2, 'pop', .8); cue(68.5, 'pop', .8);
cue(70.9, 'chime', .8);
face(64.0, 'dot', 'o');
face(67.5, 'happy', 'grin');
face(70.0, 'wink', 'w');
face(71.1, 'happy', 'grin');
scene(64, 72, (lt, t) => {
  if (lt < 3.6) {
    const out = 3.15;
    ktext('WHAT IF GETTING PAID', W / 2, 280, { size: 70, align: 'center', weight: 700, t: lt - .0, type: 'rise', stagger: .016, out });
    ktext('FOR COMPLETED WORK', W / 2, 375, { size: 70, align: 'center', weight: 700, t: lt - .5, type: 'rise', stagger: .016, out: out + .03 });
    ktext("DIDN'T DEPEND ENTIRELY ON", W / 2, 465, { size: 52, align: 'center', weight: 700, fill: '#f0dcff', t: lt - 1.0, type: 'rise', stagger: .014, out: out + .06 });
    const tr = P(lt, 1.6, 3.2);
    ktext('TRUST?', W / 2, 790, { size: 230, align: 'center', grad: ['#fff', COL.pink, COL.purple], t: lt - 1.6, type: 'zoom', stagger: .06, dur: .6, glow: 60, rgb: 3 + tr * 10, jitter: tr * tr * 10, out: out + .1, odur: .3 });
    if (lt > 1.6) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.purple, W / 2, 690, 1400 * (1 + tr * .3), .5 * clamp(lt - 1.6)); ctx.restore(); }
    // tension particles converging
    if (lt > 2.0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 80; i++) {
        const ph = (hash(i) + (lt - 2) * (.6 + hash(i * 2) * .6)) % 1;
        const ang = hash(i * 3) * TAU, d = (1 - ph) * 1100;
        ctx.globalAlpha = ph * clamp((lt - 2) * 2) * (1 - P(lt, out, out + .2));
        ctx.fillStyle = i % 2 ? COL.pink : '#fff';
        ctx.fillRect(W / 2 + Math.cos(ang) * d, 690 + Math.sin(ang) * d * .6, 3, 3);
      }
      ctx.restore();
    }
    return;
  }
  const k = lt - 3.5;
  const fade = 1 - P(lt, 7.45, 8);
  ctx.save(); ctx.globalAlpha = fade;
  drawRays(500, 640, t, .7, 'purple', 16, 1400);
  ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.purple, 500, 640, 1200, .7); drawSprite(SPR.pink, 1300, 520, 1000, .25); ctx.globalCompositeOperation = 'source-over';
  ring(500, 640, E.outExpo(P(k, 0, 1)) * 1200, 6, COL.pink, 1 - P(k, 0, 1));
  ring(500, 640, E.outExpo(P(k, .12, 1.2)) * 900, 4, COL.cyan, 1 - P(k, .12, 1.2));
  burst(500, 600, k, 4242, 90, 1500, COL.pink, 1.6, 600);
  // character jump in
  const jp = P(k, 0, .7);
  const jy = jp < 1 ? -Math.sin(jp * Math.PI) * 260 + (1 - jp) * 300 : 0;
  const land = k - .7;
  const sq = land > 0 ? Math.exp(-land * 6) * Math.cos(land * 20) : 0;
  drawCharacter({ x: 500, y: 980 + jy - (land > 0 ? Math.sin(land * 2.2) * 10 : 0), groundY: 980, h: 760, sy: 1 - sq * .14, sx: 1 + sq * .1, rot: Math.sin(t * 1.5) * .03, disc: clamp(land * 3), chest: .6 + .4 * Math.sin(t * 5), alpha: clamp(k * 6) }, t);
  // lockup
  const lx = 930;
  const lp = E.outBack(P(k, .2, .65));
  ctx.save(); ctx.translate(lx + 80, 300); ctx.scale(lp, lp);
  ctx.globalCompositeOperation = 'lighter'; drawSprite(SPR.purple, 0, 0, 420, .9); ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(LOGO_GRAD, -85, -80, 170, 160);
  ctx.restore();
  ktext('GENLAYER', lx + 200, 335, { size: fit('GENLAYER', W - lx - 290, 92, 'Unbounded', 900, 6), grad: ['#fff', COL.pink], t: k - .35, type: 'decode', stagger: .04, dur: .3, glow: 30, ls: 6 });
  ktext('EXPLORE THE FUTURE OF', lx, 490, { size: 30, family: 'JetBrains Mono', weight: 800, ls: 6, fill: COL.pink, t: k - .6, type: 'decode', stagger: .015, dur: .2 });
  ktext('ONCHAIN DECISIONS', lx, 570, { size: fit('ONCHAIN DECISIONS', W - lx - 90, 66), grad: ['#fff', COL.pink, COL.purple], t: k - .75, type: 'rise', stagger: .022, glow: 30 });
  pill('genlayer.com', lx, 685, { align: 'left', size: 32, family: 'Space Grotesk', weight: 700, ls: 1, h: 78, padX: 30, color: COL.pink, sc: E.outBack(P(k, 1.0, 1.35)), a: clamp((k - 1) * 4), icon: iconGlobe });
  pill('docs.genlayer.com', lx, 785, { align: 'left', size: 32, family: 'Space Grotesk', weight: 700, ls: 1, h: 78, padX: 30, color: COL.cyan, sc: E.outBack(P(k, 1.2, 1.55)), a: clamp((k - 1.2) * 4), icon: iconBook });
  ktext('INTELLIGENT CONTRACTS · AI CONSENSUS · ONCHAIN', lx, 895, { size: 20, family: 'JetBrains Mono', weight: 700, ls: 4, fill: 'rgba(255,135,255,0.75)', t: k - 1.5, type: 'decode', stagger: .01, dur: .2 });
  ctx.restore();
});

// ================================================================ frame
function shakeAt(t) {
  let x = 0, y = 0, r = 0;
  for (const im of IMPACTS) {
    const d = t - im.t;
    if (d < 0 || d > .8) continue;
    const a = im.amp * Math.exp(-d * 9) * 22;
    x += noise1(d * 40 + im.t * 10) * a; y += noise1(d * 40 + 50 + im.t) * a; r += noise1(d * 30 + 99) * a * .0012;
  }
  return { x, y, r };
}
function renderFrame(t) {
  t = clamp(t, 0, DURATION - 1e-4);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0; ctx.filter = 'none';
  drawBG(t);
  const sh = shakeAt(t);
  // subtle global camera drift + zoom pulses on impacts
  let zp = 0;
  for (const im of IMPACTS) { const d = t - im.t; if (d >= 0 && d < .5) zp += im.amp * .025 * Math.exp(-d * 8); }
  ctx.save();
  ctx.translate(W / 2 + sh.x, H / 2 + sh.y); ctx.rotate(sh.r); ctx.scale(1 + zp, 1 + zp); ctx.translate(-W / 2, -H / 2);
  for (const s of SCENES) if (t >= s.s && t < s.e) { ctx.save(); s.fn(t - s.s, t); ctx.restore(); }
  ctx.restore();
  postFX(t);
}
function postFX(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  // glitch slices
  let g = 0;
  for (const gl of GLITCHES) { const d = t - gl.t; if (d >= -.05 && d < gl.dur) g = Math.max(g, gl.amt * (1 - Math.abs(d) / gl.dur)); }
  if (g > 0) {
    bctx.globalCompositeOperation = 'copy'; bctx.drawImage(cv, 0, 0); bctx.globalCompositeOperation = 'source-over';
    const fr = Math.floor(t * 60);
    for (let i = 0; i < 14; i++) {
      if (hash(i * 7 + fr) > .55) continue;
      const y = hash(i * 13 + fr) * H, h = 8 + hash(i * 17 + fr) * 90, dx = (hash(i * 19 + fr) - .5) * 220 * g;
      ctx.drawImage(BUF, 0, y, W, h, dx, y, W, h);
      if (hash(i * 23 + fr) > .6) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = hash(i + fr) > .5 ? 'rgba(220,0,255,0.35)' : 'rgba(62,240,255,0.3)'; ctx.fillRect(0, y, W, h * .3); ctx.globalCompositeOperation = 'source-over'; }
    }
    // rgb split
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .18 * g;
    ctx.drawImage(BUF, -10 * g, 0); ctx.drawImage(BUF, 10 * g, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  // flashes
  for (const f of FLASHES) {
    const d = t - f.t;
    if (d < 0 || d > f.dur) continue;
    ctx.fillStyle = `rgba(${f.color},${f.a * Math.pow(1 - d / f.dur, 2)})`;
    ctx.fillRect(0, 0, W, H);
  }
  // scanlines, grain, vignette
  ctx.fillStyle = SCAN_PAT; ctx.globalAlpha = .35; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = .06; ctx.globalCompositeOperation = 'overlay';
  const n = NOISE[Math.floor(t * 30) % 4], ox = Math.floor(hash(Math.floor(t * 30)) * 256);
  for (let x = -ox; x < W; x += 256) for (let y = -ox; y < H; y += 256) ctx.drawImage(n, x, y);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.drawImage(VIGNETTE, 0, 0);
  // fade in from black at the very start
  if (t < .15) { ctx.fillStyle = `rgba(0,0,0,${1 - t / .15})`; ctx.fillRect(0, 0, W, H); }
  if (t > DURATION - .5) { ctx.fillStyle = `rgba(0,0,0,${P(t, DURATION - .5, DURATION)})`; ctx.fillRect(0, 0, W, H); }
}

// ================================================================ boot
CUES.sort((a, b) => a.t - b.t);
FACEK.sort((a, b) => a[0] - b[0]);
window.DURATION = DURATION; window.FPS = FPS; window.CUES = CUES;
window.renderFrame = renderFrame;
window.ready = setup().then(() => { renderFrame(0); return true; });

const params = new URLSearchParams(location.search);
if (!params.has('capture')) {
  window.ready.then(() => {
    const startAt = parseFloat(params.get('t') || '0');
    if (params.has('still')) { renderFrame(startAt); return; }
    const audio = new Audio('soundtrack.wav');
    const btn = document.createElement('button'); btn.id = 'play'; btn.textContent = '▶  PLAY';
    document.body.appendChild(btn);
    renderFrame(startAt);
    btn.onclick = () => {
      btn.remove();
      audio.currentTime = startAt; audio.play().catch(() => {});
      const t0 = performance.now() - startAt * 1000;
      const loop = () => {
        const t = (performance.now() - t0) / 1000;
        renderFrame(t % DURATION);
        if (t >= DURATION) { audio.currentTime = 0; }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };
  });
}
