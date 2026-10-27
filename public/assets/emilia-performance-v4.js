// One connected surface. Facial artwork is composited in SOURCE coordinates
// before deformation, so neither the eyes nor the mouth can slip off the head.
import { normalizeExpression } from "/avatar-director.js";
import { faceLibrary, eyeRegistration } from "/assets/emilia-face-library.js?v=16";
const WIDTH = 971, HEIGHT = 1620;
const FACE = { x: 365, y: 304, w: 220, h: 146 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, dt, tau) => lerp(a, b, 1 - Math.exp(-dt / tau));
const canvas = document.querySelector("#portrait");
const fallback = document.querySelector("#fallback");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const motionStates = {
  listening: { tilt: 0, lift: 0, shoulders: 0, smile: .08 },
  thinking: { tilt: -2.0, lift: -2.2, shoulders: .15, smile: .02 },
  encouraging: { tilt: .85, lift: -.6, shoulders: .7, smile: .28 },
  celebrating: { tilt: -.5, lift: -2.0, shoulders: 1, smile: .42 },
  speaking: { tilt: .35, lift: -.4, shoulders: .25, smile: .16 }
};
const reactions = {
  neutral: { tilt: 0, lift: 0, shoulders: 0, smile: .08, eyes: 1, nod: 0, lean: 0 },
  curious: { tilt: -3.3, lift: -2, shoulders: .1, smile: .13, eyes: 1, nod: .2, lean: .7 },
  empathy: { tilt: 3.3, lift: 2, shoulders: .08, smile: .22, eyes: .68, nod: .85, lean: 1.2 },
  encouraging: { tilt: -1.3, lift: -1, shoulders: 1.05, smile: .9, eyes: .72, nod: 1.25, lean: .7 },
  celebrating: { tilt: 1.7, lift: -4, shoulders: 1.2, smile: .98, eyes: .72, nod: 1.25, lean: .8 }
};
let cue = { kind: "neutral", intensity: 0, startedAt: 0 };
let input = { parameters: {}, motion: true, speaking: false, performance: "listening" };
let lastInputAt = performance.now();
let current = { x: 0, y: 0, tilt: 0, body: 0, breath: 0, shoulders: 0, smile: .08, lean: 0, mouth: 0, mouthForm: .08, eyeL: 1, eyeR: 1 };
let lastTime = 0, animationTime = 0, frameNumber = 0;
let ready = false, assets = {}, renderer, faceContext;
let lastFaceKey = "";
let faceStyle = "neutral", pendingFaceStyle = "neutral", faceTransitionStartedAt = -10;

function makeCanvas(w, h) {
  const result = document.createElement("canvas"); result.width = w; result.height = h; return result;
}
async function loadImage(url) {
  const image = new Image(); image.src = url; await image.decode(); return image;
}

// A very small, feathered skin repair removes the neutral feature before its
// deformed replacement is drawn. It never covers the nose, jaw or other eye.
function skinBed(source, box, upperY, lowerY) {
  const result = makeCanvas(box.w, box.h), ctx = result.getContext("2d");
  const sample = makeCanvas(WIDTH, HEIGHT), sampleCtx = sample.getContext("2d", { willReadFrequently: true });
  sampleCtx.drawImage(source, 0, 0);
  const top = sampleCtx.getImageData(box.x, upperY, box.w, 1).data;
  const bottom = sampleCtx.getImageData(box.x, lowerY, box.w, 1).data;
  const pixels = ctx.createImageData(box.w, box.h);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
    const at = (y * box.w + x) * 4;
    const distance = Math.hypot((x + .5 - box.w / 2) / (box.w / 2), (y + .5 - box.h / 2) / (box.h / 2));
    for (let c = 0; c < 3; c++) pixels.data[at + c] = lerp(top[x * 4 + c], bottom[x * 4 + c], clamp((box.y + y - upperY) / (lowerY - upperY), 0, 1));
    pixels.data[at + 3] = Math.round(255 * (1 - smooth(.84, 1, distance)));
  }
  ctx.putImageData(pixels, 0, 0); return result;
}

function featheredCrop(source, box, inset = .88) {
  const result = makeCanvas(box.w, box.h), ctx = result.getContext("2d");
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const mask = makeCanvas(box.w, box.h), maskCtx = mask.getContext("2d");
  const pixels = maskCtx.createImageData(box.w, box.h);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
    const d = Math.hypot((x + .5 - box.w / 2) / (box.w / 2), (y + .5 - box.h / 2) / (box.h / 2));
    pixels.data[(y * box.w + x) * 4 + 3] = Math.round(255 * (1 - smooth(inset, 1, d)));
  }
  maskCtx.putImageData(pixels, 0, 0);
  ctx.globalCompositeOperation = "destination-in"; ctx.drawImage(mask, 0, 0);
  return result;
}

function prepareFace() {
  const face = makeCanvas(FACE.w, FACE.h); faceContext = face.getContext("2d");
  const eyes = [
    { x: 374, y: 311, w: 79, h: 62, baseline: 350 },
    { x: 501, y: 309, w: 78, h: 64, baseline: 350 }
  ];
  assets.eyes = eyes.map(box => ({
    ...box,
    bed: skinBed(assets.blink || assets.neutral, box, 311, 373),
    open: featheredCrop(assets.neutral, box, .92),
    closed: featheredCrop(assets.blink || assets.neutral, box, .89)
  }));
  assets.eyeStyles = {};
  for (const [kind, spec] of Object.entries(faceLibrary)) {
    const source = assets[kind];
    if (!source) continue;
    const aligned = makeCanvas(WIDTH, HEIGHT), ctx = aligned.getContext("2d");
    ctx.setTransform(...eyeRegistration(spec.eyes));
    ctx.drawImage(source, 0, 0);
    assets.eyeStyles[kind] = eyes.map(box => featheredCrop(aligned, box, .87));
  }
  assets.mouthBedBox = { x: 449, y: 408, w: 57, h: 32 };
  assets.mouthBed = skinBed(assets.neutral, assets.mouthBedBox, 410, 435);
  // Only the original mouth ink is sampled; not the surrounding lower face.
  assets.mouth = featheredCrop(assets.delighted || assets.neutral, { x: 451, y: 414, w: 41, h: 22 }, .86);
  return face;
}

function drawFace(s) {
  const ctx = faceContext;
  ctx.clearRect(0, 0, FACE.w, FACE.h);
  ctx.drawImage(assets.neutral, FACE.x, FACE.y, FACE.w, FACE.h, 0, 0, FACE.w, FACE.h);
  assets.eyes.forEach((eye, index) => {
    const opening = clamp(index ? s.eyeR : s.eyeL, 0, 1);
    const styled = assets.eyeStyles[faceStyle]?.[index];
    if ((opening > .995 && !styled) || !assets.blink) return;
    const x = eye.x - FACE.x, y = eye.y - FACE.y;
    ctx.drawImage(eye.bed, x, y);
    const scale = Math.max(.025, opening);
    ctx.globalAlpha = smooth(.01, .2, opening);
    ctx.drawImage(styled || eye.open, x, eye.baseline - FACE.y + (eye.y - eye.baseline) * scale, eye.w, eye.h * scale);
    ctx.globalAlpha = 1 - smooth(.03, .22, opening);
    ctx.drawImage(eye.closed, x, y);
    ctx.globalAlpha = 1;
  });
  const mouth = clamp(s.mouth, 0, 1);
  if (mouth > .008 && assets.delighted) {
    const box = assets.mouthBedBox;
    // Retain the original closed lip during the last few pixels of closure.
    // The repair never scales with the mouth, so surrounding skin stays still.
    ctx.globalAlpha = smooth(.008, .10, mouth);
    ctx.drawImage(assets.mouthBed, box.x - FACE.x, box.y - FACE.y);
    const opening = Math.pow(mouth, .72);
    const height = 3 + 23 * opening;
    const width = 38 + clamp(s.mouthForm, -.2, .8) * 4 + s.smile * 2 - opening * 2;
    // Upper lip stays almost fixed; the lower lip opens downward, rather than
    // a whole patch expanding about its centre and dragging the upper face.
    ctx.drawImage(assets.mouth, 477.5 - FACE.x - width / 2, 419.7 - FACE.y - height * .14, width, height);
    ctx.globalAlpha = 1;
  }
}

// Smooth, connected deformation, with a fixed neck and body pivot. All
// triangles and all facial features share this function and source UVs.
function deform(x, y, s, time) {
  const head = 1 - smooth(445, 640, y);
  const angle = s.tilt * Math.PI / 180 * head;
  const dx = x - 477, dy = y - 483;
  let px = 477 + dx * Math.cos(angle) - dy * Math.sin(angle) + s.x * head;
  let py = 483 + dx * Math.sin(angle) + dy * Math.cos(angle) + s.y * head;
  px += dx * (s.lean || 0) * .008 * head;
  py += dy * (s.lean || 0) * .008 * head;
  const torso = smooth(445, 650, y) * (1 - smooth(1000, 1460, y));
  const side = smooth(95, 240, Math.abs(x - 485));
  py -= s.shoulders * 10 * torso * side;
  const tails = smooth(410, 710, y) * (1 - smooth(1250, 1530, y)) * smooth(155, 290, Math.abs(x - 485));
  px += Math.sin(time * 1.15 + y * .004) * 2.5 * tails * s.motion;
  py -= s.breath * 3 * torso;
  px += (x - 485) * s.breath * .0012 * torso;
  const bodyAngle = s.body * Math.PI / 180;
  return [485 + (px - 485) * Math.cos(bodyAngle) - (py - 1180) * Math.sin(bodyAngle),
    1180 + (px - 485) * Math.sin(bodyAngle) + (py - 1180) * Math.cos(bodyAngle)];
}

function createRenderer(face) {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: false });
  if (!gl) return createCanvasRenderer(face);
  const compile = (type, code) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, code); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, `
    attribute vec2 a_position; attribute vec2 a_uv;
    uniform vec2 u_view; varying highp vec2 v_uv;
    void main() {
      float scale = u_view.y * 1.58 / 1620.0;
      vec2 pixel = vec2(u_view.x * .5 + (a_position.x - 485.5) * scale, a_position.y * scale);
      gl_Position = vec4(pixel.x / u_view.x * 2.0 - 1.0, 1.0 - pixel.y / u_view.y * 2.0, 0, 1);
      v_uv = a_uv;
    }`));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    uniform sampler2D u_art; uniform sampler2D u_face; varying highp vec2 v_uv;
    void main() {
      vec4 color = texture2D(u_art, v_uv);
      // The repaired artwork now carries a clean matte. Preserve its fine
      // antialiased strands rather than applying a global alpha erosion.
      vec2 p = v_uv * vec2(971., 1620.);
      if (p.x >= 365. && p.x <= 585. && p.y >= 304. && p.y <= 450.) {
        color = texture2D(u_face, (p - vec2(365., 304.)) / vec2(220., 146.));
      }
      gl_FragColor = color;
    }`));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program); gl.disable(gl.BLEND);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const upload = (image, unit, name) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.uniform1i(gl.getUniformLocation(program, name), unit); return texture;
  };
  upload(assets.neutral, 0, "u_art");
  const faceTexture = upload(face, 1, "u_face");
  const cols = 48, rows = 80, vertices = new Float32Array((cols + 1) * (rows + 1) * 4), indices = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const a = y * (cols + 1) + x, b = a + 1, c = a + cols + 1, d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW);
  for (const [name, offset] of [["a_position", 0], ["a_uv", 8]]) {
    const loc = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 16, offset);
  }
  const indexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  const view = gl.getUniformLocation(program, "u_view");
  let minArea = 1, maxStep = 0;
  return {
    type: "connected-mesh",
    draw(s, time, dirty) {
      for (let row = 0; row <= rows; row++) for (let col = 0; col <= cols; col++) {
        const i = (row * (cols + 1) + col) * 4;
        const point = deform(col / cols * WIDTH, row / rows * HEIGHT, s, time);
        if (frameNumber > 1) maxStep = Math.max(maxStep, Math.hypot(point[0] - vertices[i], point[1] - vertices[i + 1]));
        vertices[i] = point[0]; vertices[i + 1] = point[1]; vertices[i + 2] = col / cols; vertices[i + 3] = row / rows;
      }
      if (frameNumber % 10 === 0) {
        const normal = WIDTH / cols * HEIGHT / rows;
        for (let i = 0; i < indices.length; i += 3) {
          const a = indices[i] * 4, b = indices[i + 1] * 4, c = indices[i + 2] * 4;
          const area = ((vertices[b] - vertices[a]) * (vertices[c + 1] - vertices[a + 1]) - (vertices[b + 1] - vertices[a + 1]) * (vertices[c] - vertices[a]));
          minArea = Math.min(minArea, area / normal);
        }
      }
      gl.viewport(0, 0, canvas.width, canvas.height); gl.uniform2f(view, canvas.width, canvas.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
      if (dirty) {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, faceTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, face);
      }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    },
    stats: () => ({ minAreaRatio: minArea, maximumVertexStep: maxStep, triangles: indices.length / 3 })
  };
}

function createCanvasRenderer(face) {
  const ctx = canvas.getContext("2d"), surface = makeCanvas(WIDTH, HEIGHT), source = surface.getContext("2d");
  return {
    type: "canvas-fallback",
    draw(s) {
      source.clearRect(0, 0, WIDTH, HEIGHT); source.drawImage(assets.neutral, 0, 0); source.drawImage(face, FACE.x, FACE.y);
      const scale = canvas.height * 1.58 / HEIGHT;
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save();
      ctx.translate(canvas.width / 2, 483 * scale); ctx.rotate(s.tilt * Math.PI / 180 * .5);
      ctx.drawImage(surface, (-WIDTH / 2 + s.x) * scale, (-483 + s.y) * scale, WIDTH * scale, HEIGHT * scale); ctx.restore();
    }, stats: () => ({ minAreaRatio: 1, maximumVertexStep: null, triangles: 0 })
  };
}

function receive(data) {
  if (data?.type !== "auto-live2d:state") return;
  const active = data.expressionState?.active || {};
  const expression = normalizeExpression(active.expression);
  if (active.cueId !== undefined && active.cueId !== input.cueId) {
    cue = { ...expression, startedAt: animationTime };
    input.cueId = active.cueId;
  } else if (expression.kind === "neutral" && input.expressionKind && input.expressionKind !== "neutral") {
    cue = { ...expression, startedAt: animationTime };
  }
  if (active.performance === "celebrating" && input.performance !== "celebrating" && expression.kind === "neutral") {
    cue = { kind: "celebrating", intensity: .65, startedAt: animationTime };
  }
  input.expressionKind = expression.kind;
  input.parameters = { ...input.parameters, ...data.parameters };
  input.motion = data.motion !== false;
  input.performance = data.expressionState?.active?.performance || "listening";
  input.speaking = data.speaking === true;
  lastInputAt = performance.now();
}
addEventListener("message", event => {
  // A tab can drive only its own iframe. BroadcastChannel let other open lessons
  // overwrite lip sync and performance state on every 90 ms idle update.
  if (event.source !== parent || event.origin !== location.origin) return;
  receive(event.data);
});

function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 1.6);
  const width = Math.max(1, Math.round(innerWidth * ratio)), height = Math.max(1, Math.round(innerHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
}
new ResizeObserver(resize).observe(document.documentElement);

function tick(now) {
  const dt = Math.min(.034, Math.max(.001, (now - (lastTime || now - 16.7)) / 1000)); lastTime = now;
  const p = input.parameters;
  const enabled = input.motion && !reducedMotion.matches;
  if (enabled) animationTime += dt;
  const motion = enabled ? 1 : 0;
  const pose = motionStates[input.performance] || motionStates.listening;
  const aliveSpeech = input.speaking && now - lastInputAt < 1500;
  const elapsed = animationTime - cue.startedAt;
  const reaction = reactions[cue.kind] || reactions.neutral;
  const amount = cue.intensity * (1 - smooth(6.5, 8.5, elapsed));
  const desiredFace = amount > .12 && assets.eyeStyles[cue.kind] ? cue.kind : "neutral";
  if (desiredFace !== pendingFaceStyle) {
    pendingFaceStyle = desiredFace;
    faceTransitionStartedAt = now / 1000;
  }
  // Change eye artwork only behind a blink, never by dissolving two irises.
  // This uses wall time so reduced-motion mode cannot get stuck mid-blink.
  const faceElapsed = now / 1000 - faceTransitionStartedAt;
  if (faceElapsed >= .14) faceStyle = pendingFaceStyle;
  const transitionEye = faceElapsed < .14 ? 1 - smooth(0, .10, faceElapsed) : smooth(.18, .32, faceElapsed);
  // One or two gentle nods at the start of a reaction, then settle. Incoming
  // audio packets do not restart this gesture on every frame.
  const nodPeriod = cue.kind === "empathy" ? 2.7 : cue.kind === "encouraging" ? .95 : 1.2;
  const nodEnd = cue.kind === "empathy" ? 2.7 : 2.4;
  const nod = elapsed < nodEnd ? Math.sin(elapsed * Math.PI / nodPeriod) ** 2 * (1 - smooth(nodEnd - .6, nodEnd, elapsed)) : 0;
  const emphasis = aliveSpeech ? Math.sin(animationTime * 2.4) * .2 : 0;
  const targets = {
    x: clamp(p.ParamAngleX, -15, 15) * .48 * motion,
    y: (pose.lift + amount * (reaction.lift + reaction.nod * nod * 13) - clamp(p.ParamAngleY, -10, 10) * .3 + emphasis) * motion,
    tilt: clamp(pose.tilt + amount * reaction.tilt + clamp(p.ParamAngleZ, -8, 8) * .13 + Math.sin(animationTime * .46) * .23, -3.4, 3.4) * motion,
    body: (clamp(p.ParamBodyAngleZ, -5, 5) * .09 + Math.sin(animationTime * .38) * .08) * motion,
    breath: Math.sin(animationTime * 1.42) * .55 * motion,
    shoulders: (pose.shoulders + amount * reaction.shoulders) * motion,
    smile: lerp(pose.smile, reaction.smile, amount),
    lean: amount * reaction.lean * motion,
    mouth: aliveSpeech ? clamp(p.ParamMouthOpenY, 0, .95) : 0,
    mouthForm: aliveSpeech ? clamp(p.ParamMouthForm ?? .08, -.2, .8) : .08,
    eyeL: (enabled ? clamp(p.ParamEyeLOpen ?? 1, 0, 1) * lerp(1, reaction.eyes, amount) : 1) * transitionEye,
    eyeR: (enabled ? clamp(p.ParamEyeROpen ?? 1, 0, 1) * lerp(1, reaction.eyes, amount) : 1) * transitionEye
  };
  for (const key of Object.keys(targets)) current[key] = damp(current[key], targets[key], dt, key.startsWith("eye") ? .014 : key === "mouth" ? .035 : .32);
  if (current.mouth < .006) current.mouth = 0;
  current.motion = damp(current.motion ?? 0, motion, dt, .25);
  const faceKey = faceStyle + ":" + [current.eyeL, current.eyeR, current.mouth, current.mouthForm, current.smile].map(v => Math.round(v * 1000)).join(":");
  const dirty = faceKey !== lastFaceKey;
  if (dirty) { drawFace(current); lastFaceKey = faceKey; }
  renderer.draw(current, animationTime, dirty); frameNumber++;
  requestAnimationFrame(tick);
}

// Read-only metrics and explicitly opt-in QA controls. Production input is
// frame-addressed; no external same-origin BroadcastChannel is consumed.
globalThis.avatarDiagnostics = {
  snapshot: () => ({ ready, renderer: renderer?.type, frameNumber, performance: input.performance, speaking: input.speaking,
    expression: cue.kind, faceStyle, pendingFaceStyle, cueId: input.cueId, cueStartedAt: cue.startedAt,
    state: { ...current }, ...renderer?.stats(), assets: Object.keys(assets).filter(k => assets[k] instanceof HTMLImageElement) })
};
if (new URLSearchParams(location.search).has("qa")) {
  globalThis.avatarDiagnostics.set = receive;
  globalThis.avatarDiagnostics.face = () => faceContext.canvas.toDataURL();
}
canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); canvas.classList.remove("ready"); fallback.classList.remove("hidden"); });
canvas.addEventListener("webglcontextrestored", () => location.reload());

try {
  try { assets.neutral = await loadImage("/assets/avatar-v3/neutral-ear-v22.png?v=1"); }
  catch { assets.neutral = await loadImage("/assets/avatar-v3/neutral-v3.png"); }
  const optional = await Promise.allSettled([loadImage("/assets/avatar-v3/blink-v3.png"), loadImage("/assets/avatar-v3/delighted-v3.png")]);
  if (optional[0].status === "fulfilled") assets.blink = optional[0].value;
  if (optional[1].status === "fulfilled") assets.delighted = optional[1].value;
  // A missing optional illustration must not blank the stage or block speech.
  await Promise.all(Object.entries(faceLibrary).map(async ([kind, spec]) => {
    try { assets[kind] = await loadImage(`/assets/avatar-v3/${spec.file}-v3.png`); }
    catch { /* The neutral eye artwork remains available. */ }
  }));
  const face = prepareFace(); drawFace(current); renderer = createRenderer(face); resize();
  renderer.draw({ ...current, motion: 0 }, 0, true);
  ready = true; canvas.classList.add("ready"); fallback.classList.add("hidden");
  requestAnimationFrame(tick);
  parent.postMessage({ type: "emilia:ready" }, location.origin);
} catch (error) {
  console.error("Avatar renderer:", error);
  parent.postMessage({ type: "emilia:error" }, location.origin);
  // The neutral art is already visible; asset/GPU failure cannot leave a blank stage.
}
