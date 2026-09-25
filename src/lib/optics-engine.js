/* ============================================================
   OptoLabs — Server-side Ray Tracing Engine
   ============================================================
   This module contains all the computation-heavy ray tracing
   logic that runs on the server via the API route. It operates
   on plain JS objects (no Three.js dependency).
   ============================================================ */

import {
  MEDIA, nOf, wavelengthToRGB, FILTERS,
  MAX_DEPTH, MAX_TRACE_SEGS, MAX_PROC, MIN_INT,
  HARD_RAY_CAP, SCREEN_RES,
} from './constants.js';

/* ============================================================
   1.  Simple 3D Vector helpers (no Three.js on server)
   ============================================================ */
function V(x = 0, y = 0, z = 0) { return { x, y, z }; }

function vAdd(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function vSub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function vScale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function vDot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function vCross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function vLen(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
function vLenSq(a) { return a.x * a.x + a.y * a.y + a.z * a.z; }
function vNorm(a) {
  const l = vLen(a);
  if (l < 1e-14) return { x: 0, y: 0, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
function vAddScaled(a, b, s) {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}
function vNegate(a) { return { x: -a.x, y: -a.y, z: -a.z }; }
function vClone(a) { return { x: a.x, y: a.y, z: a.z }; }

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* ============================================================
   2.  Polarization / Jones-matrix helpers
   ============================================================ */
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const cconj = (a) => [a[0], -a[1]];

function J_unpolarized(I = 1) { return { ss: I * 0.5, pp: I * 0.5, sp: [0, 0] }; }
function J_linear(I, ex, ey) { return { ss: I * ex * ex, pp: I * ey * ey, sp: [I * ex * ey, 0] }; }
function J_intensity(J) { return J.ss + J.pp; }

function J_scale(J, k1, k2) {
  return { ss: J.ss * k1 * k1, pp: J.pp * k2 * k2, sp: [J.sp[0] * k1 * k2, J.sp[1] * k1 * k2] };
}
function J_rotate(J, phi) {
  const c = Math.cos(phi), s = Math.sin(phi);
  return {
    ss: c * c * J.ss + s * s * J.pp + 2 * c * s * J.sp[0],
    pp: s * s * J.ss + c * c * J.pp - 2 * c * s * J.sp[0],
    sp: [c * s * (J.pp - J.ss) + (c * c - s * s) * J.sp[0], J.sp[1]]
  };
}
function J_apply(J, U) {
  const Jm = [[[J.ss, 0], J.sp], [cconj(J.sp), [J.pp, 0]]];
  const out = [[[0, 0], [0, 0]], [[0, 0], [0, 0]]];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    let acc = [0, 0];
    for (let k = 0; k < 2; k++) for (let l = 0; l < 2; l++)
      acc = cadd(acc, cmul(cmul(U[i][k], Jm[k][l]), cconj(U[j][l])));
    out[i][j] = acc;
  }
  return { ss: out[0][0][0], pp: out[1][1][0], sp: out[0][1] };
}

function arbitraryPerp(d) {
  const a = Math.abs(d.x) < 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  return vNorm(vCross(d, a));
}

/* ============================================================
   3.  Matrix helpers (4×4 for transforms, 3×3 for normals)
   ============================================================ */

/* Create a 4x4 transform from position + quaternion */
function mat4FromPosQuat(pos, quat) {
  const [qx, qy, qz, qw] = quat;
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  // column-major like Three.js
  return [
    1 - (yy + zz), xy + wz,       xz - wy,       0,
    xy - wz,       1 - (xx + zz), yz + wx,       0,
    xz + wy,       yz - wx,       1 - (xx + yy), 0,
    pos[0],         pos[1],         pos[2],         1,
  ];
}

function mat4Invert(m) {
  const te = new Array(16);
  const n11 = m[0], n21 = m[1], n31 = m[2], n41 = m[3];
  const n12 = m[4], n22 = m[5], n32 = m[6], n42 = m[7];
  const n13 = m[8], n23 = m[9], n33 = m[10], n43 = m[11];
  const n14 = m[12], n24 = m[13], n34 = m[14], n44 = m[15];

  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (Math.abs(det) < 1e-20) return null;
  const invDet = 1 / det;

  te[0] = t11 * invDet;
  te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * invDet;
  te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * invDet;
  te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * invDet;
  te[4] = t12 * invDet;
  te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * invDet;
  te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * invDet;
  te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * invDet;
  te[8] = t13 * invDet;
  te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * invDet;
  te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * invDet;
  te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * invDet;
  te[12] = t14 * invDet;
  te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * invDet;
  te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * invDet;
  te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * invDet;

  return te;
}

/* Apply 4x4 matrix to a point (w=1) */
function applyMat4(m, p) {
  return {
    x: m[0] * p.x + m[4] * p.y + m[8]  * p.z + m[12],
    y: m[1] * p.x + m[5] * p.y + m[9]  * p.z + m[13],
    z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
  };
}

/* Extract upper-left 3x3 (rotation) from 4x4, and get its normal matrix */
function normalMatrix3(m) {
  // For an orthogonal matrix (no scale), the normal matrix is the same rotation
  const n = [
    m[0], m[1], m[2],
    m[4], m[5], m[6],
    m[8], m[9], m[10],
  ];
  return n;
}

function applyMat3(n, v) {
  return vNorm({
    x: n[0] * v.x + n[3] * v.y + n[6] * v.z,
    y: n[1] * v.x + n[4] * v.y + n[7] * v.z,
    z: n[2] * v.x + n[5] * v.y + n[8] * v.z,
  });
}

/* Quaternion application to a direction vector */
function applyQuat(q, v) {
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  return {
    x: v.x + qw * tx + (qy * tz - qz * ty),
    y: v.y + qw * ty + (qz * tx - qx * tz),
    z: v.z + qw * tz + (qx * ty - qy * tx),
  };
}

/* ============================================================
   4.  Surface construction from component definitions
   ============================================================ */

function buildLocalSurfaces(comp) {
  const p = comp.params;
  const type = comp.type;

  switch (type) {
    case 'mirror': {
      const w = 2.0, h = 2.0;
      return [{
        kind: 'rect', o: V(0, 0, 0), e1: V(1, 0, 0), e2: V(0, 1, 0),
        h1: w / 2, h2: h / 2, n: V(0, 0, 1),
        behavior: 'mirror', reflectivity: p.reflectivity
      }];
    }
    case 'curvedmirror': {
      const A = p.aperture, R = p.curvature;
      return [{
        kind: 'sphere', c: V(0, 0, R), R, axis: V(0, 0, -1), aperture: A,
        behavior: 'mirror', reflectivity: p.reflectivity
      }];
    }
    case 'beamsplitter': {
      const w = 1.8, h = 1.8;
      return [{
        kind: 'rect', o: V(0, 0, 0), e1: V(1, 0, 0), e2: V(0, 1, 0),
        h1: w / 2, h2: h / 2, n: V(0, 0, 1),
        behavior: 'split', reflectivity: p.reflectivity
      }];
    }
    case 'polarizer': {
      const w = 1.8, h = 1.8;
      const ang = p.angle * Math.PI / 180;
      return [{
        kind: 'rect', o: V(0, 0, 0), e1: V(1, 0, 0), e2: V(0, 1, 0),
        h1: w / 2, h2: h / 2, n: V(0, 0, 1),
        behavior: 'polarizer', axisLocal: V(Math.cos(ang), Math.sin(ang), 0)
      }];
    }
    case 'halfwave': {
      const w = 1.8, h = 1.8;
      const ang = p.angle * Math.PI / 180;
      return [{
        kind: 'rect', o: V(0, 0, 0), e1: V(1, 0, 0), e2: V(0, 1, 0),
        h1: w / 2, h2: h / 2, n: V(0, 0, 1),
        behavior: 'waveplate', retardance: Math.PI,
        axisLocal: V(Math.cos(ang), Math.sin(ang), 0)
      }];
    }
    case 'quarterwave': {
      const w = 1.8, h = 1.8;
      const ang = p.angle * Math.PI / 180;
      return [{
        kind: 'rect', o: V(0, 0, 0), e1: V(1, 0, 0), e2: V(0, 1, 0),
        h1: w / 2, h2: h / 2, n: V(0, 0, 1),
        behavior: 'waveplate', retardance: Math.PI / 2,
        axisLocal: V(Math.cos(ang), Math.sin(ang), 0)
      }];
    }
    case 'lens': {
      const A = p.aperture, R = p.curvature;
      const t = 2 * (R - Math.sqrt(R * R - A * A));
      const zc1 = -t / 2 + R, zc2 = t / 2 - R;
      return [
        { kind: 'sphere', c: V(0, 0, zc1), R, axis: V(0, 0, -1), aperture: A, behavior: 'dielectric' },
        { kind: 'sphere', c: V(0, 0, zc2), R, axis: V(0, 0, 1),  aperture: A, behavior: 'dielectric' },
      ];
    }
    case 'prism': {
      const side = 2.0, height = 2.0, Rt = side / Math.sqrt(3);
      const verts = [];
      for (let i = 0; i < 3; i++) {
        const a = i * 2 * Math.PI / 3;
        verts.push(V(Rt * Math.sin(a), 0, Rt * Math.cos(a)));
      }
      const surfaces = [];
      for (let i = 0; i < 3; i++) {
        const v1 = verts[i], v2 = verts[(i + 1) % 3];
        const mid = vScale(vAdd(v1, v2), 0.5);
        const e = vNorm(vSub(v2, v1));
        surfaces.push({
          kind: 'rect', o: mid, e1: e, e2: V(0, 1, 0),
          h1: side / 2, h2: height / 2, n: vNorm(mid),
          behavior: 'dielectric'
        });
      }
      return surfaces;
    }
    case 'block': {
      const s = p.size;
      const w = s, h = s, d = s;
      return [
        { kind: 'rect', o: V(w / 2, 0, 0),  e1: V(0, 0, 1),  e2: V(0, 1, 0), h1: d / 2, h2: h / 2, n: V(1, 0, 0),  behavior: 'dielectric' },
        { kind: 'rect', o: V(-w / 2, 0, 0), e1: V(0, 0, -1), e2: V(0, 1, 0), h1: d / 2, h2: h / 2, n: V(-1, 0, 0), behavior: 'dielectric' },
        { kind: 'rect', o: V(0, h / 2, 0),  e1: V(1, 0, 0),  e2: V(0, 0, 1), h1: w / 2, h2: d / 2, n: V(0, 1, 0),  behavior: 'dielectric' },
        { kind: 'rect', o: V(0, -h / 2, 0), e1: V(1, 0, 0),  e2: V(0, 0, -1),h1: w / 2, h2: d / 2, n: V(0, -1, 0), behavior: 'dielectric' },
        { kind: 'rect', o: V(0, 0, d / 2),  e1: V(1, 0, 0),  e2: V(0, 1, 0), h1: w / 2, h2: h / 2, n: V(0, 0, 1),  behavior: 'dielectric' },
        { kind: 'rect', o: V(0, 0, -d / 2), e1: V(-1, 0, 0), e2: V(0, 1, 0), h1: w / 2, h2: h / 2, n: V(0, 0, -1), behavior: 'dielectric' },
      ];
    }
    case 'filter': {
      const w = 1.8, h = 1.8;
      return [{
        kind: 'rect', o: V(0, 0, 0), e1: V(1, 0, 0), e2: V(0, 1, 0),
        h1: w / 2, h2: h / 2, n: V(0, 0, 1),
        behavior: 'filter', filterColor: p.color
      }];
    }
    case 'screen': {
      const w = 2.4, h = 2.4;
      return [{
        kind: 'rect', o: V(0, 0, 0), e1: V(1, 0, 0), e2: V(0, 1, 0),
        h1: w / 2, h2: h / 2, n: V(0, 0, 1),
        behavior: 'screen'
      }];
    }
    case 'detector': {
      const w = 2.0, h = 2.0;
      return [{
        kind: 'rect', o: V(0, 0, 0), e1: V(1, 0, 0), e2: V(0, 1, 0),
        h1: w / 2, h2: h / 2, n: V(0, 0, 1),
        behavior: 'detector'
      }];
    }
    default:
      return [];
  }
}

/* ============================================================
   5.  Collect world-space surfaces from component list
   ============================================================ */
function collectSurfaces(components, ambientMediumKey) {
  const out = [];
  for (const comp of components) {
    const M = mat4FromPosQuat(comp.position, comp.quaternion);
    const NM = normalMatrix3(M);
    const invM = mat4Invert(M);
    const localSurfaces = buildLocalSurfaces(comp);
    const material = MEDIA[comp.params.material || 'glass'];

    for (const s of localSurfaces) {
      const ws = {
        compId: comp.id,
        compType: comp.type,
        compMaterial: material,
        compParams: comp.params,
        behavior: s.behavior
      };
      if (s.kind === 'rect') {
        ws.kind = 'rect';
        ws.o = applyMat4(M, s.o);
        ws.e1 = applyMat3(NM, s.e1);
        ws.e2 = applyMat3(NM, s.e2);
        ws.n = applyMat3(NM, s.n);
        ws.h1 = s.h1; ws.h2 = s.h2;
        if (s.axisLocal) ws.axisWorld = applyMat3(NM, s.axisLocal);
        if (s.reflectivity !== undefined) ws.reflectivity = s.reflectivity;
        if (s.retardance !== undefined) ws.retardance = s.retardance;
        if (s.filterColor !== undefined) ws.filterColor = s.filterColor;
      } else {
        ws.kind = 'sphere';
        ws.c = applyMat4(M, s.c);
        ws.R = s.R;
        ws.axis = applyMat3(NM, s.axis);
        ws.aperture = s.aperture;
        if (s.reflectivity !== undefined) ws.reflectivity = s.reflectivity;
      }
      ws.invM = invM;
      out.push(ws);
    }
  }
  return out;
}

/* ============================================================
   6.  Ray-surface intersection
   ============================================================ */
function intersectSurf(s, o, d) {
  if (s.kind === 'rect') {
    const den = vDot(s.n, d);
    if (Math.abs(den) < 1e-10) return null;
    const t = vDot(vSub(s.o, o), s.n) / den;
    if (t < 1e-5) return null;
    const p = vAddScaled(o, d, t);
    const rel = vSub(p, s.o);
    if (Math.abs(vDot(rel, s.e1)) > s.h1) return null;
    if (Math.abs(vDot(rel, s.e2)) > s.h2) return null;
    return t;
  } else {
    const oc = vSub(o, s.c);
    const b = vDot(oc, d);
    const c = vDot(oc, oc) - s.R * s.R;
    const disc = b * b - c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    for (const t of [-b - sq, -b + sq]) {
      if (t < 1e-5) continue;
      const p = vAddScaled(o, d, t);
      const v = vSub(p, s.c);
      const proj = vDot(v, s.axis);
      if (proj <= 0) continue;
      const radV = vAddScaled(v, s.axis, -proj);
      const rad = vLen(radV);
      if (rad > s.aperture) continue;
      return t;
    }
    return null;
  }
}

function nearestHit(o, d, surfaces) {
  let bestT = Infinity, bestS = null;
  for (const s of surfaces) {
    const t = intersectSurf(s, o, d);
    if (t !== null && t < bestT) { bestT = t; bestS = s; }
  }
  if (!bestS) return null;
  const p = vAddScaled(o, d, bestT);
  const n = (bestS.kind === 'rect') ? vClone(bestS.n) : vNorm(vSub(p, bestS.c));
  return { surf: bestS, t: bestT, p, n };
}

/* ============================================================
   7.  Screen/detector accumulation
   ============================================================ */
function splatAccum(accum, N, px, py, col, intensity, gain) {
  const weight = intensity * gain;
  const R = 4, R2 = R * R;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d2 = dx * dx + dy * dy;
    if (d2 > R2) continue;
    const nx = px + dx, ny = py + dy;
    if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
    const g = Math.exp(-d2 / (R2 * 0.5)) * 0.22;
    const j = (ny * N + nx) * 3;
    accum[j] += col[0] * weight * g;
    accum[j + 1] += col[1] * weight * g;
    accum[j + 2] += col[2] * weight * g;
  }
}

/* ============================================================
   8.  Ray tracing step
   ============================================================ */
function stepRay(ray, surfaces, queue, segments, screenAccums, ambientMedium) {
  if (ray.depth > MAX_DEPTH) return;

  const hit = nearestHit(ray.o, ray.d, surfaces);
  const end = hit ? hit.p : vAddScaled(ray.o, ray.d, 400);

  // Collect segment
  if (segments.length < MAX_TRACE_SEGS) {
    segments.push({
      ax: ray.o.x, ay: ray.o.y, az: ray.o.z,
      bx: end.x, by: end.y, bz: end.z,
      dx: ray.d.x, dy: ray.d.y, dz: ray.d.z,
      sx: ray.s.x, sy: ray.s.y, sz: ray.s.z,
      wl: ray.wl, I: J_intensity(ray.J),
      r0: ray.r0 || 0,
    });
  }
  if (!hit) return;

  const surf = hit.surf;
  const d = ray.d;
  let n = vClone(hit.n);
  let cosi = -vDot(d, n);
  if (cosi < 0) { n = vNegate(n); cosi = -cosi; }
  cosi = clamp(cosi, 0, 1);

  let sNew = vCross(d, n);
  if (vLenSq(sNew) < 1e-14) sNew = arbitraryPerp(d);
  sNew = vNorm(sNew);

  let J = ray.J;
  if (ray.s) {
    const pOld = vCross(ray.s, d);
    const alpha = vDot(sNew, ray.s);
    const beta = vDot(sNew, pOld);
    const phi = Math.atan2(beta, alpha);
    if (Math.abs(phi) > 1e-9) J = J_rotate(J, phi);
  }
  if (J_intensity(J) < MIN_INT) return;

  const p = hit.p;
  const eps = 4e-4;
  const depth = ray.depth + 1;
  const wl = ray.wl;
  const reflectDir = vNorm(vAddScaled(d, n, -2 * vDot(d, n)));

  switch (surf.behavior) {
    case 'mirror': {
      const k = Math.sqrt(surf.reflectivity ?? 0.95);
      queue.push({
        o: vAddScaled(p, reflectDir, eps), d: reflectDir, s: sNew,
        J: J_scale(J, k, k), wl, inside: ray.inside, depth, r0: ray.r0
      });
      break;
    }
    case 'split': {
      const R = surf.reflectivity ?? 0.5;
      if (R > 0.001) {
        const k = Math.sqrt(R);
        queue.push({
          o: vAddScaled(p, reflectDir, eps), d: reflectDir, s: sNew,
          J: J_scale(J, k, k), wl, inside: ray.inside, depth, r0: ray.r0
        });
      }
      if (R < 0.999) {
        const k = Math.sqrt(1 - R);
        queue.push({
          o: vAddScaled(p, d, eps), d: vClone(d), s: sNew,
          J: J_scale(J, k, k), wl, inside: ray.inside, depth, r0: ray.r0
        });
      }
      break;
    }
    case 'polarizer': {
      const axis = vClone(surf.axisWorld);
      const projected = vSub(axis, vScale(d, vDot(axis, d)));
      if (vLenSq(projected) < 1e-12) break;
      const axisNorm = vNorm(projected);
      const pv = vNorm(vCross(sNew, d));
      const th = Math.atan2(vDot(axisNorm, pv), vDot(axisNorm, sNew));
      const c = Math.cos(th), s2 = Math.sin(th);
      const U = [[[c * c, 0], [c * s2, 0]], [[c * s2, 0], [s2 * s2, 0]]];
      const J2 = J_apply(J, U);
      if (J_intensity(J2) < MIN_INT) break;
      queue.push({
        o: vAddScaled(p, d, eps), d: vClone(d), s: sNew,
        J: J2, wl, inside: ray.inside, depth, r0: ray.r0
      });
      break;
    }
    case 'waveplate': {
      const axis = vClone(surf.axisWorld);
      const projected = vSub(axis, vScale(d, vDot(axis, d)));
      if (vLenSq(projected) < 1e-12) break;
      const axisNorm = vNorm(projected);
      const pv = vNorm(vCross(sNew, d));
      const th = Math.atan2(vDot(axisNorm, pv), vDot(axisNorm, sNew));
      const c = Math.cos(th), s2 = Math.sin(th);
      const delta = surf.retardance;
      const cd = Math.cos(delta), sd = Math.sin(delta);
      const U = [
        [[c * c + s2 * s2 * cd, s2 * s2 * sd], [c * s2 * (1 - cd), -c * s2 * sd]],
        [[c * s2 * (1 - cd), -c * s2 * sd], [s2 * s2 + c * c * cd, c * c * sd]]
      ];
      const J2 = J_apply(J, U);
      if (J_intensity(J2) < MIN_INT) break;
      queue.push({
        o: vAddScaled(p, d, eps), d: vClone(d), s: sNew,
        J: J2, wl, inside: ray.inside, depth, r0: ray.r0
      });
      break;
    }
    case 'filter': {
      const filterFn = FILTERS[surf.filterColor];
      if (!filterFn) break;
      const T = filterFn(wl);
      if (T <= 0.002) break;
      const k = Math.sqrt(T);
      queue.push({
        o: vAddScaled(p, d, eps), d: vClone(d), s: sNew,
        J: J_scale(J, k, k), wl, inside: ray.inside, depth, r0: ray.r0
      });
      break;
    }
    case 'screen':
    case 'detector': {
      const compId = surf.compId;
      if (screenAccums[compId] && surf.invM) {
        const local = applyMat4(surf.invM, p);
        const u = local.x, v = local.y;
        const N = SCREEN_RES;
        const px2 = Math.floor((u / surf.h1 * 0.5 + 0.5) * N);
        const py2 = Math.floor((0.5 - v / surf.h2 * 0.5) * N);
        if (px2 >= 0 && px2 < N && py2 >= 0 && py2 < N) {
          const I = J_intensity(J);
          const gain = surf.compParams.gain !== undefined ? surf.compParams.gain : 1;
          splatAccum(screenAccums[compId].accum, N, px2, py2, wavelengthToRGB(wl), I, gain);
          screenAccums[compId].hitCount++;
          screenAccums[compId].totalPower += I;
        }
      }
      break;
    }
    case 'dielectric': {
      const n1 = ray.inside ? nOf(ray.inside.material, wl) : nOf(ambientMedium, wl);
      // Determine if we're exiting this component
      const isExiting = ray.inside && ray.inside.id === surf.compId;
      const n2 = isExiting ? nOf(ambientMedium, wl) : nOf(surf.compMaterial, wl);
      const eta = n1 / n2;
      const sin2t = eta * eta * (1 - cosi * cosi);
      if (sin2t >= 1.0) {
        // Total internal reflection
        queue.push({
          o: vAddScaled(p, reflectDir, eps), d: reflectDir, s: sNew,
          J: J, wl, inside: ray.inside, depth, r0: ray.r0
        });
        break;
      }
      const cost = Math.sqrt(1 - sin2t);
      const rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost);
      const rp = (n2 * cosi - n1 * cost) / (n2 * cosi + n1 * cost);
      const ts0 = 2 * n1 * cosi / (n1 * cosi + n2 * cost);
      const tp0 = 2 * n1 * cosi / (n2 * cosi + n1 * cost);
      const fac = Math.sqrt(Math.max(0, (n2 * cost) / (n1 * cosi)));
      const ts = ts0 * fac, tp = tp0 * fac;
      const Jr = J_scale(J, rs, rp);
      const Jt = J_scale(J, ts, tp);
      const I0 = J_intensity(J);
      if (J_intensity(Jr) > MIN_INT && J_intensity(Jr) > 0.004 * I0) {
        queue.push({
          o: vAddScaled(p, reflectDir, eps), d: reflectDir, s: sNew,
          J: Jr, wl, inside: ray.inside, depth, r0: ray.r0
        });
      }
      if (J_intensity(Jt) > MIN_INT) {
        const dt = vNorm(vAddScaled(vScale(d, eta), n, eta * cosi - cost));
        const newInside = isExiting ? null : { id: surf.compId, material: surf.compMaterial };
        queue.push({
          o: vAddScaled(p, dt, eps), d: dt, s: sNew,
          J: Jt, wl, inside: newInside, depth, r0: ray.r0
        });
      }
      break;
    }
  }
}

/* ============================================================
   9.  Initial ray generation
   ============================================================ */
function makeInitialRays(sourceState, lightModel) {
  const rays = [];
  const origin = { x: sourceState.position[0], y: sourceState.position[1], z: sourceState.position[2] };
  const q = sourceState.quaternion;
  const dir = vNorm(applyQuat(q, V(0, 0, 1)));
  const right = vNorm(applyQuat(q, V(1, 0, 0)));
  const up = vNorm(applyQuat(q, V(0, 1, 0)));

  const I = sourceState.intensity;
  const requestedRays = sourceState.rays;
  const actualRays = Math.min(requestedRays, HARD_RAY_CAP);

  /* TORCH MODE */
  if (lightModel === 'torch') {
    const nDir = Math.max(24, actualRays);
    const halfAngle = Math.max(sourceState.spread, 6) * Math.PI / 180;
    const cosHalf = Math.cos(halfAngle);

    const wls = (sourceState.type === 'white')
      ? [430, 475, 520, 565, 610, 660]
      : [parseFloat(sourceState.type)];

    const aperture = Math.max(0.06, sourceState.radius * 0.25);
    const golden = 2.39996323;

    for (let i = 0; i < nDir; i++) {
      const u = (i + 0.5) / nDir;
      const cosT = cosHalf + (1 - cosHalf) * u;
      const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
      const phi = i * golden;

      const lx = sinT * Math.cos(phi);
      const ly = sinT * Math.sin(phi);
      const lz = cosT;

      const d0 = vNorm(vAdd(vAdd(vScale(right, lx), vScale(up, ly)), vScale(dir, lz)));

      const ra = aperture * Math.sqrt(u);
      const ta = i * golden;
      const start = vAdd(
        vAdd(vAddScaled(origin, right, ra * Math.cos(ta)), vScale(up, ra * Math.sin(ta))),
        vScale(dir, 0.45)
      );

      const s0 = arbitraryPerp(d0);

      for (const wl of wls) {
        const J = J_unpolarized(I * 1.6 / wls.length);
        rays.push({
          o: vClone(start), d: vClone(d0), s: vClone(s0), J, wl,
          inside: null, depth: 0, r0: ra
        });
      }
    }
    return rays;
  }

  /* OTHER MODES */
  const N = (lightModel === 'ray') ? 1 : actualRays;
  const isWhite = sourceState.type === 'white';
  const wls = [];
  if (isWhite) {
    const K = 9;
    for (let i = 0; i < K; i++) wls.push(400 + (680 - 400) * i / (K - 1));
  } else {
    wls.push(parseFloat(sourceState.type));
  }

  const spreadRad = sourceState.spread * Math.PI / 180;

  for (let i = 0; i < N; i++) {
    const rr = sourceState.radius * Math.sqrt((i + 0.5) / N);
    const th = i * 2.39996323;
    const off = vAdd(vScale(right, rr * Math.cos(th)), vScale(up, rr * Math.sin(th)));

    for (const wl of wls) {
      let start, d0;
      if (spreadRad > 0.0001) {
        const t = Math.sqrt((i + 0.5) / N);
        const a = i * 2.39996323;
        start = vClone(origin);
        d0 = vNorm(vAdd(
          vAdd(dir, vScale(right, Math.tan(spreadRad) * t * Math.cos(a))),
          vScale(up, Math.tan(spreadRad) * t * Math.sin(a))
        ));
      } else {
        start = vAdd(origin, off);
        d0 = vClone(dir);
      }
      const s0 = arbitraryPerp(d0);
      let J;
      if (sourceState.pol === 'lin') {
        const ex = vDot(up, s0), ey = vDot(up, vNorm(vCross(s0, d0)));
        J = J_linear(I, ex, ey);
      } else {
        J = J_unpolarized(I);
      }
      rays.push({ o: start, d: d0, s: s0, J, wl, inside: null, depth: 0, r0: rr });
    }
  }
  return rays;
}

/* ============================================================
   10. Main trace function (called from API route)
   ============================================================ */
export function doTrace(requestBody) {
  const { sourceState, lightModel, ambientMedium: ambientKey, components } = requestBody;
  const ambientMedium = MEDIA[ambientKey] || MEDIA.air;

  // Build world-space surfaces
  const surfaces = collectSurfaces(components, ambientKey);

  // For dielectric inside tracking, we store compId references
  // Adjust inside tracking: on the server, `inside` will be compId (number) or null
  // We need to map compId → material for dielectric calcs
  const compMaterialMap = {};
  for (const comp of components) {
    compMaterialMap[comp.id] = MEDIA[comp.params.material || 'glass'];
  }

  // Prepare screen/detector accumulators
  const screenAccums = {};
  for (const comp of components) {
    if (comp.type === 'screen' || comp.type === 'detector') {
      const N = SCREEN_RES;
      screenAccums[comp.id] = {
        accum: new Float32Array(N * N * 3),
        hitCount: 0,
        totalPower: 0,
        peak: 0,
        illuminatedPixels: 0,
      };
    }
  }

  // Generate initial rays
  const queue = makeInitialRays(sourceState, lightModel);
  const segments = [];
  let processed = 0;

  // BFS trace
  while (queue.length > 0 && processed < MAX_PROC && segments.length < MAX_TRACE_SEGS) {
    const ray = queue.pop();
    processed++;

    // For dielectric: ray.inside is a compId. We need to pass the material info.
    // The stepRay function handles this by looking up compMaterial on the surface.
    stepRay(ray, surfaces, queue, segments, screenAccums, ambientMedium);
  }

  // Process screen accumulators to get stats
  const screenData = {};
  for (const compId of Object.keys(screenAccums)) {
    const sa = screenAccums[compId];
    const N = SCREEN_RES;
    let peak = 0, lit = 0;
    for (let i = 0; i < N * N; i++) {
      const mx = Math.max(sa.accum[i * 3], sa.accum[i * 3 + 1], sa.accum[i * 3 + 2]);
      if (mx > peak) peak = mx;
      if (mx > 0.001) lit++;
    }
    sa.peak = peak;
    sa.illuminatedPixels = lit;

    // Convert Float32Array to base64 for transport
    const buf = Buffer.from(sa.accum.buffer);
    screenData[compId] = {
      hitCount: sa.hitCount,
      totalPower: sa.totalPower,
      peak,
      illuminatedPixels: lit,
      accumBase64: buf.toString('base64'),
    };
  }

  return { segments, screenData };
}
