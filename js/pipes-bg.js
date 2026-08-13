// ───────────────────────────────────────────────────────────
// Ambient glow-trail background for the login screen. Adapted from
// the "Pipes" demo (index5.html / js/pipeline.js) in Sean Free's
// Ambient Canvas Backgrounds (Codrops), credited per its license.
// The original fills a solid black background each frame; this
// version never does — it draws low-alpha glowing strokes on a
// transparent canvas that sits directly over the app's solid navy
// backdrop (.auth-wrap), so the embers are the whole scene rather
// than an overlay on a stock photo.
// Retinted from the demo's default cyan to rodeo orange/gold.
// ─────────────────────────────────────────────────────
(function () {
  'use strict';

  const { PI, cos, sin, abs, round, random } = Math;
  const HALF_PI = 0.5 * PI;
  const TAU = 2 * PI;
  const TO_RAD = PI / 180;
  const rand = (n) => n * random();
  const fadeInOut = (t, m) => { const hm = 0.5 * m; return abs((t + hm) % m - hm) / hm; };

  const pipeCount = 30;
  const pipePropCount = 8;
  const pipePropsLength = pipeCount * pipePropCount;
  const turnCount = 8;
  const turnAmount = (360 / turnCount) * TO_RAD;
  const turnChanceRange = 58;
  // A modest bump over the original demo's values (0.4/0.8) — 4x
  // turned out way too fast once the draw fix below made the motion
  // actually read as continuous lines instead of choppy dot-stamps
  // (the choppiness was what made the original speed look slow, not
  // the speed itself). This is closer to ~1.5x.
  const baseSpeed = 0.6;
  const rangeSpeed = 1.0;
  const baseTTL = 100;
  const rangeTTL = 260;
  const baseWidth = 2;
  const rangeWidth = 4;
  const baseHue = 18;   // rodeo orange
  const rangeHue = 42;  // ...through amber/gold
  const strokeAlpha = 0.4; // now the whole scene (solid navy backdrop), not a subtle overlay on a photo

  let container, canvas, ctx, center, tick, pipeProps, raf;

  function setup() {
    container = document.querySelector('.auth-bg-pipes');
    if (!container) return;
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    container.appendChild(canvas);
    ctx = canvas.getContext('2d');
    center = [0, 0];
    tick = 0;
    resize();
    initPipes();
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; // leave it static — no rAF loop
    draw();
  }

  function initPipes() {
    pipeProps = new Float32Array(pipePropsLength);
    for (let i = 0; i < pipePropsLength; i += pipePropCount) initPipe(i);
  }
  function initPipe(i) {
    const x = rand(canvas.width);
    const y = center[1];
    const direction = round(rand(1)) ? HALF_PI : TAU - HALF_PI;
    const speed = baseSpeed + rand(rangeSpeed);
    const life = 0;
    const ttl = baseTTL + rand(rangeTTL);
    const width = baseWidth + rand(rangeWidth);
    const hue = baseHue + rand(rangeHue);
    pipeProps.set([x, y, direction, speed, life, ttl, width, hue], i);
  }

  // The original demo never clears its trail canvas — fine against a
  // solid black background, but on top of a photo the glow just keeps
  // accumulating into a wash. Fading a touch of transparency in each
  // frame (via destination-out) lets old strokes decay so this settles
  // into a steady drifting-ember look instead of slowly overexposing.
  function fadeTrails() {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.035)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function updatePipes() {
    tick++;
    fadeTrails();
    for (let i = 0; i < pipePropsLength; i += pipePropCount) updatePipe(i);
  }
  function updatePipe(i) {
    const i2 = 1 + i, i3 = 2 + i, i5 = 4 + i, i6 = 5 + i, i7 = 6 + i, i8 = 7 + i;
    const x = pipeProps[i], y = pipeProps[i2], direction = pipeProps[i3];
    const speed = pipeProps[4 + i], life = pipeProps[i5], ttl = pipeProps[i6], width = pipeProps[i7], hue = pipeProps[i8];

    const newLife = life + 1;
    let nx = x + cos(direction) * speed;
    let ny = y + sin(direction) * speed;

    // Draw a stroked segment from the old position to the new one each
    // frame — a continuous flowing line, not a stamped circle at each
    // point (which, chained frame to frame, reads as a trail of
    // separate dots rather than a single moving pipe).
    drawPipe(x, y, nx, ny, life, ttl, width, hue);

    const turnChance = !(tick % round(rand(turnChanceRange))) && (!(round(nx) % 6) || !(round(ny) % 6));
    const turnBias = round(rand(1)) ? -1 : 1;
    let direction2 = direction + (turnChance ? turnAmount * turnBias : 0);

    if (nx > canvas.width) nx = 0; if (nx < 0) nx = canvas.width;
    if (ny > canvas.height) ny = 0; if (ny < 0) ny = canvas.height;

    pipeProps[i] = nx; pipeProps[i2] = ny; pipeProps[i3] = direction2; pipeProps[i5] = newLife;
    if (newLife > ttl) initPipe(i);
  }
  function drawPipe(x1, y1, x2, y2, life, ttl, width, hue) {
    ctx.save();
    ctx.strokeStyle = `hsla(${hue},85%,58%,${fadeInOut(life, ttl) * strokeAlpha})`;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    center[0] = 0.5 * canvas.width;
    center[1] = 0.5 * canvas.height;
  }

  function draw() {
    updatePipes();
    raf = window.requestAnimationFrame(draw);
  }

  window.addEventListener('load', setup);
  window.addEventListener('resize', () => { if (canvas) resize(); });
})();
