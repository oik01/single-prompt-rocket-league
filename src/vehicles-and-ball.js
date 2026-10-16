import * as THREE_IMPORT from 'three';

/**
 * Module 2 — Lofted Battle-Car (`Octane-RLX`), Bilateral UV Livery,
 * 32-Panel Geodesic Soccer Ball & Studio Turnaround Builder
 *
 * Strictly obeys the Frozen Shared Architecture Contract (`S_final`):
 * - Vehicle Local Axes: `+Z` = Forward Nose, `+Y` = Up Roof, `+X` = Right Flank
 * - Overall Envelope: Length 4.20m (`z in [-2.10, +2.10]`), Width 2.10m (`x in [-1.05, +1.05]`), Height 1.38m (`y in [0.0, +1.38]`)
 * - 10 Multi-Station Loft Cross-Sections (`S0..S9` from `z = -1.95` to `z = +2.10`) with separated endcap normals
 * - High-Resolution (`2048x1024`) Bilateral UV Livery with non-mirrored `-X` (`v = 0.25`) and `+X` (`v = 0.75`) flank decals
 * - Exposed Double-Wishbone Suspension & Helical Coilover Struts (`FL, FR, RL, RR`)
 * - 32-Panel Truncated Icosahedron Geodesic Soccer Ball (`R_ball = 3.20m`) + Dynamic Ground Target Projection Ring (`renderOrder = 1`)
 */

function resolveTHREE(maybeTHREE) {
  if (maybeTHREE && maybeTHREE.BufferGeometry && maybeTHREE.Group && maybeTHREE.Mesh) {
    return maybeTHREE;
  }
  if (typeof window !== 'undefined' && window.THREE && window.THREE.BufferGeometry) {
    return window.THREE;
  }
  return THREE_IMPORT;
}

// ============================================================================
// 1. LOCKED 10-STATION LOFT TABLE (S0..S9) & MULTI-STATION 3D LOFT GENERATOR
// ============================================================================

export const DEFAULT_LOFT_STATIONS = [
  { id: 'S0', z: -1.95, yBot: 0.38, yTop: 0.88, halfW: 0.58, topWRatio: 0.72, botWRatio: 0.85, crown: 0.06, role: 'Rear Thruster Tail' },
  { id: 'S1', z: -1.55, yBot: 0.34, yTop: 0.96, halfW: 0.74, topWRatio: 0.68, botWRatio: 0.88, crown: 0.08, role: 'Rear Axle Deck' },
  { id: 'S2', z: -0.95, yBot: 0.28, yTop: 1.26, halfW: 0.86, topWRatio: 0.56, botWRatio: 0.92, crown: 0.10, role: 'Rear Cockpit Bulkhead' },
  { id: 'S3', z: -0.35, yBot: 0.26, yTop: 1.38, halfW: 0.92, topWRatio: 0.52, botWRatio: 0.95, crown: 0.12, role: 'Main Roll-Cage Apex' },
  { id: 'S4', z: +0.25, yBot: 0.26, yTop: 1.06, halfW: 0.88, topWRatio: 0.64, botWRatio: 0.94, crown: 0.09, role: 'Windshield Base & Sidepod Intake' },
  { id: 'S5', z: +0.75, yBot: 0.28, yTop: 0.86, halfW: 0.72, topWRatio: 0.75, botWRatio: 0.90, crown: 0.07, role: 'Mid Hood & Front Sidepod Taper' },
  { id: 'S6', z: +1.25, yBot: 0.30, yTop: 0.72, halfW: 0.54, topWRatio: 0.80, botWRatio: 0.88, crown: 0.05, role: 'Front Suspension Bulkhead' },
  { id: 'S7', z: +1.68, yBot: 0.28, yTop: 0.58, halfW: 0.44, topWRatio: 0.84, botWRatio: 0.90, crown: 0.04, role: 'Sloped Nose Cone' },
  { id: 'S8', z: +1.98, yBot: 0.24, yTop: 0.44, halfW: 0.36, topWRatio: 0.88, botWRatio: 0.92, crown: 0.03, role: 'Front Wing Mount' },
  { id: 'S9', z: +2.10, yBot: 0.24, yTop: 0.38, halfW: 0.26, topWRatio: 0.90, botWRatio: 0.95, crown: 0.02, role: 'Nose Tip' }
];

function catmullRomScalar(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * Evaluates an interpolated longitudinal station across S0..S9 using
 * clamped Catmull-Rom / cosine-blended interpolation so hull curvature is smooth
 * while preserving exact station checkpoints.
 */
function interpolateStationAt(stations, uLong) {
  const n = stations.length;
  const zMin = stations[0].z;
  const zMax = stations[n - 1].z;
  const targetZ = zMin + uLong * (zMax - zMin);

  let segIdx = 0;
  for (let i = 0; i < n - 1; i++) {
    if (targetZ >= stations[i].z && targetZ <= stations[i + 1].z) {
      segIdx = i;
      break;
    }
  }
  const sA = stations[segIdx];
  const sB = stations[Math.min(n - 1, segIdx + 1)];
  const sPrev = stations[Math.max(0, segIdx - 1)];
  const sNext = stations[Math.min(n - 1, segIdx + 2)];

  const span = Math.max(1e-6, sB.z - sA.z);
  const rawT = Math.max(0, Math.min(1, (targetZ - sA.z) / span));
  // Blend linear + cosine + Catmull-Rom for smooth C1 continuity without overshoot
  const cosT = 0.5 - 0.5 * Math.cos(rawT * Math.PI);

  const evalProp = (key, minVal, maxVal) => {
    const cr = catmullRomScalar(sPrev[key], sA[key], sB[key], sNext[key], rawT);
    const lin = sA[key] + (sB[key] - sA[key]) * cosT;
    const val = 0.65 * cr + 0.35 * lin;
    return Math.max(minVal, Math.min(maxVal, val));
  };

  return {
    z: targetZ,
    yBot: evalProp('yBot', 0.18, 0.50),
    yTop: evalProp('yTop', 0.34, 1.42),
    halfW: evalProp('halfW', 0.20, 0.96),
    topWRatio: evalProp('topWRatio', 0.45, 0.96),
    botWRatio: evalProp('botWRatio', 0.70, 0.98),
    crown: evalProp('crown', 0.01, 0.16)
  };
}

/**
 * Evaluates a point `(x, y)` on a station cross-section perimeter for `s in [0, 1]`:
 * - `s = 0.00`: Bottom belly center `(0, yBot)`
 * - `s = 0.25`: Left (`-X`) flank center `(-halfW, yMid)`
 * - `s = 0.50`: Top roof/hood crown center `(0, yTop)`
 * - `s = 0.75`: Right (`+X`) flank center `(+halfW, yMid)`
 * - `s = 1.00`: Bottom belly center `(0, yBot)`
 */
function sampleStationCrossSection(st, s) {
  const sNorm = ((s % 1) + 1) % 1;
  const H = Math.max(0.08, st.yTop - st.yBot);
  const crown = Math.min(st.crown, H * 0.32);
  const wBot = st.halfW * st.botWRatio;
  const wTop = st.halfW * st.topWRatio;
  const wMid = st.halfW;
  const wShoulder = st.halfW * (0.58 * st.topWRatio + 0.42);

  const yChine = st.yBot + H * 0.06;
  const yLowerBelt = st.yBot + H * 0.24;
  const yFlankCenter = st.yBot + H * 0.46;
  const yShoulder = st.yBot + H * 0.70;
  const yRoofEdge = st.yTop - crown;

  // 12 symmetric perimeter control knots around s in [0, 1]
  // Carefully spaced so s = 0.25 is Left (-X) flank center, s = 0.50 is Top (0, yTop), s = 0.75 is Right (+X) flank center
  const knots = [
    { s: 0.00, x: 0.0, y: st.yBot },
    { s: 0.08, x: -wBot, y: yChine },
    { s: 0.16, x: -wMid, y: yLowerBelt },
    { s: 0.25, x: -wMid * 0.99, y: yFlankCenter },
    { s: 0.34, x: -wShoulder, y: yShoulder },
    { s: 0.42, x: -wTop, y: yRoofEdge },
    { s: 0.50, x: 0.0, y: st.yTop },
    { s: 0.58, x: +wTop, y: yRoofEdge },
    { s: 0.66, x: +wShoulder, y: yShoulder },
    { s: 0.75, x: +wMid * 0.99, y: yFlankCenter },
    { s: 0.84, x: +wMid, y: yLowerBelt },
    { s: 0.92, x: +wBot, y: yChine },
    { s: 1.00, x: 0.0, y: st.yBot }
  ];

  const m = knots.length - 1; // 12 segments
  let idx = 0;
  for (let i = 0; i < m; i++) {
    if (sNorm >= knots[i].s && sNorm <= knots[i + 1].s) {
      idx = i;
      break;
    }
  }

  const k0 = knots[(idx - 1 + m) % m];
  const k1 = knots[idx];
  const k2 = knots[idx + 1];
  const k3 = knots[(idx + 2) % m];

  const segSpan = Math.max(1e-6, k2.s - k1.s);
  const localT = Math.max(0, Math.min(1, (sNorm - k1.s) / segSpan));

  const x = catmullRomScalar(k0.x, k1.x, k2.x, k3.x, localT);
  const y = catmullRomScalar(k0.y, k1.y, k2.y, k3.y, localT);

  return { x, y };
}

/**
 * Builds the 3D multi-station cross-section lofted BufferGeometry for the Octane-RLX monocoque hull.
 * Includes separated endcap vertex rings with flat longitudinal normals `(0, 0, -1)` and `(0, 0, +1)`
 * so endcaps never average with smooth hull skin normals.
 *
 * @param {object} THREEOrStations - Either the THREE namespace or stations array
 * @param {Array} [maybeStations] - Array of longitudinal station definitions (`S0..S9`)
 * @param {number} [maybeRadialSegments=64] - Number of radial perimeter subdivisions
 */
export function createLoftedShellGeometry(
  THREEOrStations,
  maybeStations = DEFAULT_LOFT_STATIONS,
  maybeRadialSegments = 64
) {
  let THREE = THREE_IMPORT;
  let stations = DEFAULT_LOFT_STATIONS;
  let radialSegments = 64;

  if (Array.isArray(THREEOrStations)) {
    stations = THREEOrStations;
    if (typeof maybeStations === 'number') radialSegments = maybeStations;
  } else {
    THREE = resolveTHREE(THREEOrStations);
    if (Array.isArray(maybeStations) && maybeStations.length >= 2) {
      stations = maybeStations;
    }
    if (typeof maybeRadialSegments === 'number') {
      radialSegments = maybeRadialSegments;
    }
  }

  radialSegments = Math.max(24, Math.floor(radialSegments));
  const longitudinalSegments = 48;

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  // 1. Pre-sample longitudinal station slices
  const slices = [];
  for (let i = 0; i <= longitudinalSegments; i++) {
    const u = i / longitudinalSegments;
    const st = interpolateStationAt(stations, u);
    const ring = [];
    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const pt = sampleStationCrossSection(st, v);
      ring.push({ x: pt.x, y: pt.y, z: st.z, u, v });
    }
    slices.push({ st, u, ring });
  }

  // 2. Emit hull skin vertices & compute smooth analytical surface normals
  for (let i = 0; i <= longitudinalSegments; i++) {
    const slicePrev = slices[Math.max(0, i - 1)];
    const sliceCurr = slices[i];
    const sliceNext = slices[Math.min(longitudinalSegments, i + 1)];

    for (let j = 0; j <= radialSegments; j++) {
      const p = sliceCurr.ring[j];
      positions.push(p.x, p.y, p.z);
      uvs.push(p.u, p.v);

      // Tangent along u (+Z longitudinal)
      const pU0 = slicePrev.ring[j];
      const pU1 = sliceNext.ring[j];
      const tux = pU1.x - pU0.x;
      const tuy = pU1.y - pU0.y;
      const tuz = pU1.z - pU0.z;

      // Tangent along v (perimeter loop: bottom -> left(-X) -> top(+Y) -> right(+X) -> bottom)
      const jPrev = (j - 1 + radialSegments) % radialSegments;
      const jNext = (j + 1) % radialSegments;
      const pV0 = sliceCurr.ring[jPrev];
      const pV1 = sliceCurr.ring[jNext];
      const tvx = pV1.x - pV0.x;
      const tvy = pV1.y - pV0.y;
      const tvz = pV1.z - pV0.z;

      // Outward normal N = normalize(T_u x T_v)
      let nx = tuy * tvz - tuz * tvy;
      let ny = tuz * tvx - tux * tvz;
      let nz = tux * tvy - tuy * tvx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      normals.push(nx, ny, nz);
    }
  }

  // 3. Emit hull skin triangle indices (outward CCW winding)
  const stride = radialSegments + 1;
  for (let i = 0; i < longitudinalSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);
      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  // 4. Emit SEPARATED Rear Endcap at S0 (z = -1.95) with flat normal (0, 0, -1)
  const rearSlice = slices[0];
  const rearCenterY = 0.5 * (rearSlice.st.yBot + rearSlice.st.yTop);
  const rearCenterIdx = positions.length / 3;
  positions.push(0, rearCenterY, rearSlice.st.z);
  normals.push(0, 0, -1);
  uvs.push(0.02, 0.5);

  const rearRingStartIdx = positions.length / 3;
  for (let j = 0; j <= radialSegments; j++) {
    const p = rearSlice.ring[j];
    positions.push(p.x, p.y, p.z);
    normals.push(0, 0, -1);
    uvs.push(0.02, p.v);
  }
  for (let j = 0; j < radialSegments; j++) {
    // Looking from -Z toward +Z, ring goes clockwise, so (center, j+1, j) has outward -Z normal
    indices.push(rearCenterIdx, rearRingStartIdx + j + 1, rearRingStartIdx + j);
  }

  // 5. Emit SEPARATED Front Endcap at S9 (z = +2.10) with flat normal (0, 0, +1)
  const frontSlice = slices[longitudinalSegments];
  const frontCenterY = 0.5 * (frontSlice.st.yBot + frontSlice.st.yTop);
  const frontCenterIdx = positions.length / 3;
  positions.push(0, frontCenterY, frontSlice.st.z);
  normals.push(0, 0, 1);
  uvs.push(0.98, 0.5);

  const frontRingStartIdx = positions.length / 3;
  for (let j = 0; j <= radialSegments; j++) {
    const p = frontSlice.ring[j];
    positions.push(p.x, p.y, p.z);
    normals.push(0, 0, 1);
    uvs.push(0.98, p.v);
  }
  for (let j = 0; j < radialSegments; j++) {
    // Outward +Z normal
    indices.push(frontCenterIdx, frontRingStartIdx + j, frontRingStartIdx + j + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

// ============================================================================
// 2. HIGH-RESOLUTION (2048x1024) BILATERAL UV LIVERY GENERATOR
// ============================================================================

const LIVERY_CACHE = new Map();

/**
 * Generates the `2048x1024` bilateral UV livery texture for the Octane-RLX hull.
 * Parameterization:
 * - `u in [0, 1]` maps longitudinal `z` from `S0 (-1.95m)` to `S9 (+2.10m)` (`x_px = u * 2048`).
 * - `v in [0, 1]` maps perimeter `s` (`y_px = (1 - v) * 1024` with `flipY = true`):
 *   - `v = 0.50` (`y_px = 512`): Top Roof / Hood centerline (`x = 0`)
 *   - `v = 0.25` (`y_px = 768`): Left (`-X`) flank center
 *   - `v = 0.75` (`y_px = 256`): Right (`+X`) flank center
 *
 * Explicit Bilateral Flank Transforms prevent mirrored text/numbers:
 * - On Left (`-X`) flank (`v = 0.25`, `y_px = 768`), viewing from `-X` puts `+Z` (Nose, high `u`) on screen-left
 *   and `+Y` (Roof, `v = 0.50`, `y_px = 512`) on screen-top -> `ctx.scale(-1, +1)` makes glyphs read left-to-right & upright!
 * - On Right (`+X`) flank (`v = 0.75`, `y_px = 256`), viewing from `+X` puts `-Z` (Rear, low `u`) on screen-left
 *   and `+Y` (Roof, `v = 0.50`, `y_px = 512`) on screen-top -> `ctx.scale(+1, -1)` makes glyphs read left-to-right & upright!
 */
export function generateCarLiveryTexture(team = 'blue', carNumber = null, maybeTHREE = null) {
  const THREE = resolveTHREE(maybeTHREE);
  const normalizedTeam = String(team || 'blue').toLowerCase() === 'orange' ? 'orange' : 'blue';
  const numStr = carNumber ? String(carNumber) : (normalizedTeam === 'blue' ? '01' : '02');
  const cacheKey = `${normalizedTeam}_${numStr}`;

  if (LIVERY_CACHE.has(cacheKey)) {
    return LIVERY_CACHE.get(cacheKey);
  }

  const width = 2048;
  const height = 1024;

  // Headless Node fallback when DOM canvas is unavailable
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    const data = new Uint8Array(64 * 32 * 4);
    const r = normalizedTeam === 'blue' ? 0 : 255;
    const g = normalizedTeam === 'blue' ? 102 : 85;
    const b = normalizedTeam === 'blue' ? 255 : 0;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, 64, 32);
    tex.needsUpdate = true;
    LIVERY_CACHE.set(cacheKey, tex);
    return tex;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const palette = normalizedTeam === 'blue'
    ? {
        baseDark: '#002b80',
        baseMid: '#0058e6',
        baseBright: '#0088ff',
        accent: '#00e5ff',
        accentSecondary: '#70f3ff',
        stripeCore: '#00e5ff',
        stripeEdge: '#e6fbff',
        numberBg: '#06152d',
        numberBorder: '#00e5ff',
        numberText: '#ffffff'
      }
    : {
        baseDark: '#8c2300',
        baseMid: '#ff4d00',
        baseBright: '#ff7700',
        accent: '#ffae00',
        accentSecondary: '#ffe066',
        stripeCore: '#ffae00',
        stripeEdge: '#fff5cc',
        numberBg: '#260d04',
        numberBorder: '#ffae00',
        numberText: '#ffffff'
      };

  // 1. Base metallic longitudinal + perimeter gradient
  const baseGrad = ctx.createLinearGradient(0, 0, 0, height);
  baseGrad.addColorStop(0.00, '#11161f');        // v = 1.00 bottom center
  baseGrad.addColorStop(0.11, '#18202c');        // v = 0.89 lower rocker
  baseGrad.addColorStop(0.14, palette.baseDark);
  baseGrad.addColorStop(0.25, palette.baseMid);  // v = 0.75 Right (+X) flank center
  baseGrad.addColorStop(0.38, palette.baseBright);
  baseGrad.addColorStop(0.50, palette.baseMid);  // v = 0.50 Top roof/hood centerline
  baseGrad.addColorStop(0.62, palette.baseBright);
  baseGrad.addColorStop(0.75, palette.baseMid);  // v = 0.25 Left (-X) flank center
  baseGrad.addColorStop(0.86, palette.baseDark);
  baseGrad.addColorStop(0.89, '#18202c');        // v = 0.11 lower rocker
  baseGrad.addColorStop(1.00, '#11161f');        // v = 0.00 bottom center
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle longitudinal highlight sheen towards nose & cockpit apex
  const longGrad = ctx.createLinearGradient(0, 0, width, 0);
  longGrad.addColorStop(0.00, 'rgba(0,0,0,0.32)');
  longGrad.addColorStop(0.35, 'rgba(255,255,255,0.08)');
  longGrad.addColorStop(0.65, 'rgba(255,255,255,0.14)');
  longGrad.addColorStop(1.00, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = longGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Carbon-fiber lower chassis belly & rocker skirts (v in [0, 0.13] -> y in [890, 1024], v in [0.87, 1.0] -> y in [0, 134])
  ctx.fillStyle = '#121720';
  ctx.fillRect(0, 0, width, 136);
  ctx.fillRect(0, height - 136, width, 136);

  // Carbon weave diagonal micro-stripes on lower rockers
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 3;
  for (let x = -height; x < width + height; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 136, 136);
    ctx.moveTo(x, height - 136);
    ctx.lineTo(x + 136, height);
    ctx.stroke();
  }
  ctx.restore();

  // Rocker accent pinstripes at v = 0.135 (y = 886) and v = 0.865 (y = 138)
  ctx.fillStyle = palette.accent;
  ctx.fillRect(140, 134, width - 240, 8);
  ctx.fillRect(140, height - 142, width - 240, 8);

  // 3. Twin Centerline Hood & Roof Racing Stripes along v = 0.50 (y = 512)
  const centerY = height * 0.5;
  ctx.fillStyle = palette.stripeEdge;
  ctx.fillRect(80, centerY - 52, width - 120, 104);
  ctx.fillStyle = palette.baseDark;
  ctx.fillRect(80, centerY - 46, width - 120, 92);
  ctx.fillStyle = palette.stripeCore;
  ctx.fillRect(80, centerY - 40, width - 120, 30);
  ctx.fillRect(80, centerY + 10, width - 120, 30);

  // 4. Upper Shoulder Accent Lines along v = 0.37 (y = 645) and v = 0.63 (y = 379)
  ctx.fillStyle = palette.accent;
  ctx.fillRect(220, 372, width - 320, 10);
  ctx.fillRect(220, height - 382, width - 320, 10);

  // 5. Automotive Panel Seam Lines at station checkpoints
  const zMin = -1.95;
  const zMax = +2.10;
  const stationZs = [-1.55, -0.95, -0.35, +0.25, +0.75, +1.25, +1.68, +1.98];
  ctx.strokeStyle = 'rgba(5, 10, 18, 0.55)';
  ctx.lineWidth = 3;
  for (const sz of stationZs) {
    const ux = ((sz - zMin) / (zMax - zMin)) * width;
    ctx.beginPath();
    ctx.moveTo(ux, 136);
    ctx.lineTo(ux, height - 136);
    ctx.stroke();
  }

  // 6. Helper to draw non-mirrored sidepod graphics, racing numeral ("01"/"02"), and "OCTANE-RLX" badge
  // in local flank coordinates where +dx = screen-right and +dy = screen-down when viewing that flank from outside!
  const drawBilateralFlankGraphics = (centerX, centerYFlank, scaleX, scaleY) => {
    ctx.save();
    ctx.translate(centerX, centerYFlank);
    ctx.scale(scaleX, scaleY);

    // Sculpted dark carbon trapezoid door badge backing behind the number plate
    ctx.fillStyle = '#0c1320';
    ctx.beginPath();
    ctx.moveTo(-248, -82);
    ctx.lineTo(248, -82);
    ctx.lineTo(214, 92);
    ctx.lineTo(-214, 92);
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = 6;
    ctx.strokeStyle = palette.accent;
    ctx.stroke();

    // Bilateral aerodynamic speed chevrons flanking the number box on both sides
    ctx.fillStyle = palette.accent;
    for (let k = 0; k < 3; k++) {
      const lx = -196 + k * 28;
      ctx.beginPath();
      ctx.moveTo(lx, -56);
      ctx.lineTo(lx + 16, -56);
      ctx.lineTo(lx - 6, 36);
      ctx.lineTo(lx - 22, 36);
      ctx.closePath();
      ctx.fill();

      const rx = 124 + k * 28;
      ctx.beginPath();
      ctx.moveTo(rx, -56);
      ctx.lineTo(rx + 16, -56);
      ctx.lineTo(rx - 6, 36);
      ctx.lineTo(rx - 22, 36);
      ctx.closePath();
      ctx.fill();
    }

    // High-contrast racing number box
    ctx.fillStyle = palette.numberBg;
    ctx.beginPath();
    ctx.roundRect(-96, -68, 192, 108, 12);
    ctx.fill();

    ctx.lineWidth = 5;
    ctx.strokeStyle = palette.numberBorder;
    ctx.stroke();

    // Crisp racing numeral ("01" for Blue, "02" for Orange)
    ctx.fillStyle = palette.numberText;
    ctx.font = '900 88px "Impact", "Arial Black", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(numStr, 0, -12);

    // Subtle cyan/gold outline on numeral
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = palette.accentSecondary;
    ctx.strokeText(numStr, 0, -12);

    // "OCTANE-RLX // TURBO" technical badging along lower badge strip (well inside the cyan border)
    ctx.fillStyle = palette.accentSecondary;
    ctx.font = 'bold 21px "Arial", system-ui, sans-serif';
    ctx.fillText('OCTANE-RLX // TURBO', 0, 66);

    ctx.restore();
  };

  // Door number plate longitudinal center at z = +0.12m (forward of rear quarter sidepod intake)
  const doorCenterX = Math.round(((0.12 - zMin) / (zMax - zMin)) * width);

  // Left (-X) Flank around v = 0.27 -> y_px = (1 - 0.27) * 1024 = 748
  // Viewed from -X looking toward +X: Screen-Right is +Z (+u => +x_px => scaleX = +1), Screen-Down is -Y (-v => +y_px => scaleY = +1)
  drawBilateralFlankGraphics(doorCenterX, 748, 1, 1);

  // Right (+X) Flank around v = 0.73 -> y_px = (1 - 0.73) * 1024 = 276
  // Viewed from +X looking toward -X: Screen-Right is -Z (-u => -x_px => scaleX = -1), Screen-Down is -Y (+v => -y_px => scaleY = -1)
  drawBilateralFlankGraphics(doorCenterX, 276, -1, -1);

  // Nose cone emblem at z = +1.78m (u = 0.92, v = 0.50 -> y_px = 512)
  const noseX = Math.round(((1.78 - zMin) / (zMax - zMin)) * width);
  ctx.save();
  ctx.translate(noseX, centerY);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#0b1320';
  ctx.beginPath();
  ctx.roundRect(-42, -28, 84, 56, 8);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = palette.accent;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 34px "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(numStr, 0, 2);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in texture && THREE.SRGBColorSpace) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  texture.anisotropy = 8;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  LIVERY_CACHE.set(cacheKey, texture);
  return texture;
}

// ============================================================================
// 3. PROCEDURAL TIRE SIDEWALL / TREAD & REAR BADGE TEXTURES
// ============================================================================

let CACHED_TIRE_SIDEWALL_TEX = null;

function getTireSidewallTexture(THREE) {
  if (CACHED_TIRE_SIDEWALL_TEX) return CACHED_TIRE_SIDEWALL_TEX;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#181a1f';
  ctx.fillRect(0, 0, 512, 512);

  // Radial sidewall ribs
  ctx.strokeStyle = '#252932';
  ctx.lineWidth = 3;
  for (let a = 0; a < 64; a++) {
    const ang = (a / 64) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(256 + Math.cos(ang) * 155, 256 + Math.sin(ang) * 155);
    ctx.lineTo(256 + Math.cos(ang) * 235, 256 + Math.sin(ang) * 235);
    ctx.stroke();
  }

  // Concentric sidewall rings
  ctx.strokeStyle = '#2e3440';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(256, 256, 218, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(256, 256, 172, 0, Math.PI * 2);
  ctx.stroke();

  // Crisp sidewall stencil lettering
  ctx.save();
  ctx.translate(256, 256);
  ctx.fillStyle = '#9aa5b8';
  ctx.font = 'bold 20px "Arial", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelTop = 'RLX-PRO // GEOLANDAR A/T';
  for (let i = 0; i < labelTop.length; i++) {
    const theta = -Math.PI * 0.72 + i * 0.062;
    ctx.save();
    ctx.rotate(theta + Math.PI / 2);
    ctx.fillText(labelTop[i], 0, -195);
    ctx.restore();
  }
  const labelBot = '285/40R18 // ULTRA GRIP';
  for (let i = 0; i < labelBot.length; i++) {
    const theta = Math.PI * 0.28 + i * 0.062;
    ctx.save();
    ctx.rotate(theta + Math.PI / 2);
    ctx.fillText(labelBot[i], 0, -195);
    ctx.restore();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in tex && THREE.SRGBColorSpace) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.needsUpdate = true;
  CACHED_TIRE_SIDEWALL_TEX = tex;
  return tex;
}

function createRearBadgeTexture(THREE, badgeText = 'RLX-01', accentColor = '#00e5ff') {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#090e17';
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 248, 88);

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 44px "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, 128, 50);

  const tex = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in tex && THREE.SRGBColorSpace) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.needsUpdate = true;
  return tex;
}

let CACHED_SOFT_SHADOW_TEX = null;

function getSoftShadowTexture(THREE) {
  if (CACHED_SOFT_SHADOW_TEX) return CACHED_SOFT_SHADOW_TEX;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 124);
  grad.addColorStop(0.0, 'rgba(0, 0, 0, 0.82)');
  grad.addColorStop(0.45, 'rgba(0, 0, 0, 0.52)');
  grad.addColorStop(0.78, 'rgba(0, 0, 0, 0.16)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  CACHED_SOFT_SHADOW_TEX = tex;
  return tex;
}

// ============================================================================
// 4. MECHANICAL SUB-ASSEMBLY BUILDERS (WHEELS, WISHBONES, THRUSTERS, SPOILER)
// ============================================================================

/**
 * Creates a true 3D helical spring geometry around the Y axis from y = -halfLen to +halfLen
 */
function createHelicalSpringGeometry(THREE, radius = 0.052, wireRadius = 0.011, height = 0.30, turns = 6.5) {
  class HelixCurve extends THREE.Curve {
    getPoint(t, optionalTarget = new THREE.Vector3()) {
      const angle = t * turns * Math.PI * 2;
      const y = (t - 0.5) * height;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      return optionalTarget.set(x, y, z);
    }
  }
  return new THREE.TubeGeometry(new HelixCurve(), 72, wireRadius, 8, false);
}

/**
 * Builds an articulated Wheel & Brake Assembly:
 * - `steerPivot`: Rotates around Y for front steering; carries non-rotating steering knuckle,
 *   slotted ventilated brake rotor, and team-anodized brake caliper.
 * - `spinPivot`: Rotates around X for rolling spin; carries sculpted radial tire carcass,
 *   24 3D shoulder tread lugs, 6-spoke deep-dish forged alloy rim, and center-lock nut.
 * - `contactShadow`: Soft ground contact occlusion decal at the tire contact patch (`y = -radius + 0.004`).
 */
function createWheelAssembly(THREE, {
  radius = 0.40,
  width = 0.34,
  isLeft = true,
  isFront = true,
  accentHex = 0x00e5ff,
  coilHex = 0xff6600
}) {
  const wheelRoot = new THREE.Group();
  wheelRoot.name = `wheel_${isFront ? 'F' : 'R'}${isLeft ? 'L' : 'R'}`;

  const steerPivot = new THREE.Group();
  steerPivot.name = 'steerPivot';
  wheelRoot.add(steerPivot);

  const spinPivot = new THREE.Group();
  spinPivot.name = 'spinPivot';
  steerPivot.add(spinPivot);

  const sideSign = isLeft ? -1 : 1; // Outward flank direction (-X for Left, +X for Right)

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x1b1e24,
    roughness: 0.78,
    metalness: 0.08
  });

  const sidewallTex = getTireSidewallTexture(THREE);
  const sidewallMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: sidewallTex || null,
    roughness: 0.68,
    metalness: 0.12
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x3b4352,
    metalness: 0.86,
    roughness: 0.24
  });

  const rimLipMat = new THREE.MeshStandardMaterial({
    color: 0x9aa6b8,
    metalness: 0.92,
    roughness: 0.16
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 0.25,
    metalness: 0.75,
    roughness: 0.22
  });

  // 1. Sculpted radial tire carcass (Lathe profile rotated so axle is along X)
  const rimRadius = radius * 0.60;
  const halfW = width * 0.5;
  const bevelW = width * 0.09;
  const lathePts = [
    new THREE.Vector2(rimRadius, -halfW + bevelW * 0.4),
    new THREE.Vector2(radius * 0.88, -halfW),
    new THREE.Vector2(radius * 0.97, -halfW + bevelW),
    new THREE.Vector2(radius * 0.99, 0),
    new THREE.Vector2(radius * 0.97, halfW - bevelW),
    new THREE.Vector2(radius * 0.88, halfW),
    new THREE.Vector2(rimRadius, halfW - bevelW * 0.4)
  ];
  const tireCarcassGeo = new THREE.LatheGeometry(lathePts, 36);
  tireCarcassGeo.rotateZ(Math.PI / 2); // Align lathe Y axis along local X axle
  const tireCarcass = new THREE.Mesh(tireCarcassGeo, tireMat);
  tireCarcass.castShadow = true;
  tireCarcass.receiveShadow = true;
  steerPivot.add(tireCarcass);

  // Sidewall lettered rings on outward and inward faces
  const sidewallRingGeo = new THREE.RingGeometry(rimRadius * 0.98, radius * 0.94, 36);
  const outerSidewall = new THREE.Mesh(sidewallRingGeo, sidewallMat);
  outerSidewall.position.x = sideSign * (halfW + 0.002);
  outerSidewall.rotation.y = sideSign > 0 ? Math.PI / 2 : -Math.PI / 2;
  steerPivot.add(outerSidewall);

  // 2. 24 Sculpted 3D Radial Tire Tread Lugs (guarantees unmistakable 3D tread silhouette)
  const numLugs = 24;
  const lugGeo = new THREE.BoxGeometry(width * 0.40, radius * 0.055, radius * 0.14);
  for (let k = 0; k < numLugs; k++) {
    const theta = (k / numLugs) * Math.PI * 2;
    const cy = Math.cos(theta) * (radius * 0.978);
    const cz = Math.sin(theta) * (radius * 0.978);

    // Dual staggered shoulder tread blocks
    for (const rowSign of [-1, 1]) {
      const lug = new THREE.Mesh(lugGeo, tireMat);
      const rowOffsetAngle = theta + (rowSign * 0.04);
      lug.position.set(
        rowSign * (width * 0.23),
        Math.cos(rowOffsetAngle) * (radius * 0.968),
        Math.sin(rowOffsetAngle) * (radius * 0.968)
      );
      lug.rotation.x = -rowOffsetAngle;
      lug.rotation.y = rowSign * 0.18;
      spinPivot.add(lug);
    }
  }

  // 3. Deep-Dish 6-Spoke Forged Alloy Rim
  const rimBarrelGeo = new THREE.CylinderGeometry(rimRadius, rimRadius, width * 0.84, 32, 1, true);
  rimBarrelGeo.rotateZ(Math.PI / 2);
  const rimBarrel = new THREE.Mesh(rimBarrelGeo, rimLipMat);
  steerPivot.add(rimBarrel);

  // Glowing team-colored rim pinstripe ring
  const pinstripeGeo = new THREE.TorusGeometry(rimRadius * 0.98, 0.010, 8, 36);
  pinstripeGeo.rotateY(Math.PI / 2);
  const pinstripe = new THREE.Mesh(pinstripeGeo, accentMat);
  pinstripe.position.x = sideSign * (halfW * 0.82);
  steerPivot.add(pinstripe);

  // 6 Sculpted Twin-Chamfer Spokes
  const spokeLen = rimRadius * 1.78;
  const spokeGeo = new THREE.BoxGeometry(0.036, spokeLen, 0.052);
  for (let s = 0; s < 3; s++) {
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    spoke.position.x = sideSign * (halfW * 0.58);
    spoke.rotation.x = (s / 3) * Math.PI;
    spinPivot.add(spoke);
  }

  // Center hub & anodized center-lock nut
  const hubGeo = new THREE.CylinderGeometry(rimRadius * 0.28, rimRadius * 0.32, width * 0.35, 16);
  hubGeo.rotateZ(Math.PI / 2);
  const hubMesh = new THREE.Mesh(hubGeo, rimMat);
  hubMesh.position.x = sideSign * (halfW * 0.52);
  steerPivot.add(hubMesh);

  const lockNutGeo = new THREE.CylinderGeometry(rimRadius * 0.15, rimRadius * 0.18, 0.06, 6);
  lockNutGeo.rotateZ(Math.PI / 2);
  const lockNut = new THREE.Mesh(lockNutGeo, accentMat);
  lockNut.position.x = sideSign * (halfW * 0.72);
  spinPivot.add(lockNut);

  // 4. Non-Rotating Slotted Brake Rotor, Caliper & Steering Knuckle (attached to steerPivot!)
  const rotorRadius = rimRadius * 0.76;
  const rotorGeo = new THREE.CylinderGeometry(rotorRadius, rotorRadius, 0.026, 28);
  rotorGeo.rotateZ(Math.PI / 2);
  const rotorMat = new THREE.MeshStandardMaterial({
    color: 0x8a95a5,
    metalness: 0.88,
    roughness: 0.30
  });
  const brakeRotor = new THREE.Mesh(rotorGeo, rotorMat);
  brakeRotor.position.x = sideSign * (halfW * 0.20);
  steerPivot.add(brakeRotor);

  // Brake caliper (mounted toward the rear/front of the rotor)
  const caliperGeo = new THREE.BoxGeometry(0.068, rotorRadius * 0.65, 0.11);
  const caliperMat = new THREE.MeshStandardMaterial({
    color: coilHex,
    metalness: 0.65,
    roughness: 0.28
  });
  const caliper = new THREE.Mesh(caliperGeo, caliperMat);
  caliper.position.set(
    sideSign * (halfW * 0.22),
    rotorRadius * 0.32,
    isFront ? -rotorRadius * 0.68 : rotorRadius * 0.68
  );
  steerPivot.add(caliper);

  // Steering knuckle upright behind the hub
  const knuckleGeo = new THREE.BoxGeometry(0.06, radius * 0.52, 0.09);
  const knuckle = new THREE.Mesh(knuckleGeo, rimMat);
  knuckle.position.set(-sideSign * (halfW * 0.18), 0, 0);
  steerPivot.add(knuckle);

  // 5. Soft Ground Contact Occlusion Shadow Decal at bottom of tire (y = -radius + 0.004)
  const shadowTex = getSoftShadowTexture(THREE);
  const contactShadowGeo = new THREE.PlaneGeometry(width * 1.05, radius * 1.75);
  contactShadowGeo.rotateX(-Math.PI / 2);
  const contactShadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    map: shadowTex || null,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
  contactShadow.position.set(0, -radius + 0.004, 0);
  contactShadow.renderOrder = 1;
  wheelRoot.add(contactShadow);

  wheelRoot.userData = {
    radius,
    width,
    isLeft,
    isFront,
    steerPivot,
    spinPivot,
    contactShadow,
    restPosition: new THREE.Vector3()
  };

  return wheelRoot;
}

/**
 * Builds an Exposed Double-Wishbone & Helical Coilover Strut Corner Assembly (`FL, FR, RL, RR`)
 * reaching from the chassis bulkhead out to the wheel steering knuckle.
 */
function createSuspensionCornerAssembly(THREE, {
  isLeft = true,
  isFront = true,
  wheelX = 0.92,
  wheelY = 0.40,
  wheelZ = 1.32,
  chassisInnerX = 0.44,
  accentHex = 0x00e5ff,
  coilHex = 0xff6b00
}) {
  const suspGroup = new THREE.Group();
  suspGroup.name = `suspension_${isFront ? 'F' : 'R'}${isLeft ? 'L' : 'R'}`;

  const sideSign = isLeft ? -1 : 1;
  const innerX = sideSign * Math.abs(chassisInnerX);
  const outerX = sideSign * (Math.abs(wheelX) - 0.14);

  const armMat = new THREE.MeshStandardMaterial({
    color: 0x2a313d,
    metalness: 0.85,
    roughness: 0.28
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xd8e2f0,
    metalness: 0.95,
    roughness: 0.12
  });

  const coilMat = new THREE.MeshStandardMaterial({
    color: coilHex,
    metalness: 0.55,
    roughness: 0.25
  });

  const reservoirMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    metalness: 0.78,
    roughness: 0.20
  });

  // Helper to build a tubular strut between two 3D points
  const addLinkTube = (parent, pA, pB, rad, mat) => {
    const dir = new THREE.Vector3().subVectors(pB, pA);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
    const geo = new THREE.CylinderGeometry(rad, rad, len, 10);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Pivoting wishbone sub-group (tilts dynamically with wheel vertical travel)
  const wishbonePivot = new THREE.Group();
  wishbonePivot.position.set(innerX, wheelY, wheelZ);
  suspGroup.add(wishbonePivot);

  const dx = outerX - innerX;

  // Lower A-Arm (2 converged arms + ball joint)
  addLinkTube(
    wishbonePivot,
    new THREE.Vector3(0, -0.09, -0.16),
    new THREE.Vector3(dx, -0.08, 0),
    0.022,
    armMat
  );
  addLinkTube(
    wishbonePivot,
    new THREE.Vector3(0, -0.09, +0.16),
    new THREE.Vector3(dx, -0.08, 0),
    0.022,
    armMat
  );

  // Upper A-Arm (2 converged arms + ball joint)
  addLinkTube(
    wishbonePivot,
    new THREE.Vector3(-sideSign * 0.04, +0.11, -0.14),
    new THREE.Vector3(dx * 0.92, +0.10, 0),
    0.019,
    armMat
  );
  addLinkTube(
    wishbonePivot,
    new THREE.Vector3(-sideSign * 0.04, +0.11, +0.14),
    new THREE.Vector3(dx * 0.92, +0.10, 0),
    0.019,
    armMat
  );

  // Chrome steering tie-rod
  addLinkTube(
    wishbonePivot,
    new THREE.Vector3(0, -0.01, isFront ? -0.11 : +0.11),
    new THREE.Vector3(dx * 0.95, -0.01, isFront ? -0.07 : +0.07),
    0.014,
    chromeMat
  );

  // Angled Coilover Spring-Damper Strut reaching from upper shock tower to lower A-arm
  const shockTop = new THREE.Vector3(-sideSign * 0.05, +0.28, 0);
  const shockBot = new THREE.Vector3(dx * 0.72, -0.06, 0);
  const shockDir = new THREE.Vector3().subVectors(shockBot, shockTop);
  const shockLen = shockDir.length();
  const shockMid = new THREE.Vector3().addVectors(shockTop, shockBot).multiplyScalar(0.5);

  const coiloverGroup = new THREE.Group();
  coiloverGroup.position.copy(shockMid);
  coiloverGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shockDir.clone().normalize());
  wishbonePivot.add(coiloverGroup);

  // Chrome damper shaft
  const shaftGeo = new THREE.CylinderGeometry(0.018, 0.018, shockLen * 0.95, 10);
  coiloverGroup.add(new THREE.Mesh(shaftGeo, chromeMat));

  // Upper anodized shock body & piggyback reservoir
  const bodyGeo = new THREE.CylinderGeometry(0.034, 0.034, shockLen * 0.42, 12);
  const bodyMesh = new THREE.Mesh(bodyGeo, reservoirMat);
  bodyMesh.position.y = -shockLen * 0.24;
  coiloverGroup.add(bodyMesh);

  // True 3D Helical Coil Spring around damper
  const springGeo = createHelicalSpringGeometry(THREE, 0.046, 0.0105, shockLen * 0.62, 6.5);
  const springMesh = new THREE.Mesh(springGeo, coilMat);
  springMesh.position.y = shockLen * 0.04;
  coiloverGroup.add(springMesh);

  suspGroup.userData = {
    wishbonePivot,
    coiloverGroup,
    springMesh,
    sideSign,
    spanX: Math.abs(dx),
    restPosition: new THREE.Vector3(0, 0, 0)
  };

  return suspGroup;
}

// ============================================================================
// 5. HERO BATTLE-CAR BUILDER (`createBattleCarMesh`)
// ============================================================================

/**
 * Builds the complete `Octane-RLX` Rocket-Powered Battle-Car mesh hierarchy.
 * Supports both `createBattleCarMesh(THREE, options)` and `createBattleCarMesh(options)`.
 */
export function createBattleCarMesh(THREEOrOptions = {}, maybeOptions = {}) {
  let THREE = THREE_IMPORT;
  let options = {};

  if (THREEOrOptions && THREEOrOptions.BufferGeometry && THREEOrOptions.Group) {
    THREE = THREEOrOptions;
    options = maybeOptions || {};
  } else {
    THREE = resolveTHREE(null);
    options = THREEOrOptions || {};
  }

  const team = String(options.team || 'blue').toLowerCase() === 'orange' ? 'orange' : 'blue';
  const carNumber = options.carNumber || (team === 'blue' ? '01' : '02');
  const isBlue = team === 'blue';

  const accentHex = isBlue ? 0x00e5ff : 0xffae00;
  const primaryHex = isBlue ? 0x0058e6 : 0xff4d00;
  const coilHex = isBlue ? 0xff6b00 : 0x00e5ff; // High-contrast racing coilover springs

  const carRoot = new THREE.Group();
  carRoot.name = `OctaneRLX_${team}_${carNumber}`;

  // Chassis Tilt Group (pitches/rolls with acceleration & steering while wheels track ground)
  const chassisTiltGroup = new THREE.Group();
  chassisTiltGroup.name = 'chassisTiltGroup';
  carRoot.add(chassisTiltGroup);

  // Shared PBR Materials
  const liveryTexture = generateCarLiveryTexture(team, carNumber, THREE);
  const bodyShellMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: liveryTexture,
    metalness: 0.42,
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08
  });

  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x161b24,
    metalness: 0.48,
    roughness: 0.36
  });

  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: 0x1e2532,
    metalness: 0.72,
    roughness: 0.30
  });

  const cageMat = new THREE.MeshStandardMaterial({
    color: isBlue ? 0x00b8ff : 0xff9900,
    metalness: 0.68,
    roughness: 0.24
  });

  const accentGlowMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 0.75,
    metalness: 0.4,
    roughness: 0.2
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a1526,
    metalness: 0.15,
    roughness: 0.06,
    transmission: 0.0,
    transparent: true,
    opacity: 0.84,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04
  });

  // --------------------------------------------------------------------------
  // A. MULTI-STATION LOFTED MAIN MONOCOQUE SHELL (S0..S9)
  // --------------------------------------------------------------------------
  const monocoqueGroup = new THREE.Group();
  monocoqueGroup.name = 'monocoqueGroup';
  chassisTiltGroup.add(monocoqueGroup);

  const shellGeo = createLoftedShellGeometry(THREE, DEFAULT_LOFT_STATIONS, 64);
  const shellMesh = new THREE.Mesh(shellGeo, bodyShellMat);
  shellMesh.name = 'loftedMonocoqueShell';
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;
  monocoqueGroup.add(shellMesh);

  // Sculpted Front & Rear Fender Arch Flares with Anodized Rim Trim (matching photoreal_turnaround_ref)
  for (const sideSign of [-1, 1]) {
    // Front high-clearance buggy fender arch above FL/FR wheel
    const fArchCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sideSign * 0.66, 0.56, 0.88),
      new THREE.Vector3(sideSign * 0.86, 0.82, 1.15),
      new THREE.Vector3(sideSign * 0.88, 0.86, 1.38),
      new THREE.Vector3(sideSign * 0.82, 0.72, 1.65)
    ]);
    const fArchMesh = new THREE.Mesh(
      new THREE.TubeGeometry(fArchCurve, 20, 0.042, 8, false),
      cageMat
    );
    fArchMesh.castShadow = true;
    monocoqueGroup.add(fArchMesh);

    // Rear muscular fender flare arch above RL/RR wheel
    const rArchCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sideSign * 0.84, 0.62, -0.78),
      new THREE.Vector3(sideSign * 0.94, 0.92, -1.08),
      new THREE.Vector3(sideSign * 0.95, 0.96, -1.36),
      new THREE.Vector3(sideSign * 0.86, 0.78, -1.68)
    ]);
    const rArchMesh = new THREE.Mesh(
      new THREE.TubeGeometry(rArchCurve, 20, 0.048, 8, false),
      cageMat
    );
    rArchMesh.castShadow = true;
    monocoqueGroup.add(rArchMesh);
  }

  // --------------------------------------------------------------------------
  // B. COCKPIT GREENHOUSE, INTERNAL ROLL-CAGE, ENGINE DECK & ROOF RAM-AIR SCOOP
  // --------------------------------------------------------------------------
  const greenhouseGroup = new THREE.Group();
  greenhouseGroup.name = 'greenhouseGroup';
  chassisTiltGroup.add(greenhouseGroup);

  const zMinHull = DEFAULT_LOFT_STATIONS[0].z;
  const zMaxHull = DEFAULT_LOFT_STATIONS[DEFAULT_LOFT_STATIONS.length - 1].z;
  const zToU = (zVal) => Math.max(0, Math.min(1, (zVal - zMinHull) / (zMaxHull - zMinHull)));

  const evalHullSurfacePoint = (u, v, normalOffset = 0.008) => {
    const uClamped = Math.max(0, Math.min(1, u));
    const st = interpolateStationAt(DEFAULT_LOFT_STATIONS, uClamped);
    const pt = sampleStationCrossSection(st, v);

    const du = 0.008;
    const stU0 = interpolateStationAt(DEFAULT_LOFT_STATIONS, Math.max(0, uClamped - du));
    const stU1 = interpolateStationAt(DEFAULT_LOFT_STATIONS, Math.min(1, uClamped + du));
    const ptU0 = sampleStationCrossSection(stU0, v);
    const ptU1 = sampleStationCrossSection(stU1, v);
    const tux = ptU1.x - ptU0.x;
    const tuy = ptU1.y - ptU0.y;
    const tuz = stU1.z - stU0.z;

    const dv = 0.008;
    const ptV0 = sampleStationCrossSection(st, v - dv);
    const ptV1 = sampleStationCrossSection(st, v + dv);
    const tvx = ptV1.x - ptV0.x;
    const tvy = ptV1.y - ptV0.y;
    const tvz = 0;

    let nx = tuy * tvz - tuz * tvy;
    let ny = tuz * tvx - tux * tvz;
    let nz = tux * tvy - tuy * tvx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    return {
      x: pt.x + nx * normalOffset,
      y: pt.y + ny * normalOffset,
      z: st.z + nz * normalOffset,
      nx,
      ny,
      nz
    };
  };

  const buildFlushCanopyPatchGeo = (uMin, uMax, vMin, vMax, normalOffset = 0.008, uSegs = 12, vSegs = 10) => {
    const posArr = [];
    const normArr = [];
    const idxArr = [];
    for (let iu = 0; iu <= uSegs; iu++) {
      const u = uMin + (iu / uSegs) * (uMax - uMin);
      for (let iv = 0; iv <= vSegs; iv++) {
        const v = vMin + (iv / vSegs) * (vMax - vMin);
        const p = evalHullSurfacePoint(u, v, normalOffset);
        posArr.push(p.x, p.y, p.z);
        normArr.push(p.nx, p.ny, p.nz);
      }
    }
    const stride = vSegs + 1;
    for (let iu = 0; iu < uSegs; iu++) {
      for (let iv = 0; iv < vSegs; iv++) {
        const a = iu * stride + iv;
        const b = (iu + 1) * stride + iv;
        const c = (iu + 1) * stride + (iv + 1);
        const d = iu * stride + (iv + 1);
        idxArr.push(a, b, c, a, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
    geo.setIndex(idxArr);
    return geo;
  };

  if (THREE.DoubleSide) {
    glassMat.side = THREE.DoubleSide;
  }

  // Contoured Smoked Polycarbonate Windshield Panel (flush along S3 z=-0.26 to S4 z=+0.32)
  const windshieldGeo = buildFlushCanopyPatchGeo(
    zToU(-0.26),
    zToU(+0.32),
    0.422,
    0.578,
    0.008,
    14,
    12
  );
  const windshieldMesh = new THREE.Mesh(windshieldGeo, glassMat);
  greenhouseGroup.add(windshieldMesh);

  // Contoured Left (-X) & Right (+X) Polycarbonate Side Windows (flush along S2..S4 upper bevel)
  const leftSideWinGeo = buildFlushCanopyPatchGeo(
    zToU(-0.84),
    zToU(+0.18),
    0.382,
    0.432,
    0.008,
    14,
    8
  );
  greenhouseGroup.add(new THREE.Mesh(leftSideWinGeo, glassMat));

  const rightSideWinGeo = buildFlushCanopyPatchGeo(
    zToU(-0.84),
    zToU(+0.18),
    0.568,
    0.618,
    0.008,
    14,
    8
  );
  greenhouseGroup.add(new THREE.Mesh(rightSideWinGeo, glassMat));

  // Ariel-Nomad Inspired Exposed Tubular Exoskeleton A-Pillar, Roof Rail & B-Pillar Cage
  // Sampled directly off the lofted S1..S5 shoulder seam (+0.022m normal offset) so it hugs the body
  for (const sideSign of [-1, 1]) {
    const vRail = 0.50 + sideSign * 0.082;
    const railZs = [+0.68, +0.28, -0.05, -0.35, -0.92, -1.48];
    const railPts = railZs.map((zVal) => {
      const p = evalHullSurfacePoint(zToU(zVal), vRail, 0.022);
      return new THREE.Vector3(p.x, p.y, p.z);
    });
    const pillarCurve = new THREE.CatmullRomCurve3(railPts);
    const pillarTube = new THREE.Mesh(
      new THREE.TubeGeometry(pillarCurve, 28, 0.028, 8, false),
      cageMat
    );
    pillarTube.castShadow = true;
    greenhouseGroup.add(pillarTube);
  }

  // Internal Roll-Cage Crossbars & Racing Bucket Seat
  const crossBarGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.72, 8);
  crossBarGeo.rotateZ(Math.PI / 2);
  const topCrossBar = new THREE.Mesh(crossBarGeo, cageMat);
  topCrossBar.position.set(0, 1.31, -0.35);
  greenhouseGroup.add(topCrossBar);

  const seatMat = new THREE.MeshStandardMaterial({ color: 0x11151d, roughness: 0.65 });
  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.10), seatMat);
  seatBack.position.set(0, 0.84, -0.48);
  seatBack.rotation.x = -0.22;
  greenhouseGroup.add(seatBack);

  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.09), cageMat);
  headrest.position.set(0, 1.12, -0.54);
  greenhouseGroup.add(headrest);

  // Overhead Carbon-Fiber Roof Ram-Air Intake Scoop (y = 1.38..1.48, z = -0.28)
  const scoopGroup = new THREE.Group();
  scoopGroup.position.set(0, 1.37, -0.28);
  greenhouseGroup.add(scoopGroup);

  const scoopBodyGeo = new THREE.BoxGeometry(0.36, 0.11, 0.52);
  const scoopBody = new THREE.Mesh(scoopBodyGeo, carbonMat);
  scoopBody.position.set(0, 0.04, 0);
  scoopBody.castShadow = true;
  scoopGroup.add(scoopBody);

  const scoopMouthGeo = new THREE.BoxGeometry(0.30, 0.07, 0.04);
  const scoopMouth = new THREE.Mesh(scoopMouthGeo, accentGlowMat);
  scoopMouth.position.set(0, 0.04, 0.25);
  scoopGroup.add(scoopMouth);

  // Exposed Rear Mid-Engine Twin Anodized Cylinder Heads / Intercooler (S1..S2, z = -1.35..-0.95)
  const engineBlockMat = new THREE.MeshStandardMaterial({
    color: 0xb8251e,
    metalness: 0.72,
    roughness: 0.28
  });
  for (const sideSign of [-1, 1]) {
    const valveCover = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.46), engineBlockMat);
    valveCover.position.set(sideSign * 0.22, 1.06, -1.22);
    valveCover.rotation.z = -sideSign * 0.28;
    valveCover.castShadow = true;
    greenhouseGroup.add(valveCover);
  }

  // --------------------------------------------------------------------------
  // C. LOFTED SIDEPOD RADIATOR INTAKES, HONEYCOMB GRILLES & SIDE SKIRTS
  // --------------------------------------------------------------------------
  const sidepodsGroup = new THREE.Group();
  sidepodsGroup.name = 'sidepodsGroup';
  chassisTiltGroup.add(sidepodsGroup);

  for (const sideSign of [-1, 1]) {
    // Compact rear-quarter carbon radiator intake cowl at z = -0.68m, y = 0.38m
    // Positioned cleanly aft & below the "01" / "02" door number plate so the badge is 100% unobstructed!
    const podCowl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.19, 0.52), carbonMat);
    podCowl.position.set(sideSign * 0.83, 0.38, -0.68);
    podCowl.rotation.y = sideSign * 0.06;
    podCowl.castShadow = true;
    sidepodsGroup.add(podCowl);

    // Glowing radiator intake louver at front mouth of rear-quarter scoop (z = -0.42m)
    const intakeGrille = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.03), accentGlowMat);
    intakeGrille.position.set(sideSign * 0.83, 0.38, -0.42);
    sidepodsGroup.add(intakeGrille);

    // Lower carbon aerodynamic side skirt along sill (y = 0.26m)
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.042, 1.45), carbonMat);
    skirt.position.set(sideSign * 0.85, 0.26, -0.05);
    sidepodsGroup.add(skirt);
  }

  // --------------------------------------------------------------------------
  // D. COMPACT FRONT CARBON SPLITTER, BULL-BAR & LED HEADLIGHT PODS
  // --------------------------------------------------------------------------
  const frontSplitterGroup = new THREE.Group();
  frontSplitterGroup.name = 'frontSplitterGroup';
  chassisTiltGroup.add(frontSplitterGroup);

  // Compact front carbon wing splitter (x in [-0.62, +0.62], y = 0.20, z = +1.95..+2.10)
  // Leaves FL/FR double-wishbone suspension completely unobstructed!
  const splitterBlade = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.038, 0.34), carbonMat);
  splitterBlade.position.set(0, 0.21, 1.98);
  splitterBlade.castShadow = true;
  frontSplitterGroup.add(splitterBlade);

  // Front splitter accent leading edge strip
  const splitterLip = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.018, 0.04), accentGlowMat);
  splitterLip.position.set(0, 0.21, 2.14);
  frontSplitterGroup.add(splitterLip);

  // Twin aerodynamic dive-planes / splitter endplates at x = ±0.62m
  const endplateGeo = new THREE.BoxGeometry(0.03, 0.18, 0.32);
  for (const sideSign of [-1, 1]) {
    const ep = new THREE.Mesh(endplateGeo, carbonMat);
    ep.position.set(sideSign * 0.62, 0.28, 1.98);
    ep.rotation.z = -sideSign * 0.12;
    frontSplitterGroup.add(ep);
  }

  // Compact Nomad-style tubular front nose guard bar (x in [-0.36, +0.36])
  const bullBarCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.34, 0.22, 1.96),
    new THREE.Vector3(-0.32, 0.48, 2.04),
    new THREE.Vector3(+0.32, 0.48, 2.04),
    new THREE.Vector3(+0.34, 0.22, 1.96)
  ]);
  const bullBar = new THREE.Mesh(
    new THREE.TubeGeometry(bullBarCurve, 20, 0.024, 8, false),
    darkTrimMat
  );
  frontSplitterGroup.add(bullBar);

  // Aggressive Angled LED Headlight Pods tucked on nose flanks (z = +1.68, x = ±0.42, y = 0.46)
  const headlightPodGeo = new THREE.CylinderGeometry(0.085, 0.095, 0.14, 16);
  headlightPodGeo.rotateX(Math.PI / 2);
  const headlightLensGeo = new THREE.CircleGeometry(0.076, 16);
  const headlightLensMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: isBlue ? 0x00f0ff : 0xffcc33,
    emissiveIntensity: 2.2,
    roughness: 0.1
  });

  for (const sideSign of [-1, 1]) {
    const podGroup = new THREE.Group();
    podGroup.position.set(sideSign * 0.43, 0.46, 1.72);
    podGroup.rotation.y = sideSign * 0.12;
    frontSplitterGroup.add(podGroup);

    podGroup.add(new THREE.Mesh(headlightPodGeo, carbonMat));
    const lens = new THREE.Mesh(headlightLensGeo, headlightLensMat);
    lens.position.z = 0.072;
    podGroup.add(lens);

    // Secondary compact lower fog light inside bull-bar
    const fogLens = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), headlightLensMat);
    fogLens.position.set(sideSign * 0.18, 0.30, 2.06);
    frontSplitterGroup.add(fogLens);
  }

  // --------------------------------------------------------------------------
  // E. TWIN-PYLON HIGH-DOWNFORCE REAR WING (y = 1.36..1.48, z = -1.70..-2.08)
  // --------------------------------------------------------------------------
  const rearWingGroup = new THREE.Group();
  rearWingGroup.name = 'rearWingGroup';
  chassisTiltGroup.add(rearWingGroup);

  // Twin swept swan-neck pylons at x = ±0.42m, z = -1.75m
  for (const sideSign of [-1, 1]) {
    const pylonCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sideSign * 0.42, 0.90, -1.58),
      new THREE.Vector3(sideSign * 0.42, 1.18, -1.74),
      new THREE.Vector3(sideSign * 0.42, 1.38, -1.86)
    ]);
    const pylonMesh = new THREE.Mesh(
      new THREE.TubeGeometry(pylonCurve, 12, 0.032, 8, false),
      darkTrimMat
    );
    pylonMesh.castShadow = true;
    rearWingGroup.add(pylonMesh);
  }

  // Main Lower Airfoil Element (x in [-0.88, +0.88], y = 1.38, z = -1.86)
  const mainWingGeo = new THREE.BoxGeometry(1.76, 0.042, 0.32);
  const mainWingMat = new THREE.MeshPhysicalMaterial({
    color: primaryHex,
    metalness: 0.55,
    roughness: 0.20,
    clearcoat: 1.0
  });
  const mainWing = new THREE.Mesh(mainWingGeo, mainWingMat);
  mainWing.position.set(0, 1.38, -1.86);
  mainWing.rotation.x = 0.18; // High-downforce positive angle of attack
  mainWing.castShadow = true;
  rearWingGroup.add(mainWing);

  // Upper Carbon DRS Flap Element
  const upperFlapGeo = new THREE.BoxGeometry(1.72, 0.030, 0.16);
  const upperFlap = new THREE.Mesh(upperFlapGeo, carbonMat);
  upperFlap.position.set(0, 1.44, -1.98);
  upperFlap.rotation.x = 0.32;
  rearWingGroup.add(upperFlap);

  // Leading-edge cyan/gold accent strip on rear wing
  const wingStripe = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.015, 0.04), accentGlowMat);
  wingStripe.position.set(0, 1.36, -1.71);
  rearWingGroup.add(wingStripe);

  // Sculpted Wing Endplates at x = ±0.88m
  const wingEndplateGeo = new THREE.BoxGeometry(0.036, 0.24, 0.42);
  for (const sideSign of [-1, 1]) {
    const wep = new THREE.Mesh(wingEndplateGeo, mainWingMat);
    wep.position.set(sideSign * 0.88, 1.40, -1.88);
    wep.castShadow = true;
    rearWingGroup.add(wep);

    const wepTrim = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.03, 0.43), accentGlowMat);
    wepTrim.position.set(sideSign * 0.88, 1.51, -1.88);
    rearWingGroup.add(wepTrim);
  }

  // --------------------------------------------------------------------------
  // F. TWIN REAR TITANIUM ROCKET THRUSTER NOZZLES (R = 0.22m at X = ±0.24m) & DIFFUSER
  // --------------------------------------------------------------------------
  const thrusterModuleGroup = new THREE.Group();
  thrusterModuleGroup.name = 'thrusterModuleGroup';
  chassisTiltGroup.add(thrusterModuleGroup);

  const titaniumMat = new THREE.MeshStandardMaterial({
    color: 0x7c8a9e,
    metalness: 0.92,
    roughness: 0.20
  });

  const heatBlueMat = new THREE.MeshStandardMaterial({
    color: 0x2b5599,
    emissive: 0x0a1c3d,
    metalness: 0.94,
    roughness: 0.16
  });

  const plasmaCoreMat = new THREE.MeshBasicMaterial({
    color: isBlue ? 0x40f8ff : 0xffaa22
  });

  const plumeConeMat = new THREE.MeshBasicMaterial({
    color: isBlue ? 0x00d8ff : 0xff6600,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const thrusterPlumes = [];
  const thrusterCores = [];

  for (const sideSign of [-1, 1]) {
    const nozzleGroup = new THREE.Group();
    nozzleGroup.position.set(sideSign * 0.24, 0.62, -1.96);
    thrusterModuleGroup.add(nozzleGroup);

    // Outer flared titanium Mach-cone bell (`R_nozzle = 0.22m`)
    const bellGeo = new THREE.CylinderGeometry(0.22, 0.16, 0.28, 28, 1, true);
    bellGeo.rotateX(-Math.PI / 2);
    const bellMesh = new THREE.Mesh(bellGeo, titaniumMat);
    bellMesh.castShadow = true;
    nozzleGroup.add(bellMesh);

    // Heat-blued titanium lip torus ring at exit plane (z = -0.14 local => -2.10m world)
    const lipGeo = new THREE.TorusGeometry(0.215, 0.018, 10, 28);
    const lipMesh = new THREE.Mesh(lipGeo, heatBlueMat);
    lipMesh.position.z = -0.13;
    nozzleGroup.add(lipMesh);

    // Internal radial turbine stator blades
    for (let b = 0; b < 8; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.34, 0.04), titaniumMat);
      blade.rotation.z = (b / 8) * Math.PI;
      blade.position.z = -0.04;
      nozzleGroup.add(blade);
    }

    // Glowing internal plasma core disc
    const coreGeo = new THREE.CircleGeometry(0.165, 24);
    coreGeo.rotateY(Math.PI);
    const coreMesh = new THREE.Mesh(coreGeo, plasmaCoreMat.clone());
    coreMesh.position.z = -0.06;
    nozzleGroup.add(coreMesh);
    thrusterCores.push(coreMesh);

    // Outer glowing plasma ring at nozzle mouth
    const glowRingGeo = new THREE.TorusGeometry(0.18, 0.012, 8, 24);
    const glowRing = new THREE.Mesh(glowRingGeo, accentGlowMat);
    glowRing.position.z = -0.11;
    nozzleGroup.add(glowRing);

    // Dynamic volumetric afterburner plume cone (scales with boostActive & throttle)
    const plumeGeo = new THREE.ConeGeometry(0.18, 0.95, 20, 1, true);
    plumeGeo.rotateX(Math.PI / 2); // Point tip toward -Z
    plumeGeo.translate(0, 0, -0.52);
    const plumeMesh = new THREE.Mesh(plumeGeo, plumeConeMat.clone());
    plumeMesh.renderOrder = 4;
    nozzleGroup.add(plumeMesh);
    thrusterPlumes.push(plumeMesh);
  }

  // Rear "RLX-01" / "RLX-02" Badge Plate centered above the twin nozzles
  const badgeTex = createRearBadgeTexture(THREE, `RLX-${carNumber}`, isBlue ? '#00e5ff' : '#ffae00');
  const badgeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: badgeTex || null
  });
  const badgePlate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.14), badgeMat);
  badgePlate.position.set(0, 0.86, -1.965);
  badgePlate.rotation.y = Math.PI;
  thrusterModuleGroup.add(badgePlate);

  // Twin Rear LED Tail-Light Pods (x = ±0.50m, y = 0.78m, z = -1.94m)
  const tailLightMat = new THREE.MeshStandardMaterial({
    color: 0xff2200,
    emissive: 0xff2200,
    emissiveIntensity: 1.8
  });
  for (const sideSign of [-1, 1]) {
    const tl = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.04, 16), tailLightMat);
    tl.rotation.x = Math.PI / 2;
    tl.position.set(sideSign * 0.48, 0.78, -1.95);
    thrusterModuleGroup.add(tl);
  }

  // 4-Strake Carbon-Fiber Underbody Rear Diffuser (y = 0.28..0.38m, z = -1.94m)
  const diffuserBase = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.03, 0.32), carbonMat);
  diffuserBase.position.set(0, 0.34, -1.88);
  diffuserBase.rotation.x = -0.18;
  thrusterModuleGroup.add(diffuserBase);

  for (const sx of [-0.42, -0.15, +0.15, +0.42]) {
    const strake = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.12, 0.28), carbonMat);
    strake.position.set(sx, 0.32, -1.92);
    thrusterModuleGroup.add(strake);
  }

  // Supersonic Aerodynamic Mach Cone Ring (visible when carState.isSupersonic)
  const machGeo = new THREE.ConeGeometry(0.58, 1.35, 28, 1, true);
  machGeo.rotateX(-Math.PI / 2);
  const machMat = new THREE.MeshBasicMaterial({
    color: accentHex,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const supersonicHalo = new THREE.Mesh(machGeo, machMat);
  supersonicHalo.position.set(0, 0.72, 0.65);
  supersonicHalo.renderOrder = 4;
  chassisTiltGroup.add(supersonicHalo);

  // --------------------------------------------------------------------------
  // G. 4 ARTICULATED WHEELS & EXPOSED DOUBLE-WISHBONE SUSPENSION CORNERS
  // --------------------------------------------------------------------------
  // Locked Wheel Centers:
  // FL: (-0.92, 0.40, +1.32), R = 0.40m | FR: (+0.92, 0.40, +1.32), R = 0.40m
  // RL: (-0.96, 0.45, -1.28), R = 0.45m | RR: (+0.96, 0.45, -1.28), R = 0.45m
  // Bottom of all 4 tires rests at exact ground datum Y = 0.00m!
  const wheelSpecs = [
    { id: 'FL', x: -0.92, y: 0.40, z: +1.32, radius: 0.40, width: 0.34, isLeft: true, isFront: true, innerX: 0.42 },
    { id: 'FR', x: +0.92, y: 0.40, z: +1.32, radius: 0.40, width: 0.34, isLeft: false, isFront: true, innerX: 0.42 },
    { id: 'RL', x: -0.96, y: 0.45, z: -1.28, radius: 0.45, width: 0.38, isLeft: true, isFront: false, innerX: 0.56 },
    { id: 'RR', x: +0.96, y: 0.45, z: -1.28, radius: 0.45, width: 0.38, isLeft: false, isFront: false, innerX: 0.56 }
  ];

  const wheels = [];
  const suspensionCorners = [];

  for (const spec of wheelSpecs) {
    const wheelMesh = createWheelAssembly(THREE, {
      radius: spec.radius,
      width: spec.width,
      isLeft: spec.isLeft,
      isFront: spec.isFront,
      accentHex,
      coilHex
    });
    wheelMesh.position.set(spec.x, spec.y, spec.z);
    wheelMesh.userData.restPosition.set(spec.x, spec.y, spec.z);
    carRoot.add(wheelMesh);
    wheels.push(wheelMesh);

    const suspMesh = createSuspensionCornerAssembly(THREE, {
      isLeft: spec.isLeft,
      isFront: spec.isFront,
      wheelX: spec.x,
      wheelY: spec.y,
      wheelZ: spec.z,
      chassisInnerX: spec.innerX,
      accentHex,
      coilHex
    });
    carRoot.add(suspMesh);
    suspensionCorners.push(suspMesh);
  }

  // --------------------------------------------------------------------------
  // H. UNDERBODY CHASSIS AMBIENT OCCLUSION CONTACT SHADOW DECAL (Y = 0.006m)
  // --------------------------------------------------------------------------
  const shadowTex = getSoftShadowTexture(THREE);
  const chassisShadowGeo = new THREE.PlaneGeometry(2.05, 4.10);
  chassisShadowGeo.rotateX(-Math.PI / 2);
  const chassisShadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    map: shadowTex || null,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  const chassisShadow = new THREE.Mesh(chassisShadowGeo, chassisShadowMat);
  chassisShadow.name = 'chassisContactShadow';
  chassisShadow.position.set(0, 0.006, 0.05);
  chassisShadow.renderOrder = 1;
  carRoot.add(chassisShadow);

  // Store structured references for fast updates & exploded inspection mode
  carRoot.userData = {
    team,
    carNumber,
    chassisTiltGroup,
    monocoqueGroup,
    greenhouseGroup,
    sidepodsGroup,
    frontSplitterGroup,
    rearWingGroup,
    thrusterModuleGroup,
    thrusterPlumes,
    thrusterCores,
    supersonicHalo,
    wheels,
    suspensionCorners,
    chassisShadow,
    wheelRotationAccum: 0,
    explodedFactor: 0
  };

  return carRoot;
}

// ============================================================================
// 6. DYNAMIC VEHICLE VISUAL UPDATE & EXPLODED VIEW (`updateBattleCarVisuals`, `setExplodedView`)
// ============================================================================

const VISUAL_HULL_FLOOR_SAMPLES_LOCAL = Object.freeze([
  // 4 Outer-Bottom Tire Contact Corners (carRoot local space where y=0 is tire bottom)
  { x: -1.16, y: 0.00, z: +1.35 },
  { x: +1.16, y: 0.00, z: +1.35 },
  { x: -1.16, y: 0.00, z: -1.35 },
  { x: +1.16, y: 0.00, z: -1.35 },
  // 4 Outer-Top Tire Sidewall Corners (y = 0.84m)
  { x: -1.16, y: 0.84, z: +1.35 },
  { x: +1.16, y: 0.84, z: +1.35 },
  { x: -1.16, y: 0.84, z: -1.35 },
  { x: +1.16, y: 0.84, z: -1.35 },
  // 4 Outer Tire Front/Rear Tread Extremities
  { x: -1.16, y: 0.42, z: +1.77 },
  { x: +1.16, y: 0.42, z: +1.77 },
  { x: -1.16, y: 0.42, z: -1.73 },
  { x: +1.16, y: 0.42, z: -1.73 },
  // 4 Sidepod, Nose Splitter & Rear Thruster Bell Extremities
  { x: -1.04, y: 0.62, z: +0.10 },
  { x: +1.04, y: 0.62, z: +0.10 },
  { x: -0.68, y: 0.20, z: +2.16 },
  { x: +0.68, y: 0.20, z: +2.16 },
  { x: -0.48, y: 0.62, z: -2.18 },
  { x: +0.48, y: 0.62, z: -2.18 },
  // 6 Upper Roof Roll-Cage, Scoop, Windshield & Rear Wing Endplate Crown Points
  { x: -0.48, y: 1.48, z: -0.30 },
  { x: +0.48, y: 1.48, z: -0.30 },
  { x: -0.48, y: 1.10, z: +0.32 },
  { x: +0.48, y: 1.10, z: +0.32 },
  { x: -0.90, y: 1.54, z: -1.90 },
  { x: +0.90, y: 1.54, z: -1.90 }
]);

/**
 * Separates or reassembles the mechanical sub-assemblies of the Battle-Car along radial axes
 * for the Studio `'exploded'` diagnostic inspection view (`factor in [0, 1]`).
 */
export function setExplodedView(carMesh, factor = 0) {
  if (!carMesh || !carMesh.userData) return;
  const f = Math.max(0, Math.min(1.5, Number(factor) || 0));
  const ud = carMesh.userData;
  ud.explodedFactor = f;

  if (ud.monocoqueGroup) ud.monocoqueGroup.position.set(0, f * 0.42, 0);
  if (ud.greenhouseGroup) ud.greenhouseGroup.position.set(0, f * 0.96, -f * 0.12);
  if (ud.sidepodsGroup) ud.sidepodsGroup.position.set(0, -f * 0.18, 0);
  if (ud.frontSplitterGroup) ud.frontSplitterGroup.position.set(0, -f * 0.12, f * 0.75);
  if (ud.rearWingGroup) ud.rearWingGroup.position.set(0, f * 0.78, -f * 0.68);
  if (ud.thrusterModuleGroup) ud.thrusterModuleGroup.position.set(0, 0, -f * 0.85);

  if (Array.isArray(ud.wheels)) {
    for (const w of ud.wheels) {
      const rp = w.userData.restPosition;
      const sx = w.userData.isLeft ? -1 : 1;
      const sz = w.userData.isFront ? 1 : -1;
      w.position.set(rp.x + sx * f * 0.68, rp.y, rp.z + sz * f * 0.22);
    }
  }

  if (Array.isArray(ud.suspensionCorners)) {
    for (const s of ud.suspensionCorners) {
      const sx = s.userData.sideSign || 1;
      s.position.set(sx * f * 0.32, -f * 0.10, 0);
    }
  }
}

/**
 * Updates Battle-Car transform, 4-wheel suspension travel, wishbone/coilover articulation,
 * front steering yaw, wheel spin, chassis squat/dive, thruster plasma plumes, and ground contact shadow.
 */
export function updateBattleCarVisuals(carMesh, carState = {}, dt = 1 / 60) {
  if (!carMesh || !carMesh.userData) return;
  const ud = carMesh.userData;
  const safeDt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 1 / 60;

  // 1. World Position & Orientation
  if (carState.position && Number.isFinite(carState.position.x)) {
    carMesh.position.set(
      carState.position.x,
      Number.isFinite(carState.position.y) ? carState.position.y : 0.42,
      Number.isFinite(carState.position.z) ? carState.position.z : 0
    );
  } else if (Number.isFinite(carState.x) && Number.isFinite(carState.y) && Number.isFinite(carState.z)) {
    carMesh.position.set(carState.x, carState.y, carState.z);
  }

  if (
    carState.quaternion &&
    Number.isFinite(carState.quaternion.w) &&
    Number.isFinite(carState.quaternion.x) &&
    Number.isFinite(carState.quaternion.y) &&
    Number.isFinite(carState.quaternion.z)
  ) {
    carMesh.quaternion.set(
      carState.quaternion.x,
      carState.quaternion.y,
      carState.quaternion.z,
      carState.quaternion.w
    );
    carMesh.quaternion.normalize();
  } else if (Number.isFinite(carState.qw)) {
    carMesh.quaternion.set(
      carState.qx || 0,
      carState.qy || 0,
      carState.qz || 0,
      carState.qw
    );
    carMesh.quaternion.normalize();
  } else if (Number.isFinite(carState.heading) || Number.isFinite(carState.yaw)) {
    const yaw = carState.yaw ?? carState.heading ?? 0;
    const pitch = carState.pitch ?? 0;
    const roll = carState.roll ?? 0;
    carMesh.rotation.set(pitch, yaw, roll, 'YXZ');
  }

  // Orthonormal basis of carMesh.quaternion
  const qx = carMesh.quaternion.x;
  const qy = carMesh.quaternion.y;
  const qz = carMesh.quaternion.z;
  const qw = carMesh.quaternion.w;

  const rightX = 1 - 2 * (qy * qy + qz * qz);
  const rightY = 2 * (qx * qy + qw * qz);
  const rightZ = 2 * (qx * qz - qw * qy);

  const upX = 2 * (qx * qy - qw * qz);
  const upY = 1 - 2 * (qx * qx + qz * qz);
  const upZ = 2 * (qy * qz + qw * qx);

  const fwdX = 2 * (qx * qz + qw * qy);
  const fwdY = 2 * (qy * qz - qw * qx);
  const fwdZ = 1 - 2 * (qx * qx + qy * qy);

  // PhysicsWorld stores car.position at the axle/COM center (0.42m above the tire contact patch along local +Y).
  // Shift carMesh along local -Y by 0.42m when driven by a PhysicsWorld / Replay car state so tires touch the turf/wall flush.
  const isPhysicsState = Boolean(
    carState.surfaceNormal ||
    carState.wheelContacts ||
    carState.input ||
    carState.isPhysicsCar ||
    carState.qx !== undefined
  );
  if (isPhysicsState) {
    const rideOffset = Number.isFinite(carState.rideHeightOffset) ? carState.rideHeightOffset : 0.42;
    carMesh.position.x -= upX * rideOffset;
    carMesh.position.y -= upY * rideOffset;
    carMesh.position.z -= upZ * rideOffset;

    // [SPEC PATCH #15] Enforce visual OBB floor non-penetration across all 24 hull/tire/wing/roof points
    if (
      Math.abs(carMesh.position.x) < 54.0 &&
      Math.abs(carMesh.position.z) < 96.0 &&
      carMesh.position.y < 3.5
    ) {
      let minWorldY = Infinity;
      for (let s = 0; s < VISUAL_HULL_FLOOR_SAMPLES_LOCAL.length; s++) {
        const pt = VISUAL_HULL_FLOOR_SAMPLES_LOCAL[s];
        const wy = carMesh.position.y + rightY * pt.x + upY * pt.y + fwdY * pt.z;
        if (wy < minWorldY) minWorldY = wy;
      }
      if (minWorldY < 0.004) {
        carMesh.position.y += (0.004 - minWorldY);
      }
    }
  }

  // Handle Demolished Visibility ([SPEC PATCH #14])
  if (carState.demolished || carState.isDemolished) {
    carMesh.visible = false;
    return;
  }
  carMesh.visible = true;
  if (ud.chassisTiltGroup) ud.chassisTiltGroup.visible = true;

  // If in studio exploded view, keep exploded offsets intact
  if (ud.explodedFactor > 0.001) {
    return;
  }

  // 2. Chassis Squat / Dive / Roll & Heave on `chassisTiltGroup`
  const forwardSpeed = Number.isFinite(carState.forwardSpeed)
    ? carState.forwardSpeed
    : (carState.velocity ? Math.hypot(carState.velocity.x || 0, carState.velocity.z || 0) : 0);
  const steerInput = Number.isFinite(carState.steerAngle)
    ? carState.steerAngle
    : (Number.isFinite(carState.steer) ? carState.steer * 0.42 : 0);
  const boostActive = Boolean(carState.boostActive || carState.isBoosting);
  const isSupersonic = Boolean(carState.isSupersonic || forwardSpeed >= 40);

  const compressions = Array.isArray(carState.suspensionCompression)
    ? carState.suspensionCompression
    : [0, 0, 0, 0];
  const avgComp =
    ((Number(compressions[0]) || 0) +
      (Number(compressions[1]) || 0) +
      (Number(compressions[2]) || 0) +
      (Number(compressions[3]) || 0)) *
    0.25;

  const isUprightOnFloor = upY >= 0.78;
  const onGround =
    carState.onGround !== undefined
      ? Boolean(carState.onGround) && isUprightOnFloor
      : (carMesh.position.y <= 0.65 && isUprightOnFloor);

  if (ud.chassisTiltGroup) {
    if (!isUprightOnFloor) {
      ud.chassisTiltGroup.rotation.x = 0;
      ud.chassisTiltGroup.rotation.z = 0;
      ud.chassisTiltGroup.position.y = 0;
    } else {
      // Note: in right-handed vehicle frame (+Z forward, +Y up, +X right), negative rotation.x pitches nose UP
      const rawPitch = Number.isFinite(carState.bodyPitch)
        ? -carState.bodyPitch
        : (Number.isFinite(carState.chassisPitch) ? -carState.chassisPitch : (boostActive ? -0.045 : 0));
      const rawRoll = Number.isFinite(carState.bodyRoll)
        ? -carState.bodyRoll
        : (Number.isFinite(carState.chassisRoll)
            ? -carState.chassisRoll
            : (-steerInput * Math.min(1, Math.abs(forwardSpeed) / 22) * 0.08));
      ud.chassisTiltGroup.rotation.x += (rawPitch - ud.chassisTiltGroup.rotation.x) * Math.min(1, safeDt * 14);
      ud.chassisTiltGroup.rotation.z += (rawRoll - ud.chassisTiltGroup.rotation.z) * Math.min(1, safeDt * 14);
      const targetHeaveY = onGround ? -Math.max(0, avgComp - 0.02) * 0.85 : 0;
      ud.chassisTiltGroup.position.y += (targetHeaveY - ud.chassisTiltGroup.position.y) * Math.min(1, safeDt * 16);
    }
  }

  // 3. Wheel Spin, Front Steering & Suspension Compression + Wishbone Articulation
  if (Number.isFinite(carState.wheelRotation)) {
    ud.wheelRotationAccum = carState.wheelRotation;
  } else if (Number.isFinite(carState.wheelSpinAngle)) {
    ud.wheelRotationAccum = carState.wheelSpinAngle;
  } else {
    ud.wheelRotationAccum += (forwardSpeed / 0.42) * safeDt;
  }

  for (let i = 0; i < ud.wheels.length; i++) {
    const w = ud.wheels[i];
    const rp = w.userData.restPosition;
    const comp = Number.isFinite(compressions[i]) ? Math.max(-0.14, Math.min(0.18, compressions[i])) : 0;

    // Keep grounded tires planted flush on the contact plane (y = rp.y) while chassis heaves; zero offset when tilted
    const wheelOffsetY = !isUprightOnFloor ? 0.0 : (onGround ? 0.0 : Math.min(0, comp));
    w.position.set(rp.x, rp.y + wheelOffsetY, rp.z);

    // Front wheel steering yaw (zero when car is rolled on its side so tire rim doesn't dip below floor)
    if (w.userData.isFront && w.userData.steerPivot) {
      w.userData.steerPivot.rotation.y = isUprightOnFloor ? steerInput : 0;
    }

    // Wheel rolling spin around X axle
    if (w.userData.spinPivot) {
      w.userData.spinPivot.rotation.x = ud.wheelRotationAccum;
    }

    // Contact shadow visibility & scale (collapse decal plane when tilted/airborne so Box3 bounds stay accurate)
    if (w.userData.contactShadow) {
      const showWheelShadow = onGround && isUprightOnFloor;
      w.userData.contactShadow.visible = showWheelShadow;
      w.userData.contactShadow.scale.setScalar(showWheelShadow ? 1.0 : 0.0001);
      w.userData.contactShadow.position.y = -w.userData.radius + 0.004;
    }

    // Articulate corresponding double-wishbone & coilover strut angle
    const susp = ud.suspensionCorners[i];
    if (susp && susp.userData.wishbonePivot) {
      const span = susp.userData.spanX || 0.36;
      const angle = isUprightOnFloor ? (Math.atan2(comp, span) * susp.userData.sideSign) : 0;
      susp.userData.wishbonePivot.rotation.z = angle;
      if (susp.userData.springMesh) {
        susp.userData.springMesh.scale.y = isUprightOnFloor
          ? Math.max(0.65, Math.min(1.25, 1.0 - comp * 1.8))
          : 1.0;
      }
    }
  }

  // 4. Underbody Contact Shadow
  if (ud.chassisShadow) {
    const alt = Math.max(0, carMesh.position.y);
    const alpha = isUprightOnFloor ? Math.max(0, Math.min(0.62, 0.62 * (1 - alt / 6.0))) : 0;
    const showChassisShadow = alpha > 0.02 && isUprightOnFloor;
    ud.chassisShadow.visible = showChassisShadow;
    ud.chassisShadow.scale.setScalar(showChassisShadow ? 1.0 : 0.0001);
    ud.chassisShadow.material.opacity = alpha;
  }

  // 5. Rocket Thruster Plasma Glow & Afterburner Cone Scale
  const time = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
  const flutter = 0.88 + 0.12 * Math.sin(time * 42.0);
  const plumeScaleZ = boostActive
    ? (1.45 + (isSupersonic ? 0.55 : 0.0)) * flutter
    : (isUprightOnFloor ? (0.28 + Math.min(0.35, Math.abs(forwardSpeed) * 0.012)) * flutter : 0.01);
  const plumeScaleXY = boostActive ? 1.18 * flutter : (isUprightOnFloor ? 0.68 : 0.01);

  for (const plume of ud.thrusterPlumes) {
    plume.scale.set(plumeScaleXY, plumeScaleXY, plumeScaleZ);
    plume.material.opacity = boostActive ? 0.88 : (isUprightOnFloor ? 0.36 : 0.0);
    plume.visible = boostActive || isUprightOnFloor;
  }

  // 6. Supersonic Mach Halo
  if (ud.supersonicHalo) {
    const targetOpacity = isSupersonic ? 0.28 * flutter : 0.0;
    ud.supersonicHalo.material.opacity += (targetOpacity - ud.supersonicHalo.material.opacity) * Math.min(1, safeDt * 10);
    const showHalo = ud.supersonicHalo.material.opacity > 0.01 && isUprightOnFloor;
    ud.supersonicHalo.visible = showHalo;
    ud.supersonicHalo.scale.setScalar(showHalo ? 1.0 : 0.0001);
  }

  // 7. [SPEC PATCH #15] Final Three.js Box3 Floor Non-Penetration Guarantee when tilted/rolled
  if (
    upY < 0.96 &&
    Math.abs(carMesh.position.x) < 54.0 &&
    Math.abs(carMesh.position.z) < 96.0 &&
    carMesh.position.y < 3.5
  ) {
    const T = resolveTHREE(null);
    if (T && typeof T.Box3 === 'function') {
      carMesh.updateMatrixWorld(true);
      const vBox = new T.Box3().setFromObject(carMesh);
      if (Number.isFinite(vBox.min.y) && vBox.min.y < 0.002) {
        carMesh.position.y += (0.002 - vBox.min.y);
        carMesh.updateMatrixWorld(true);
      }
    }
  }
}

// ============================================================================
// 7. 32-PANEL TRUNCATED ICOSAHEDRON GEODESIC SOCCER BALL (`createSoccerBallMesh`)
// ============================================================================

/**
 * Computes the exact 12 pentagons and 20 hexagons of a mathematical Truncated Icosahedron
 * on the unit sphere.
 */
function computeTruncatedIcosahedronPanels(THREE) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const rawVerts = [
    [0, 1, phi], [0, 1, -phi], [0, -1, phi], [0, -1, -phi],
    [1, phi, 0], [1, -phi, 0], [-1, phi, 0], [-1, -phi, 0],
    [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1]
  ];
  const icoVerts = rawVerts.map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());

  // 20 triangular faces of the regular icosahedron
  const icoFaces = [];
  const edgeTargetDist = 2 / Math.sqrt(1 + phi * phi);
  const tol = 0.05;

  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      if (Math.abs(icoVerts[i].distanceTo(icoVerts[j]) - edgeTargetDist) > tol) continue;
      for (let k = j + 1; k < 12; k++) {
        if (
          Math.abs(icoVerts[j].distanceTo(icoVerts[k]) - edgeTargetDist) <= tol &&
          Math.abs(icoVerts[k].distanceTo(icoVerts[i]) - edgeTargetDist) <= tol
        ) {
          // Ensure outward CCW orientation
          const vA = icoVerts[i];
          const vB = icoVerts[j];
          const vC = icoVerts[k];
          const center = new THREE.Vector3().add(vA).add(vB).add(vC).multiplyScalar(1 / 3);
          const normal = new THREE.Vector3().subVectors(vB, vA).cross(new THREE.Vector3().subVectors(vC, vA));
          if (normal.dot(center) >= 0) {
            icoFaces.push([i, j, k]);
          } else {
            icoFaces.push([i, k, j]);
          }
        }
      }
    }
  }

  const pentagons = [];
  const hexagons = [];

  // 12 Pentagons (one centered at each of the 12 icosahedron vertices)
  for (let i = 0; i < 12; i++) {
    const centerDir = icoVerts[i].clone().normalize();
    const neighbors = [];
    for (let j = 0; j < 12; j++) {
      if (i !== j && Math.abs(icoVerts[i].distanceTo(icoVerts[j]) - edgeTargetDist) <= tol) {
        neighbors.push(icoVerts[j]);
      }
    }
    // Sort neighbors CCW around centerDir
    const refVec = Math.abs(centerDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tangentU = new THREE.Vector3().crossVectors(refVec, centerDir).normalize();
    const tangentV = new THREE.Vector3().crossVectors(centerDir, tangentU).normalize();

    neighbors.sort((a, b) => {
      const angA = Math.atan2(a.dot(tangentV), a.dot(tangentU));
      const angB = Math.atan2(b.dot(tangentV), b.dot(tangentU));
      return angA - angB;
    });

    const corners = neighbors.map((nb) =>
      new THREE.Vector3().addScaledVector(icoVerts[i], 2 / 3).addScaledVector(nb, 1 / 3).normalize()
    );
    pentagons.push({ centerDir, corners });
  }

  // 20 Hexagons (one on each of the 20 icosahedron faces)
  for (const [ia, ib, ic] of icoFaces) {
    const vA = icoVerts[ia];
    const vB = icoVerts[ib];
    const vC = icoVerts[ic];
    const centerDir = new THREE.Vector3().add(vA).add(vB).add(vC).normalize();
    const corners = [
      new THREE.Vector3().addScaledVector(vA, 2 / 3).addScaledVector(vB, 1 / 3).normalize(),
      new THREE.Vector3().addScaledVector(vA, 1 / 3).addScaledVector(vB, 2 / 3).normalize(),
      new THREE.Vector3().addScaledVector(vB, 2 / 3).addScaledVector(vC, 1 / 3).normalize(),
      new THREE.Vector3().addScaledVector(vB, 1 / 3).addScaledVector(vC, 2 / 3).normalize(),
      new THREE.Vector3().addScaledVector(vC, 2 / 3).addScaledVector(vA, 1 / 3).normalize(),
      new THREE.Vector3().addScaledVector(vC, 1 / 3).addScaledVector(vA, 2 / 3).normalize()
    ];
    hexagons.push({ centerDir, corners });
  }

  return { pentagons, hexagons };
}

/**
 * Builds a spherical beveled armor plate BufferGeometry for a given set of polygon panels
 * (either the 12 pentagons or the 20 hexagons) on a sphere of radius `radius`.
 */
function buildSphericalPanelsGeometry(THREE, panels, radius, seamGap = 0.045, bevelDepth = 0.065) {
  const positions = [];
  const normals = [];
  const indices = [];

  // Radial rings from center (0) -> inner ridge (0.48) -> outer flat face (0.86) -> beveled seam edge (0.955)
  const ringFracs = [0.0, 0.45, 0.86, 1.0 - seamGap];
  const ringRadii = [
    radius,
    radius + 0.008,
    radius,
    radius - bevelDepth
  ];

  for (const panel of panels) {
    const nSides = panel.corners.length;
    const cDir = panel.centerDir;
    const baseVertexIdx = positions.length / 3;

    // Center vertex
    positions.push(cDir.x * ringRadii[0], cDir.y * ringRadii[0], cDir.z * ringRadii[0]);
    normals.push(cDir.x, cDir.y, cDir.z);

    // Emit concentric rings
    for (let r = 1; r < ringFracs.length; r++) {
      const frac = ringFracs[r];
      const rad = ringRadii[r];
      const isBevelRing = r === ringFracs.length - 1;

      for (let s = 0; s < nSides; s++) {
        const cornerA = panel.corners[s];
        const cornerB = panel.corners[(s + 1) % nSides];
        // 2 subdivisions per polygon edge so spherical curvature is smooth
        for (let sub = 0; sub < 2; sub++) {
          const edgeDir = new THREE.Vector3()
            .lerpVectors(cornerA, cornerB, sub * 0.5)
            .normalize();
          const dir = new THREE.Vector3()
            .lerpVectors(cDir, edgeDir, frac)
            .normalize();
          positions.push(dir.x * rad, dir.y * rad, dir.z * rad);

          if (isBevelRing) {
            // Tilt normal outward toward panel edge for crisp chamfer specular catchlight
            const bevelN = new THREE.Vector3().lerpVectors(dir, edgeDir, 0.55).normalize();
            normals.push(bevelN.x, bevelN.y, bevelN.z);
          } else {
            normals.push(dir.x, dir.y, dir.z);
          }
        }
      }
    }

    const ringVertCount = nSides * 2;
    // Center fan to ring 1
    for (let k = 0; k < ringVertCount; k++) {
      const nextK = (k + 1) % ringVertCount;
      indices.push(baseVertexIdx, baseVertexIdx + 1 + k, baseVertexIdx + 1 + nextK);
    }

    // Ring-to-ring quads
    for (let r = 1; r < ringFracs.length - 1; r++) {
      const r0Start = baseVertexIdx + 1 + (r - 1) * ringVertCount;
      const r1Start = baseVertexIdx + 1 + r * ringVertCount;
      for (let k = 0; k < ringVertCount; k++) {
        const nextK = (k + 1) % ringVertCount;
        const a = r0Start + k;
        const b = r1Start + k;
        const c = r1Start + nextK;
        const d = r0Start + nextK;
        indices.push(a, b, c);
        indices.push(a, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds the 32-Panel Truncated Icosahedron Geodesic Soccer Ball (`R_ball = 3.20m`)
 * + Dynamic Ground Target Projection Ring (`ballMesh.groundIndicator`, `renderOrder = 1`).
 */
export function createSoccerBallMesh(THREEOrRadius = 3.20, maybeRadius = 3.20) {
  let THREE = THREE_IMPORT;
  let radius = 3.20;

  if (THREEOrRadius && THREEOrRadius.BufferGeometry && THREEOrRadius.Group) {
    THREE = THREEOrRadius;
    if (typeof maybeRadius === 'number') {
      radius = maybeRadius;
    } else if (maybeRadius && typeof maybeRadius.radius === 'number') {
      radius = maybeRadius.radius;
    }
  } else {
    THREE = resolveTHREE(null);
    if (typeof THREEOrRadius === 'number') {
      radius = THREEOrRadius;
    } else if (THREEOrRadius && typeof THREEOrRadius.radius === 'number') {
      radius = THREEOrRadius.radius;
    }
  }

  const ballRoot = new THREE.Group();
  ballRoot.name = 'GeodesicSoccerBall';

  const spinGroup = new THREE.Group();
  spinGroup.name = 'ballSpinGroup';
  ballRoot.add(spinGroup);

  const { pentagons, hexagons } = computeTruncatedIcosahedronPanels(THREE);

  // 1. Recessed Glowing Energy Seam Core Sphere (`R_core = radius * 0.972`)
  const seamCoreGeo = new THREE.SphereGeometry(radius * 0.972, 48, 32);
  const seamCoreMat = new THREE.MeshStandardMaterial({
    color: 0x091422,
    emissive: 0x00f0ff,
    emissiveIntensity: 1.45,
    roughness: 0.25,
    metalness: 0.30
  });
  const seamCoreMesh = new THREE.Mesh(seamCoreGeo, seamCoreMat);
  spinGroup.add(seamCoreMesh);

  // 2. 12 Dark Carbon-Fiber Pentagonal Armor Plates
  const pentGeo = buildSphericalPanelsGeometry(THREE, pentagons, radius, 0.048, 0.075);
  const pentMat = new THREE.MeshPhysicalMaterial({
    color: 0x181f2c,
    metalness: 0.62,
    roughness: 0.32,
    clearcoat: 0.75,
    clearcoatRoughness: 0.16
  });
  const pentMesh = new THREE.Mesh(pentGeo, pentMat);
  pentMesh.castShadow = true;
  pentMesh.receiveShadow = true;
  spinGroup.add(pentMesh);

  // 3. 20 Brushed Titanium-Silver Hexagonal Armor Plates
  const hexGeo = buildSphericalPanelsGeometry(THREE, hexagons, radius, 0.048, 0.075);
  const hexMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8e3f2,
    metalness: 0.84,
    roughness: 0.20,
    clearcoat: 0.85,
    clearcoatRoughness: 0.10
  });
  const hexMesh = new THREE.Mesh(hexGeo, hexMat);
  hexMesh.castShadow = true;
  hexMesh.receiveShadow = true;
  spinGroup.add(hexMesh);

  // 4. 12 Blinking LED Beacon Nodes centered on the 12 Pentagonal Plates
  const ledNodeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x00f0ff,
    emissiveIntensity: 2.2,
    roughness: 0.1
  });
  const ledRingGeo = new THREE.TorusGeometry(radius * 0.068, radius * 0.012, 8, 20);
  const ledNodes = [];

  for (const pent of pentagons) {
    const nodeMesh = new THREE.Mesh(ledRingGeo, ledNodeMat);
    const pos = pent.centerDir.clone().multiplyScalar(radius * 1.002);
    nodeMesh.position.copy(pos);
    nodeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pent.centerDir);
    spinGroup.add(nodeMesh);
    ledNodes.push(nodeMesh);
  }

  // 5. Dynamic Ground Target Projection Ring (`ballMesh.groundIndicator`, `renderOrder = 1`)
  const groundIndicator = new THREE.Group();
  groundIndicator.name = 'ballGroundIndicator';
  groundIndicator.renderOrder = 1;

  // Soft Ground Shadow Blob under Ball
  const shadowTex = getSoftShadowTexture(THREE);
  const ballShadowGeo = new THREE.PlaneGeometry(radius * 2.5, radius * 2.5);
  ballShadowGeo.rotateX(-Math.PI / 2);
  const ballShadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    map: shadowTex || null,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  const ballShadowMesh = new THREE.Mesh(ballShadowGeo, ballShadowMat);
  ballShadowMesh.renderOrder = 1;
  groundIndicator.add(ballShadowMesh);

  // Outer Constant-Radius Laser Target Ring (`R = 3.20m`)
  const outerRingGeo = new THREE.RingGeometry(radius * 0.94, radius * 1.0, 48);
  outerRingGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  const outerRingMesh = new THREE.Mesh(outerRingGeo, ringMat);
  outerRingMesh.position.y = 0.01;
  outerRingMesh.renderOrder = 1;
  groundIndicator.add(outerRingMesh);

  // Altitude-Scaled Inner Target Ring
  const innerRingGeo = new THREE.RingGeometry(radius * 0.82, radius * 0.88, 48);
  innerRingGeo.rotateX(-Math.PI / 2);
  const innerRingMat = ringMat.clone();
  innerRingMat.opacity = 0.55;
  const innerRingMesh = new THREE.Mesh(innerRingGeo, innerRingMat);
  innerRingMesh.position.y = 0.015;
  innerRingMesh.renderOrder = 1;
  groundIndicator.add(innerRingMesh);

  // Attach `groundIndicator` as both a property (`ballRoot.groundIndicator`) AND child so it renders
  // automatically even if the caller only adds `ballMesh` to `scene`!
  groundIndicator.position.set(0, -radius + 0.06, 0);
  ballRoot.add(groundIndicator);
  ballRoot.groundIndicator = groundIndicator;

  ballRoot.userData = {
    radius,
    spinGroup,
    seamCoreMat,
    ledNodeMat,
    ledNodes,
    groundIndicator,
    outerRingMesh,
    innerRingMesh,
    ballShadowMesh,
    currentSeamColor: new THREE.Color(0x00f0ff),
    pulsePhase: 0
  };

  return ballRoot;
}

/**
 * Updates Soccer Ball position, spin rotation, team-colored seam/LED pulse,
 * and projects `ballMesh.groundIndicator` onto the pitch floor (`Y = 0.06m`) directly below `(ball.x, ball.z)`.
 */
export function updateSoccerBallVisuals(ballMesh, ballState = {}, dt = 1 / 60) {
  if (!ballMesh || !ballMesh.userData) return;
  const ud = ballMesh.userData;
  const safeDt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 1 / 60;

  // 1. World Position
  if (ballState.position && Number.isFinite(ballState.position.x)) {
    ballMesh.position.set(ballState.position.x, ballState.position.y, ballState.position.z);
  } else if (Number.isFinite(ballState.x) && Number.isFinite(ballState.y) && Number.isFinite(ballState.z)) {
    ballMesh.position.set(ballState.x, ballState.y, ballState.z);
  }

  // 2. Spin Orientation (applied to `spinGroup` so `groundIndicator` stays horizontal if child!)
  if (ballState.quaternion && Number.isFinite(ballState.quaternion.w)) {
    ud.spinGroup.quaternion.set(
      ballState.quaternion.x,
      ballState.quaternion.y,
      ballState.quaternion.z,
      ballState.quaternion.w
    );
  } else {
    const wx = ballState.angularVelocity?.x ?? ballState.wx ?? 0;
    const wy = ballState.angularVelocity?.y ?? ballState.wy ?? 0;
    const wz = ballState.angularVelocity?.z ?? ballState.wz ?? 0;
    ud.spinGroup.rotation.x += wx * safeDt;
    ud.spinGroup.rotation.y += wy * safeDt;
    ud.spinGroup.rotation.z += wz * safeDt;
  }

  // 3. Team Seam Color & Goal-Proximity Pulse
  const team = String(ballState.lastTouchTeam || 'neutral').toLowerCase();
  let targetHex = 0x00f0ff; // Neutral Cyan
  if (team === 'blue') targetHex = 0x2979ff;
  else if (team === 'orange') targetHex = 0xff6d00;

  ud.currentSeamColor.lerp(ud.currentSeamColor.clone().setHex(targetHex), Math.min(1, safeDt * 8));

  const absZ = Math.abs(ballMesh.position.z);
  const goalProximity = Math.max(0, Math.min(1, (absZ - 60) / 40));
  const pulseRate = 4.0 + goalProximity * 14.0;
  ud.pulsePhase += pulseRate * safeDt;
  const pulse = 1.15 + 0.55 * Math.sin(ud.pulsePhase) + goalProximity * 0.85;

  if (ud.seamCoreMat) {
    ud.seamCoreMat.emissive.copy(ud.currentSeamColor);
    ud.seamCoreMat.emissiveIntensity = pulse;
  }
  if (ud.ledNodeMat) {
    ud.ledNodeMat.emissive.copy(ud.currentSeamColor);
    ud.ledNodeMat.emissiveIntensity = pulse * 1.45;
  }

  // 4. Update Ground Target Projection Ring (`Y = 0.06m`)
  if (ud.groundIndicator) {
    const ballY = Math.max(ud.radius, ballMesh.position.y);
    const altitude = Math.max(0, ballY - ud.radius);

    if (ud.groundIndicator.parent === ballMesh) {
      // Keep world rotation flat on ground and world Y at 0.06m
      const invScaleY = 1.0 / Math.max(1e-4, ballMesh.scale?.y || 1.0);
      ud.groundIndicator.quaternion.copy(ballMesh.quaternion).invert();
      ud.groundIndicator.position.set(0, (0.06 - ballMesh.position.y) * invScaleY, 0);
      ud.groundIndicator.position.applyQuaternion(ud.groundIndicator.quaternion);
    } else {
      ud.groundIndicator.position.set(ballMesh.position.x, 0.06, ballMesh.position.z);
      ud.groundIndicator.rotation.set(0, 0, 0);
    }

    const innerScale = Math.max(0.18, Math.min(0.95, 1.0 - altitude / 34.0));
    if (ud.innerRingMesh) {
      ud.innerRingMesh.scale.set(innerScale, 1, innerScale);
      ud.innerRingMesh.material.color.copy(ud.currentSeamColor);
    }
    if (ud.outerRingMesh) {
      ud.outerRingMesh.material.color.copy(ud.currentSeamColor);
    }
    if (ud.ballShadowMesh) {
      const shadowScale = 1.0 + Math.min(0.8, altitude / 25.0);
      ud.ballShadowMesh.scale.set(shadowScale, 1, shadowScale);
      ud.ballShadowMesh.material.opacity = Math.max(0.15, 0.68 * (1.0 - altitude / 38.0));
    }
  }
}

// ============================================================================
// 8. STUDIO 6-ANGLE + EXPLODED DIAGNOSTIC TURNAROUND HELPER
// ============================================================================

/**
 * Sets up a clean Studio Inspection Scene with cyclorama floor, metric reference grid,
 * 3-point Key/Fill/Rim lighting rig, Blue "01" Hero Car, Geodesic Ball, and Orange "02" Car,
 * plus deterministic camera presets for all 7 diagnostic views:
 * `'side'`, `'front_34'`, `'front'`, `'top'`, `'rear_34'`, `'closeup'` / `'ground_check'`, and `'exploded'`.
 */
export function setupStudioInspectionScene(THREEOrScene, maybeScene, maybeCamera, maybeRenderer, maybeOptions = {}) {
  let THREE = THREE_IMPORT;
  let scene = maybeScene;
  let camera = maybeCamera;
  let renderer = maybeRenderer;
  let options = maybeOptions;

  if (THREEOrScene && THREEOrScene.BufferGeometry && THREEOrScene.Group) {
    THREE = THREEOrScene;
  } else {
    THREE = resolveTHREE(null);
    scene = THREEOrScene;
    camera = maybeScene;
    renderer = maybeCamera;
    options = maybeRenderer || {};
  }

  const studioGroup = new THREE.Group();
  studioGroup.name = 'StudioInspectionRig';
  if (scene && typeof scene.add === 'function') {
    scene.add(studioGroup);
  }

  // 1. Studio Cyclorama Floor at exact Y = 0.00m
  const floorGeo = new THREE.CircleGeometry(36, 64);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x101722,
    roughness: 0.42,
    metalness: 0.15
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.receiveShadow = true;
  floorMesh.position.y = 0.0;
  studioGroup.add(floorMesh);

  // Subtle metric calibration grid at Y = 0.002m
  const gridHelper = new THREE.GridHelper(24, 24, 0x00a8ff, 0x1e2c40);
  gridHelper.position.y = 0.002;
  if (gridHelper.material) {
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.35;
  }
  studioGroup.add(gridHelper);

  // 2. 3-Point Studio Key / Fill / Rim Lighting Rig
  const hemiLight = new THREE.HemisphereLight(0xdbeeff, 0x182232, 1.50);
  studioGroup.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff8ed, 2.75);
  keyLight.position.set(-6.5, 9.5, 7.5);
  keyLight.castShadow = true;
  studioGroup.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x88ccff, 1.65);
  fillLight.position.set(7.5, 5.0, 4.5);
  studioGroup.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0x00e5ff, 1.85);
  rimLight.position.set(0.0, 6.5, -8.5);
  studioGroup.add(rimLight);

  // 3. Hero Actors (if not passed in via options)
  const heroCar = options.heroCar || createBattleCarMesh(THREE, { team: 'blue', carNumber: '01' });
  const orangeCar = options.orangeCar || createBattleCarMesh(THREE, { team: 'orange', carNumber: '02' });
  const soccerBall = options.soccerBall || createSoccerBallMesh(THREE, 3.20);

  if (!options.heroCar) {
    heroCar.position.set(0, 0, 0);
    studioGroup.add(heroCar);
  }
  if (!options.orangeCar) {
    orangeCar.position.set(3.2, 0, -2.5);
    orangeCar.rotation.y = -0.35;
    studioGroup.add(orangeCar);
  }
  if (!options.soccerBall) {
    soccerBall.position.set(4.1, 3.20, -7.8);
    updateSoccerBallVisuals(
      soccerBall,
      { x: 4.1, y: 3.20, z: -7.8, lastTouchTeam: 'neutral' },
      0.016
    );
    studioGroup.add(soccerBall);
  }

  // 4. Deterministic 7-View Camera Preset Controller
  const setCameraAngle = (angleName = 'front_34') => {
    const angle = String(angleName || 'front_34').toLowerCase();

    // Default visibility & exploded state
    setExplodedView(heroCar, angle === 'exploded' ? 1.0 : 0.0);
    updateBattleCarVisuals(heroCar, { x: 0, y: 0, z: 0, boostActive: true }, 0.016);

    const showSecondary = angle === 'front_34';
    orangeCar.visible = showSecondary;
    soccerBall.visible = showSecondary;

    if (!camera) return;

    camera.up.set(0, 1, 0);
    if (camera.isPerspectiveCamera) {
      camera.fov = 34;
    }

    switch (angle) {
      case 'side': {
        // Pure Side Elevation (-X looking toward +X so +Z Nose points Right, matching Panel 1 of model_sheet_5view.png!)
        if (camera.isPerspectiveCamera) camera.fov = 18;
        camera.position.set(-11.8, 0.76, 0.05);
        camera.lookAt(0, 0.68, 0.05);
        break;
      }
      case 'front_34': {
        // Hero Front-Left 3/4 Perspective showing Blue "01" car, non-mirrored left-flank "01", exposed wishbones, plus uncropped R=3.20m Ball & Orange "02"
        if (camera.isPerspectiveCamera) camera.fov = 41;
        camera.position.set(-4.35, 2.18, +5.25);
        camera.lookAt(0.65, 1.78, -0.95);
        break;
      }
      case 'front': {
        // Pure Front Elevation (+Z looking toward -Z, showing front track 1.84m, exposed wishbones & coilover springs)
        if (camera.isPerspectiveCamera) camera.fov = 20;
        camera.position.set(0.0, 0.72, +10.2);
        camera.lookAt(0.0, 0.68, 0.0);
        break;
      }
      case 'top': {
        // Pure Top Plan (+Y looking down -Y with +Z Nose pointing Right and +X Right Flank at Bottom, matching Panel 4!)
        if (camera.isPerspectiveCamera) camera.fov = 22;
        camera.position.set(0.0, 11.8, 0.08);
        camera.up.set(1, 0, 0);
        camera.lookAt(0.0, 0.0, 0.08);
        break;
      }
      case 'rear_34': {
        // Rear-Right 3/4 Perspective showcasing twin R=0.22m rocket thrusters, "RLX-01" badge, diffuser, and +X right-flank "01" decal
        if (camera.isPerspectiveCamera) camera.fov = 36;
        camera.position.set(+3.25, 1.68, -3.85);
        camera.lookAt(0.0, 0.66, -0.15);
        break;
      }
      case 'closeup':
      case 'ground_check': {
        // Low-angle close-up on front-left wheel contact patch (Y=0.00m), exposed double-wishbone & helical coilover, brake caliper, and "01" door decal
        if (camera.isPerspectiveCamera) camera.fov = 32;
        camera.position.set(-2.25, 0.48, +1.95);
        camera.lookAt(-0.35, 0.46, +0.55);
        break;
      }
      case 'exploded': {
        // 3/4 perspective with setExplodedView(heroCar, 1.0) showing separated monocoque, roll-cage, rear wing, thrusters, splitter, wishbones & wheels
        if (camera.isPerspectiveCamera) camera.fov = 40;
        camera.position.set(-4.35, 2.65, +4.45);
        camera.lookAt(0.0, 0.85, 0.0);
        break;
      }
      default: {
        camera.position.set(-4.35, 2.18, +5.25);
        camera.lookAt(0.65, 1.78, -0.95);
        break;
      }
    }

    if (typeof camera.updateProjectionMatrix === 'function') {
      camera.updateProjectionMatrix();
    }
    if (renderer && scene && typeof renderer.render === 'function') {
      renderer.render(scene, camera);
    }
  };

  const dispose = () => {
    setExplodedView(heroCar, 0);
    if (studioGroup.parent) {
      studioGroup.parent.remove(studioGroup);
    }
  };

  return {
    studioGroup,
    heroCar,
    orangeCar,
    soccerBall,
    setCameraAngle,
    dispose
  };
}

// ============================================================================
// 9. GLOBAL CONTRACT REGISTRATION (`window.RLModules.Assets`)
// ============================================================================

const AssetsModule = {
  DEFAULT_LOFT_STATIONS,
  createLoftedShellGeometry,
  generateCarLiveryTexture,
  createBattleCarMesh,
  updateBattleCarVisuals,
  setExplodedView,
  createSoccerBallMesh,
  updateSoccerBallVisuals,
  setupStudioInspectionScene
};

if (typeof window !== 'undefined') {
  window.RLModules = window.RLModules || {};
  window.RLModules.Assets = AssetsModule;
}

export default AssetsModule;
