'use client';

/* ============================================================
   OpticsLab — Client-side Three.js Component
   ============================================================
   Handles:
   - Three.js scene, renderer, camera, controls
   - Component mesh builders (visual only)
   - UI controls and inspector
   - API calls to /api/trace for ray computation
   - Rendering returned trace segments as line geometry
   ============================================================ */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  MEDIA, wavelengthToRGB,
  rayCountFromSlider, sliderFromRayCount, formatRayCount,
  MODEL_NOTES, HARD_RAY_CAP, SCREEN_RES,
} from '@/lib/constants.js';

export default function OpticsLab() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    initOpticsLab();
  }, []);

  return (
    <>
      <canvas id="c"></canvas>

      <div id="panel">
        <h1>3D <span>Optics</span> Lab</h1>

        <h2>Light Source</h2>
        <div className="row"><label>Representation</label>
          <select id="lightModel" defaultValue="beam">
            <option value="ray">Ray (geometric)</option>
            <option value="beam">Beam (collimated)</option>
            <option value="wave">Wave (E-field)</option>
            <option value="plane">Plane wave</option>
            <option value="spherical">Spherical wave</option>
            <option value="gaussian">Gaussian beam</option>
            <option value="torch">🔦 Real-world torch (volumetric)</option>
          </select>
        </div>
        <div className="note" id="modelNote">Parallel rays — width controlled by beam radius &amp; ray count.</div>

        <div className="row"><label>Type</label>
          <select id="srcType">
            <option value="white">White light (broadband)</option>
            <option value="650">Red laser · 650 nm</option>
            <option value="532">Green laser · 532 nm</option>
            <option value="473">Blue laser · 473 nm</option>
            <option value="405">Violet laser · 405 nm</option>
          </select>
        </div>
        <div className="row"><label>Polarization</label>
          <select id="srcPol">
            <option value="unpol">Unpolarized</option>
            <option value="lin">Linear</option>
          </select>
        </div>
        <div className="row"><label>Brightness</label><input type="range" id="srcIntensity" min="0.05" max="5" step="0.05"
          defaultValue="1" /><span className="val" id="vIntensity">1.0×</span></div>
        <div className="row"><label>Beam radius</label><input type="range" id="srcRadius" min="0" max="1.2" step="0.02"
          defaultValue="0.35" /><span className="val" id="vRadius">0.35</span></div>
        <div className="row"><label>Ray count</label><input type="range" id="srcRays" min="0" max="800" step="1"
          defaultValue="70" /><span className="val" id="vRays">5</span></div>
        <div className="row"><label>Beam angle</label><input type="range" id="srcSpread" min="0" max="40" step="1"
          defaultValue="0" /><span className="val" id="vSpread">0°</span></div>
        <div className="note" id="rayNote">Log scale: 1 ray → 100,000,000 rays</div>

        <h2>Add Component</h2>
        <div className="grid">
          <button data-add="mirror">Mirror</button>
          <button data-add="curvedmirror">Concave mirror</button>
          <button data-add="beamsplitter">Beam splitter</button>
          <button data-add="polarizer">Polarizer</button>
          <button data-add="halfwave">½-wave plate</button>
          <button data-add="quarterwave">¼-wave plate</button>
          <button data-add="lens">Lens</button>
          <button data-add="prism">Prism</button>
          <button data-add="block">Glass block</button>
          <button data-add="filter">Color filter</button>
          <button data-add="screen">Screen</button>
          <button data-add="detector">Detector</button>
        </div>

        <h2>Environment</h2>
        <div className="row"><label>Ambient medium</label>
          <select id="ambient"></select>
        </div>

        <h2>Selected Object</h2>
        <div id="inspector">
          <div className="hint">Click an object in the scene to edit it. Drag to move. Shift+drag to raise/lower. Delete key
            removes it.</div>
        </div>
      </div>

      <div id="monitors"></div>

      <div id="hud">
        <div><b id="hudSegs">0</b> ray segments</div>
        <div>Drag = orbit · Scroll = zoom · Right-drag = pan</div>
      </div>

      <div id="traceLoading" className="trace-loading" style={{ display: 'none' }}>
        <div className="spinner"></div>
        <span>Tracing rays…</span>
      </div>
    </>
  );
}


/* ============================================================
   MAIN INITIALIZATION (runs once on mount)
   ============================================================ */
function initOpticsLab() {

  /* ============================================================
     0. SCENE / RENDERER
     ============================================================ */
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.Fog(0x150e2e, 30, 60);

  const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 500);
  camera.position.set(8, 7.5, 11);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2, 0.5);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 3;
  controls.maxDistance = 45;

  scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x0a0618, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(8, 14, 6); scene.add(key);
  const fill = new THREE.DirectionalLight(0x8a6fff, 0.75); fill.position.set(-10, 6, -8); scene.add(fill);

  const grid = new THREE.GridHelper(40, 40, 0x3b2f6a, 0x1c1540);
  grid.position.y = 0;
  scene.add(grid);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x0e0a24, roughness: 0.9, metalness: 0.1 })
  );
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; scene.add(floor);

  /* ============================================================
     1. HELPERS
     ============================================================ */
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  /* ============================================================
     2. COMPONENT BUILDERS (visual meshes only)
     ============================================================ */
  const components = [];
  let nextId = 1;
  let selected = null;

  function clearGroup(g) {
    while (g.children.length) {
      const c = g.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) { Array.isArray(c.material) ? c.material.forEach(m => m.dispose()) : c.material.dispose(); }
    }
  }

  function plateMesh(w, h, color, o = {}) {
    const geo = new THREE.BoxGeometry(w, h, o.thickness ?? 0.06);
    const mat = new THREE.MeshStandardMaterial({
      color, metalness: o.metalness ?? 0.15, roughness: o.roughness ?? 0.25,
      transparent: !!o.transparent, opacity: o.opacity ?? 1,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: 0.6
    });
    return new THREE.Mesh(geo, mat);
  }

  function buildMirror(comp) {
    clearGroup(comp.group);
    const w = 2.0, h = 2.0;
    const m = plateMesh(w, h, 0xd8e8ff, { metalness: 1, roughness: 0.04, thickness: 0.08 });
    m.position.z = 0.04; comp.group.add(m);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.6, metalness: 0.4 }));
    frame.position.z = -0.02; comp.group.add(frame);
  }

  function buildCurvedMirror(comp) {
    clearGroup(comp.group);
    const A = comp.params.aperture, R = comp.params.curvature;
    const thMax = Math.asin(clamp(A / R, 0, 1));
    const geo = new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, 0, thMax);
    geo.rotateX(-Math.PI / 2); geo.translate(0, 0, R);
    comp.group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xd8e8ff, metalness: 1, roughness: 0.05, side: THREE.DoubleSide
    })));
  }

  function buildBeamsplitter(comp) {
    clearGroup(comp.group);
    const w = 1.8, h = 1.8;
    const m = plateMesh(w, h, 0x8fe6ff, { metalness: 0.05, roughness: 0.02, transparent: true, opacity: 0.28, thickness: 0.05, emissive: 0x0a3a4a });
    m.position.z = 0.025; comp.group.add(m);
    comp.group.add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x22334d, roughness: 0.7 })));
  }

  function buildAxisPlate(comp, color, opacity) {
    clearGroup(comp.group);
    const w = 1.8, h = 1.8;
    const m = plateMesh(w, h, color, { metalness: 0.05, roughness: 0.35, transparent: true, opacity, thickness: 0.04 });
    comp.group.add(m);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x22334d, roughness: 0.7 }));
    fr.position.z = -0.03; comp.group.add(fr);
    const ang = comp.params.angle * Math.PI / 180;
    const L = w * 0.44;
    comp.group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        V(-Math.cos(ang) * L, -Math.sin(ang) * L, 0.05),
        V(Math.cos(ang) * L, Math.sin(ang) * L, 0.05)]),
      new THREE.LineBasicMaterial({ color: 0xffd166 })));
  }

  function buildPolarizer(comp) { buildAxisPlate(comp, 0x4a5a80, 0.45); }
  function buildHalfWave(comp) { buildAxisPlate(comp, 0x5a4a80, 0.42); }
  function buildQuarterWave(comp) { buildAxisPlate(comp, 0x4a805a, 0.42); }

  function buildLens(comp) {
    clearGroup(comp.group);
    const A = comp.params.aperture, R = comp.params.curvature;
    const t = 2 * (R - Math.sqrt(R * R - A * A));
    const zc1 = -t / 2 + R, zc2 = t / 2 - R;
    const pts = [];
    const N = 26;
    for (let i = 0; i <= N; i++) { const r = A * i / N; pts.push(new THREE.Vector2(r, zc1 - Math.sqrt(R * R - r * r))); }
    for (let i = N; i >= 0; i--) { const r = A * i / N; pts.push(new THREE.Vector2(r, zc2 + Math.sqrt(R * R - r * r))); }
    const geo = new THREE.LatheGeometry(pts, 56); geo.rotateX(Math.PI / 2);
    comp.group.add(new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
      color: 0xbfe4ff, metalness: 0, roughness: 0.04,
      transparent: true, opacity: 0.30, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.05
    })));
  }

  function buildPrism(comp) {
    clearGroup(comp.group);
    const side = 2.0, height = 2.0, Rt = side / Math.sqrt(3);
    const geo = new THREE.CylinderGeometry(Rt, Rt, height, 3, 1);
    comp.group.add(new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
      color: 0xcfe8ff, metalness: 0, roughness: 0.03,
      transparent: true, opacity: 0.28, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.04
    })));
  }

  function buildBlock(comp) {
    clearGroup(comp.group);
    const s = comp.params.size;
    comp.group.add(new THREE.Mesh(new THREE.BoxGeometry(s, s, s),
      new THREE.MeshPhysicalMaterial({
        color: 0xcfe8ff, metalness: 0, roughness: 0.05,
        transparent: true, opacity: 0.22, side: THREE.DoubleSide, clearcoat: 1
      })));
  }

  function buildFilter(comp) {
    clearGroup(comp.group);
    const w = 1.8, h = 1.8;
    const col = { red: 0xff4444, green: 0x44ff77, blue: 0x4488ff }[comp.params.color];
    comp.group.add(plateMesh(w, h, col, { transparent: true, opacity: 0.35, roughness: 0.15, thickness: 0.06, emissive: col }));
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x22334d, roughness: 0.7 }));
    fr.position.z = -0.04; comp.group.add(fr);
  }

  function initScreenAccum(comp) {
    comp.accum = new Float32Array(SCREEN_RES * SCREEN_RES * 3);
    comp.accumSize = SCREEN_RES;
    comp.hitCount = 0; comp.totalPower = 0; comp.peak = 0; comp.illuminatedPixels = 0;
  }

  function makeScreenCanvas(bgCol, isGrid) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = SCREEN_RES;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = bgCol;
    ctx.fillRect(0, 0, SCREEN_RES, SCREEN_RES);
    if (isGrid) {
      ctx.strokeStyle = '#151238'; ctx.lineWidth = 1;
      const step = SCREEN_RES / 8;
      for (let i = 0; i <= 8; i++) {
        const p = Math.round(i * step) + 0.5;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, SCREEN_RES); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(SCREEN_RES, p); ctx.stroke();
      }
    }
    return { canvas: cv, ctx };
  }

  function buildScreen(comp) {
    clearGroup(comp.group);
    const w = 2.4, h = 2.4;
    const { canvas: cv, ctx } = makeScreenCanvas('#050810', false);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    comp.screenCanvas = cv; comp.screenCtx = ctx; comp.screenTex = tex;
    initScreenAccum(comp);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }));
    m.position.z = 0.016; comp.group.add(m);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x1a2436, roughness: 0.6, metalness: 0.35 }));
    fr.position.z = -0.016; comp.group.add(fr);
    const markMat = new THREE.MeshBasicMaterial({ color: 0x3a5570 });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.055), markMat);
      c.position.set(sx * (w / 2 - 0.04), sy * (h / 2 - 0.04), 0);
      comp.group.add(c);
    }
  }

  function buildDetector(comp) {
    clearGroup(comp.group);
    const w = 2.0, h = 2.0;
    const { canvas: cv, ctx } = makeScreenCanvas('#050810', true);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    comp.screenCanvas = cv; comp.screenCtx = ctx; comp.screenTex = tex;
    initScreenAccum(comp);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }));
    m.position.z = 0.016; comp.group.add(m);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.18, h + 0.18, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x22303f, roughness: 0.5, metalness: 0.6 }));
    fr.position.z = -0.02; comp.group.add(fr);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x33ff88 }));
    led.position.set(w / 2 - 0.14, -h / 2 - 0.09, 0.045);
    comp.group.add(led);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.98, h * 0.98),
      new THREE.MeshBasicMaterial({ color: 0x0a3a4a, transparent: true, opacity: 0.15 }));
    inner.position.z = 0.014; comp.group.add(inner);
  }

  const COMPONENT_TYPES = {
    mirror: {
      label: 'Mirror', build: buildMirror,
      defaults: { reflectivity: 0.95 },
      defs: [{ key: 'reflectivity', label: 'Reflectivity', type: 'range', min: 0.05, max: 1, step: 0.01 }]
    },
    curvedmirror: {
      label: 'Concave mirror', build: buildCurvedMirror,
      defaults: { aperture: 0.85, curvature: 2.6, reflectivity: 0.95 },
      defs: [
        { key: 'aperture', label: 'Aperture', type: 'range', min: 0.2, max: 1.6, step: 0.05 },
        { key: 'curvature', label: 'Curvature R', type: 'range', min: 1.2, max: 6, step: 0.1 },
        { key: 'reflectivity', label: 'Reflectivity', type: 'range', min: 0.05, max: 1, step: 0.01 }]
    },
    beamsplitter: {
      label: 'Beam splitter', build: buildBeamsplitter,
      defaults: { reflectivity: 0.5 },
      defs: [{ key: 'reflectivity', label: 'Reflectance', type: 'range', min: 0, max: 1, step: 0.01 }]
    },
    polarizer: {
      label: 'Polarizer', build: buildPolarizer,
      defaults: { angle: 0 },
      defs: [{ key: 'angle', label: 'Axis angle', type: 'range', min: 0, max: 180, step: 5, unit: '°' }]
    },
    halfwave: {
      label: 'Half-wave plate', build: buildHalfWave,
      defaults: { angle: 0 },
      defs: [{ key: 'angle', label: 'Fast axis', type: 'range', min: 0, max: 180, step: 5, unit: '°' }]
    },
    quarterwave: {
      label: 'Quarter-wave plate', build: buildQuarterWave,
      defaults: { angle: 0 },
      defs: [{ key: 'angle', label: 'Fast axis', type: 'range', min: 0, max: 180, step: 5, unit: '°' }]
    },
    lens: {
      label: 'Lens', build: buildLens,
      defaults: { aperture: 0.7, curvature: 2.5, material: 'glass' },
      defs: [
        { key: 'aperture', label: 'Aperture', type: 'range', min: 0.25, max: 1.3, step: 0.05 },
        { key: 'curvature', label: 'Curvature R', type: 'range', min: 1.2, max: 6, step: 0.1 },
        { key: 'material', label: 'Material', type: 'material' }]
    },
    prism: {
      label: 'Prism', build: buildPrism,
      defaults: { material: 'flint' },
      defs: [{ key: 'material', label: 'Material', type: 'material' }]
    },
    block: {
      label: 'Glass block', build: buildBlock,
      defaults: { size: 1.6, material: 'glass' },
      defs: [
        { key: 'size', label: 'Size', type: 'range', min: 0.6, max: 3, step: 0.1 },
        { key: 'material', label: 'Material', type: 'material' }]
    },
    filter: {
      label: 'Color filter', build: buildFilter,
      defaults: { color: 'red' },
      defs: [{
        key: 'color', label: 'Passes', type: 'select',
        options: [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue']]
      }]
    },
    screen: {
      label: 'Screen', build: buildScreen,
      defaults: { gain: 1.0 },
      defs: [{ key: 'gain', label: 'Gain', type: 'range', min: 0.1, max: 8, step: 0.1 }]
    },
    detector: {
      label: 'Detector', build: buildDetector,
      defaults: { gain: 1.0 },
      defs: [{ key: 'gain', label: 'Gain', type: 'range', min: 0.1, max: 8, step: 0.1 }]
    }
  };

  function addComponent(type, pos, rotY) {
    const def = COMPONENT_TYPES[type];
    const comp = {
      id: nextId++, type, label: def.label,
      group: new THREE.Group(),
      params: Object.assign({}, def.defaults),
      material: MEDIA[def.defaults.material || 'glass'],
      defs: def.defs || []
    };
    if (pos) comp.group.position.copy(pos);
    if (rotY !== undefined) comp.group.rotation.y = rotY;
    comp.group.userData.comp = comp;
    scene.add(comp.group);
    components.push(comp);
    def.build(comp);
    if (type === 'screen' || type === 'detector') createMonitor(comp);
    return comp;
  }

  function rebuild(comp) {
    const def = COMPONENT_TYPES[comp.type];
    comp.material = MEDIA[comp.params.material || 'glass'];
    def.build(comp);
    scheduleTrace();
  }

  /* ============================================================
     3. SIDE MONITOR POPUPS
     ============================================================ */
  const monitorsEl = document.getElementById('monitors');

  function createMonitor(comp) {
    const panel = document.createElement('div');
    panel.className = 'monitor' + (comp.type === 'detector' ? ' detector-monitor' : '');
    const header = document.createElement('div');
    header.className = 'monitor-header';
    const dot = document.createElement('span'); dot.className = 'monitor-dot';
    header.appendChild(dot);
    const title = document.createElement('span');
    title.className = 'monitor-title';
    title.textContent = (comp.type === 'detector' ? 'DETECTOR' : 'SCREEN') + ' #' + comp.id;
    header.appendChild(title);
    const close = document.createElement('button');
    close.className = 'monitor-close'; close.textContent = '×';
    close.title = 'Hide this view';
    close.addEventListener('click', () => {
      panel.style.display = 'none';
      comp.monitorHidden = true;
      refreshInspector();
    });
    header.appendChild(close);
    panel.appendChild(header);

    const cv = document.createElement('canvas');
    cv.width = SCREEN_RES; cv.height = SCREEN_RES;
    cv.className = 'monitor-canvas';
    panel.appendChild(cv);

    const ro = document.createElement('div');
    ro.className = 'monitor-readout';
    ro.innerHTML =
      '<div><span>Rays</span><b>0</b></div>' +
      '<div><span>Pwr</span><b>0.000</b></div>' +
      '<div><span>Peak</span><b>0.000</b></div>' +
      '<div><span>Lit</span><b>—</b></div>';
    panel.appendChild(ro);

    monitorsEl.appendChild(panel);
    comp.monitorEl = panel; comp.monitorCanvas = cv;
    comp.monitorCtx = cv.getContext('2d');
    comp.monitorReadout = ro; comp.monitorHidden = false;
    comp.monitorCtx.fillStyle = '#050810';
    comp.monitorCtx.fillRect(0, 0, SCREEN_RES, SCREEN_RES);
  }

  function removeMonitor(comp) {
    if (comp.monitorEl) {
      comp.monitorEl.remove();
      comp.monitorEl = null; comp.monitorCanvas = null;
      comp.monitorCtx = null; comp.monitorReadout = null;
    }
  }

  /* ============================================================
     4. LIGHT SOURCE (visual only)
     ============================================================ */
  const sourceGroup = new THREE.Group();
  sourceGroup.position.set(0, 2, -5.5);
  scene.add(sourceGroup);

  const srcBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.28, 0.85, 24),
    new THREE.MeshStandardMaterial({ color: 0x2a3a58, metalness: 0.85, roughness: 0.25 }));
  srcBody.rotation.x = Math.PI / 2; sourceGroup.add(srcBody);

  const srcLens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.24, 0.07, 24),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.4 }));
  srcLens.rotation.x = Math.PI / 2; srcLens.position.z = 0.43; sourceGroup.add(srcLens);

  const aim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 1.6, 8),
    new THREE.MeshBasicMaterial({ color: 0x2f4a70, transparent: true, opacity: 0.6 }));
  aim.rotation.x = Math.PI / 2; aim.position.z = 1.1; sourceGroup.add(aim);

  /* Torch glow sprite */
  const torchGlowCanvas = document.createElement('canvas');
  torchGlowCanvas.width = torchGlowCanvas.height = 128;
  (function () {
    const gctx = torchGlowCanvas.getContext('2d');
    const grad = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.20, 'rgba(255,244,220,0.85)');
    grad.addColorStop(0.45, 'rgba(255,225,175,0.35)');
    grad.addColorStop(0.75, 'rgba(255,200,130,0.09)');
    grad.addColorStop(1, 'rgba(255,180,100,0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 128, 128);
  })();
  const torchGlowTex = new THREE.CanvasTexture(torchGlowCanvas);
  torchGlowTex.colorSpace = THREE.SRGBColorSpace;
  const torchGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: torchGlowTex, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, toneMapped: false
  }));
  torchGlow.scale.set(1.8, 1.8, 1);
  torchGlow.position.z = 0.5;
  torchGlow.visible = false;
  sourceGroup.add(torchGlow);

  const torchLight = new THREE.PointLight(0xffe9c8, 0, 8, 2);
  torchLight.position.z = 0.6;
  sourceGroup.add(torchLight);

  /* Source state */
  const sourceState = {
    type: 'white', pol: 'unpol', radius: 0.35, rays: 5, spread: 0, intensity: 1.0,
    get group() { return sourceGroup; }
  };
  sourceGroup.userData.comp = sourceState;
  sourceState.label = 'Light source';
  sourceState.defs = []; sourceState.params = {};

  /* Representation state */
  let lightModel = 'beam';

  function updateSourceVisual() {
    const isTorch = (lightModel === 'torch');
    srcBody.visible = true;
    srcLens.visible = true;
    aim.visible = !isTorch;
    torchGlow.visible = isTorch;

    if (isTorch) {
      const k = sourceState.intensity;
      srcLens.material.emissiveIntensity = 1.6 + k * 0.6;
      srcLens.scale.set(1.0 + k * 0.10, 1.0 + k * 0.10, 1.0);
      torchGlow.scale.setScalar(1.6 + k * 0.55);
      torchGlow.material.opacity = clamp(0.55 + k * 0.12, 0.4, 1.0);
      torchLight.intensity = k * 2.4;
      torchLight.distance = 7 + k * 3;
    } else {
      srcLens.material.emissiveIntensity = 1.4;
      srcLens.scale.set(1, 1, 1);
      torchLight.intensity = 0;
    }
  }

  /* ============================================================
     5. RAY VISUALIZATION (line segments + point cloud)
     ============================================================ */
  const MAX_VIS_SEGS = 3000000;
  const MAX_POINTS = 3000000;

  let segPositions, segColors, segGeo, segLines, segCount = 0;

  (function initSegBuffers() {
    segPositions = new Float32Array(MAX_VIS_SEGS * 6);
    segColors = new Float32Array(MAX_VIS_SEGS * 6);
    segGeo = new THREE.BufferGeometry();
    segGeo.setAttribute('position', new THREE.BufferAttribute(segPositions, 3));
    segGeo.setAttribute('color', new THREE.BufferAttribute(segColors, 3));
    segGeo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    segLines = new THREE.LineSegments(segGeo, mat);
    segLines.frustumCulled = false;
    scene.add(segLines);
  })();

  /* Point cloud buffer (torch mode) */
  let ptPositions, ptColors, ptGeo, ptPoints, ptCount = 0;

  (function initPointBuffers() {
    ptPositions = new Float32Array(MAX_POINTS * 3);
    ptColors = new Float32Array(MAX_POINTS * 3);
    ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPositions, 3));
    ptGeo.setAttribute('color', new THREE.BufferAttribute(ptColors, 3));
    ptGeo.setDrawRange(0, 0);

    const c2 = document.createElement('canvas');
    c2.width = c2.height = 64;
    const ctx2 = c2.getContext('2d');
    const g = ctx2.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.72)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.22)');
    g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx2.fillStyle = g;
    ctx2.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c2);
    tex.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.PointsMaterial({
      size: 0.24, map: tex, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
      sizeAttenuation: true, toneMapped: false,
    });
    ptPoints = new THREE.Points(ptGeo, mat);
    ptPoints.frustumCulled = false;
    ptPoints.visible = false;
    scene.add(ptPoints);
  })();

  let traceSegments = [];

  function addLineF(ax, ay, az, bx, by, bz, r, g, b) {
    if (segCount >= MAX_VIS_SEGS) return;
    const i6 = segCount * 6;
    segPositions[i6] = ax; segPositions[i6 + 1] = ay; segPositions[i6 + 2] = az;
    segPositions[i6 + 3] = bx; segPositions[i6 + 4] = by; segPositions[i6 + 5] = bz;
    segColors[i6] = r; segColors[i6 + 1] = g; segColors[i6 + 2] = b;
    segColors[i6 + 3] = r; segColors[i6 + 4] = g; segColors[i6 + 5] = b;
    segCount++;
  }

  const SRC_POS = new THREE.Vector3();

  function drawTraceSegment(t, time) {
    const I = t.I;
    if (I < 0.003) return;

    let bright = Math.pow(I, 0.75);

    if (lightModel === 'gaussian') {
      const w = Math.max(0.05, sourceState.radius);
      const g = Math.exp(-(t.r0 * t.r0) / (w * w));
      bright *= Math.pow(g, 0.4);
    }

    const col = wavelengthToRGB(t.wl);
    const r = col[0] * bright, g = col[1] * bright, b = col[2] * bright;
    if (r + g + b < 0.005) return;

    const dxs = t.bx - t.ax, dys = t.by - t.ay, dzs = t.bz - t.az;
    const len = Math.hypot(dxs, dys, dzs);
    if (len < 1e-6) return;

    if (lightModel === 'ray' || lightModel === 'beam' || lightModel === 'gaussian') {
      addLineF(t.ax, t.ay, t.az, t.bx, t.by, t.bz, r, g, b);
      return;
    }

    const visWl = Math.max(0.20, 0.42 * (t.wl / 550));

    if (lightModel === 'wave') {
      const amp = Math.min(0.075, visWl * 0.30);
      const nCycles = len / visWl;
      const samples = Math.max(3, Math.min(90, Math.ceil(nCycles * 5)));
      const phase0 = time * 4.0;
      const kPerLen = (Math.PI * 2) / visWl;

      let prevX = t.ax + t.sx * Math.sin(phase0) * amp;
      let prevY = t.ay + t.sy * Math.sin(phase0) * amp;
      let prevZ = t.az + t.sz * Math.sin(phase0) * amp;

      for (let i = 1; i <= samples; i++) {
        if (segCount >= MAX_VIS_SEGS - 4) return;
        const tt = i / samples;
        const off = Math.sin(phase0 + (tt * len) * kPerLen) * amp;
        const px = t.ax + dxs * tt + t.sx * off;
        const py = t.ay + dys * tt + t.sy * off;
        const pz = t.az + dzs * tt + t.sz * off;
        addLineF(prevX, prevY, prevZ, px, py, pz, r, g, b);
        prevX = px; prevY = py; prevZ = pz;
      }
      return;
    }

    // plane / spherical
    addLineF(t.ax, t.ay, t.az, t.bx, t.by, t.bz, r, g, b);
    const tickHalf = lightModel === 'spherical' ? 0.14 : 0.11;
    const nTicks = Math.max(0, Math.min(40, Math.floor(len / visWl)));
    for (let i = 1; i <= nTicks; i++) {
      if (segCount >= MAX_VIS_SEGS - 4) return;
      const tt = (i - 0.5) / nTicks;
      const cx = t.ax + dxs * tt, cy = t.ay + dys * tt, cz = t.az + dzs * tt;
      addLineF(
        cx + t.sx * tickHalf, cy + t.sy * tickHalf, cz + t.sz * tickHalf,
        cx - t.sx * tickHalf, cy - t.sy * tickHalf, cz - t.sz * tickHalf,
        r, g, b);
    }
  }

  function sampleSegmentToPoints(t) {
    const I = t.I;
    if (I < 0.004) return;

    const dxs = t.bx - t.ax, dys = t.by - t.ay, dzs = t.bz - t.az;
    const len = Math.hypot(dxs, dys, dzs);
    if (len < 0.001) return;

    const col = wavelengthToRGB(t.wl);
    const baseBright = Math.pow(I, 0.85);

    const spacing = 0.22;
    const N = Math.min(50, Math.max(3, Math.ceil(len / spacing)));

    for (let i = 0; i <= N; i++) {
      if (ptCount >= MAX_POINTS - 4) return;
      const tt = i / N;
      const x = t.ax + dxs * tt;
      const y = t.ay + dys * tt;
      const z = t.az + dzs * tt;

      const dSrc = Math.hypot(x - SRC_POS.x, y - SRC_POS.y, z - SRC_POS.z);
      const fall = 1.0 / (1.0 + dSrc * dSrc * 0.018);

      const b = baseBright * fall * 0.22;
      if (b < 0.0035) continue;

      const i3 = ptCount * 3;
      ptPositions[i3] = x;
      ptPositions[i3 + 1] = y;
      ptPositions[i3 + 2] = z;
      ptColors[i3] = col[0] * b;
      ptColors[i3 + 1] = col[1] * b;
      ptColors[i3 + 2] = col[2] * b;
      ptCount++;
    }
  }

  function renderVisuals(time) {
    segCount = 0;
    ptCount = 0;

    scene.updateMatrixWorld(true);
    SRC_POS.setFromMatrixPosition(sourceGroup.matrixWorld);

    if (lightModel === 'torch') {
      ptPoints.visible = true;
      for (let k = 0; k < traceSegments.length; k++) {
        if (ptCount >= MAX_POINTS - 200) break;
        sampleSegmentToPoints(traceSegments[k]);
      }
      ptGeo.attributes.position.needsUpdate = true;
      ptGeo.attributes.color.needsUpdate = true;
      ptGeo.setDrawRange(0, ptCount);

      segGeo.setDrawRange(0, 0);
      document.getElementById('hudSegs').textContent = ptCount.toLocaleString() + ' pts';
      return;
    }

    ptPoints.visible = false;
    const N = traceSegments.length;
    let stride = 1;
    if (lightModel === 'wave' && N > 650) stride = Math.ceil(N / 650);
    else if ((lightModel === 'plane' || lightModel === 'spherical') && N > 1500)
      stride = Math.ceil(N / 1500);

    for (let k = 0; k < N; k += stride) {
      if (segCount >= MAX_VIS_SEGS - 200) break;
      drawTraceSegment(traceSegments[k], time);
    }

    segGeo.attributes.position.needsUpdate = true;
    segGeo.attributes.color.needsUpdate = true;
    segGeo.setDrawRange(0, segCount * 2);
    document.getElementById('hudSegs').textContent = segCount.toLocaleString();
  }

  /* ============================================================
     6. API TRACE CALL
     ============================================================ */
  let traceScheduled = false;
  let traceAbortController = null;
  let isTracing = false;
  const loadingEl = document.getElementById('traceLoading');

  function serializeSceneForTrace() {
    scene.updateMatrixWorld(true);

    const pos = sourceGroup.position;
    const quat = sourceGroup.quaternion;

    return {
      sourceState: {
        type: sourceState.type,
        pol: sourceState.pol,
        radius: sourceState.radius,
        rays: sourceState.rays,
        spread: sourceState.spread,
        intensity: sourceState.intensity,
        position: [pos.x, pos.y, pos.z],
        quaternion: [quat.x, quat.y, quat.z, quat.w],
      },
      lightModel,
      ambientMedium: ambientMediumKey,
      components: components.map(c => ({
        id: c.id,
        type: c.type,
        params: { ...c.params },
        position: [c.group.position.x, c.group.position.y, c.group.position.z],
        quaternion: [c.group.quaternion.x, c.group.quaternion.y, c.group.quaternion.z, c.group.quaternion.w],
      })),
    };
  }

  async function doTrace() {
    // Cancel any in-flight trace
    if (traceAbortController) {
      traceAbortController.abort();
    }
    traceAbortController = new AbortController();

    isTracing = true;
    loadingEl.style.display = 'flex';

    try {
      const body = serializeSceneForTrace();
      const response = await fetch('/api/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: traceAbortController.signal,
      });

      if (!response.ok) {
        console.error('Trace API error:', response.status);
        return;
      }

      const result = await response.json();

      // Store segments for visualization
      traceSegments = result.segments;

      // Apply screen/detector data
      for (const comp of components) {
        if ((comp.type === 'screen' || comp.type === 'detector') && result.screenData[comp.id]) {
          const sd = result.screenData[comp.id];
          comp.hitCount = sd.hitCount;
          comp.totalPower = sd.totalPower;
          comp.peak = sd.peak;
          comp.illuminatedPixels = sd.illuminatedPixels;

          // Decode base64 accumulator
          if (sd.accumBase64 && comp.screenCtx) {
            const binaryStr = atob(sd.accumBase64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
            comp.accum = new Float32Array(bytes.buffer);
            flushScreen(comp);
          }
        }
      }

      // Render the visuals
      renderVisuals(performance.now() * 0.001);
      updateReadout();

    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Trace error:', err);
      }
    } finally {
      isTracing = false;
      loadingEl.style.display = 'none';
    }
  }

  function scheduleTrace() {
    if (traceScheduled) return;
    traceScheduled = true;
    // Debounce: wait a tick so multiple rapid changes batch into one trace
    setTimeout(() => {
      traceScheduled = false;
      doTrace();
    }, 50);
  }

  /* ============================================================
     6b. SCREEN FLUSH (client-side rendering of accumulator data)
     ============================================================ */
  function flushScreen(comp) {
    const N = comp.accumSize || SCREEN_RES;
    const ctx = comp.screenCtx;
    if (!ctx) return;
    const img = ctx.createImageData(N, N);
    const data = img.data;
    const isDet = comp.type === 'detector';
    let peak = 0, lit = 0;

    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let r = 5, g = 8, b = 16;
      if (isDet && (x % 32 === 0 || y % 32 === 0)) { r = 14; g = 24; b = 48; }
      const i = y * N + x;
      const ar = comp.accum[i * 3], ag = comp.accum[i * 3 + 1], ab = comp.accum[i * 3 + 2];
      const mx = Math.max(ar, ag, ab);
      if (mx > peak) peak = mx;
      if (mx > 0.001) {
        lit++;
        const rr = ar / (1 + ar * 0.85), gg = ag / (1 + ag * 0.85), bb = ab / (1 + ab * 0.85);
        r = Math.min(255, r + rr * 255);
        g = Math.min(255, g + gg * 255);
        b = Math.min(255, b + bb * 255);
      }
      const k = i * 4;
      data[k] = r; data[k + 1] = g; data[k + 2] = b; data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    comp.screenTex.needsUpdate = true;

    if (comp.monitorCtx && comp.monitorCanvas) {
      comp.monitorCtx.clearRect(0, 0, comp.monitorCanvas.width, comp.monitorCanvas.height);
      comp.monitorCtx.drawImage(comp.screenCanvas, 0, 0);
      if (comp.monitorReadout) {
        const area = lit > 0 ? (lit / (N * N) * 100).toFixed(1) + '%' : '—';
        comp.monitorReadout.innerHTML =
          `<div><span>Rays</span><b>${comp.hitCount}</b></div>` +
          `<div><span>Pwr</span><b>${comp.totalPower.toFixed(3)}</b></div>` +
          `<div><span>Peak</span><b>${peak.toFixed(3)}</b></div>` +
          `<div><span>Lit</span><b>${area}</b></div>`;
      }
    }
  }

  /* ============================================================
     7. UI
     ============================================================ */
  const inspector = document.getElementById('inspector');
  let readoutEl = null;
  let ambientMediumKey = 'air';

  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  function makeSliderRow(label, min, max, step, value, unit, onInput) {
    const row = el('div', 'row');
    row.appendChild(el('label', null, label));
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
    const val = el('span', 'val', (unit === '°' ? value + '°' : (unit === '×' ? (+value).toFixed(1) + '×' : (+value).toFixed(step < 1 ? 2 : 0))));
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      val.textContent = (unit === '°' ? v + '°' : (unit === '×' ? v.toFixed(1) + '×' : (step < 1 ? v.toFixed(2) : v)));
      onInput(v);
    });
    row.appendChild(inp); row.appendChild(val);
    return row;
  }

  function makeSelectRow(label, options, value, onChange) {
    const row = el('div', 'row');
    row.appendChild(el('label', null, label));
    const sel = document.createElement('select');
    for (const [v, l] of options) {
      const o = document.createElement('option');
      o.value = v; o.textContent = l; if (v === value) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    row.appendChild(sel);
    return row;
  }

  function updateReadout() {
    if (!readoutEl || !selected || !selected.accum) return;
    const c = selected;
    const total = c.totalPower || 0, peak = c.peak || 0;
    const hits = c.hitCount || 0, lit = c.illuminatedPixels || 0;
    const area = lit > 0 ? (lit / (SCREEN_RES * SCREEN_RES) * 100).toFixed(1) + '%' : '—';
    const kind = c.type === 'detector' ? 'DETECTOR' : 'SCREEN';
    readoutEl.innerHTML =
      `<div style="color:#6cd8ff;font-size:10px;letter-spacing:1.5px;margin-bottom:4px">${kind} READOUT</div>` +
      `<div><span class="k">Rays absorbed : </span><span class="v">${hits}</span></div>` +
      `<div><span class="k">Total power   : </span><span class="v">${total.toFixed(4)}</span></div>` +
      `<div><span class="k">Peak intensity: </span><span class="v">${peak.toFixed(3)}</span></div>` +
      `<div><span class="k">Lit area      : </span><span class="v">${area}</span></div>`;
  }

  function refreshInspector() {
    inspector.innerHTML = '';
    readoutEl = null;

    if (!selected) {
      inspector.innerHTML = '<div class="hint">Click an object in the scene to edit it. Drag to move. Shift+drag to raise/lower. Delete key removes it.</div>';
      return;
    }

    const c = selected;
    inspector.appendChild(el('div', 'pill', c.label || 'Object'));

    if (c === sourceState) {
      const hint = el('div', 'bulb-hint');
      if (lightModel === 'torch') {
        hint.innerHTML = '🔦 <b>Real-world torch</b> — rendered as a soft volumetric glow. ' +
          'Use <b>Brightness</b> to change output, <b>Beam angle</b> to widen the cone, ' +
          'and <b>Ray count</b> for sampling density.';
      } else {
        hint.innerHTML = 'Ray count is on a <b>log scale</b>: the slider maps 1 → 100,000,000 rays. ' +
          'Very large values are clamped internally to keep the simulation responsive.';
      }
      inspector.appendChild(hint);
    }

    if (c.defs && c.defs.length) {
      for (const d of c.defs) {
        const cur = c.params[d.key];
        if (d.type === 'range') {
          inspector.appendChild(makeSliderRow(d.label, d.min, d.max, d.step, cur, d.unit, v => {
            c.params[d.key] = v; rebuild(c);
          }));
        } else if (d.type === 'select') {
          inspector.appendChild(makeSelectRow(d.label, d.options, cur, v => {
            c.params[d.key] = v; rebuild(c);
          }));
        } else if (d.type === 'material') {
          const opts = Object.keys(MEDIA).map(k => [k, MEDIA[k].label]);
          inspector.appendChild(makeSelectRow(d.label, opts, cur, v => {
            c.params[d.key] = v; c.material = MEDIA[v]; rebuild(c);
          }));
        }
      }
    }

    if (c.accum) {
      readoutEl = el('div', 'readout');
      inspector.appendChild(readoutEl);
      updateReadout();
    }

    if (c.monitorEl && c.monitorHidden) {
      const show = el('button', null, 'Show monitor view');
      show.style.width = '100%'; show.style.marginTop = '8px';
      show.addEventListener('click', () => {
        c.monitorEl.style.display = '';
        c.monitorHidden = false;
        refreshInspector();
      });
      inspector.appendChild(show);
    }

    inspector.appendChild(el('hr'));

    const g = c.group;
    inspector.appendChild(makeSliderRow('X', -10, 10, 0.1, g.position.x, '', v => {
      g.position.x = v; scheduleTrace();
    }));
    inspector.appendChild(makeSliderRow('Y', 0.2, 8, 0.1, g.position.y, '', v => {
      g.position.y = v; scheduleTrace();
    }));
    inspector.appendChild(makeSliderRow('Z', -10, 10, 0.1, g.position.z, '', v => {
      g.position.z = v; scheduleTrace();
    }));
    inspector.appendChild(makeSliderRow('Yaw', -180, 180, 1, THREE.MathUtils.radToDeg(g.rotation.y), '°', v => {
      g.rotation.y = THREE.MathUtils.degToRad(v); scheduleTrace();
    }));
    inspector.appendChild(makeSliderRow('Pitch', -90, 90, 1, THREE.MathUtils.radToDeg(g.rotation.x), '°', v => {
      g.rotation.x = THREE.MathUtils.degToRad(v); scheduleTrace();
    }));

    if (c !== sourceState) {
      inspector.appendChild(el('hr'));
      const del = el('button', 'danger', 'Delete component');
      del.style.width = '100%';
      del.addEventListener('click', () => {
        removeMonitor(c);
        scene.remove(g);
        const i = components.indexOf(c);
        if (i >= 0) components.splice(i, 1);
        selected = null;
        refreshInspector();
        scheduleTrace();
      });
      inspector.appendChild(del);
    }
  }

  function select(obj) {
    selected = obj;
    if (obj && obj.monitorEl && obj.monitorHidden) {
      obj.monitorEl.style.display = '';
      obj.monitorHidden = false;
    }
    refreshInspector();
  }

  /* ---- Add buttons ---- */
  document.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.add;
      const off = (components.length % 5) * 0.4 - 0.8;
      const comp = addComponent(type, V(off, 2, 0), 0);
      select(comp);
      scheduleTrace();
    });
  });

  /* ---- Source controls ---- */
  const $ = id => document.getElementById(id);

  $('lightModel').addEventListener('change', e => {
    lightModel = e.target.value;
    $('modelNote').textContent = MODEL_NOTES[lightModel] || '';

    if (lightModel === 'torch' && sourceState.spread === 0) {
      sourceState.spread = 14;
      $('srcSpread').value = 14;
      $('vSpread').textContent = '14°';
    }

    updateSourceVisual();
    if (selected === sourceState) refreshInspector();
    renderVisuals(performance.now() * 0.001);
    scheduleTrace();
  });

  $('srcType').addEventListener('change', e => { sourceState.type = e.target.value; scheduleTrace(); });
  $('srcPol').addEventListener('change', e => { sourceState.pol = e.target.value; scheduleTrace(); });

  $('srcIntensity').addEventListener('input', e => {
    sourceState.intensity = parseFloat(e.target.value);
    $('vIntensity').textContent = sourceState.intensity.toFixed(1) + '×';
    updateSourceVisual();
    scheduleTrace();
  });

  $('srcRadius').addEventListener('input', e => {
    sourceState.radius = parseFloat(e.target.value);
    $('vRadius').textContent = sourceState.radius.toFixed(2);
    scheduleTrace();
  });

  /* Ray count: log-scale slider */
  $('srcRays').addEventListener('input', e => {
    const logVal = parseFloat(e.target.value);
    sourceState.rays = rayCountFromSlider(logVal);
    $('vRays').textContent = formatRayCount(sourceState.rays);
    if (sourceState.rays > HARD_RAY_CAP) {
      $('rayNote').textContent =
        `Requested ${formatRayCount(sourceState.rays)} — clamped to ${formatRayCount(HARD_RAY_CAP)} for performance`;
    } else {
      $('rayNote').textContent = 'Log scale: 1 ray → 100,000,000 rays';
    }
    scheduleTrace();
  });

  $('srcSpread').addEventListener('input', e => {
    sourceState.spread = parseFloat(e.target.value);
    $('vSpread').textContent = sourceState.spread + '°';
    scheduleTrace();
  });

  /* Ambient medium */
  (function () {
    const sel = $('ambient');
    for (const k of Object.keys(MEDIA)) {
      const o = document.createElement('option');
      o.value = k; o.textContent = MEDIA[k].label;
      if (k === 'air') o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      ambientMediumKey = sel.value;
      scheduleTrace();
    });
  })();

  /* ============================================================
     8. INTERACTION
     ============================================================ */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const dragPt = new THREE.Vector3();
  let dragState = null;

  function pointerRay(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray;
  }
  function pickRoots() {
    const arr = components.map(c => c.group);
    arr.push(sourceGroup);
    return arr;
  }

  renderer.domElement.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const ray = pointerRay(e);
    const hits = raycaster.intersectObjects(pickRoots(), true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.comp) o = o.parent;
      if (o) {
        select(o.userData.comp);
        const g = o;
        dragPlane.setFromNormalAndCoplanarPoint(V(0, 1, 0), g.position);
        if (ray.intersectPlane(dragPlane, dragPt)) {
          dragState = {
            group: g, offset: g.position.clone().sub(dragPt),
            startY: g.position.y, startClientY: e.clientY
          };
          controls.enabled = false;
        }
        return;
      }
    }
    select(null);
  });

  renderer.domElement.addEventListener('pointermove', e => {
    if (!dragState) return;
    const g = dragState.group;
    if (e.shiftKey) {
      const dy = e.clientY - dragState.startClientY;
      g.position.y = clamp(dragState.startY - dy * 0.012, 0.1, 9);
    } else {
      dragPlane.setFromNormalAndCoplanarPoint(V(0, 1, 0), g.position);
      const ray = pointerRay(e);
      if (ray.intersectPlane(dragPlane, dragPt)) {
        g.position.copy(dragPt.add(dragState.offset));
      }
    }
    scheduleTrace();
  });

  window.addEventListener('pointerup', () => {
    if (dragState) {
      dragState = null; controls.enabled = true;
      refreshInspector();
    }
  });

  window.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected && selected !== sourceState) {
      removeMonitor(selected);
      scene.remove(selected.group);
      const i = components.indexOf(selected);
      if (i >= 0) components.splice(i, 1);
      selected = null;
      refreshInspector();
      scheduleTrace();
    }
  });

  /* ============================================================
     9. BOOT + LOOP
     ============================================================ */
  // Initialise the slider display from the default ray count
  (function initRaySlider() {
    $('srcRays').value = sliderFromRayCount(sourceState.rays);
    $('vRays').textContent = formatRayCount(sourceState.rays);
  })();

  addComponent('lens', V(0, 2, -0.5), 0);
  addComponent('mirror', V(0, 2, 3.2), -Math.PI / 4);
  addComponent('screen', V(3.4, 2, 3.2), -Math.PI / 2);

  updateSourceVisual();
  refreshInspector();
  scheduleTrace();

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    if (lightModel === 'wave') {
      renderVisuals(performance.now() * 0.001);
    }
    renderer.render(scene, camera);
  }
  animate();
}
