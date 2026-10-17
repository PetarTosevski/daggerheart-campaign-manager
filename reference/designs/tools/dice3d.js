// ---- 3D dice (Dice So Nice style): physics is simulated up front, the faces are relabelled so the
// face that lands on top shows the rolled value, then the recorded throw is played back.
const DICE3D = (() => {
  const LIB_T = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
  const LIB_C = 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
  let libs = null, R = null, audio = null;
  const load = () => { if (!libs) libs = Promise.all([import(LIB_T), import(LIB_C)]).then(([T, C]) => ({ T, C })); return libs; };
  const enabled = () => { try { return window.localStorage.getItem('dh.dice3d') !== 'off'; } catch (e) { return true; } };
  const setEnabled = (on) => { try { window.localStorage.setItem('dh.dice3d', on ? 'on' : 'off'); } catch (e) {} };
  const muted = () => { try { return window.localStorage.getItem('dh.dice3d.sound') === 'off'; } catch (e) { return false; } };
  const setMuted = (m) => { try { window.localStorage.setItem('dh.dice3d.sound', m ? 'off' : 'on'); } catch (e) {} };
  const THEMES = {
    hope: { bg: '#e9be55', bg2: '#b9861f', ink: '#3a2505', edge: '#7a5510', metal: 0.35, rough: 0.35 },
    fear: { bg: '#5a3797', bg2: '#2e1a5a', ink: '#f1e8ff', edge: '#1b0f38', metal: 0.2, rough: 0.4 },
    adv: { bg: '#3f8f6a', bg2: '#22573f', ink: '#f2fff7', edge: '#123826', metal: 0.1, rough: 0.5 },
    dis: { bg: '#a53a32', bg2: '#5f1d18', ink: '#fff1ec', edge: '#3a0f0b', metal: 0.1, rough: 0.5 },
    dmg: { bg: '#f3ead6', bg2: '#cdbb94', ink: '#7a1d1d', edge: '#7d6640', metal: 0.05, rough: 0.55 }
  };
  // ---- geometry: vertices for each die; faces are found as the hull's planes
  const PHI = (1 + Math.sqrt(5)) / 2;
  const VERTS = {
    4: [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]],
    6: [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z]))),
    8: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
    10: (() => { const a = 0.105573, v = [[0, 1, 0], [0, -1, 0]]; for (let k = 0; k < 10; k++) { const t = k * Math.PI / 5; v.push([Math.cos(t), k % 2 ? -a : a, Math.sin(t)]); } return v; })(),
    12: (() => { const v = []; [-1, 1].forEach((x) => [-1, 1].forEach((y) => [-1, 1].forEach((z) => v.push([x, y, z])))); const p = PHI, q = 1 / PHI; [-1, 1].forEach((s) => [-1, 1].forEach((t) => { v.push([0, s * q, t * p]); v.push([s * q, t * p, 0]); v.push([s * p, 0, t * q]); })); return v; })(),
    20: (() => { const v = []; [-1, 1].forEach((s) => [-1, 1].forEach((t) => { v.push([0, s, t * PHI]); v.push([s, t * PHI, 0]); v.push([t * PHI, 0, s]); })); return v; })()
  };
  const SIZE = { 4: 1.5, 6: 1.12, 8: 1.4, 10: 1.38, 12: 1.34, 20: 1.4 };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const SHAPES = {};
  const shape = (n) => {
    if (SHAPES[n]) return SHAPES[n];
    let V = VERTS[n]; const rMax = Math.max(...V.map((p) => Math.hypot(p[0], p[1], p[2])));
    V = V.map((p) => p.map((c) => c / rMax * SIZE[n]));
    const faces = []; const seen = new Set();
    for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) for (let k = j + 1; k < V.length; k++) {
      let nn = cross(sub(V[j], V[i]), sub(V[k], V[i])); if (Math.hypot(...nn) < 1e-6) continue; nn = norm(nn);
      let dd = dot(nn, V[i]); if (dd < 0) { nn = nn.map((c) => -c); dd = -dd; }
      if (V.some((p) => dot(nn, p) > dd + 1e-5)) continue;
      const on = V.map((p, idx) => [p, idx]).filter(([p]) => Math.abs(dot(nn, p) - dd) < 1e-5).map(([, idx]) => idx);
      const key = on.slice().sort((a, b) => a - b).join(','); if (seen.has(key)) continue; seen.add(key);
      const c = on.reduce((s, idx) => [s[0] + V[idx][0] / on.length, s[1] + V[idx][1] / on.length, s[2] + V[idx][2] / on.length], [0, 0, 0]);
      const u = norm(sub(V[on[0]], c)); const w = cross(nn, u);
      on.sort((a, b) => { const pa = sub(V[a], c), pb = sub(V[b], c); return Math.atan2(dot(pa, w), dot(pa, u)) - Math.atan2(dot(pb, w), dot(pb, u)); });
      faces.push({ idx: on, n: nn, c });
    }
    SHAPES[n] = { V, faces }; return SHAPES[n];
  };
  // ---- face textures
  const TEX = {};
  const faceCanvas = (theme, labels, poly, d4) => {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'); const th = THEMES[theme] || THEMES.dmg;
    const grd = g.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.7); grd.addColorStop(0, th.bg); grd.addColorStop(1, th.bg2); g.fillStyle = grd; g.fillRect(0, 0, S, S);
    g.beginPath(); poly.forEach(([x, y], i) => (i ? g.lineTo(x * S, y * S) : g.moveTo(x * S, y * S))); g.closePath(); g.lineWidth = S * 0.035; g.strokeStyle = th.edge; g.stroke();
    g.fillStyle = th.ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 4; g.shadowOffsetY = 2;
    if (d4) {
      poly.forEach(([x, y], i) => { const px = 0.5 + (x - 0.5) * 0.55, py = 0.5 + (y - 0.5) * 0.55; g.save(); g.translate(px * S, py * S); g.rotate(Math.atan2(y - 0.5, x - 0.5) + Math.PI / 2); g.font = '900 ' + Math.round(S * 0.24) + 'px Cinzel, Georgia, serif'; g.fillText(String(labels[i]), 0, 0); g.restore(); });
    } else {
      const t = String(labels); const fs = poly.length === 3 ? (t.length > 1 ? 0.3 : 0.38) : poly.length === 4 ? (t.length > 1 ? 0.34 : 0.48) : t.length > 1 ? 0.36 : 0.46;
      g.font = '900 ' + Math.round(S * fs) + 'px Cinzel, Georgia, serif'; const cy = poly.length === 3 ? 0.56 : 0.52; g.fillText(t, S / 2, S * cy);
      if (t === '6' || t === '9') { g.fillRect(S * 0.42, S * (cy + fs / 2 + 0.02), S * 0.16, S * 0.025); }
    }
    return cv;
  };
  // per face: 2D polygon in texture space (centred, upright-ish)
  const faceUV = (V, f) => {
    const u = norm(sub(V[f.idx[0]], f.c)); const w = cross(f.n, u);
    let pts = f.idx.map((i) => { const p = sub(V[i], f.c); return [-dot(p, w), dot(p, u)]; });
    const r = Math.max(...pts.map(([x, y]) => Math.hypot(x, y)));
    const off = f.idx.length === 3 ? 0.06 : 0; // triangles look better nudged down so the number sits at the centroid
    return pts.map(([x, y]) => [0.5 + x / r * 0.46, 0.5 - y / r * 0.46 + off]);
  };
  // ---- renderer
  const ensure = (T) => {
    if (R) return R;
    const cv = document.createElement('canvas'); cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;opacity:0;transition:opacity .45s';
    document.body.appendChild(cv);
    const renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.outputColorSpace = T.SRGBColorSpace;
    const scene = new T.Scene(); const cam = new T.PerspectiveCamera(30, 1, 1, 200);
    scene.add(new T.HemisphereLight(0xfff4e0, 0x2a2140, 1.1));
    const sun = new T.DirectionalLight(0xffffff, 2.2); sun.position.set(-8, 30, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 80 }); sun.shadow.bias = -0.0005; scene.add(sun);
    const rim = new T.PointLight(0xffd59a, 40, 60); rim.position.set(10, 12, -8); scene.add(rim);
    const floor = new T.Mesh(new T.PlaneGeometry(200, 200), new T.ShadowMaterial({ opacity: 0.32 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    R = { cv, renderer, scene, cam, meshes: [], raf: 0, timer: 0, bounds: null };
    const fit = () => { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.position.set(0, 36, 9); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
      const halfZ = Math.tan(cam.fov * Math.PI / 360) * 37; R.bounds = { x: halfZ * cam.aspect * 0.88, z: halfZ * 0.86 }; };
    fit(); window.addEventListener('resize', fit); R.fit = fit; return R;
  };
  const clear = () => { if (!R) return; cancelAnimationFrame(R.raf); clearTimeout(R.timer); R.meshes.forEach((m) => { R.scene.remove(m); m.geometry.dispose(); }); R.meshes = []; };
  const buildMesh = (T, n, theme, labels) => {
    const { V, faces } = shape(n); const pos = [], uv = [], nor = []; const geo = new T.BufferGeometry(); const mats = [];
    faces.forEach((f, fi) => {
      const p2 = faceUV(V, f); const start = pos.length / 3;
      for (let t = 1; t < f.idx.length - 1; t++) [0, t, t + 1].forEach((k) => { pos.push(...V[f.idx[k]]); nor.push(...f.n); uv.push(p2[k][0], 1 - p2[k][1]); });
      geo.addGroup(start, (f.idx.length - 2) * 3, fi);
      const lab = n === 4 ? f.idx.map((vi) => labels[vi]) : labels[fi]; const key = n + '|' + theme + '|' + (Array.isArray(lab) ? lab.join('.') : lab);
      if (!TEX[key]) { const tx = new T.CanvasTexture(faceCanvas(theme, lab, p2, n === 4)); tx.colorSpace = T.SRGBColorSpace; tx.anisotropy = 4; TEX[key] = tx; }
      const th = THEMES[theme] || THEMES.dmg; mats.push(new T.MeshStandardMaterial({ map: TEX[key], metalness: th.metal, roughness: th.rough }));
    });
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    const m = new T.Mesh(geo, mats); m.castShadow = true; return m;
  };
  // ---- sound: short filtered clacks, louder for harder hits
  const clack = (v, n) => {
    if (muted()) return; try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); const a = audio; if (a.state === 'suspended') a.resume();
      const len = 0.05, buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 6);
      const src = a.createBufferSource(); src.buffer = buf; const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = (n >= 12 ? 2600 : 3400) + Math.random() * 900; bp.Q.value = 3;
      const gn = a.createGain(); gn.gain.value = Math.min(0.5, 0.05 + v * 0.03); src.connect(bp).connect(gn).connect(a.destination); src.start(); } catch (e) {}
  };
  // ---- simulate: returns frames[dieIndex][frame] = [x,y,z,qx,qy,qz,qw] plus impact sounds
  const simulate = (C, list, B) => {
    const world = new C.World({ gravity: new C.Vec3(0, -40, 0) }); world.allowSleep = true; world.broadphase = new C.NaiveBroadphase();
    const dm = new C.Material('d'), fm = new C.Material('f');
    world.addContactMaterial(new C.ContactMaterial(dm, fm, { friction: 0.12, restitution: 0.42 }));
    world.addContactMaterial(new C.ContactMaterial(dm, dm, { friction: 0.05, restitution: 0.5 }));
    const plane = (pos, rotAxis, ang) => { const b = new C.Body({ mass: 0, material: fm, shape: new C.Plane() }); b.position.set(...pos); if (rotAxis) b.quaternion.setFromAxisAngle(new C.Vec3(...rotAxis), ang); world.addBody(b); };
    plane([0, 0, 0], [1, 0, 0], -Math.PI / 2); plane([-B.x, 0, 0], [0, 1, 0], Math.PI / 2); plane([B.x, 0, 0], [0, 1, 0], -Math.PI / 2); plane([0, 0, -B.z], null, 0); plane([0, 0, B.z], [0, 1, 0], Math.PI);
    const side = Math.random() < 0.5 ? -1 : 1; const sounds = [];
    const bodies = list.map((it, i) => {
      const { V, faces } = shape(it.sides);
      const sh = new C.ConvexPolyhedron({ vertices: V.map((p) => new C.Vec3(...p)), faces: faces.map((f) => f.idx.slice()) });
      const b = new C.Body({ mass: 1, material: dm, shape: sh, linearDamping: 0.12, angularDamping: 0.12, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.3 });
      const row = Math.floor(i / 5), col = i % 5;
      b.position.set(side * (B.x * 0.85 - row * 1.6), 3 + Math.random() * 2 + col * 0.4, B.z * (0.55 - col * 0.3) + Math.random() * 0.6);
      b.velocity.set(-side * (18 + Math.random() * 10), 2 + Math.random() * 4, -(4 + Math.random() * 8) * (Math.random() < 0.5 ? 1 : -1));
      b.angularVelocity.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
      b.quaternion.setFromEuler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      b.addEventListener('collide', (e) => { const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); if (v > 2) sounds.push([b._f || 0, v, it.sides, i]); });
      world.addBody(b); return b;
    });
    const frames = list.map(() => []); let f = 0;
    for (; f < 60 * 7; f++) {
      bodies.forEach((b) => { b._f = f; }); world.step(1 / 60);
      bodies.forEach((b, i) => frames[i].push([b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]));
      if (f > 30 && bodies.every((b) => b.sleepState === C.Body.SLEEPING || (b.velocity.length() < 0.05 && b.angularVelocity.length() < 0.05))) break;
    }
    // keep at most one clack per die every few frames
    const last = {}; const snd = sounds.filter(([fr, , , di]) => { const kk = Math.floor(fr / 4) + ':' + di; if (last[kk]) return false; last[kk] = 1; return true; });
    return { frames, sounds: snd, end: f };
  };
  // which face (or d4 vertex) points up for a final quaternion
  const topIndex = (T, n, q) => {
    const { V, faces } = shape(n); const Q = new T.Quaternion(q[3], q[4], q[5], q[6]);
    if (n === 4) { let best = 0, by = -1e9; V.forEach((p, i) => { const y = new T.Vector3(...p).applyQuaternion(Q).y; if (y > by) { by = y; best = i; } }); return best; }
    let best = 0, by = -1e9; faces.forEach((f, i) => { const y = new T.Vector3(...f.n).applyQuaternion(Q).y; if (y > by) { by = y; best = i; } }); return best;
  };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // list: [{ sides, value, theme }], onLanded called once the dice settle (or immediately if 3D is unavailable)
  const roll = (list, onLanded) => {
    let fired = false; const land = () => { if (!fired) { fired = true; try { onLanded && onLanded(); } catch (e) {} } };
    const ok = (list || []).filter((it) => VERTS[it.sides] && it.value >= 1 && it.value <= it.sides);
    if (!enabled() || !ok.length || typeof window === 'undefined' || !window.WebGLRenderingContext) { land(); return Promise.resolve(false); }
    const safety = setTimeout(land, 9000);
    return load().then(({ T, C }) => {
      const r = ensure(T); clear(); r.fit();
      const sim = simulate(C, ok, r.bounds);
      ok.forEach((it, i) => {
        const n = it.sides; const count = n === 4 ? 4 : shape(n).faces.length;
        const labels = shuffle(Array.from({ length: count }, (_, k) => k + 1));
        const top = topIndex(T, n, sim.frames[i][sim.frames[i].length - 1]);
        const j = labels.indexOf(it.value); [labels[top], labels[j]] = [labels[j], labels[top]];
        const m = buildMesh(T, n, it.theme || 'dmg', labels); r.scene.add(m); r.meshes.push(m);
      });
      r.cv.style.transition = 'none'; r.cv.style.opacity = '1';
      const t0 = performance.now(); let si = 0; const sounds = sim.sounds.sort((a, b) => a[0] - b[0]);
      const tick = () => {
        const fr = Math.min(sim.end, Math.floor((performance.now() - t0) / (1000 / 60)));
        r.meshes.forEach((m, i) => { const F = sim.frames[i][Math.min(fr, sim.frames[i].length - 1)]; m.position.set(F[0], F[1], F[2]); m.quaternion.set(F[3], F[4], F[5], F[6]); });
        while (si < sounds.length && sounds[si][0] <= fr) { clack(sounds[si][1], sounds[si][2]); si++; }
        r.renderer.render(r.scene, r.cam);
        if (fr < sim.end) { r.raf = requestAnimationFrame(tick); return; }
        clearTimeout(safety); land();
        r.timer = setTimeout(() => { r.cv.style.transition = 'opacity .5s'; r.cv.style.opacity = '0'; r.timer = setTimeout(clear, 550); }, 2200);
      };
      r.raf = requestAnimationFrame(tick); return true;
    }).catch(() => { clearTimeout(safety); land(); return false; });
  };
  return { roll, enabled, setEnabled, muted, setMuted, preload: () => { if (enabled()) load().catch(() => {}); } };
})();
