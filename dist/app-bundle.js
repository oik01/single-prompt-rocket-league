import * as THREE from 'three';
window.THREE = THREE;
window.RLModules = window.RLModules || {};

// ============================================================================
// Module 1: Arena & Environment (arena-and-environment.js)
// ============================================================================
(function(THREE, THREE_IMPORT) {
/**
 * @file src/arena-and-environment.js
 * @description Module 1 — DFH Neo-Dome Arena & Stadium Environment Builder.
 * Implements:
 *   1. ARENA_CONSTANTS (exact metric dimensions of the 120m x 200m x 40m enclosed cage & goals)
 *   2. BOOST_PAD_LAYOUT (all 28 boost pads: 6 full canisters + 22 small pads)
 *   3. evalArenaSDF(x, y, z) — C1-continuous analytical signed distance & inward normal field
 *      with R_fillet = 8.0m floor/ceiling ramps, R_corner = 16.0m vertical corners, unobstructed
 *      recessed goal chambers (|Z| in [100, 112], |X| < 14, Y < 11), and exact 3D capsule
 *      goalposts & crossbar (R_post = 0.45m).
 *   4. createArenaEnvironment(THREE, scene) — Full 3D stadium environment matching evalArenaSDF,
 *      procedural 2048x1024 turf + normal/roughness maps, dynamic hex-ripple glass dome shader,
 *      recessed neon goal chambers, 28 interactive boost pads with cooldown gauges, 4,000 instanced
 *      crowd light-sticks, twin dynamic 512x256 Jumbotrons, and 3-tier stadium lighting rig.
 */

const ARENA_CONSTANTS = {
  halfWidth: 60.0,      // X in [-60, +60] (120m width)
  halfLength: 100.0,    // Z in [-100, +100] (200m length)
  height: 40.0,         // Y in [0, 40] (40m ceiling)
  filletRadius: 8.0,    // R_fillet = 8.0m floor-to-wall & wall-to-ceiling
  cornerRadius: 16.0,   // R_corner = 16.0m vertical X-Z corners
  goalHalfWidth: 14.0,  // X in [-14, +14] (28m goal width)
  goalHeight: 11.0,     // Y in [0, 11] (11m goal height)
  goalDepth: 12.0,      // |Z| in [100, 112] (12m recessed goal box)
  goalPostRadius: 0.45, // R_post = 0.45m capsule posts & crossbar
  ballRadius: 3.20
};

const RAW_FULL_PADS = [
  [-48, 0, -80],
  [+48, 0, -80],
  [-50, 0, 0],
  [+50, 0, 0],
  [-48, 0, +80],
  [+48, 0, +80]
];

const RAW_SMALL_PADS = [
  [0, 0, -84],
  [-18, 0, -76],
  [+18, 0, -76],
  [-30, 0, -60],
  [0, 0, -60],
  [+30, 0, -60],
  [-16, 0, -40],
  [+16, 0, -40],
  [-36, 0, -24],
  [0, 0, -24],
  [+36, 0, -24],
  [-36, 0, +24],
  [0, 0, +24],
  [+36, 0, +24],
  [-16, 0, +40],
  [+16, 0, +40],
  [-30, 0, +60],
  [0, 0, +60],
  [+30, 0, +60],
  [-18, 0, +76],
  [+18, 0, +76],
  [0, 0, +84]
];

const BOOST_PAD_LAYOUT = [
  ...RAW_FULL_PADS.map(([x, y, z], idx) => ({
    id: idx,
    type: 'full',
    x,
    y,
    z,
    boost: 100,
    respawnTime: 10.0,
    respawn: 10.0,
    radius: 2.8
  })),
  ...RAW_SMALL_PADS.map(([x, y, z], idx) => ({
    id: RAW_FULL_PADS.length + idx,
    type: 'small',
    x,
    y,
    z,
    boost: 12,
    respawnTime: 4.0,
    respawn: 4.0,
    radius: 1.8
  }))
];

/**
 * Helper: smoothstep(edge0, edge1, x)
 */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3.0 - 2.0 * t);
}

/**
 * Helper: Compute exact 3D distance and outward normal from the 3-segment goal frame
 * (Left Post at x = -14, Right Post at x = +14, Crossbar at y = 11) at z = zGoal.
 */
function evalGoalFrameCapsule(x, y, z, zGoal, postRadius) {
  const gw = ARENA_CONSTANTS.goalHalfWidth; // 14.0
  const gh = ARENA_CONSTANTS.goalHeight;    // 11.0

  // Segment 1: Left vertical post (-14, [0..11], zGoal)
  const ly = Math.max(0.0, Math.min(gh, y));
  const dlx = x - (-gw);
  const dly = y - ly;
  const dlz = z - zGoal;
  const distSqL = dlx * dlx + dly * dly + dlz * dlz;

  // Segment 2: Right vertical post (+14, [0..11], zGoal)
  const ry = ly;
  const drx = x - gw;
  const dry = y - ry;
  const drz = dlz;
  const distSqR = drx * drx + dry * dry + drz * drz;

  // Segment 3: Horizontal crossbar ([-14..+14], 11, zGoal)
  const tx = Math.max(-gw, Math.min(gw, x));
  const dtx = x - tx;
  const dty = y - gh;
  const dtz = dlz;
  const distSqT = dtx * dtx + dty * dty + dtz * dtz;

  let minSq = distSqL;
  let dx = dlx;
  let dy = dly;
  let dz = dlz;

  if (distSqR < minSq) {
    minSq = distSqR;
    dx = drx;
    dy = dry;
    dz = drz;
  }
  if (distSqT < minSq) {
    minSq = distSqT;
    dx = dtx;
    dy = dty;
    dz = dtz;
  }

  const len = Math.sqrt(minSq);
  const dist = len - postRadius;
  let nx = 0.0;
  let ny = 0.0;
  let nz = 0.0;

  if (len > 1e-7) {
    nx = dx / len;
    ny = dy / len;
    nz = dz / len;
  } else {
    // Fallback unit normal pointing inward toward pitch center when queried directly on post axis
    const sx = x >= 0.0 ? -1.0 : 1.0;
    const sz = zGoal >= 0.0 ? -1.0 : 1.0;
    nx = sx * 0.7071067811865475;
    ny = 0.0;
    nz = sz * 0.7071067811865475;
  }

  return { dist, nx, ny, nz, surfaceType: 'goal_post' };
}

/**
 * Helper: Evaluate horizontal distance to the 2D rounded rectangle wall (halfWidth=60, halfLength=100, R_corner=16)
 * and the inward-pointing 2D horizontal normal (nhx, nhz).
 */
function evalHorizontalPerimeter(x, z) {
  const W = ARENA_CONSTANTS.halfWidth;    // 60.0
  const L = ARENA_CONSTANTS.halfLength;   // 100.0
  const Rc = ARENA_CONSTANTS.cornerRadius; // 16.0
  const Wc = W - Rc; // 44.0
  const Lc = L - Rc; // 84.0

  const ax = Math.abs(x);
  const az = Math.abs(z);
  const sx = x < 0.0 ? -1.0 : 1.0;
  const sz = z < 0.0 ? -1.0 : 1.0;

  const qx = ax - Wc;
  const qz = az - Lc;

  let dHoriz;
  let nhx = 0.0;
  let nhz = 0.0;
  let isBackWallDominant = false;

  if (qx > 0.0 && qz > 0.0) {
    // In the 4 rounded vertical corner quadrants (|x| > 44, |z| > 84)
    const uLen = Math.sqrt(qx * qx + qz * qz);
    dHoriz = Rc - uLen;
    if (uLen > 1e-8) {
      nhx = (-sx * qx) / uLen;
      nhz = (-sz * qz) / uLen;
    } else {
      nhx = -sx * 0.7071067811865475;
      nhz = -sz * 0.7071067811865475;
    }
    isBackWallDominant = qz > qx;
  } else if (qx > qz) {
    // Side wall (|x| = 60) is closest horizontal boundary
    dHoriz = W - ax;
    nhx = -sx;
    nhz = 0.0;
    isBackWallDominant = false;
  } else {
    // Back wall (|z| = 100) is closest horizontal boundary
    dHoriz = L - az;
    nhx = 0.0;
    nhz = -sz;
    isBackWallDominant = true;
  }

  return { dHoriz, nhx, nhz, isBackWallDominant };
}

/**
 * Compute the bottom fillet radius at a given (x, z) along the perimeter.
 * Everywhere along the sidelines, corners, and outer back wall (|x| >= 18), R_bot = 8.0m.
 * Next to the goalposts (|x| in [14, 18] near the back walls), R_bot smoothly tapers from
 * 0.0m at |x| = 14.0m (goalpost edge) to 8.0m at |x| = 18.0m so the ramp meets the goalpost flush.
 */
function getBottomFilletRadiusAt(x, z) {
  const Rf = ARENA_CONSTANTS.filletRadius; // 8.0
  const gw = ARENA_CONSTANTS.goalHalfWidth; // 14.0
  const az = Math.abs(z);
  const ax = Math.abs(x);

  if (az > 80.0 && ax < gw + 4.0) {
    if (ax <= gw) return 0.0;
    return Rf * smoothstep(gw, gw + 4.0, ax);
  }
  return Rf;
}

/**
 * Analytical C1-Continuous Signed Distance & Surface Normal Function.
 *
 * @param {number} x - World X coordinate in meters ([-60, +60])
 * @param {number} y - World Y coordinate in meters ([0, +40])
 * @param {number} z - World Z coordinate in meters ([-112, +112])
 * @returns {{ dist: number, nx: number, ny: number, nz: number, surfaceType: 'floor' | 'ramp' | 'wall' | 'ceiling' | 'goal_box' | 'goal_post' }}
 */
function evalArenaSDF(x, y, z) {
  // Sanitize non-finite inputs safely
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return { dist: 0.0, nx: 0.0, ny: 1.0, nz: 0.0, surfaceType: 'floor' };
  }

  const L = ARENA_CONSTANTS.halfLength;       // 100.0
  const H = ARENA_CONSTANTS.height;           // 40.0
  const Rf = ARENA_CONSTANTS.filletRadius;    // 8.0
  const gw = ARENA_CONSTANTS.goalHalfWidth;   // 14.0
  const gh = ARENA_CONSTANTS.goalHeight;      // 11.0
  const gd = ARENA_CONSTANTS.goalDepth;       // 12.0
  const rPost = ARENA_CONSTANTS.goalPostRadius; // 0.45

  const ax = Math.abs(x);
  const az = Math.abs(z);
  const sx = x < 0.0 ? -1.0 : 1.0;
  const sz = z < 0.0 ? -1.0 : 1.0;
  const zGoal = z < 0.0 ? -L : L;

  // Evaluate 3D capsule distance to the nearest goal frame (posts + crossbar) when near Z = ±100
  const nearGoalPlane = az > 88.0 && ax < gw + 6.0 && y < gh + 6.0;
  const frameHit = nearGoalPlane ? evalGoalFrameCapsule(x, y, z, zGoal, rPost) : null;

  // -------------------------------------------------------------------------
  // REGION 1: Inside or penetrating the Recessed Goal Chamber (|z| > 100.0)
  // -------------------------------------------------------------------------
  if (az > L && ax < gw + 4.0 && y < gh + 3.5) {
    const dFloor = y;                  // y = 0.0, inward normal (0, +1, 0)
    const dCeil = gh - y;              // y = 11.0, inward normal (0, -1, 0)
    const dSide = gw - ax;             // |x| = 14.0, inward normal (-sx, 0, 0)
    const dBack = (L + gd) - az;       // |z| = 112.0, inward normal (0, 0, -sz)

    let minDist = dFloor;
    let nx = 0.0;
    let ny = 1.0;
    let nz = 0.0;

    if (dCeil < minDist) {
      minDist = dCeil;
      nx = 0.0;
      ny = -1.0;
      nz = 0.0;
    }
    if (dSide < minDist) {
      minDist = dSide;
      nx = -sx;
      ny = 0.0;
      nz = 0.0;
    }
    if (dBack < minDist) {
      minDist = dBack;
      nx = 0.0;
      ny = 0.0;
      nz = -sz;
    }

    if (frameHit && frameHit.dist < minDist) {
      return frameHit;
    }

    return { dist: minDist, nx, ny, nz, surfaceType: 'goal_box' };
  }

  // -------------------------------------------------------------------------
  // REGION 2: Main Arena Volume & Goal Mouth Approach (|z| <= 100.0)
  // -------------------------------------------------------------------------
  // If inside the goal mouth aperture (|x| < 14.0 and y < 11.0) and approaching |z| <= 100,
  // the back wall at |z| = 100 is OPEN into the recessed goal chamber!
  const inGoalAperture = ax < gw && y < gh && az > 76.0;

  if (inGoalAperture) {
    const dFloor = y;
    const dGoalBack = (L + gd) - az;

    let minDist = dFloor;
    let nx = 0.0;
    let ny = 1.0;
    let nz = 0.0;
    let surfaceType = 'floor';

    if (dGoalBack < minDist) {
      minDist = dGoalBack;
      nx = 0.0;
      ny = 0.0;
      nz = -sz;
      surfaceType = 'goal_box';
    }

    if (frameHit && frameHit.dist < minDist) {
      return frameHit;
    }

    return { dist: minDist, nx, ny, nz, surfaceType };
  }

  // Standard C1-continuous rounded-rectangle + filleted floor/ceiling cross-section
  const { dHoriz, nhx, nhz, isBackWallDominant } = evalHorizontalPerimeter(x, z);

  // Determine effective fillet radius (R_fillet = 8.0m on ceiling and walls, tapered to 0 at goalposts)
  const isNearFloor = y < H * 0.5;
  const rFillet = (isNearFloor && isBackWallDominant) ? getBottomFilletRadiusAt(x, z) : Rf;

  const dVert = isNearFloor ? y : (H - y);
  const nvy = isNearFloor ? 1.0 : -1.0;

  let dist;
  let nx;
  let ny;
  let nz;
  let surfaceType;

  const wH = rFillet - dHoriz;
  const wV = rFillet - dVert;

  if (rFillet > 1e-5 && wH > 0.0 && wV > 0.0) {
    // Inside the curved floor-to-wall or wall-to-ceiling fillet ramp zone
    const r = Math.sqrt(wH * wH + wV * wV);
    dist = rFillet - r;
    if (r > 1e-8) {
      const invR = 1.0 / r;
      nx = nhx * wH * invR;
      ny = nvy * wV * invR;
      nz = nhz * wH * invR;
    } else {
      nx = nhx * 0.7071067811865475;
      ny = nvy * 0.7071067811865475;
      nz = nhz * 0.7071067811865475;
    }
    surfaceType = 'ramp';
  } else if (dVert <= dHoriz) {
    // Flat floor (y = 0) or flat ceiling (y = 40)
    dist = dVert;
    nx = 0.0;
    ny = nvy;
    nz = 0.0;
    surfaceType = isNearFloor ? 'floor' : 'ceiling';
  } else {
    // Vertical perimeter wall (or vertical corner)
    dist = dHoriz;
    nx = nhx;
    ny = 0.0;
    nz = nhz;
    surfaceType = 'wall';
  }

  // Check if the 3D capsule goalpost or crossbar is closer than the wall/floor
  if (frameHit && frameHit.dist < dist) {
    return frameHit;
  }

  return { dist, nx, ny, nz, surfaceType };
}

// ============================================================================
// PROCEDURAL TEXTURE GENERATORS (Turf, Normal/Bump, Roughness, Curb, Jumbotron)
// ============================================================================

function createSafeCanvas(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }
  return null;
}

/**
 * Generates the high-resolution 2048x1024 procedural mowed turf pitch textures:
 *  - map: Alternating 10m emerald grass stripes (#133822 & #184229), hexagonal tech sub-grid,
 *    Blue/Orange floodlight color grading, crisp white touchlines, halfway line, R=18m center circle,
 *    center kickoff spot, and penalty box markings.
 *  - bumpMap & roughnessMap: Micro-blade turf grain + smooth painted chalk lines.
 */
function createPitchTextures(THREE) {
  const width = 2048;
  const height = 1024;
  const colorCanvas = createSafeCanvas(width, height);
  const bumpCanvas = createSafeCanvas(width / 2, height / 2);
  const roughCanvas = createSafeCanvas(width / 2, height / 2);

  if (!colorCanvas) {
    return { map: null, bumpMap: null, roughnessMap: null };
  }

  const ctx = colorCanvas.getContext('2d');
  // Mapping: u in [0, 1] -> Z in [-100, +100] (200m length), v in [0, 1] -> X in [-60, +60] (120m width)
  const zToX = (z) => ((z + 100.0) / 200.0) * width;
  const xToY = (x) => ((x + 60.0) / 120.0) * height;
  const mToPxZ = (m) => (m / 200.0) * width;
  const mToPxX = (m) => (m / 120.0) * height;

  // 1. 20 Alternating 10m Mowed Emerald Grass Stripes along Z in [-100, +100]
  const numStripes = 20;
  const stripeW = width / numStripes;
  for (let i = 0; i < numStripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#133822' : '#184229';
    ctx.fillRect(i * stripeW, 0, Math.ceil(stripeW) + 1, height);

    // Subtle longitudinal mower tracks within each 10m band
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.022)';
    for (let s = 0; s < 4; s++) {
      ctx.fillRect(i * stripeW + (s + 0.25) * (stripeW / 4), 0, stripeW / 8, height);
    }
  }

  // 2. Subtle Longitudinal Turf Sheen Striations
  for (let row = 0; row < height; row += 16) {
    ctx.fillStyle = (row / 16) % 2 === 0 ? 'rgba(255, 255, 255, 0.015)' : 'rgba(0, 0, 0, 0.018)';
    ctx.fillRect(0, row, width, 8);
  }

  // 3. Subtle Hexagonal Sub-Surface Tech Grid
  ctx.save();
  ctx.lineWidth = 1.2;
  const hexR = 22;
  const hexH = hexR * Math.sqrt(3);
  for (let gx = 0; gx < width + hexR * 2; gx += hexR * 1.5) {
    const colIdx = Math.round(gx / (hexR * 1.5));
    const isBlueSide = gx < width * 0.5;
    ctx.strokeStyle = isBlueSide
      ? 'rgba(0, 210, 255, 0.055)'
      : 'rgba(255, 135, 20, 0.055)';
    for (let gy = -hexH; gy < height + hexH; gy += hexH) {
      const cy = gy + (colIdx % 2 === 1 ? hexH * 0.5 : 0);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const ang = (Math.PI / 3) * k;
        const px = gx + hexR * 0.88 * Math.cos(ang);
        const py = cy + hexR * 0.88 * Math.sin(ang);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();

  // 4. Blue (Z < 0) and Orange (Z > 0) Stadium Floodlight Color Grading
  const blueGrad = ctx.createRadialGradient(
    zToX(-96), xToY(0), 20,
    zToX(-60), xToY(0), width * 0.48
  );
  blueGrad.addColorStop(0.0, 'rgba(0, 155, 255, 0.22)');
  blueGrad.addColorStop(0.45, 'rgba(0, 110, 220, 0.08)');
  blueGrad.addColorStop(1.0, 'rgba(0, 110, 220, 0.0)');
  ctx.fillStyle = blueGrad;
  ctx.fillRect(0, 0, width, height);

  const orangeGrad = ctx.createRadialGradient(
    zToX(96), xToY(0), 20,
    zToX(60), xToY(0), width * 0.48
  );
  orangeGrad.addColorStop(0.0, 'rgba(255, 105, 0, 0.22)');
  orangeGrad.addColorStop(0.45, 'rgba(255, 75, 0, 0.08)');
  orangeGrad.addColorStop(1.0, 'rgba(255, 75, 0, 0.0)');
  ctx.fillStyle = orangeGrad;
  ctx.fillRect(0, 0, width, height);

  // 5. Crisp White Boundary Lines, Halfway Line, Center Circle (R = 18.0m), Penalty Boxes
  ctx.save();
  ctx.strokeStyle = 'rgba(236, 248, 255, 0.92)';
  ctx.fillStyle = 'rgba(236, 248, 255, 0.92)';
  ctx.shadowColor = 'rgba(180, 235, 255, 0.45)';
  ctx.shadowBlur = 6;
  ctx.lineWidth = 5.5;

  // Outer rounded pitch boundary at the flat floor edge (Z in [-92, +92], X in [-52, +52], corner R = 8m)
  const bx0 = zToX(-92.0);
  const bx1 = zToX(+92.0);
  const by0 = xToY(-52.0);
  const by1 = xToY(+52.0);
  const br = mToPxZ(8.0);

  ctx.beginPath();
  ctx.moveTo(bx0 + br, by0);
  ctx.lineTo(bx1 - br, by0);
  ctx.quadraticCurveTo(bx1, by0, bx1, by0 + br);
  ctx.lineTo(bx1, by1 - br);
  ctx.quadraticCurveTo(bx1, by1, bx1 - br, by1);
  ctx.lineTo(bx0 + br, by1);
  ctx.quadraticCurveTo(bx0, by1, bx0, by1 - br);
  ctx.lineTo(bx0, by0 + br);
  ctx.quadraticCurveTo(bx0, by0, bx0 + br, by0);
  ctx.closePath();
  ctx.stroke();

  // Halfway line (Z = 0)
  ctx.beginPath();
  ctx.moveTo(zToX(0), by0);
  ctx.lineTo(zToX(0), by1);
  ctx.stroke();

  // Center Circle (R = 18.0m exact metric radius)
  ctx.beginPath();
  ctx.ellipse(
    zToX(0),
    xToY(0),
    mToPxZ(18.0),
    mToPxX(18.0),
    0,
    0,
    Math.PI * 2
  );
  ctx.stroke();

  // Inner Center Tech Ring (R = 3.6m) & Kickoff Center Spot
  ctx.lineWidth = 3.0;
  ctx.beginPath();
  ctx.ellipse(zToX(0), xToY(0), mToPxZ(3.6), mToPxX(3.6), 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(zToX(0), xToY(0), mToPxZ(0.95), mToPxX(0.95), 0, 0, Math.PI * 2);
  ctx.fill();

  // Blue (-Z) and Orange (+Z) Penalty Boxes & Goal Boxes
  ctx.lineWidth = 5.0;
  for (const dir of [-1, +1]) {
    const zLine = dir * 92.0;
    const zPen = dir * 64.0;
    const zGoalBox = dir * 80.0;

    // Outer Penalty Area (X in [-28, +28], Z from ±92 to ±64)
    const px0 = Math.min(zToX(zLine), zToX(zPen));
    const pw = Math.abs(zToX(zLine) - zToX(zPen));
    const py0 = xToY(-28.0);
    const ph = xToY(+28.0) - py0;
    ctx.strokeRect(px0, py0, pw, ph);

    // Inner Goal Box (X in [-16, +16], Z from ±92 to ±80)
    const gx0 = Math.min(zToX(zLine), zToX(zGoalBox));
    const gwPx = Math.abs(zToX(zLine) - zToX(zGoalBox));
    const gy0 = xToY(-16.0);
    const ghPx = xToY(+16.0) - gy0;
    ctx.strokeRect(gx0, gy0, gwPx, ghPx);

    // Goal-line neon accent bar across X in [-14, +14] at Z = ±99.5
    ctx.save();
    ctx.strokeStyle = dir < 0 ? '#00c8ff' : '#ff6a00';
    ctx.shadowColor = dir < 0 ? '#00c8ff' : '#ff6a00';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 8.0;
    ctx.beginPath();
    ctx.moveTo(zToX(dir * 99.0), xToY(-14.0));
    ctx.lineTo(zToX(dir * 99.0), xToY(+14.0));
    ctx.stroke();
    ctx.restore();

    // Penalty Arc at Z = ±64
    ctx.beginPath();
    const startAng = dir < 0 ? -0.32 * Math.PI : 0.68 * Math.PI;
    const endAng = dir < 0 ? 0.32 * Math.PI : 1.32 * Math.PI;
    ctx.ellipse(
      zToX(dir * 68.0),
      xToY(0),
      mToPxZ(10.0),
      mToPxX(10.0),
      0,
      startAng,
      endAng
    );
    ctx.stroke();
  }
  ctx.restore();

  // Build Bump & Roughness Maps
  if (bumpCanvas && roughCanvas) {
    const bCtx = bumpCanvas.getContext('2d');
    const rCtx = roughCanvas.getContext('2d');
    const bw = bumpCanvas.width;
    const bh = bumpCanvas.height;

    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, bw, bh);

    rCtx.fillStyle = '#b8b8b8'; // ~0.72 roughness on grass
    rCtx.fillRect(0, 0, bw, bh);

    for (let i = 0; i < numStripes; i++) {
      rCtx.fillStyle = i % 2 === 0 ? '#b2b2b2' : '#c4c4c4';
      rCtx.fillRect(i * (bw / numStripes), 0, bw / numStripes, bh);
    }

    // Deterministic grass blade micro-grain
    const imgData = bCtx.getImageData(0, 0, bw, bh);
    const data = imgData.data;
    let seed = 1337;
    for (let i = 0; i < data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = 110 + ((seed >>> 24) & 35);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
    bCtx.putImageData(imgData, 0, 0);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = 8;
  if (THREE.SRGBColorSpace) {
    map.colorSpace = THREE.SRGBColorSpace;
  }

  const bumpMap = bumpCanvas ? new THREE.CanvasTexture(bumpCanvas) : null;
  const roughnessMap = roughCanvas ? new THREE.CanvasTexture(roughCanvas) : null;

  return { map, bumpMap, roughnessMap };
}

/**
 * Generates a tileable warning chevron + carbon trim texture for the lower R_fillet = 8.0m ramp apron.
 */
function createRampCurbTexture(THREE) {
  const canvas = createSafeCanvas(512, 256);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  // Dark metallic carbon base
  ctx.fillStyle = '#19212c';
  ctx.fillRect(0, 0, 512, 256);

  // Subtle horizontal grip ribs along the ramp curvature
  for (let y = 0; y < 256; y += 16) {
    ctx.fillStyle = (y / 16) % 2 === 0 ? '#1f2937' : '#141b24';
    ctx.fillRect(0, y, 512, 8);
  }

  // Lower safety hazard chevron stripe band (near floor transition y in [0, 56px])
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 512, 54);
  ctx.clip();
  ctx.fillStyle = '#11161d';
  ctx.fillRect(0, 0, 512, 54);

  ctx.fillStyle = '#f59e0b';
  for (let x = -64; x < 576; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 32, 0);
    ctx.lineTo(x + 56, 54);
    ctx.lineTo(x + 24, 54);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Glowing cyan/amber boundary guide line at top and bottom of ramp
  ctx.fillStyle = '#00d8ff';
  ctx.fillRect(0, 54, 512, 4);
  ctx.fillRect(0, 248, 512, 6);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(36, 1);
  if (THREE.SRGBColorSpace) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  return tex;
}

// ============================================================================
// EXACT SDF-MATCHED 3D ARENA RAMP, WALL & CEILING MESH GENERATORS
// ============================================================================

/**
 * Computes a point (x, z) and inward horizontal normal (nhx, nhz) along the outer rounded-rectangle
 * perimeter (halfWidth = 60, halfLength = 100, cornerRadius = 16) at angle/parameter theta in [0, 2*PI).
 * Rather than uniform angle (which bunches vertices), we parameterize by exact arc-length around the
 * 4 straight walls and 4 circular corner arcs!
 */
function sampleRoundedPerimeterByArcLength(uNormalized) {
  const W = ARENA_CONSTANTS.halfWidth;    // 60.0
  const L = ARENA_CONSTANTS.halfLength;   // 100.0
  const Rc = ARENA_CONSTANTS.cornerRadius; // 16.0
  const Wc = W - Rc; // 44.0 (half-width of straight back wall segment)
  const Lc = L - Rc; // 84.0 (half-length of straight side wall segment)

  const straightBack = 2.0 * Wc; // 88.0m
  const straightSide = 2.0 * Lc; // 168.0m
  const cornerArc = 0.5 * Math.PI * Rc; // ~25.1327m
  const totalPerimeter = 2.0 * straightBack + 2.0 * straightSide + 4.0 * cornerArc;

  let s = ((uNormalized % 1.0) + 1.0) % 1.0 * totalPerimeter;

  // Segment 0: North/Orange Back Wall (z = +100, x from -Wc to +Wc)
  if (s < straightBack) {
    const x = -Wc + s;
    return { x, z: L, nhx: 0.0, nhz: -1.0, u: uNormalized, isBackWall: true };
  }
  s -= straightBack;

  // Segment 1: Top-Right Corner (+Wc..+W, +Lc..+L)
  if (s < cornerArc) {
    const ang = (s / cornerArc) * (Math.PI * 0.5); // 0 to PI/2
    const sinA = Math.sin(ang);
    const cosA = Math.cos(ang);
    return {
      x: Wc + Rc * sinA,
      z: Lc + Rc * cosA,
      nhx: -sinA,
      nhz: -cosA,
      u: uNormalized,
      isBackWall: false
    };
  }
  s -= cornerArc;

  // Segment 2: Right Side Wall (x = +60, z from +Lc to -Lc)
  if (s < straightSide) {
    const z = Lc - s;
    return { x: W, z, nhx: -1.0, nhz: 0.0, u: uNormalized, isBackWall: false };
  }
  s -= straightSide;

  // Segment 3: Bottom-Right Corner (+Wc..+W, -Lc..-L)
  if (s < cornerArc) {
    const ang = (s / cornerArc) * (Math.PI * 0.5);
    const sinA = Math.sin(ang);
    const cosA = Math.cos(ang);
    return {
      x: Wc + Rc * cosA,
      z: -Lc - Rc * sinA,
      nhx: -cosA,
      nhz: sinA,
      u: uNormalized,
      isBackWall: false
    };
  }
  s -= cornerArc;

  // Segment 4: South/Blue Back Wall (z = -100, x from +Wc to -Wc)
  if (s < straightBack) {
    const x = Wc - s;
    return { x, z: -L, nhx: 0.0, nhz: 1.0, u: uNormalized, isBackWall: true };
  }
  s -= straightBack;

  // Segment 5: Bottom-Left Corner (-Wc..-W, -Lc..-L)
  if (s < cornerArc) {
    const ang = (s / cornerArc) * (Math.PI * 0.5);
    const sinA = Math.sin(ang);
    const cosA = Math.cos(ang);
    return {
      x: -Wc - Rc * sinA,
      z: -Lc - Rc * cosA,
      nhx: sinA,
      nhz: cosA,
      u: uNormalized,
      isBackWall: false
    };
  }
  s -= cornerArc;

  // Segment 6: Left Side Wall (x = -60, z from -Lc to +Lc)
  if (s < straightSide) {
    const z = -Lc + s;
    return { x: -W, z, nhx: 1.0, nhz: 0.0, u: uNormalized, isBackWall: false };
  }
  s -= straightSide;

  // Segment 7: Top-Left Corner (-Wc..-W, +Lc..+L)
  const ang = Math.min(1.0, s / cornerArc) * (Math.PI * 0.5);
  const sinA = Math.sin(ang);
  const cosA = Math.cos(ang);
  return {
    x: -Wc - Rc * cosA,
    z: Lc + Rc * sinA,
    nhx: cosA,
    nhz: -sinA,
    u: uNormalized,
    isBackWall: false
  };
}

/**
 * Builds the exact SDF-matching 3D geometries for:
 *  1. Lower R_fillet = 8.0m curved transition ramp (opaque hazard curb mesh, skipping goal mouths)
 *  2. Translucent hexagonal energy-shield glass cage (vertical walls y in [8, 32], upper fillet y in [32, 40],
 *     ceiling canopy, and above-crossbar back wall y in [11, 32], leaving Z=±100, |X|<14, Y<11 wide open!)
 */
function buildArenaCageGeometries(THREE) {
  const H = ARENA_CONSTANTS.height;         // 40.0
  const Rf = ARENA_CONSTANTS.filletRadius;  // 8.0
  const gw = ARENA_CONSTANTS.goalHalfWidth; // 14.0
  const gh = ARENA_CONSTANTS.goalHeight;    // 11.0

  const numPerimeterSteps = 320;
  const perimeterSamples = [];
  for (let i = 0; i <= numPerimeterSteps; i++) {
    perimeterSamples.push(sampleRoundedPerimeterByArcLength(i / numPerimeterSteps));
  }

  // -------------------------------------------------------------------------
  // 1. Lower Curved Transition Ramp Geometry (y in [0, 8.0m])
  // -------------------------------------------------------------------------
  const rampArcSteps = 10;
  const rampPositions = [];
  const rampNormals = [];
  const rampUVs = [];
  const rampIndices = [];

  for (let i = 0; i < numPerimeterSteps; i++) {
    const s0 = perimeterSamples[i];
    const s1 = perimeterSamples[i + 1];
    const xm = 0.5 * (s0.x + s1.x);
    const zm = 0.5 * (s0.z + s1.z);

    // Skip the goal mouth opening (|Z| > 99.0 and |X| < 14.0)
    if (Math.abs(zm) > 99.0 && Math.abs(xm) < gw) {
      continue;
    }

    const baseVertexIndex = rampPositions.length / 3;
    for (let c = 0; c <= 1; c++) {
      const sp = c === 0 ? s0 : s1;
      const rBot = sp.isBackWall ? getBottomFilletRadiusAt(sp.x, sp.z) : Rf;

      for (let j = 0; j <= rampArcSteps; j++) {
        const vFrac = j / rampArcSteps;
        const theta = vFrac * (Math.PI * 0.5); // 0 (at floor) to PI/2 (at vertical wall)
        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);

        // Point on the fillet arc of radius rBot:
        // At theta = 0: dHoriz = rBot, y = 0 (tangent to floor)
        // At theta = PI/2: dHoriz = 0, y = rBot (tangent to vertical wall)
        const inset = rBot * (1.0 - sinT);
        const px = sp.x + sp.nhx * inset;
        const py = rBot * (1.0 - cosT);
        const pz = sp.z + sp.nhz * inset;

        const nx = sp.nhx * sinT;
        const ny = cosT;
        const nz = sp.nhz * sinT;

        rampPositions.push(px, py, pz);
        rampNormals.push(nx, ny, nz);
        rampUVs.push(sp.u, vFrac);
      }
    }

    const stride = rampArcSteps + 1;
    for (let j = 0; j < rampArcSteps; j++) {
      const a = baseVertexIndex + j;
      const b = baseVertexIndex + stride + j;
      const c = baseVertexIndex + stride + j + 1;
      const d = baseVertexIndex + j + 1;
      rampIndices.push(a, b, d, b, c, d);
    }
  }

  const rampGeometry = new THREE.BufferGeometry();
  rampGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rampPositions, 3));
  rampGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(rampNormals, 3));
  rampGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(rampUVs, 2));
  rampGeometry.setIndex(rampIndices);

  // -------------------------------------------------------------------------
  // 2. Translucent Hex-Shield Glass Dome & Upper Fillet Geometry
  // -------------------------------------------------------------------------
  const glassPositions = [];
  const glassNormals = [];
  const glassUVs = [];
  const glassIndices = [];

  // Vertical profile stations from top of bottom ramp up to ceiling center inset
  const upperArcSteps = 8;
  for (let i = 0; i < numPerimeterSteps; i++) {
    const s0 = perimeterSamples[i];
    const s1 = perimeterSamples[i + 1];
    const xm = 0.5 * (s0.x + s1.x);
    const zm = 0.5 * (s0.z + s1.z);
    const isGoalColumn = Math.abs(zm) > 99.0 && Math.abs(xm) < gw;

    // Above the goal mouth, the glass wall begins at the crossbar (y = 11.0m);
    // everywhere else it begins at the top of the bottom ramp (y = 8.0m).
    const yStart0 = isGoalColumn
      ? gh
      : (s0.isBackWall ? getBottomFilletRadiusAt(s0.x, s0.z) : Rf);
    const yStart1 = isGoalColumn
      ? gh
      : (s1.isBackWall ? getBottomFilletRadiusAt(s1.x, s1.z) : Rf);

    const baseIdx = glassPositions.length / 3;
    const totalRingSteps = 4 + upperArcSteps + 1; // 4 vertical wall subdivisions + upper fillet + ceiling rim

    for (let c = 0; c <= 1; c++) {
      const sp = c === 0 ? s0 : s1;
      const yMin = c === 0 ? yStart0 : yStart1;
      const yWallTop = H - Rf; // 32.0m

      // 4 vertical wall segments from yMin to 32.0m
      for (let wStep = 0; wStep <= 4; wStep++) {
        const t = wStep / 4;
        const py = yMin + t * (yWallTop - yMin);
        glassPositions.push(sp.x, py, sp.z);
        glassNormals.push(sp.nhx, 0.0, sp.nhz);
        glassUVs.push(sp.u, py / H);
      }

      // Upper wall-to-ceiling fillet (y from 32.0m to 40.0m, inset from 0 to 8.0m)
      for (let uStep = 1; uStep <= upperArcSteps; uStep++) {
        const theta = (uStep / upperArcSteps) * (Math.PI * 0.5);
        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);
        const inset = Rf * (1.0 - cosT);
        const px = sp.x + sp.nhx * inset;
        const py = (H - Rf) + Rf * sinT;
        const pz = sp.z + sp.nhz * inset;

        glassPositions.push(px, py, pz);
        glassNormals.push(sp.nhx * cosT, -sinT, sp.nhz * cosT);
        glassUVs.push(sp.u, py / H);
      }

      // Inner ceiling canopy ring (converging smoothly to center roof line)
      const cx = sp.x * 0.02;
      const cz = sp.z * 0.35;
      glassPositions.push(cx, H, cz);
      glassNormals.push(0.0, -1.0, 0.0);
      glassUVs.push(sp.u, 1.0);
    }

    const stride = totalRingSteps + 1;
    for (let j = 0; j < totalRingSteps; j++) {
      const a = baseIdx + j;
      const b = baseIdx + stride + j;
      const c = baseIdx + stride + j + 1;
      const d = baseIdx + j + 1;
      glassIndices.push(a, b, d, b, c, d);
    }
  }

  const glassGeometry = new THREE.BufferGeometry();
  glassGeometry.setAttribute('position', new THREE.Float32BufferAttribute(glassPositions, 3));
  glassGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(glassNormals, 3));
  glassGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(glassUVs, 2));
  glassGeometry.setIndex(glassIndices);

  return { rampGeometry, glassGeometry };
}

/**
 * Creates the custom ShaderMaterial for the translucent hexagonal dome shield:
 * - renderOrder = 2, transparent: true, depthWrite: false
 * - Baseline alpha = 0.07 subtle hexagonal energy grid
 * - Dynamic proximity ripples (alpha up to 0.55) around uImpactPoints[8] (ball + cars)
 * - Goal celebration wave pulse across the dome
 */
function createHexShieldShaderMaterial(THREE) {
  const impactPoints = [];
  for (let i = 0; i < 8; i++) {
    impactPoints.push(new THREE.Vector4(0, -100, 0, 0));
  }

  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uImpactPoints: { value: impactPoints },
      uGoalPulse: { value: 0.0 },
      uGoalTeam: { value: 0.0 } // -1.0 Blue, +1.0 Orange
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec4 uImpactPoints[8];
      uniform float uGoalPulse;
      uniform float uGoalTeam;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec2 vUv;

      // 2D Hexagonal grid distance (returns distance to nearest hex edge in [0, 0.5])
      float hexEdgeDist(vec2 p) {
        const vec2 s = vec2(1.0, 1.7320508);
        vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
        vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
        vec2 nearest = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
        nearest = abs(nearest);
        return 0.5 - max(dot(nearest, s * 0.5), nearest.x);
      }

      void main() {
        // Project world position into a seamless tri-planar hex coordinate
        vec3 nAbs = abs(normalize(vWorldNormal));
        vec2 hexCoord = vWorldPos.zy * 0.38 * nAbs.x
                      + vWorldPos.xz * 0.38 * nAbs.y
                      + vWorldPos.xy * 0.38 * nAbs.z;

        float edgeDist = hexEdgeDist(hexCoord);
        float hexLine = 1.0 - smoothstep(0.02, 0.075, edgeDist);
        float hexInner = smoothstep(0.08, 0.25, edgeDist);

        // Team-tinted longitudinal base color (Blue on -Z, Orange on +Z, Cyan neutral mid)
        float zNorm = clamp(vWorldPos.z / 100.0, -1.0, 1.0);
        vec3 blueTint = vec3(0.04, 0.62, 1.0);
        vec3 orangeTint = vec3(1.0, 0.38, 0.05);
        vec3 midTint = vec3(0.15, 0.85, 0.95);
        vec3 baseColor = zNorm < 0.0
          ? mix(midTint, blueTint, clamp(-zNorm * 1.15, 0.0, 1.0))
          : mix(midTint, orangeTint, clamp(zNorm * 1.15, 0.0, 1.0));

        // Fresnel rim grazing enhancement
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vWorldNormal))), 2.6);

        // Evaluate proximity and concentric ripples from Ball (index 0) and Cars (1..7)
        float proximityGlow = 0.0;
        for (int i = 0; i < 8; i++) {
          vec4 imp = uImpactPoints[i];
          if (imp.w > 0.01) {
            float d = distance(vWorldPos, imp.xyz);
            float radius = i == 0 ? 15.0 : 12.0;
            float falloff = clamp(1.0 - d / radius, 0.0, 1.0);
            float ripple = 0.5 + 0.5 * sin(d * 1.85 - uTime * 9.0);
            proximityGlow += imp.w * falloff * falloff * (0.55 + 0.45 * ripple);
          }
        }
        proximityGlow = clamp(proximityGlow, 0.0, 1.0);

        // Goal celebration wave sweeping from the scored goal
        if (uGoalPulse > 0.01) {
          vec3 pulseColor = uGoalTeam < 0.0 ? blueTint : orangeTint;
          float wave = 0.5 + 0.5 * sin(vWorldPos.z * 0.14 - uTime * 8.0 * sign(uGoalTeam));
          baseColor = mix(baseColor, pulseColor, uGoalPulse * 0.75);
          proximityGlow = max(proximityGlow, uGoalPulse * (0.35 + 0.45 * wave));
        }

        // Baseline alpha = 0.07 per spec, rising up to 0.55 near ball/car impact
        float baseAlpha = 0.045 + 0.045 * hexLine + 0.04 * fresnel;
        float impactAlpha = proximityGlow * (0.48 * hexLine + 0.16 * (1.0 - hexInner));
        float alpha = clamp(baseAlpha + impactAlpha, 0.04, 0.55);

        vec3 finalColor = baseColor * (0.75 + 0.95 * hexLine + 1.35 * proximityGlow);
        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

// ============================================================================
// ZONE 3C — RECESSED GOAL CHAMBERS, NEON GOALPOSTS & LASER CURTAINS
// ============================================================================

function buildGoalChambers(THREE, rootGroup) {
  const L = ARENA_CONSTANTS.halfLength;       // 100.0
  const gw = ARENA_CONSTANTS.goalHalfWidth;   // 14.0
  const gh = ARENA_CONSTANTS.goalHeight;      // 11.0
  const gd = ARENA_CONSTANTS.goalDepth;       // 12.0
  const rPost = ARENA_CONSTANTS.goalPostRadius; // 0.45

  const darkFrameMat = new THREE.MeshStandardMaterial({
    color: 0x1a222d,
    metalness: 0.85,
    roughness: 0.28
  });

  const goalFloorMat = new THREE.MeshStandardMaterial({
    color: 0x0f1f18,
    metalness: 0.25,
    roughness: 0.65
  });

  const laserCurtainMaterials = [];

  for (const team of ['blue', 'orange']) {
    const dir = team === 'blue' ? -1.0 : +1.0;
    const zGoal = dir * L; // -100 or +100
    const teamHex = team === 'blue' ? 0x00a8ff : 0xff5500;
    const teamColorVec = team === 'blue'
      ? new THREE.Color(0x00a8ff)
      : new THREE.Color(0xff5500);

    const goalGroup = new THREE.Group();
    goalGroup.name = `GoalChamber_${team}`;

    const neonMat = new THREE.MeshStandardMaterial({
      color: teamHex,
      emissive: teamHex,
      emissiveIntensity: 2.2,
      metalness: 0.3,
      roughness: 0.2
    });

    // 1. Capsule Goalposts (X = ±14.0, Y in [0, 11.0], Z = ±100.0) & Crossbar
    const postGeo = new THREE.CylinderGeometry(rPost, rPost, gh, 20);
    for (const side of [-1, +1]) {
      const post = new THREE.Mesh(postGeo, darkFrameMat);
      post.position.set(side * gw, gh * 0.5, zGoal);
      post.castShadow = true;
      post.receiveShadow = true;
      post.renderOrder = 0;
      goalGroup.add(post);

      // Neon light strip inset along inner face of vertical post
      const neonPostGeo = new THREE.CylinderGeometry(rPost * 0.36, rPost * 0.36, gh - 0.3, 12);
      const neonPost = new THREE.Mesh(neonPostGeo, neonMat);
      neonPost.position.set(side * (gw - 0.18), gh * 0.5, zGoal - dir * 0.22);
      neonPost.renderOrder = 0;
      goalGroup.add(neonPost);
    }

    // Horizontal Crossbar (X in [-14, +14], Y = 11.0, Z = ±100.0)
    const crossbarGeo = new THREE.CylinderGeometry(rPost, rPost, gw * 2.0, 20);
    crossbarGeo.rotateZ(Math.PI * 0.5);
    const crossbar = new THREE.Mesh(crossbarGeo, darkFrameMat);
    crossbar.position.set(0, gh, zGoal);
    crossbar.castShadow = true;
    crossbar.renderOrder = 0;
    goalGroup.add(crossbar);

    const neonBarGeo = new THREE.CylinderGeometry(rPost * 0.38, rPost * 0.38, gw * 2.0 - 0.2, 12);
    neonBarGeo.rotateZ(Math.PI * 0.5);
    const neonBar = new THREE.Mesh(neonBarGeo, neonMat);
    neonBar.position.set(0, gh - 0.16, zGoal - dir * 0.22);
    neonBar.renderOrder = 0;
    goalGroup.add(neonBar);

    // Rounded Corner Elbows at (±14.0, 11.0, ±100.0)
    const elbowGeo = new THREE.SphereGeometry(rPost * 1.12, 16, 16);
    for (const side of [-1, +1]) {
      const elbow = new THREE.Mesh(elbowGeo, neonMat);
      elbow.position.set(side * gw, gh, zGoal);
      elbow.renderOrder = 0;
      goalGroup.add(elbow);
    }

    // 2. Recessed 12m Deep Goal Enclosure (|Z| in [100, 112], X in [-14, +14], Y in [0, 11])
    const floorGeo = new THREE.PlaneGeometry(gw * 2.0 + 1.2, gd + 0.6);
    floorGeo.rotateX(-Math.PI * 0.5);
    const goalFloor = new THREE.Mesh(floorGeo, goalFloorMat);
    goalFloor.position.set(0, 0.01, zGoal + dir * (gd * 0.5));
    goalFloor.receiveShadow = true;
    goalFloor.renderOrder = 0;
    goalGroup.add(goalFloor);

    // Structural Stanchion Arches inside the Goal Box (at |Z| = 104, 108, 112)
    for (const dOffset of [4.0, 8.0, 12.0]) {
      const zRib = zGoal + dir * dOffset;
      const ribMat = dOffset === 12.0 ? neonMat : darkFrameMat;
      const ribR = dOffset === 12.0 ? 0.32 : 0.26;

      const topRib = new THREE.Mesh(
        new THREE.BoxGeometry(gw * 2.0 + 0.6, ribR * 2, ribR * 2),
        ribMat
      );
      topRib.position.set(0, gh, zRib);
      topRib.renderOrder = 0;
      goalGroup.add(topRib);

      for (const side of [-1, +1]) {
        const sideRib = new THREE.Mesh(
          new THREE.BoxGeometry(ribR * 2, gh, ribR * 2),
          ribMat
        );
        sideRib.position.set(side * gw, gh * 0.5, zRib);
        sideRib.renderOrder = 0;
        goalGroup.add(sideRib);
      }
    }

    // Translucent Hexagonal Energy Netting inside the Goal Box (Back Wall, Ceiling, Side Walls)
    const netMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: teamColorVec },
        uTime: { value: 0.0 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vec2 grid = abs(fract(vWorldPos.xy * 0.65 + vWorldPos.z * 0.45) - 0.5);
          float line = 1.0 - smoothstep(0.03, 0.09, min(grid.x, grid.y));
          float pulse = 0.65 + 0.35 * sin(uTime * 3.5 - abs(vWorldPos.z) * 0.4);
          float alpha = 0.14 + 0.34 * line * pulse;
          gl_FragColor = vec4(uColor * (0.9 + 0.8 * line), alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    laserCurtainMaterials.push(netMat);

    // Back Net Wall (|Z| = 112.0)
    const backNet = new THREE.Mesh(new THREE.PlaneGeometry(gw * 2.0, gh), netMat);
    backNet.position.set(0, gh * 0.5, zGoal + dir * gd);
    backNet.renderOrder = 2;
    goalGroup.add(backNet);

    // Ceiling Net (Y = 11.0, |Z| in [100, 112])
    const ceilNetGeo = new THREE.PlaneGeometry(gw * 2.0, gd);
    ceilNetGeo.rotateX(Math.PI * 0.5);
    const ceilNet = new THREE.Mesh(ceilNetGeo, netMat);
    ceilNet.position.set(0, gh, zGoal + dir * (gd * 0.5));
    ceilNet.renderOrder = 2;
    goalGroup.add(ceilNet);

    // Side Nets (X = ±14.0, |Z| in [100, 112])
    const sideNetGeo = new THREE.PlaneGeometry(gd, gh);
    sideNetGeo.rotateY(Math.PI * 0.5);
    for (const side of [-1, +1]) {
      const sideNet = new THREE.Mesh(sideNetGeo, netMat);
      sideNet.position.set(side * gw, gh * 0.5, zGoal + dir * (gd * 0.5));
      sideNet.renderOrder = 2;
      goalGroup.add(sideNet);
    }

    // 3. Animated Vertical Laser Scanline Curtain across Goal Mouth (renderOrder = 3, depthWrite: false)
    const curtainMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: teamColorVec },
        uTime: { value: 0.0 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float vBars = pow(0.5 + 0.5 * sin(vUv.x * 110.0), 6.0);
          float hScan = pow(0.5 + 0.5 * sin(vUv.y * 28.0 - uTime * 4.5), 4.0);
          float border = smoothstep(0.18, 0.0, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
          float alpha = 0.04 + 0.07 * vBars + 0.06 * hScan + 0.22 * border;
          gl_FragColor = vec4(uColor * (1.1 + 0.6 * border), alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    laserCurtainMaterials.push(curtainMat);

    const curtainMesh = new THREE.Mesh(new THREE.PlaneGeometry(gw * 2.0 - 0.4, gh - 0.2), curtainMat);
    curtainMesh.position.set(0, gh * 0.5, zGoal + dir * 0.05);
    curtainMesh.renderOrder = 3;
    goalGroup.add(curtainMesh);

    rootGroup.add(goalGroup);
  }

  return laserCurtainMaterials;
}

// ============================================================================
// ZONE 3B — STRUCTURAL SPACE-FRAME ARCHES & ROOF TRUSSES (renderOrder = 0)
// ============================================================================

function buildStructuralSpaceFrame(THREE, rootGroup) {
  const W = ARENA_CONSTANTS.halfWidth;    // 60.0
  const H = ARENA_CONSTANTS.height;       // 40.0
  const Rf = ARENA_CONSTANTS.filletRadius; // 8.0

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x161d26,
    metalness: 0.88,
    roughness: 0.34
  });

  const floodlightMat = new THREE.MeshStandardMaterial({
    color: 0xeef8ff,
    emissive: 0xd8f0ff,
    emissiveIntensity: 2.0,
    roughness: 0.2
  });

  const frameGroup = new THREE.Group();
  frameGroup.name = 'StructuralSpaceFrame';

  // Transverse space-frame arches every 25m along Z: [-75, -50, -25, 0, +25, +50, +75]
  const zStations = [-75, -50, -25, 0, 25, 50, 75];
  const archProfilePoints = [];
  const archSegments = 36;

  for (let i = 0; i <= archSegments; i++) {
    const t = i / archSegments;
    // Parameterize from Left Floor (-52, 0) -> Left Wall (-60, 8..32) -> Ceiling (-52..+52, 40) -> Right Wall (+60, 32..8) -> Right Floor (+52, 0)
    let px = 0;
    let py = 0;
    if (t < 0.15) {
      const a = (t / 0.15) * (Math.PI * 0.5);
      px = -(W - Rf + Rf * Math.sin(a));
      py = Rf * (1.0 - Math.cos(a));
    } else if (t < 0.35) {
      const f = (t - 0.15) / 0.20;
      px = -W - 0.35;
      py = Rf + f * (H - 2.0 * Rf);
    } else if (t < 0.50) {
      const a = ((t - 0.35) / 0.15) * (Math.PI * 0.5);
      px = -(W - Rf + Rf * Math.cos(a));
      py = (H - Rf) + Rf * Math.sin(a) + 0.35;
    } else if (t < 0.65) {
      const a = ((0.65 - t) / 0.15) * (Math.PI * 0.5);
      px = +(W - Rf + Rf * Math.cos(a));
      py = (H - Rf) + Rf * Math.sin(a) + 0.35;
    } else if (t < 0.85) {
      const f = (0.85 - t) / 0.20;
      px = +W + 0.35;
      py = Rf + f * (H - 2.0 * Rf);
    } else {
      const a = ((1.0 - t) / 0.15) * (Math.PI * 0.5);
      px = +(W - Rf + Rf * Math.sin(a));
      py = Rf * (1.0 - Math.cos(a));
    }
    archProfilePoints.push(new THREE.Vector3(px, py, 0));
  }

  const archCurve = new THREE.CatmullRomCurve3(archProfilePoints);
  const archTubeGeo = new THREE.TubeGeometry(archCurve, 48, 0.55, 8, false);

  for (const zPos of zStations) {
    const archMesh = new THREE.Mesh(archTubeGeo, steelMat);
    archMesh.position.z = zPos;
    archMesh.renderOrder = 0;
    frameGroup.add(archMesh);

    // Overhead emissive stadium floodlight pods mounted beneath the roof arch
    for (const xPod of [-34, -16, 16, 34]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.45, 1.4), floodlightMat);
      pod.position.set(xPod, H - 0.45, zPos);
      pod.renderOrder = 0;
      frameGroup.add(pod);
    }
  }

  // Longitudinal Roof Spine Trusses at X = ±34m and X = ±16m
  const spineGeo = new THREE.BoxGeometry(0.85, 0.85, 176.0);
  for (const xSpine of [-34, -16, 16, 34]) {
    const spine = new THREE.Mesh(spineGeo, steelMat);
    spine.position.set(xSpine, H + 0.45, 0);
    spine.renderOrder = 0;
    frameGroup.add(spine);
  }

  rootGroup.add(frameGroup);
}

// ============================================================================
// ZONE 4 — 28 INTERACTIVE BOOST PADS (6 FULL CANISTERS + 22 SMALL PADS)
// ============================================================================

function buildBoostPadsNetwork(THREE, rootGroup) {
  const padsGroup = new THREE.Group();
  padsGroup.name = 'BoostPadsNetwork';

  const baseMetalMat = new THREE.MeshStandardMaterial({
    color: 0x222b38,
    metalness: 0.88,
    roughness: 0.3,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });

  const goldOrbMat = new THREE.MeshStandardMaterial({
    color: 0xffcc22,
    emissive: 0xff9900,
    emissiveIntensity: 2.2,
    metalness: 0.25,
    roughness: 0.15
  });

  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffdd55,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });

  const plumeMat = new THREE.MeshBasicMaterial({
    color: 0xffbb22,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });

  const fullBaseGeo = new THREE.CylinderGeometry(1.75, 1.95, 0.18, 6);
  const smallBaseGeo = new THREE.CylinderGeometry(1.05, 1.20, 0.12, 8);
  const fullOrbGeo = new THREE.IcosahedronGeometry(0.78, 2);
  const fullGyroGeo = new THREE.TorusGeometry(1.05, 0.08, 10, 24);
  const smallChevronGeo = new THREE.OctahedronGeometry(0.42, 0);
  const smallPlumeGeo = new THREE.CylinderGeometry(0.55, 0.85, 1.9, 12, 1, true);

  const padEntries = [];

  for (const padDef of BOOST_PAD_LAYOUT) {
    const isFull = padDef.type === 'full';
    const holder = new THREE.Group();
    holder.position.set(padDef.x, 0.02, padDef.z);

    // 1. Metallic Base Pedestal (renderOrder = 1)
    const baseMesh = new THREE.Mesh(isFull ? fullBaseGeo : smallBaseGeo, baseMetalMat);
    baseMesh.position.y = isFull ? 0.09 : 0.06;
    baseMesh.renderOrder = 1;
    holder.add(baseMesh);

    // 2. Radial Cooldown Ring Gauge (ShaderMaterial filling 0..2*PI based on uProgress)
    const ringRadius = isFull ? 1.55 : 0.92;
    const cooldownMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 1.0 }, // 1.0 when active, 0..1 while respawning
        uActive: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv - 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uProgress;
        uniform float uActive;
        varying vec2 vUv;
        void main() {
          float r = length(vUv) * 2.0;
          if (r < 0.72 || r > 0.98) discard;
          float ang = fract((atan(vUv.y, vUv.x) + 3.14159265) / 6.2831853);
          float filled = step(ang, uProgress);
          vec3 col = uActive > 0.5 ? vec3(1.0, 0.82, 0.18) : mix(vec3(0.18, 0.24, 0.32), vec3(1.0, 0.65, 0.08), filled);
          float alpha = uActive > 0.5 ? 0.88 : (0.35 + 0.55 * filled);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const ringGeo = new THREE.PlaneGeometry(ringRadius * 2.2, ringRadius * 2.2);
    ringGeo.rotateX(-Math.PI * 0.5);
    const ringMesh = new THREE.Mesh(ringGeo, cooldownMat);
    ringMesh.position.y = isFull ? 0.20 : 0.14;
    ringMesh.renderOrder = 1;
    holder.add(ringMesh);

    // 3. Floating Active Core (renderOrder = 3)
    const activeGroup = new THREE.Group();
    if (isFull) {
      const orbMesh = new THREE.Mesh(fullOrbGeo, goldOrbMat);
      orbMesh.renderOrder = 3;
      activeGroup.add(orbMesh);

      const gyroMesh = new THREE.Mesh(fullGyroGeo, haloMat);
      gyroMesh.renderOrder = 3;
      activeGroup.add(gyroMesh);

      const outerHalo = new THREE.Mesh(new THREE.SphereGeometry(1.18, 16, 16), haloMat);
      outerHalo.renderOrder = 3;
      activeGroup.add(outerHalo);
      activeGroup.position.y = 1.45;
    } else {
      const chevronMesh = new THREE.Mesh(smallChevronGeo, goldOrbMat);
      chevronMesh.position.y = 0.68;
      chevronMesh.renderOrder = 3;
      activeGroup.add(chevronMesh);

      const plumeMesh = new THREE.Mesh(smallPlumeGeo, plumeMat);
      plumeMesh.position.y = 0.95;
      plumeMesh.renderOrder = 3;
      activeGroup.add(plumeMesh);
    }

    holder.add(activeGroup);
    padsGroup.add(holder);

    padEntries.push({
      def: padDef,
      holder,
      activeGroup,
      cooldownMat,
      wasActive: true,
      respawnPopTimer: 0.0
    });
  }

  rootGroup.add(padsGroup);
  return padEntries;
}

// ============================================================================
// ZONE 5 — TIERED STADIUM BOWL, 4,000 INSTANCED CROWD & TWIN 3D JUMBOTRONS
// ============================================================================

function buildStadiumBowlAndCrowd(THREE, rootGroup) {
  const bowlGroup = new THREE.Group();
  bowlGroup.name = 'StadiumBowlAndCrowd';

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x121822,
    metalness: 0.45,
    roughness: 0.72
  });

  const fasciaMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    emissive: 0x0f2942,
    emissiveIntensity: 0.65,
    metalness: 0.7,
    roughness: 0.35
  });

  // 1. Tiered Stadium Grandstand Bowl around the glass cage (|X| in [65, 105], |Z| in [115, 145])
  const tiers = [
    { inset: 66.0, zInset: 115.0, y: 5.5, h: 6.5, depth: 11.0 },
    { inset: 78.0, zInset: 126.0, y: 14.5, h: 8.0, depth: 12.0 },
    { inset: 91.0, zInset: 138.0, y: 25.0, h: 9.5, depth: 13.0 }
  ];

  for (let tIdx = 0; tIdx < tiers.length; tIdx++) {
    const tier = tiers[tIdx];

    // Sideline Grandstands (X = ±tier.inset, spanning Z in [-105, +105])
    const sideStandGeo = new THREE.BoxGeometry(tier.depth, tier.h, 210.0);
    for (const side of [-1, +1]) {
      const stand = new THREE.Mesh(sideStandGeo, concreteMat);
      stand.position.set(side * (tier.inset + tier.depth * 0.5), tier.y, 0);
      stand.renderOrder = 0;
      bowlGroup.add(stand);

      // LED Ribbon Fascia along front edge of each tier
      const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1, 210.0), fasciaMat);
      ribbon.position.set(side * tier.inset, tier.y + tier.h * 0.45, 0);
      ribbon.renderOrder = 0;
      bowlGroup.add(ribbon);
    }

    // End-Zone Grandstands (Z = ±tier.zInset, spanning X in [-68, +68])
    const endStandGeo = new THREE.BoxGeometry(136.0, tier.h, tier.depth);
    for (const dir of [-1, +1]) {
      const stand = new THREE.Mesh(endStandGeo, concreteMat);
      stand.position.set(0, tier.y, dir * (tier.zInset + tier.depth * 0.5));
      stand.renderOrder = 0;
      bowlGroup.add(stand);
    }
  }

  // 2. 4,000 Instanced Crowd Light-Sticks (Blue-biased on -Z, Orange-biased on +Z)
  const crowdCount = 4000;
  const stickGeo = new THREE.CylinderGeometry(0.18, 0.14, 1.15, 6);
  const stickMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const crowdMesh = new THREE.InstancedMesh(stickGeo, stickMat, crowdCount);
  crowdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  crowdMesh.renderOrder = 0;

  const basePositions = new Float32Array(crowdCount * 3);
  const phases = new Float32Array(crowdCount);
  const teamSigns = new Float32Array(crowdCount);
  const dummyObj = new THREE.Object3D();
  const tempColor = new THREE.Color();

  let seed = 42069;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed & 0x00ffffff) / 0x01000000;
  };

  for (let i = 0; i < crowdCount; i++) {
    const tier = tiers[i % tiers.length];
    let px = 0;
    let py = tier.y + tier.h * 0.5 + 0.75 + rand() * 1.8;
    let pz = 0;

    if (i < 2800) {
      // Sideline grandstands (X in ±[67, 102], Z in [-102, +102])
      const side = i % 2 === 0 ? -1.0 : 1.0;
      px = side * (tier.inset + 1.2 + rand() * (tier.depth - 2.0));
      pz = (rand() * 2.0 - 1.0) * 102.0;
    } else {
      // End-zone grandstands (Z in ±[116, 145], X in [-64, +64])
      const dir = i % 2 === 0 ? -1.0 : 1.0;
      px = (rand() * 2.0 - 1.0) * 64.0;
      pz = dir * (tier.zInset + 1.2 + rand() * (tier.depth - 2.0));
    }

    basePositions[i * 3 + 0] = px;
    basePositions[i * 3 + 1] = py;
    basePositions[i * 3 + 2] = pz;
    phases[i] = rand() * Math.PI * 2.0 + pz * 0.04;

    // Blue-biased on -Z half, Orange-biased on +Z half
    const isBlueFan = pz < 0.0 ? rand() < 0.86 : rand() < 0.14;
    teamSigns[i] = isBlueFan ? -1.0 : 1.0;

    if (isBlueFan) {
      tempColor.setHSL(0.54 + rand() * 0.08, 0.92, 0.52 + rand() * 0.22);
    } else {
      tempColor.setHSL(0.04 + rand() * 0.06, 0.96, 0.52 + rand() * 0.22);
    }
    crowdMesh.setColorAt(i, tempColor);

    dummyObj.position.set(px, py, pz);
    dummyObj.rotation.set(0, 0, 0);
    dummyObj.updateMatrix();
    crowdMesh.setMatrixAt(i, dummyObj.matrix);
  }

  if (crowdMesh.instanceColor) {
    crowdMesh.instanceColor.needsUpdate = true;
  }
  crowdMesh.instanceMatrix.needsUpdate = true;
  bowlGroup.add(crowdMesh);
  rootGroup.add(bowlGroup);

  return {
    crowdMesh,
    crowdCount,
    basePositions,
    phases,
    teamSigns,
    dummyObj
  };
}

/**
 * Builds the Twin Overhead 3D Jumbotrons at X = ±62m, Y = 34m, Z = 0m angled slightly downward
 * toward the pitch, driven by a dynamic 512x256 CanvasTexture.
 */
function buildTwinJumbotrons(THREE, rootGroup) {
  const canvas = createSafeCanvas(512, 256);
  const ctx = canvas ? canvas.getContext('2d') : null;
  const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (texture && THREE.SRGBColorSpace) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  const screenMat = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffffff,
    side: THREE.DoubleSide
  });

  const housingMat = new THREE.MeshStandardMaterial({
    color: 0x141b24,
    metalness: 0.85,
    roughness: 0.3
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x00d2ff,
    emissive: 0x00a8ff,
    emissiveIntensity: 1.5
  });

  const jumbotronGroup = new THREE.Group();
  jumbotronGroup.name = 'TwinJumbotrons';

  for (const side of [-1, +1]) {
    const board = new THREE.Group();
    board.position.set(side * 62.0, 34.0, 0.0);
    // Face inward toward the pitch center (0, 0, 0) and tilt slightly downward
    board.lookAt(0, 12.0, 0);

    const housing = new THREE.Mesh(new THREE.BoxGeometry(24.0, 12.0, 1.4), housingMat);
    housing.renderOrder = 0;
    board.add(housing);

    const borderTrim = new THREE.Mesh(new THREE.BoxGeometry(24.5, 12.5, 0.9), trimMat);
    borderTrim.position.z = -0.15;
    borderTrim.renderOrder = 0;
    board.add(borderTrim);

    const screen = new THREE.Mesh(new THREE.PlaneGeometry(22.6, 10.8), screenMat);
    screen.position.z = 0.74;
    screen.renderOrder = 0;
    board.add(screen);

    jumbotronGroup.add(board);
  }

  rootGroup.add(jumbotronGroup);

  const stateCache = {
    blue: -1,
    orange: -1,
    sec: -1,
    bannerText: null,
    isOvertime: null
  };

  function renderJumbotronCanvas(score, timeRemaining, bannerText = '', isOvertime = false) {
    const blueScore = score && typeof score.blue === 'number' ? score.blue : 0;
    const orangeScore = score && typeof score.orange === 'number' ? score.orange : 0;
    const sec = Math.max(0, Math.ceil(Number.isFinite(timeRemaining) ? timeRemaining : 300));
    const banner = bannerText || '';
    const ot = Boolean(isOvertime);

    if (
      stateCache.blue === blueScore &&
      stateCache.orange === orangeScore &&
      stateCache.sec === sec &&
      stateCache.bannerText === banner &&
      stateCache.isOvertime === ot
    ) {
      return;
    }

    stateCache.blue = blueScore;
    stateCache.orange = orangeScore;
    stateCache.sec = sec;
    stateCache.bannerText = banner;
    stateCache.isOvertime = ot;

    if (!ctx || !texture) return;

    // Background broadcast dark slate gradient
    const bg = ctx.createLinearGradient(0, 0, 512, 256);
    bg.addColorStop(0.0, '#071b34');
    bg.addColorStop(0.5, '#0c1322');
    bg.addColorStop(1.0, '#331506');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 256);

    // Top League Header
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 512, 42);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 18px "Orbitron", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DFH NEO-DOME CHAMPIONSHIP ARENA', 256, 27);

    // Blue Team Panel (Left)
    ctx.fillStyle = '#0077ee';
    ctx.fillRect(20, 56, 148, 128);
    ctx.fillStyle = '#e0f2fe';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillText('BLUE', 94, 84);
    ctx.font = 'bold 74px "Segoe UI", sans-serif';
    ctx.fillText(String(blueScore), 94, 162);

    // Orange Team Panel (Right)
    ctx.fillStyle = '#ee5500';
    ctx.fillRect(344, 56, 148, 128);
    ctx.fillStyle = '#ffedd5';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillText('ORANGE', 418, 84);
    ctx.font = 'bold 74px "Segoe UI", sans-serif';
    ctx.fillText(String(orangeScore), 418, 162);

    // Center Match Clock
    const mins = Math.floor(sec / 60);
    const remSec = sec % 60;
    const clockStr = `${ot ? '+' : ''}${mins}:${remSec < 10 ? '0' : ''}${remSec}`;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(178, 56, 156, 128);
    ctx.strokeStyle = ot ? '#f59e0b' : '#38bdf8';
    ctx.lineWidth = 3;
    ctx.strokeRect(178, 56, 156, 128);

    ctx.fillStyle = ot ? '#fbbf24' : '#f8fafc';
    ctx.font = 'bold 48px "Courier New", monospace';
    ctx.fillText(clockStr, 256, 132);

    if (ot) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 18px "Segoe UI", sans-serif';
      ctx.fillText('OVERTIME', 256, 168);
    } else {
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      ctx.fillText('REGULATION', 256, 168);
    }

    // Bottom Live Event Callout Banner
    ctx.fillStyle = banner ? '#f59e0b' : '#111c2d';
    ctx.fillRect(20, 196, 472, 44);
    ctx.fillStyle = banner ? '#090d16' : '#38bdf8';
    ctx.font = 'bold 24px "Segoe UI", sans-serif';
    ctx.fillText(banner || 'LIVE TELEMETRY // OCTANE-RLX SERIES', 256, 226);

    texture.needsUpdate = true;
  }

  // Initial paint
  renderJumbotronCanvas({ blue: 0, orange: 0 }, 300, '', false);

  return { renderJumbotronCanvas };
}

// ============================================================================
// THREE-TIER STADIUM LIGHTING RIG
// ============================================================================

function buildStadiumLightingRig(THREE, rootGroup) {
  const lightsGroup = new THREE.Group();
  lightsGroup.name = 'StadiumLightingRig';

  // Tier 1: Hemisphere Sky/Turf Bounce Light (#a8d8ff sky / #132a1c turf bounce)
  const hemiLight = new THREE.HemisphereLight(0xa8d8ff, 0x132a1c, 0.9);
  hemiLight.position.set(0, 40, 0);
  lightsGroup.add(hemiLight);

  // Tier 2: Directional Stadium Sun / Key Light with 2048x2048 Shadow Map
  const dirLight = new THREE.DirectionalLight(0xfff8ee, 1.65);
  dirLight.position.set(48, 82, 36);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.left = -75;
  dirLight.shadow.camera.right = 75;
  dirLight.shadow.camera.top = 115;
  dirLight.shadow.camera.bottom = -115;
  dirLight.shadow.camera.near = 10;
  dirLight.shadow.camera.far = 190;
  dirLight.shadow.bias = -0.0004;
  lightsGroup.add(dirLight);

  // Secondary Counter-Key Stadium Fill Light so vehicle flanks never fall into flat shadow
  const fillLight = new THREE.DirectionalLight(0xcce6ff, 0.55);
  fillLight.position.set(-48, 64, -36);
  lightsGroup.add(fillLight);

  // Tier 3: Blue Goal Floodlight (#0088ff at Z = -98) & Orange Goal Floodlight (#ff6600 at Z = +98)
  const blueGoalLight = new THREE.PointLight(0x0088ff, 3.6, 68, 1.4);
  blueGoalLight.position.set(0, 13.5, -98.0);
  lightsGroup.add(blueGoalLight);

  const orangeGoalLight = new THREE.PointLight(0xff6600, 3.6, 68, 1.4);
  orangeGoalLight.position.set(0, 13.5, +98.0);
  lightsGroup.add(orangeGoalLight);

  rootGroup.add(lightsGroup);
  return { hemiLight, dirLight, blueGoalLight, orangeGoalLight };
}

// ============================================================================
// MASTER FACTORY: createArenaEnvironment(THREE, scene)
// ============================================================================

/**
 * Constructs and adds the complete DFH Neo-Dome 3D stadium to `scene`.
 *
 * @param {object} THREE - The Three.js namespace
 * @param {THREE.Scene} scene - Target Three.js scene
 * @returns {{
 *   group: THREE.Group,
 *   update: (dt: number, simState?: object) => void,
 *   updateJumbotron: (score: {blue: number, orange: number}, timeRemaining: number, bannerText?: string, isOvertime?: boolean) => void,
 *   triggerGoalPulse: (team: 'blue' | 'orange' | number) => void
 * }}
 */
function createArenaEnvironment(THREE, scene) {
  const group = new THREE.Group();
  group.name = 'DFH_NeoDome_Arena';

  // -------------------------------------------------------------------------
  // Zone 3a — Mowed Turf Pitch (renderOrder = 0)
  // -------------------------------------------------------------------------
  const { map: turfMap, bumpMap: turfBump, roughnessMap: turfRough } = createPitchTextures(THREE);
  const turfMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: turfMap,
    bumpMap: turfBump,
    bumpScale: 0.04,
    roughnessMap: turfRough,
    roughness: 0.78,
    metalness: 0.08
  });

  // PlaneGeometry(200, 120) rotated onto XZ and oriented so U -> Z in [-100, +100], V -> X in [-60, +60]
  const pitchGeo = new THREE.PlaneGeometry(
    ARENA_CONSTANTS.halfLength * 2.0,
    ARENA_CONSTANTS.halfWidth * 2.0,
    32,
    24
  );
  pitchGeo.rotateX(-Math.PI * 0.5);
  pitchGeo.rotateY(-Math.PI * 0.5);

  const pitchMesh = new THREE.Mesh(pitchGeo, turfMaterial);
  pitchMesh.receiveShadow = true;
  pitchMesh.renderOrder = 0;
  pitchMesh.name = 'PitchTurf';
  group.add(pitchMesh);

  // -------------------------------------------------------------------------
  // Zone 3b — Filleted Transition Ramps, Glass Dome Shield & Structural Arches
  // -------------------------------------------------------------------------
  const { rampGeometry, glassGeometry } = buildArenaCageGeometries(THREE);
  const curbMap = createRampCurbTexture(THREE);
  const rampMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8e2ef,
    map: curbMap,
    metalness: 0.62,
    roughness: 0.42,
    side: THREE.DoubleSide
  });

  const rampMesh = new THREE.Mesh(rampGeometry, rampMaterial);
  rampMesh.receiveShadow = true;
  rampMesh.renderOrder = 0;
  rampMesh.name = 'FilletedPerimeterRamp';
  group.add(rampMesh);

  const hexShieldMaterial = createHexShieldShaderMaterial(THREE);
  const glassDomeMesh = new THREE.Mesh(glassGeometry, hexShieldMaterial);
  glassDomeMesh.renderOrder = 2;
  glassDomeMesh.name = 'HexShieldDomeCage';
  group.add(glassDomeMesh);

  buildStructuralSpaceFrame(THREE, group);

  // -------------------------------------------------------------------------
  // Zone 3c — Recessed Blue & Orange Goal Chambers
  // -------------------------------------------------------------------------
  const laserCurtainMaterials = buildGoalChambers(THREE, group);

  // -------------------------------------------------------------------------
  // Zone 4 — 28 Interactive Boost Pads
  // -------------------------------------------------------------------------
  const padEntries = buildBoostPadsNetwork(THREE, group);

  // -------------------------------------------------------------------------
  // Zone 5 — Stadium Bowl, 4,000 Crowd Light-Sticks & Twin Jumbotrons
  // -------------------------------------------------------------------------
  const crowdController = buildStadiumBowlAndCrowd(THREE, group);
  const { renderJumbotronCanvas } = buildTwinJumbotrons(THREE, group);

  // -------------------------------------------------------------------------
  // Three-Tier Stadium Lighting Rig
  // -------------------------------------------------------------------------
  const lights = buildStadiumLightingRig(THREE, group);

  if (scene && typeof scene.add === 'function') {
    scene.add(group);
  }

  let elapsedTime = 0.0;
  let goalPulseIntensity = 0.0;
  let goalPulseTeam = 0.0; // -1 Blue, +1 Orange

  function triggerGoalPulse(team) {
    goalPulseIntensity = 1.0;
    if (team === 'blue' || team === -1) {
      goalPulseTeam = -1.0;
    } else {
      goalPulseTeam = 1.0;
    }
  }

  function updateJumbotron(score, timeRemaining, bannerText = '', isOvertime = false) {
    renderJumbotronCanvas(score, timeRemaining, bannerText, isOvertime);
  }

  function update(dt, simState) {
    const safeDt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0.0), 0.1) : 1 / 60;
    elapsedTime += safeDt;

    if (goalPulseIntensity > 0.0) {
      goalPulseIntensity = Math.max(0.0, goalPulseIntensity - safeDt * 0.42);
    }

    // 1. Update Hex-Shield Dome Shader Uniforms (uTime, uGoalPulse, and uImpactPoints[8] from ball + cars)
    hexShieldMaterial.uniforms.uTime.value = elapsedTime;
    hexShieldMaterial.uniforms.uGoalPulse.value = goalPulseIntensity;
    hexShieldMaterial.uniforms.uGoalTeam.value = goalPulseTeam;

    const impacts = hexShieldMaterial.uniforms.uImpactPoints.value;
    for (let i = 0; i < 8; i++) {
      impacts[i].set(0, -200, 0, 0);
    }

    if (simState) {
      if (simState.ball && simState.ball.position) {
        const bp = simState.ball.position;
        impacts[0].set(bp.x || 0, bp.y || 0, bp.z || 0, 1.0);
      } else if (simState.ball && Number.isFinite(simState.ball.x)) {
        impacts[0].set(simState.ball.x, simState.ball.y, simState.ball.z, 1.0);
      }

      if (Array.isArray(simState.cars)) {
        for (let i = 0; i < Math.min(7, simState.cars.length); i++) {
          const c = simState.cars[i];
          const cp = c && (c.position || c);
          if (cp && Number.isFinite(cp.x)) {
            impacts[i + 1].set(cp.x, cp.y, cp.z, 0.85);
          }
        }
      }

      // Sync Jumbotron if score/clock present in simState
      if (simState.score && Number.isFinite(simState.timeRemaining)) {
        renderJumbotronCanvas(
          simState.score,
          simState.timeRemaining,
          simState.bannerText || '',
          Boolean(simState.isOvertime)
        );
      }
    }

    // 2. Update Goal Laser Curtains & Netting
    for (let i = 0; i < laserCurtainMaterials.length; i++) {
      laserCurtainMaterials[i].uniforms.uTime.value = elapsedTime;
    }

    // 3. Update Goal Floodlights on Goal Pulse
    const pulseBoost = 1.0 + goalPulseIntensity * 2.2;
    lights.blueGoalLight.intensity = 3.6 * (goalPulseTeam < 0 ? pulseBoost : 1.0);
    lights.orangeGoalLight.intensity = 3.6 * (goalPulseTeam > 0 ? pulseBoost : 1.0);

    // 4. Animate All 28 Boost Pads (bobbing, rotation, cooldown gauge & respawn burst)
    const simPads = simState && Array.isArray(simState.boostPads) ? simState.boostPads : null;
    for (let i = 0; i < padEntries.length; i++) {
      const entry = padEntries[i];
      const isFull = entry.def.type === 'full';
      const statePad = simPads && simPads[i] ? simPads[i] : null;

      const isActive = statePad && typeof statePad.active === 'boolean' ? statePad.active : true;
      const cooldown = statePad && Number.isFinite(statePad.cooldown) ? statePad.cooldown : 0.0;
      const maxRespawn = entry.def.respawnTime;

      if (!entry.wasActive && isActive) {
        entry.respawnPopTimer = 0.35;
      }
      entry.wasActive = isActive;

      if (entry.respawnPopTimer > 0.0) {
        entry.respawnPopTimer = Math.max(0.0, entry.respawnPopTimer - safeDt);
      }

      entry.activeGroup.visible = isActive;
      if (isActive) {
        const popScale = entry.respawnPopTimer > 0.0
          ? 1.0 + 0.38 * Math.sin((entry.respawnPopTimer / 0.35) * Math.PI)
          : 1.0;
        entry.activeGroup.scale.setScalar(popScale);
        entry.activeGroup.rotation.y = elapsedTime * (isFull ? 2.2 : 1.8) + i * 0.5;
        if (isFull) {
          entry.activeGroup.position.y = 1.42 + 0.22 * Math.sin(elapsedTime * 3.2 + i);
        }
        entry.cooldownMat.uniforms.uActive.value = 1.0;
        entry.cooldownMat.uniforms.uProgress.value = 1.0;
      } else {
        const progress = Math.max(0.0, Math.min(1.0, 1.0 - cooldown / maxRespawn));
        entry.cooldownMat.uniforms.uActive.value = 0.0;
        entry.cooldownMat.uniforms.uProgress.value = progress;
      }
    }

    // 5. Animate 4,000 Instanced Crowd Light-Sticks (gentle stadium wave + goal celebration bounce)
    const { crowdMesh, crowdCount, basePositions, phases, teamSigns, dummyObj } = crowdController;
    const isCelebrating = goalPulseIntensity > 0.02;
    for (let i = 0; i < crowdCount; i++) {
      const bx = basePositions[i * 3 + 0];
      const by = basePositions[i * 3 + 1];
      const bz = basePositions[i * 3 + 2];
      const ph = phases[i];

      let dy = 0.18 * Math.sin(elapsedTime * 3.0 + ph);
      let tiltZ = 0.16 * Math.cos(elapsedTime * 2.5 + ph);

      if (isCelebrating) {
        const isScoringTeamFan = teamSigns[i] * goalPulseTeam > 0.0;
        const jumpAmp = isScoringTeamFan ? 1.35 : 0.45;
        dy += goalPulseIntensity * jumpAmp * Math.abs(Math.sin(elapsedTime * 11.5 + ph * 2.0));
        tiltZ *= 1.0 + goalPulseIntensity * 1.8;
      }

      dummyObj.position.set(bx, by + dy, bz);
      dummyObj.rotation.set(0.0, 0.0, tiltZ);
      dummyObj.updateMatrix();
      crowdMesh.setMatrixAt(i, dummyObj.matrix);
    }
    crowdMesh.instanceMatrix.needsUpdate = true;
  }

  return {
    group,
    update,
    updateJumbotron,
    triggerGoalPulse
  };
}

// Dual registration for both ES Module imports and classic script / global inspection
if (typeof window !== 'undefined') {
  window.RLModules = window.RLModules || {};
  window.RLModules.Arena = {
    evalArenaSDF,
    createArenaEnvironment,
    BOOST_PAD_LAYOUT,
    ARENA_CONSTANTS
  };
}

})(THREE, THREE);


// ============================================================================
// Module 2: Vehicles & Geodesic Ball (vehicles-and-ball.js)
// ============================================================================
(function(THREE, THREE_IMPORT) {

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

const DEFAULT_LOFT_STATIONS = [
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
function createLoftedShellGeometry(
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
function generateCarLiveryTexture(team = 'blue', carNumber = null, maybeTHREE = null) {
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
function createBattleCarMesh(THREEOrOptions = {}, maybeOptions = {}) {
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
function setExplodedView(carMesh, factor = 0) {
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
function updateBattleCarVisuals(carMesh, carState = {}, dt = 1 / 60) {
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
function createSoccerBallMesh(THREEOrRadius = 3.20, maybeRadius = 3.20) {
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
function updateSoccerBallVisuals(ballMesh, ballState = {}, dt = 1 / 60) {
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
function setupStudioInspectionScene(THREEOrScene, maybeScene, maybeCamera, maybeRenderer, maybeOptions = {}) {
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

})(THREE, THREE);


// ============================================================================
// Module 3: 6-DOF Physics, SDF & 4-Phase Kinematics (physics-and-kinematics.js)
// ============================================================================
(function(THREE, THREE_IMPORT) {
/**
 * MODULE 3: 6-DOF Vehicle Dynamics, Arena SDF Collision, 4-Phase Kinematics & AI Engine
 * Owned File: src/physics-and-kinematics.js
 *
 * Implements:
 * 1. Match State Machine (KICKOFF_COUNTDOWN, LIVE_PLAY, GOAL_CELEBRATION, INSTANT_REPLAY, FREE_PLAY, AUTOPILOT_SHOWCASE, MATCH_OVER)
 *    with authentic 0-second "keep-it-up" rule and sudden-death +OT Overtime.
 * 2. 6-DOF Rigid-Body Vehicle Dynamics with 4-Wheel Analytical SDF Raycast Suspension, Hooke's Law spring-damper
 *    compression (0..0.18m), surface-normal quaternion slerp adhesion, and aerodynamic wall/ceiling downforce.
 * 3. Pacejka-inspired lateral slip-angle tire physics, handbrake powerslide drift (mu_lat 2.4 -> 0.55, 1.45x yaw rate),
 *    140ms post-jump pitch deadband, double-jump, directional 360-deg dodge flip, and sustained aerial thrusters.
 * 4. Swept-sphere ball physics against C1-continuous evalArenaSDF + goal-post capsules, Magnus lift, Psyonix-style
 *    forward-biased power clears, and Supersonic (42 m/s) car-on-car Demolition with 3.0s respawn.
 * 5. Competitive Utility-Based Bot AI (Striker & Goalie/Support dynamic tactical roles).
 * 6. Deterministic 4-Phase Kinematic Choreographer (t0..t3) for m1..m5 with window.__MOTION_TELEMETRY__ and window.__START_AUTOPILOT__().
 */

const MATCH_STATES = Object.freeze({
  MAIN_MENU: 'MAIN_MENU',
  KICKOFF_COUNTDOWN: 'KICKOFF_COUNTDOWN',
  LIVE_PLAY: 'LIVE_PLAY',
  GOAL_CELEBRATION: 'GOAL_CELEBRATION',
  INSTANT_REPLAY: 'INSTANT_REPLAY',
  FREE_PLAY: 'FREE_PLAY',
  AUTOPILOT_SHOWCASE: 'AUTOPILOT_SHOWCASE',
  MATCH_OVER: 'MATCH_OVER'
});

const ARENA_CONSTANTS = Object.freeze({
  HALF_WIDTH: 60.0,
  HEIGHT: 40.0,
  HALF_LENGTH: 100.0,
  R_FILLET: 8.0,
  R_CORNER: 16.0,
  GOAL_HALF_WIDTH: 14.0,
  GOAL_HEIGHT: 11.0,
  GOAL_DEPTH: 12.0,
  R_POST: 0.45,
  BALL_RADIUS: 3.20
});

const DEFAULT_BOOST_PAD_LAYOUT = Object.freeze([
  // 6 Full Boost Pads (100% boost, 10.0s respawn, radius 2.8m)
  { id: 0, type: 'full', x: -48, y: 0, z: -80, boost: 100, respawn: 10.0, radius: 2.8 },
  { id: 1, type: 'full', x: 48, y: 0, z: -80, boost: 100, respawn: 10.0, radius: 2.8 },
  { id: 2, type: 'full', x: -50, y: 0, z: 0, boost: 100, respawn: 10.0, radius: 2.8 },
  { id: 3, type: 'full', x: 50, y: 0, z: 0, boost: 100, respawn: 10.0, radius: 2.8 },
  { id: 4, type: 'full', x: -48, y: 0, z: 80, boost: 100, respawn: 10.0, radius: 2.8 },
  { id: 5, type: 'full', x: 48, y: 0, z: 80, boost: 100, respawn: 10.0, radius: 2.8 },
  // 22 Small Boost Pads (12% boost, 4.0s respawn, radius 1.8m)
  { id: 6, type: 'small', x: 0, y: 0, z: -84, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 7, type: 'small', x: -18, y: 0, z: -76, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 8, type: 'small', x: 18, y: 0, z: -76, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 9, type: 'small', x: -30, y: 0, z: -60, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 10, type: 'small', x: 0, y: 0, z: -60, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 11, type: 'small', x: 30, y: 0, z: -60, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 12, type: 'small', x: -16, y: 0, z: -40, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 13, type: 'small', x: 16, y: 0, z: -40, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 14, type: 'small', x: -36, y: 0, z: -24, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 15, type: 'small', x: 0, y: 0, z: -24, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 16, type: 'small', x: 36, y: 0, z: -24, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 17, type: 'small', x: -36, y: 0, z: 24, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 18, type: 'small', x: 0, y: 0, z: 24, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 19, type: 'small', x: 36, y: 0, z: 24, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 20, type: 'small', x: -16, y: 0, z: 40, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 21, type: 'small', x: 16, y: 0, z: 40, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 22, type: 'small', x: -30, y: 0, z: 60, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 23, type: 'small', x: 0, y: 0, z: 60, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 24, type: 'small', x: 30, y: 0, z: 60, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 25, type: 'small', x: -18, y: 0, z: 76, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 26, type: 'small', x: 18, y: 0, z: 76, boost: 12, respawn: 4.0, radius: 1.8 },
  { id: 27, type: 'small', x: 0, y: 0, z: 84, boost: 12, respawn: 4.0, radius: 1.8 }
]);

const MOVEMENTS_MANIFEST = Object.freeze([
  {
    id: 'm1_supersonic_boost_blitz',
    name: 'Supersonic Rocket Boost Blitz',
    trigger: 'Hold F / Left-Click (or press Key 1 / Autopilot Phase 1)',
    duration_ms: 2200,
    phases: {
      t0_anticipation: {
        window_ms: [0, 260],
        description: 'Rear suspension squats -0.09m under initial torque pre-load, chassis pitches nose-up +3.8 deg, turbojet nozzle iris dilates with orange-cyan ignition flash.'
      },
      t1_primary_drive: {
        window_ms: [260, 1250],
        description: 'Continuous +28 m/s^2 rocket thrust accelerates car along forward vector across turf, crossing the 42 m/s Supersonic threshold with expanding FOV (62 -> 78 deg).'
      },
      t2_apex_secondary: {
        window_ms: [1250, 1750],
        description: 'Supersonic Mach shock-ring detonation around chassis, twin purple-gold wheel ribbon trails, violent camera shake impulse, and roaring sonic boom transient.'
      },
      t3_overshoot_settle: {
        window_ms: [1750, 2200],
        description: 'Throttle release triggers nose-dive pitch overshoot (-2.4 deg) and underdamped spring-damper suspension recovery (zeta = 0.52, omega_n = 18 rad/s) back to ride height.'
      }
    },
    secondary_effects: [
      'Dynamic camera FOV kick (62 to 78 deg) with spring lag',
      'Additive jet afterburner plume + Mach shock cone ring',
      'Bilateral wheel supersonic plasma ribbons'
    ]
  },
  {
    id: 'm2_powerslide_drift_hook',
    name: 'Handbrake Powerslide Drift Hook',
    trigger: 'Hold Shift + Steer A/D at speed (or press Key 2 / Autopilot Phase 2)',
    duration_ms: 2000,
    phases: {
      t0_anticipation: {
        window_ms: [0, 220],
        description: 'Front wheels snap to 32 deg steer lock, weight transfers to outside front tire compressing outer strut -0.11m and rolling chassis +6.5 deg.'
      },
      t1_primary_drive: {
        window_ms: [220, 1100],
        description: 'Rear lateral tire friction drops from mu=2.4 to 0.55; car carves a wide 110-degree slip-angle yaw arc while maintaining momentum vector tangentially.'
      },
      t2_apex_secondary: {
        window_ms: [1100, 1550],
        description: 'Peak 48-degree slip angle with counter-steer wheel lock, dense billowy tire smoke particles, glowing heated rubber skid marks on turf, and rim spark shower.'
      },
      t3_overshoot_settle: {
        window_ms: [1550, 2000],
        description: 'Handbrake release snaps lateral grip back online, producing a damped roll sway oscillation (zeta = 0.48) as the car launches straight out of the apex.'
      }
    },
    secondary_effects: [
      'Persistent dual-wheel skid mark decals on pitch',
      'Volumetric billowy tire smoke & rim friction sparks',
      'Camera lateral drift lag & roll tilt (+4.0 deg)'
    ]
  },
  {
    id: 'm3_double_jump_front_flip_strike',
    name: 'Double-Jump Front-Flip Power Strike',
    trigger: 'Press Space -> W + Space near Ball (or press Key 3 / Autopilot Phase 3)',
    duration_ms: 2100,
    phases: {
      t0_anticipation: {
        window_ms: [0, 240],
        description: 'All 4 suspension struts compress -0.12m before firing the primary vertical jump impulse (+14.5 m/s) with underbody pneumatic burst ring.'
      },
      t1_primary_drive: {
        window_ms: [240, 950],
        description: 'Second directional dodge input initiates a rapid 360-degree forward pitch torque flip (omega_x = +9.6 rad/s) paired with a +11 m/s forward lunge burst.'
      },
      t2_apex_secondary: {
        window_ms: [950, 1450],
        description: 'Nose splitter strikes the soccer ball at flip apex: 45ms hit-stop frame dilation, expanding cyan-gold shockwave torus, directional spark burst, and 115+ KPH ball launch.'
      },
      t3_overshoot_settle: {
        window_ms: [1450, 2100],
        description: 'Rotation completes 360 deg with slight pitch overshoot; all 4 wheels touch down on turf compressing suspension struts to max travel before harmonic rebound.'
      }
    },
    secondary_effects: [
      '45ms impact hit-stop & radial shockwave ring at contact point',
      'High-velocity ball spin + glowing team-colored trail',
      '4-wheel landing dust puff & spring-damper chassis bounce'
    ]
  },
  {
    id: 'm4_aerial_pitch_thruster_flight',
    name: 'High-Altitude Aerial Thruster Redirect',
    trigger: 'Jump + Pull Nose Up (Down Arrow/S) + Hold Boost F (or press Key 4 / Autopilot Phase 4)',
    duration_ms: 2600,
    phases: {
      t0_anticipation: {
        window_ms: [0, 320],
        description: 'Launch jump combined with immediate nose-up pitch rotation (+52 deg pitch angle) and thruster pre-ignition glow.'
      },
      t1_primary_drive: {
        window_ms: [320, 1500],
        description: 'Sustained rocket boost vector lifts the battle-car along a steep 3D climbing parabola up to Y = 18m altitude toward the airborne ball.'
      },
      t2_apex_secondary: {
        window_ms: [1500, 2000],
        description: 'Mid-air barrel-roll alignment (Air-Roll Q/E) and high-altitude nose redirect into upper-90 goal corner; mid-air sonic ring + HUD "AERIAL HIT +50" medal.'
      },
      t3_overshoot_settle: {
        window_ms: [2000, 2600],
        description: 'Graceful banked descent back to pitch or curved wall ramp (R_fillet = 8m), absorbing vertical momentum through progressive 4-wheel suspension compression.'
      }
    },
    secondary_effects: [
      'Long volumetric rocket boost plume in 3D space',
      'Ball-Cam upward tilt tracking high-altitude interception',
      'HUD "AERIAL HIT +50" award banner & synth chime'
    ]
  },
  {
    id: 'm5_goal_explosion_shockwave',
    name: 'Goal Explosion Supernova & Radial Shockwave',
    trigger: 'Ball crosses Goal Line |Z| >= 100m (or press Key 5 / Autopilot Phase 5)',
    duration_ms: 2800,
    phases: {
      t0_anticipation: {
        window_ms: [0, 250],
        description: 'Ball crosses the laser goal curtain; time dilates to 0.35x as the ball compresses into a blinding team-colored singularity core at the goal mouth.'
      },
      t1_primary_drive: {
        window_ms: [250, 1100],
        description: 'Supernova plasma detonation expands to R = 28m inside the goal mouth while a physical radial shockwave impulse (F_blast = 45 m/s) launches all cars airborne across the arena.'
      },
      t2_apex_secondary: {
        window_ms: [1100, 2000],
        description: 'Stadium crowd light-sticks erupt in synchronized waves, goal horn blasts, 250+ glowing plasma & confetti particles cascade, and "GOAL!" banner + shot speed KPH appears.'
      },
      t3_overshoot_settle: {
        window_ms: [2000, 2800],
        description: 'Blasted cars tumble and settle across the pitch as the camera smoothly transitions into the 4.0s Goal Instant Replay before kickoff reset.'
      }
    },
    secondary_effects: [
      'Radial physics blast launching all nearby Battle-Cars tumbling through the air',
      'Multi-ring plasma shockwave + stadium crowd wave animation',
      'Automatic transition to Circular Ring-Buffer Goal Instant Replay'
    ]
  }
]);

// ============================================================================
// STANDALONE 3D VECTOR & QUATERNION MATH HELPERS
// ============================================================================

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function safeFinite(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function vec3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

function quatIdentity() {
  return { x: 0, y: 0, z: 0, w: 1 };
}

function quatNormalize(q) {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  if (len < 1e-9 || !Number.isFinite(len)) {
    q.x = 0; q.y = 0; q.z = 0; q.w = 1;
    return q;
  }
  const inv = 1 / len;
  q.x *= inv; q.y *= inv; q.z *= inv; q.w *= inv;
  return q;
}

function quatMultiply(a, b, out = { x: 0, y: 0, z: 0, w: 1 }) {
  const ax = a.x, ay = a.y, az = a.z, aw = a.w;
  const bx = b.x, by = b.y, bz = b.z, bw = b.w;
  out.x = aw * bx + ax * bw + ay * bz - az * by;
  out.y = aw * by - ax * bz + ay * bw + az * bx;
  out.z = aw * bz + ax * by - ay * bx + az * bw;
  out.w = aw * bw - ax * bx - ay * by - az * bz;
  return quatNormalize(out);
}

function quatFromAxisAngle(ax, ay, az, angle, out = { x: 0, y: 0, z: 0, w: 1 }) {
  const len = Math.hypot(ax, ay, az);
  if (len < 1e-8) {
    out.x = 0; out.y = 0; out.z = 0; out.w = 1;
    return out;
  }
  const half = angle * 0.5;
  const s = Math.sin(half) / len;
  out.x = ax * s;
  out.y = ay * s;
  out.z = az * s;
  out.w = Math.cos(half);
  return quatNormalize(out);
}

function quatFromUnitVectors(from, to, out = { x: 0, y: 0, z: 0, w: 1 }) {
  let r = from.x * to.x + from.y * to.y + from.z * to.z + 1.0;
  if (r < 1e-6) {
    r = 0;
    if (Math.abs(from.x) > Math.abs(from.z)) {
      out.x = -from.y;
      out.y = from.x;
      out.z = 0;
      out.w = r;
    } else {
      out.x = 0;
      out.y = -from.z;
      out.z = from.y;
      out.w = r;
    }
  } else {
    out.x = from.y * to.z - from.z * to.y;
    out.y = from.z * to.x - from.x * to.z;
    out.z = from.x * to.y - from.y * to.x;
    out.w = r;
  }
  return quatNormalize(out);
}

function quatSlerp(qa, qb, t, out = { x: 0, y: 0, z: 0, w: 1 }) {
  const alpha = clamp(t, 0, 1);
  let bx = qb.x, by = qb.y, bz = qb.z, bw = qb.w;
  let cosHalfTheta = qa.x * bx + qa.y * by + qa.z * bz + qa.w * bw;
  if (cosHalfTheta < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw;
    cosHalfTheta = -cosHalfTheta;
  }
  if (cosHalfTheta >= 0.9995) {
    out.x = qa.x + (bx - qa.x) * alpha;
    out.y = qa.y + (by - qa.y) * alpha;
    out.z = qa.z + (bz - qa.z) * alpha;
    out.w = qa.w + (bw - qa.w) * alpha;
    return quatNormalize(out);
  }
  const halfTheta = Math.acos(clamp(cosHalfTheta, -1, 1));
  const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
  const ratioA = Math.sin((1 - alpha) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(alpha * halfTheta) / sinHalfTheta;
  out.x = qa.x * ratioA + bx * ratioB;
  out.y = qa.y * ratioA + by * ratioB;
  out.z = qa.z * ratioA + bz * ratioB;
  out.w = qa.w * ratioA + bw * ratioB;
  return quatNormalize(out);
}

function rotateVecByQuat(v, q, out = { x: 0, y: 0, z: 0 }) {
  const vx = v.x, vy = v.y, vz = v.z;
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const ix = qw * vx + qy * vz - qz * vy;
  const iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx;
  const iw = -qx * vx - qy * vy - qz * vz;
  out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}

function quatFromBasis(right, up, forward, out = { x: 0, y: 0, z: 0, w: 1 }) {
  // Columns of rotation matrix: c0 = right (+X), c1 = up (+Y), c2 = forward (+Z)
  const m00 = right.x, m01 = up.x, m02 = forward.x;
  const m10 = right.y, m11 = up.y, m12 = forward.y;
  const m20 = right.z, m21 = up.z, m22 = forward.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    out.w = 0.25 / s;
    out.x = (m21 - m12) * s;
    out.y = (m02 - m20) * s;
    out.z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    out.w = (m21 - m12) / s;
    out.x = 0.25 * s;
    out.y = (m01 + m10) / s;
    out.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    out.w = (m02 - m20) / s;
    out.x = (m01 + m10) / s;
    out.y = 0.25 * s;
    out.z = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    out.w = (m10 - m01) / s;
    out.x = (m02 + m20) / s;
    out.y = (m12 + m21) / s;
    out.z = 0.25 * s;
  }
  return quatNormalize(out);
}

function updateCarBasis(car) {
  rotateVecByQuat({ x: 1, y: 0, z: 0 }, car.quaternion, car.right);
  rotateVecByQuat({ x: 0, y: 1, z: 0 }, car.quaternion, car.up);
  rotateVecByQuat({ x: 0, y: 0, z: 1 }, car.quaternion, car.forward);
}

// ============================================================================
// BUILT-IN FALLBACK C1-CONTINUOUS ANALYTICAL ARENA SDF & GOAL-POST SOLVER
// ============================================================================

/**
 * Evaluates the Signed Distance Field of the DFH Neo-Dome Arena.
 * Returns { dist, nx, ny, nz, surfaceType } where:
 *  - dist > 0 inside the playable volume, dist = 0 on the boundary
 *  - (nx, ny, nz) is the inward-pointing unit surface normal
 *  - surfaceType in ['floor', 'ramp', 'wall', 'ceiling', 'goal', 'goal_post']
 */
function defaultEvalArenaSDF(x, y, z) {
  x = safeFinite(x, 0);
  y = safeFinite(y, 2);
  z = safeFinite(z, 0);

  const HX = ARENA_CONSTANTS.HALF_WIDTH;   // 60.0
  const HY = ARENA_CONSTANTS.HEIGHT;       // 40.0
  const HZ = ARENA_CONSTANTS.HALF_LENGTH;  // 100.0
  const RF = ARENA_CONSTANTS.R_FILLET;     // 8.0
  const RC = ARENA_CONSTANTS.R_CORNER;     // 16.0
  const GW = ARENA_CONSTANTS.GOAL_HALF_WIDTH; // 14.0
  const GH = ARENA_CONSTANTS.GOAL_HEIGHT;     // 11.0
  const GD = ARENA_CONSTANTS.GOAL_DEPTH;      // 12.0
  const RP = ARENA_CONSTANTS.R_POST;          // 0.45

  const absX = Math.abs(x);
  const absZ = Math.abs(z);
  const signX = x >= 0 ? 1 : -1;
  const signZ = z >= 0 ? 1 : -1;

  // Check if point is near or inside the Goal Mouth Opening: |x| < 14, y < 11, |z| >= 92
  const inGoalWindowXY = absX < (GW - 0.15) && y < (GH - 0.15) && y >= -2.0;

  // 1. Horizontal (X-Z) distance to vertical side/back walls with R_corner = 16.0m fillet
  const innerHX = HX - RC; // 44.0
  const innerHZ = HZ - RC; // 84.0
  const qx = Math.max(absX - innerHX, 0);
  const qz = Math.max(absZ - innerHZ, 0);
  const qLenXZ = Math.hypot(qx, qz);

  let dHoriz;
  let nHorizX = 0;
  let nHorizZ = 0;

  if (qLenXZ > 1e-6) {
    dHoriz = RC - qLenXZ;
    nHorizX = -signX * (qx / qLenXZ);
    nHorizZ = -signZ * (qz / qLenXZ);
  } else {
    const dxWall = HX - absX;
    const dzWall = HZ - absZ;
    if (dxWall < dzWall) {
      dHoriz = dxWall;
      nHorizX = -signX;
      nHorizZ = 0;
    } else {
      dHoriz = dzWall;
      nHorizX = 0;
      nHorizZ = -signZ;
    }
  }

  // If inside goal opening window along back wall, override back-wall containment so the chamber extends to |z| = 112.0m
  let inGoalChamber = false;
  if (inGoalWindowXY && absZ > HZ - RF - 1.0 && absX < GW) {
    inGoalChamber = true;
    const dzBack = (HZ + GD) - absZ; // distance to back of net at |z| = 112
    if (absZ >= HZ) {
      const dxSide = GW - absX;      // distance to goal inner side walls at |x| = 14 (only inside net |z| >= 100)
      if (dzBack < dxSide) {
        dHoriz = dzBack;
        nHorizX = 0;
        nHorizZ = -signZ;
      } else {
        dHoriz = dxSide;
        nHorizX = -signX;
        nHorizZ = 0;
      }
    } else {
      dHoriz = dzBack;
      nHorizX = 0;
      nHorizZ = -signZ;
    }
  }

  // 2. Vertical (Y) distance and C1-continuous R_fillet = 8.0m floor-to-wall and wall-to-ceiling transition
  const cy = HY * 0.5; // 20.0
  const halfY = HY * 0.5; // 20.0
  const absY = Math.abs(y - cy);
  const signY = y >= cy ? 1 : -1;

  // In the goal mouth & chamber, the floor at Y = 0 is flat (no 8m floor ramp blocking the goal line!)
  const activeFillet = inGoalChamber ? 0.0 : RF;

  let dist;
  let nx = 0, ny = 1, nz = 0;
  let surfaceType = 'floor';

  if (activeFillet > 0) {
    // Distance inward from vertical wall boundary is dHoriz; distance inward from floor/ceiling is dVert = halfY - absY
    const dVert = halfY - absY;
    const u = Math.max(activeFillet - dHoriz, 0);
    const v = Math.max(activeFillet - dVert, 0);
    if (u > 0 && v > 0) {
      // Inside the curved R_fillet ramp region!
      const rLen = Math.hypot(u, v);
      dist = activeFillet - rLen;
      const wHoriz = u / rLen;
      const wVert = v / rLen;
      nx = nHorizX * wHoriz;
      ny = -signY * wVert;
      nz = nHorizZ * wHoriz;
      surfaceType = y < HY * 0.5 ? 'ramp' : 'ceiling';
    } else if (dVert < dHoriz) {
      dist = dVert;
      nx = 0;
      ny = -signY;
      nz = 0;
      surfaceType = y < HY * 0.5 ? 'floor' : 'ceiling';
    } else {
      dist = dHoriz;
      nx = nHorizX;
      ny = 0;
      nz = nHorizZ;
      surfaceType = 'wall';
    }
  } else {
    // Goal chamber interior box
    const dFloor = y;
    const dRoof = GH - y;
    const dVert = Math.min(dFloor, dRoof);
    if (dVert < dHoriz) {
      dist = dVert;
      nx = 0;
      ny = dFloor < dRoof ? 1 : -1;
      nz = 0;
      surfaceType = 'goal';
    } else {
      dist = dHoriz;
      nx = nHorizX;
      ny = 0;
      nz = nHorizZ;
      surfaceType = 'goal';
    }
  }

  // 3. Exact 3D Capsule Collision against the Goal Posts (x = ±14, y in [0..11], z = ±100)
  //    and Crossbar (x in [-14..14], y = 11, z = ±100) with radius R_post = 0.45m
  if (absZ > HZ - 6.0 && absZ < HZ + 6.0 && absX < GW + 5.0 && y < GH + 5.0) {
    const gz = signZ * HZ;
    // Left/Right vertical post closest point
    const px = signX * GW;
    const py = clamp(y, 0, GH);
    const dxP = x - px;
    const dyP = y - py;
    const dzP = z - gz;
    const dPostCenter = Math.hypot(dxP, dyP, dzP);
    const dPostSurf = dPostCenter - RP;

    // Horizontal crossbar closest point
    const cx = clamp(x, -GW, GW);
    const cyBar = GH;
    const dxB = x - cx;
    const dyB = y - cyBar;
    const dzB = z - gz;
    const dBarCenter = Math.hypot(dxB, dyB, dzB);
    const dBarSurf = dBarCenter - RP;

    if (dPostSurf < dist && dPostCenter > 1e-6) {
      dist = dPostSurf;
      nx = dxP / dPostCenter;
      ny = dyP / dPostCenter;
      nz = dzP / dPostCenter;
      surfaceType = 'goal_post';
    }
    if (dBarSurf < dist && dBarCenter > 1e-6) {
      dist = dBarSurf;
      nx = dxB / dBarCenter;
      ny = dyB / dBarCenter;
      nz = dzB / dBarCenter;
      surfaceType = 'goal_post';
    }
  }

  const nLen = Math.hypot(nx, ny, nz);
  if (nLen > 1e-6) {
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
  } else {
    nx = 0; ny = 1; nz = 0;
  }

  return { dist, nx, ny, nz, surfaceType };
}

// ============================================================================
// PHYSICS WORLD & CHOREOGRAPHER ENGINE
// ============================================================================

const WHEEL_OFFSETS_LOCAL = Object.freeze([
  { id: 'FL', x: -0.92, y: 0.40, z: 1.32, radius: 0.40, isFront: true },
  { id: 'FR', x: 0.92, y: 0.40, z: 1.32, radius: 0.40, isFront: true },
  { id: 'RL', x: -0.96, y: 0.43, z: -1.28, radius: 0.45, isFront: false },
  { id: 'RR', x: 0.96, y: 0.43, z: -1.28, radius: 0.45, isFront: false }
]);

// [SPEC PATCH #15] 18 Chassis OBB & Extremity Sample Points in COM-relative local coordinates
// (where ly = y_mesh - 0.42m, so tire bottoms are at ly = -0.42m, outer flanks at lx = ±1.15m,
// roof roll-cage/scoop apex at ly = +1.05m, and rear wing endplates at ly = +1.11m).
const CHASSIS_COLLISION_SAMPLES_LOCAL = Object.freeze([
  // 4 Outer-Bottom Tire Contact Corners (covers 0..45..90 deg roll)
  { lx: -1.16, ly: -0.42, lz: +1.35 },
  { lx: +1.16, ly: -0.42, lz: +1.35 },
  { lx: -1.16, ly: -0.42, lz: -1.35 },
  { lx: +1.16, ly: -0.42, lz: -1.35 },
  // 4 Outer-Top Tire Sidewall Corners (covers 90..135 deg roll)
  { lx: -1.16, ly: +0.42, lz: +1.35 },
  { lx: +1.16, ly: +0.42, lz: +1.35 },
  { lx: -1.16, ly: +0.42, lz: -1.35 },
  { lx: +1.16, ly: +0.42, lz: -1.35 },
  // 4 Outer Tire Front/Rear Tread Extremities (covers pitch + roll combinations)
  { lx: -1.16, ly: 0.00, lz: +1.77 },
  { lx: +1.16, ly: 0.00, lz: +1.77 },
  { lx: -1.16, ly: 0.00, lz: -1.73 },
  { lx: +1.16, ly: 0.00, lz: -1.73 },
  // 4 Mid-Sidepod, Nose Splitter & Rear Thruster Bell Extremities
  { lx: -1.04, ly: +0.20, lz: +0.10 },
  { lx: +1.04, ly: +0.20, lz: +0.10 },
  { lx: -0.68, ly: -0.22, lz: +2.16 },
  { lx: +0.68, ly: -0.22, lz: +2.16 },
  { lx: -0.48, ly: +0.20, lz: -2.18 },
  { lx: +0.48, ly: +0.20, lz: -2.18 },
  // 6 Upper Roof Roll-Cage, Scoop, Windshield & Rear Wing Crown Points (covers 135..180 deg upside-down roll)
  { lx: -0.48, ly: +1.06, lz: -0.30 },
  { lx: +0.48, ly: +1.06, lz: -0.30 },
  { lx: -0.48, ly: +0.68, lz: +0.32 },
  { lx: +0.48, ly: +0.68, lz: +0.32 },
  { lx: -0.90, ly: +1.12, lz: -1.90 },
  { lx: +0.90, ly: +1.12, lz: -1.90 }
]);

const KICKOFF_SLOTS = Object.freeze({
  blue: [
    { x: 0.0, y: 0.42, z: -46.0, yaw: 0.0 },
    { x: -22.0, y: 0.42, z: -38.0, yaw: 0.42 },
    { x: 22.0, y: 0.42, z: -38.0, yaw: -0.42 }
  ],
  orange: [
    { x: 0.0, y: 0.42, z: 46.0, yaw: Math.PI },
    { x: 22.0, y: 0.42, z: 38.0, yaw: Math.PI + 0.42 },
    { x: -22.0, y: 0.42, z: 38.0, yaw: Math.PI - 0.42 }
  ]
});

class PhysicsWorld {
  constructor(options = {}) {
    const globalArena =
      typeof globalThis !== 'undefined' &&
      globalThis.RLModules &&
      globalThis.RLModules.Arena
        ? globalThis.RLModules.Arena
        : null;

    this.evalArenaSDF =
      options.evalArenaSDF ||
      (globalArena && typeof globalArena.evalArenaSDF === 'function'
        ? globalArena.evalArenaSDF
        : defaultEvalArenaSDF);

    const padLayout =
      options.boostPadLayout ||
      (globalArena && Array.isArray(globalArena.BOOST_PAD_LAYOUT)
        ? globalArena.BOOST_PAD_LAYOUT
        : DEFAULT_BOOST_PAD_LAYOUT);

    // Live Mutators per Spec Section 2.1
    this.mutators = {
      gravityScale: 1.0,
      boostStrength: 1.0,
      ballBounciness: 0.60,
      timeScale: 1.0,
      botDifficulty: 'pro',
      ...(options.mutators || {})
    };

    // Match State & Regulation Clock
    this.mode = options.mode || '2v2'; // '1v1', '2v2', '3v3', 'freeplay', 'autopilot'
    this.matchState = MATCH_STATES.KICKOFF_COUNTDOWN;
    this.stateTimer = 3.0;
    this.countdownNumber = 3;
    this.timeRemaining = 300.0; // 5:00 regulation
    this.isOvertime = false;
    this.zeroSecondKeepItUp = false;
    this.goalScoredThisRally = false;
    this.lastGoalInfo = null;
    this.score = { blue: 0, orange: 0 };
    this.simulationTime = 0;
    this.stepCount = 0;

    // Event Queue & Callbacks
    this.events = [];
    this.eventListeners = [];
    if (typeof options.onEvent === 'function') {
      this.eventListeners.push(options.onEvent);
    }

    // Initialize 28 Boost Pads
    this.boostPads = padLayout.map((p, idx) => {
      const px = p.x !== undefined ? p.x : (Array.isArray(p.position) ? p.position[0] : p.position?.x || 0);
      const py = p.y !== undefined ? p.y : (Array.isArray(p.position) ? p.position[1] : p.position?.y || 0);
      const pz = p.z !== undefined ? p.z : (Array.isArray(p.position) ? p.position[2] : p.position?.z || 0);
      const isFull = p.type === 'full' || p.boost === 100;
      const boostAmt = p.boost || (isFull ? 100 : 12);
      const respawnSec = p.respawn || (isFull ? 10.0 : 4.0);
      const rad = p.radius || (isFull ? 2.8 : 1.8);
      return {
        id: p.id !== undefined ? p.id : idx,
        index: idx,
        type: isFull ? 'full' : 'small',
        x: px,
        y: py,
        z: pz,
        position: { x: px, y: py, z: pz },
        boost: boostAmt,
        amount: boostAmt,
        respawn: respawnSec,
        maxCooldown: respawnSec,
        radius: rad,
        active: true,
        cooldown: 0.0,
        timer: 0.0
      };
    });

    // Initialize Soccer Ball (R_ball = 3.20m)
    this.ball = this._createBallState();

    // Initialize Battle-Cars
    this.cars = [];
    this.playerCar = null;
    this._setupCarsForMode(this.mode);

    // Circular Ring-Buffer for Goal Instant Replay (360 frames @ 60fps = 6.0s history)
    this.replayBuffer = [];
    this.maxReplayFrames = 360;
    this.currentReplayFrame = null;
    this.replayCursor = 0;

    // 4-Phase Kinematic Choreographer & Autopilot State
    this.activeChoreography = null;
    this.autopilotQueue = [];
    this.autopilotActive = false;
    this.telemetry = {
      activeMovementId: null,
      currentPhase: 'idle',
      phaseProgress: 0,
      velocity: { x: 0, y: 0, z: 0 },
      speedKph: 0,
      angularVelocity: { x: 0, y: 0, z: 0 },
      bodyPitchRollYaw: { pitch: 0, roll: 0, yaw: 0 },
      suspensionCompression: [0, 0, 0, 0],
      secondaryEffectsActive: [],
      frameHistory: []
    };

    this._installGlobalHooks();
    this._syncGlobalSimState();
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION & STATE CREATION
  // --------------------------------------------------------------------------

  _createBallState() {
    const ball = {
      position: vec3(0, ARENA_CONSTANTS.BALL_RADIUS, 0),
      velocity: vec3(0, 0, 0),
      angularVelocity: vec3(0, 0, 0),
      quaternion: quatIdentity(),
      radius: ARENA_CONSTANTS.BALL_RADIUS,
      speed: 0,
      speedKph: 0,
      lastTouchTeam: 'neutral',
      lastTouchCarId: null,
      lastTouchTime: -999,
      seamColor: '#00f0ff',
      hitStopTimer: 0,
      firstTouchAwarded: false
    };
    this._bindCoordAliases(ball);
    return ball;
  }

  _bindCoordAliases(entity) {
    Object.defineProperties(entity, {
      x: { get() { return this.position.x; }, set(v) { this.position.x = v; }, enumerable: true },
      y: { get() { return this.position.y; }, set(v) { this.position.y = v; }, enumerable: true },
      z: { get() { return this.position.z; }, set(v) { this.position.z = v; }, enumerable: true },
      vx: { get() { return this.velocity.x; }, set(v) { this.velocity.x = v; }, enumerable: true },
      vy: { get() { return this.velocity.y; }, set(v) { this.velocity.y = v; }, enumerable: true },
      vz: { get() { return this.velocity.z; }, set(v) { this.velocity.z = v; }, enumerable: true },
      qx: { get() { return this.quaternion.x; }, set(v) { this.quaternion.x = v; }, enumerable: true },
      qy: { get() { return this.quaternion.y; }, set(v) { this.quaternion.y = v; }, enumerable: true },
      qz: { get() { return this.quaternion.z; }, set(v) { this.quaternion.z = v; }, enumerable: true },
      qw: { get() { return this.quaternion.w; }, set(v) { this.quaternion.w = v; }, enumerable: true }
    });
  }

  _createCarState(config) {
    const yaw = config.yaw || 0;
    const q = quatFromAxisAngle(0, 1, 0, yaw);
    const car = {
      id: config.id,
      index: config.index || 0,
      name: config.name || `Octane-${config.numeral || '01'}`,
      team: config.team || 'blue',
      numeral: config.numeral || (config.team === 'blue' ? '01' : '02'),
      isPlayer: Boolean(config.isPlayer),
      isBot: !config.isPlayer,
      role: config.role || 'striker',
      kickoffSlotIndex: config.kickoffSlotIndex || 0,
      isPhysicsCar: true,
      rideHeightOffset: 0.42,

      position: vec3(config.x || 0, config.y || 0.42, config.z || 0),
      velocity: vec3(0, 0, 0),
      angularVelocity: vec3(0, 0, 0),
      quaternion: q,
      right: vec3(1, 0, 0),
      up: vec3(0, 1, 0),
      forward: vec3(0, 0, 1),

      // Surface & Suspension State
      surfaceNormal: vec3(0, 1, 0),
      surfaceDist: 0.42,
      surfaceType: 'floor',
      onGround: true,
      isGrounded: true,
      wheelContacts: [true, true, true, true],
      suspensionCompression: [0.04, 0.04, 0.04, 0.04],
      suspensionVelocity: [0, 0, 0, 0],
      wheelWorldPositions: [vec3(), vec3(), vec3(), vec3()],

      // Coupled 2nd-Order Chassis Pitch/Roll Spring-Damper State (for t0..t3 visual transfer)
      bodyPitch: 0,      // radians (+ = nose up, - = nose down)
      bodyPitchVel: 0,
      bodyRoll: 0,       // radians (+ = roll right, - = roll left)
      bodyRollVel: 0,
      bodyYaw: yaw,
      chassisHeave: 0,   // meters vertical offset from squat/compression
      chassisHeaveVel: 0,
      nozzleDilation: 0, // 0..1 turbojet iris dilation

      // Kinematics & Tire State
      speed: 0,
      speedKph: 0,
      forwardSpeed: 0,
      lateralSpeed: 0,
      slipAngle: 0,
      steerAngle: 0,
      wheelSpinAngle: 0,
      wheelSpinRate: 0,

      // Boost & Supersonic State
      boost: 33.3,
      isBoosting: false,
      isSupersonic: false,
      supersonicTimer: 0,
      isPowersliding: false,
      isDrifting: false,

      // Jump, 140ms Pitch Deadband, Double-Jump & Dodge Flip State
      airTime: 0,
      hasJumped: false,
      hasDoubleJumped: false,
      jumpHoldTimer: 0,
      prevJumpInput: false,
      isFlipping: false,
      flipTimer: 0,
      flipDuration: 0.62,
      flipProgress: 0,
      flipVerticalLockTimer: 0,
      flipDirection: vec3(0, 0, 1),
      flipPitchRate: 0,
      flipRollRate: 0,

      // Demolition State
      demolished: false,
      isDemolished: false,
      respawnTimer: 0,

      // Control Inputs
      input: {
        throttle: 0,     // -1..+1 (S/W)
        steer: 0,        // -1..+1 (D/A: +1 left, -1 right or standard steer)
        jump: false,     // Space held
        jumpPressed: false, // Edge trigger
        boost: false,    // F / Left-Click
        handbrake: false,// Shift (Powerslide on ground, Air-Roll modifier in air)
        pitch: 0,        // -1..+1 (Nose down / Nose up in air)
        yaw: 0,          // -1..+1
        roll: 0          // -1..+1 (Q/E Air Roll)
      }
    };

    this._bindCoordAliases(car);
    Object.defineProperties(car, {
      wheelCompression: {
        get() { return this.suspensionCompression; },
        enumerable: true
      },
      chassisPitch: {
        get() { return this.bodyPitch; },
        set(v) { this.bodyPitch = v; },
        enumerable: true
      },
      chassisRoll: {
        get() { return this.bodyRoll; },
        set(v) { this.bodyRoll = v; },
        enumerable: true
      },
      boostActive: {
        get() { return this.isBoosting; },
        set(v) { this.isBoosting = Boolean(v); },
        enumerable: true
      },
      wheelRotation: {
        get() { return this.wheelSpinAngle; },
        set(v) { this.wheelSpinAngle = Number(v) || 0; },
        enumerable: true
      }
    });

    updateCarBasis(car);
    return car;
  }

  _setupCarsForMode(mode) {
    const clean = String(mode || '2v2').toLowerCase().replace(/[\s_-]+/g, '');
    let normalized = '2v2';
    let teamSize = 2;
    if (clean === '1v1' || clean === 'duel') {
      normalized = '1v1';
      teamSize = 1;
    } else if (clean === '2v2' || clean === 'doubles') {
      normalized = '2v2';
      teamSize = 2;
    } else if (clean === '3v3' || clean === 'standard') {
      normalized = '3v3';
      teamSize = 3;
    } else if (clean === 'freeplay' || clean === 'training') {
      normalized = 'freeplay';
      teamSize = 1;
    } else if (clean === 'autopilot' || clean === 'autopilotshowcase') {
      normalized = 'autopilot';
      teamSize = 2;
    }

    this.mode = normalized;
    this.cars = [];

    const blueSlots = KICKOFF_SLOTS.blue;
    const orangeSlots = KICKOFF_SLOTS.orange;

    for (let i = 0; i < teamSize; i++) {
      const slot = blueSlots[i % blueSlots.length];
      const car = this._createCarState({
        id: `blue_${i}`,
        index: this.cars.length,
        name: i === 0 ? 'Octane-RLX (You)' : `Blue Bot ${i}`,
        team: 'blue',
        numeral: `0${i * 2 + 1}`,
        isPlayer: i === 0,
        role: i === 0 ? 'striker' : 'goalie',
        kickoffSlotIndex: i,
        x: slot.x,
        y: slot.y,
        z: slot.z,
        yaw: slot.yaw
      });
      this.cars.push(car);
      if (i === 0) this.playerCar = car;
    }

    if (normalized !== 'freeplay') {
      for (let i = 0; i < teamSize; i++) {
        const slot = orangeSlots[i % orangeSlots.length];
        const car = this._createCarState({
          id: `orange_${i}`,
          index: this.cars.length,
          name: `Orange Bot ${i + 1}`,
          team: 'orange',
          numeral: `0${(i + 1) * 2}`,
          isPlayer: false,
          role: i === 0 ? 'striker' : 'goalie',
          kickoffSlotIndex: i,
          x: slot.x,
          y: slot.y,
          z: slot.z,
          yaw: slot.yaw
        });
        this.cars.push(car);
      }
    }

    if (normalized === 'freeplay') {
      this.matchState = MATCH_STATES.FREE_PLAY;
      this.stateTimer = 0;
      this.cars.forEach(c => { c.boost = 100; });
    } else if (normalized === 'autopilot') {
      this.matchState = MATCH_STATES.AUTOPILOT_SHOWCASE;
      this.stateTimer = 0;
    } else {
      this.resetKickoff();
    }
  }

  // --------------------------------------------------------------------------
  // MATCH STATE MACHINE & KICKOFF / RESET CONTROLS
  // --------------------------------------------------------------------------

  setMatchMode(mode) {
    this.resetMatch(mode);
    if (this.mode === 'autopilot') {
      this.startAutopilot();
    }
    return this.mode;
  }

  setMutator(key, value) {
    const k = String(key || '').trim();
    if (k === 'gravity' || k === 'gravityScale') {
      this.mutators.gravityScale = clamp(Number(value) || 1.0, 0.2, 3.0);
    } else if (k === 'boostPower' || k === 'boostStrength') {
      this.mutators.boostStrength = clamp(Number(value) || 1.0, 0.3, 3.0);
    } else if (k === 'ballBounciness') {
      this.mutators.ballBounciness = clamp(Number(value) || 0.60, 0.2, 0.95);
    } else if (k === 'gameSpeed' || k === 'timeScale') {
      this.mutators.timeScale = clamp(Number(value) || 1.0, 0.1, 2.5);
    } else if (k === 'botDifficulty' || k === 'difficulty') {
      this.mutators.botDifficulty = String(value || 'pro').toLowerCase();
    } else {
      this.mutators[k] = value;
    }
    this._syncGlobalSimState();
    return this.mutators;
  }

  resetMatch(mode = this.mode) {
    this.score.blue = 0;
    this.score.orange = 0;
    this.timeRemaining = 300.0;
    this.isOvertime = false;
    this.zeroSecondKeepItUp = false;
    this.goalScoredThisRally = false;
    this.activeChoreography = null;
    this.autopilotActive = false;
    this._setupCarsForMode(mode);
    this._syncGlobalSimState();
  }

  resetKickoff() {
    this.goalScoredThisRally = false;
    this.activeChoreography = null;

    // [SPEC PATCH #14] Guarantee AI cars are populated in non-freeplay modes
    if (this.mode !== 'freeplay' && this.cars.filter(c => c.team === 'orange').length === 0) {
      this._setupCarsForMode(this.mode || '1v1');
      return;
    }

    // Reset Ball to center kickoff spot (0, 3.20, 0)
    this.ball.position.x = 0;
    this.ball.position.y = ARENA_CONSTANTS.BALL_RADIUS;
    this.ball.position.z = 0;
    this.ball.velocity.x = 0;
    this.ball.velocity.y = 0;
    this.ball.velocity.z = 0;
    this.ball.angularVelocity.x = 0;
    this.ball.angularVelocity.y = 0;
    this.ball.angularVelocity.z = 0;
    this.ball.quaternion = quatIdentity();
    this.ball.speed = 0;
    this.ball.speedKph = 0;
    this.ball.lastTouchTeam = 'neutral';
    this.ball.lastTouchCarId = null;
    this.ball.seamColor = '#00f0ff';
    this.ball.firstTouchAwarded = false;
    this.ball.hitStopTimer = 0;

    // Reactivate all 28 Boost Pads
    for (let i = 0; i < this.boostPads.length; i++) {
      this.boostPads[i].active = true;
      this.boostPads[i].cooldown = 0;
      this.boostPads[i].timer = 0;
    }

    // Reset Cars to Symmetric Kickoff Slots with boost = 33.3 ([SPEC PATCH #1] & [SPEC PATCH #14])
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const slots = car.team === 'blue' ? KICKOFF_SLOTS.blue : KICKOFF_SLOTS.orange;
      const slot = slots[car.kickoffSlotIndex % slots.length];
      this._resetCarPose(car, slot.x, slot.y, slot.z, slot.yaw, 33.3);
      car.demolished = false;
      car.isDemolished = false;
      car.respawnTimer = 0;
      car.visible = true;
    }

    if (this.mode === 'freeplay') {
      this.matchState = MATCH_STATES.FREE_PLAY;
      this.stateTimer = 0;
      this.cars.forEach(c => { c.boost = 100; });
    } else {
      this.matchState = MATCH_STATES.KICKOFF_COUNTDOWN;
      this.stateTimer = 3.0;
      this.countdownNumber = 3;
    }
  }

  _resetCarPose(car, x, y, z, yaw, startBoost = 33.3) {
    car.position.x = safeFinite(x, 0);
    car.position.y = safeFinite(y, 0.42);
    car.position.z = safeFinite(z, 0);
    car.velocity.x = 0;
    car.velocity.y = 0;
    car.velocity.z = 0;
    car.angularVelocity.x = 0;
    car.angularVelocity.y = 0;
    car.angularVelocity.z = 0;
    car.quaternion = quatFromAxisAngle(0, 1, 0, safeFinite(yaw, 0));
    updateCarBasis(car);
    car.surfaceNormal = vec3(0, 1, 0);
    car.surfaceDist = car.position.y;
    car.surfaceType = 'floor';
    car.onGround = true;
    car.isGrounded = true;
    car.wheelContacts = [true, true, true, true];
    car.suspensionCompression = [0.04, 0.04, 0.04, 0.04];
    car.suspensionVelocity = [0, 0, 0, 0];
    car.bodyPitch = 0;
    car.bodyPitchVel = 0;
    car.bodyRoll = 0;
    car.bodyRollVel = 0;
    car.bodyYaw = safeFinite(yaw, 0);
    car.chassisHeave = 0;
    car.chassisHeaveVel = 0;
    car.speed = 0;
    car.speedKph = 0;
    car.forwardSpeed = 0;
    car.lateralSpeed = 0;
    car.slipAngle = 0;
    car.steerAngle = 0;
    car.boost = startBoost;
    car.isBoosting = false;
    car.isSupersonic = false;
    car.supersonicTimer = 0;
    car.isPowersliding = false;
    car.isDrifting = false;
    car.airTime = 0;
    car.hasJumped = false;
    car.hasDoubleJumped = false;
    car.jumpHoldTimer = 0;
    car.isFlipping = false;
    car.flipTimer = 0;
    car.flipProgress = 0;
    car.flipVerticalLockTimer = 0;
    car.demolished = false;
    car.isDemolished = false;
    car.respawnTimer = 0;
    car.visible = true;
  }

  _respawnDemolishedCar(car) {
    const teamZ = car.team === 'blue' ? -72.0 : 72.0;
    const candidates = [
      { x: -24.0, z: teamZ },
      { x: 24.0, z: teamZ },
      { x: 0.0, z: teamZ * 0.86 },
      { x: -14.0, z: teamZ * 0.78 },
      { x: 14.0, z: teamZ * 0.78 }
    ];
    const startIdx = car.kickoffSlotIndex % 2 === 0 ? 0 : 1;
    let chosen = candidates[startIdx];

    for (let k = 0; k < candidates.length; k++) {
      const cand = candidates[(startIdx + k) % candidates.length];
      let clear = true;
      for (let j = 0; j < this.cars.length; j++) {
        const other = this.cars[j];
        if (other === car || other.demolished) continue;
        const d = Math.hypot(other.position.x - cand.x, other.position.z - cand.z);
        if (d < 8.0) {
          clear = false;
          break;
        }
      }
      if (clear) {
        chosen = cand;
        break;
      }
    }

    const spawnYaw = car.team === 'blue' ? 0.0 : Math.PI;
    this._resetCarPose(car, chosen.x, 0.42, chosen.z, spawnYaw, 33.3);
    car.demolished = false;
    car.isDemolished = false;
    car.respawnTimer = 0;
    car.visible = true;

    // Give a clean rolling start toward the ball during live play so respawned AI/player cars immediately rejoin action
    if (this.matchState === MATCH_STATES.LIVE_PLAY || this.matchState === MATCH_STATES.FREE_PLAY) {
      const launchSpeed = 9.5;
      car.velocity.x = car.forward.x * launchSpeed;
      car.velocity.y = 0;
      car.velocity.z = car.forward.z * launchSpeed;
      car.speed = launchSpeed;
      car.speedKph = launchSpeed * 3.6;
      car.forwardSpeed = launchSpeed;
    }

    this.emitEvent('CAR_RESPAWN', { carId: car.id, team: car.team, position: { ...car.position } });
  }

  skipReplay() {
    if (this.matchState === MATCH_STATES.INSTANT_REPLAY) {
      if (this.isOvertime && this.goalScoredThisRally) {
        this.matchState = MATCH_STATES.MATCH_OVER;
        this.stateTimer = 5.0;
      } else {
        this.resetKickoff();
      }
    }
  }

  emitEvent(type, payload = {}) {
    const evt = {
      type,
      timestamp: this.simulationTime,
      ...payload
    };
    this.events.push(evt);
    for (let i = 0; i < this.eventListeners.length; i++) {
      try {
        this.eventListeners[i](evt);
      } catch (_) {
        // Ignore external listener errors
      }
    }
    return evt;
  }

  consumeEvents() {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  setPlayerInput(inputState = {}) {
    if (!this.playerCar) return;
    const inp = this.playerCar.input;
    if (inputState.throttle !== undefined) inp.throttle = clamp(inputState.throttle, -1, 1);
    if (inputState.steer !== undefined) inp.steer = clamp(inputState.steer, -1, 1);
    if (inputState.jump !== undefined) {
      inp.jumpPressed = Boolean(inputState.jump && !inp.jump);
      inp.jump = Boolean(inputState.jump);
    }
    if (inputState.jumpPressed !== undefined) inp.jumpPressed = Boolean(inputState.jumpPressed);
    if (inputState.boost !== undefined) inp.boost = Boolean(inputState.boost);
    if (inputState.handbrake !== undefined) inp.handbrake = Boolean(inputState.handbrake);
    if (inputState.pitch !== undefined) inp.pitch = clamp(inputState.pitch, -1, 1);
    if (inputState.yaw !== undefined) inp.yaw = clamp(inputState.yaw, -1, 1);
    if (inputState.roll !== undefined) inp.roll = clamp(inputState.roll, -1, 1);
  }

  // --------------------------------------------------------------------------
  // MAIN FIXED-SUBSTEP INTEGRATION LOOP ([SPEC PATCH #9])
  // --------------------------------------------------------------------------

  step(rawDt = 1 / 60, explicitSteps = null) {
    // [SPEC PATCH #9] Clamp incoming frame dt = Math.min(rawDt, 0.05) and step at fixed h = 1/120s (maxSubSteps = 6)
    const safeRawDt = safeFinite(rawDt, 1 / 60);
    const clampedDt = clamp(safeRawDt, 0.0, 0.05);
    const timeScale = clamp(safeFinite(this.mutators.timeScale, 1.0), 0.1, 2.5);

    const fixedH = 1 / 120;
    let subSteps = explicitSteps !== null
      ? clamp(Math.round(explicitSteps), 1, 240)
      : Math.max(1, Math.min(6, Math.ceil((clampedDt * timeScale) / fixedH)));

    const stepDt = explicitSteps !== null
      ? (clampedDt * timeScale) / subSteps
      : (clampedDt * timeScale) / subSteps;

    for (let s = 0; s < subSteps; s++) {
      this._stepSingleSubStep(stepDt > 0 ? stepDt : fixedH);
    }

    // Record Replay Frame during live play / celebration / choreography
    if (this.matchState !== MATCH_STATES.INSTANT_REPLAY && this.matchState !== MATCH_STATES.MAIN_MENU) {
      this._recordReplaySnapshot();
    }

    this._syncGlobalSimState();
    return this.getDiagnostics();
  }

  _stepSingleSubStep(dt) {
    this.simulationTime += dt;
    this.stepCount++;

    // Handle active 4-phase choreography if running
    if (this.activeChoreography) {
      this._stepChoreography(dt);
    }

    // Handle Match State Machine transitions
    this._updateMatchStateMachine(dt);

    // If in MAIN_MENU, keep scene gently idling without advancing match timers
    if (this.matchState === MATCH_STATES.MAIN_MENU && !this.activeChoreography) {
      for (let i = 0; i < this.cars.length; i++) {
        const c = this.cars[i];
        c.demolished = false;
        c.isDemolished = false;
        c.respawnTimer = 0;
        c.visible = true;
        c.bodyPitch = 0.025 * Math.sin(this.simulationTime * 18.0 + i);
        c.nozzleDilation = 0.45 + 0.2 * Math.sin(this.simulationTime * 24.0 + i);
      }
      return;
    }

    // If in INSTANT_REPLAY, advance replay playback cursor and return
    if (this.matchState === MATCH_STATES.INSTANT_REPLAY) {
      this._stepInstantReplay(dt);
      return;
    }

    // Hit-stop micro-dilation (e.g. 45ms power-strike contact in m3)
    let physicsDt = dt;
    if (this.ball.hitStopTimer > 0) {
      this.ball.hitStopTimer = Math.max(0, this.ball.hitStopTimer - dt);
      physicsDt = dt * 0.18;
    } else if (this.matchState === MATCH_STATES.GOAL_CELEBRATION && this.stateTimer > 2.55) {
      // Initial 250ms singularity slow-mo at goal line crossing
      physicsDt = dt * 0.35;
    }

    // Update Boost Pad cooldowns
    this._updateBoostPads(physicsDt);

    // Update Bot AI tactical roles & inputs
    if (!this.activeChoreography) {
      this._assignTeamRoles();
      for (let i = 0; i < this.cars.length; i++) {
        const car = this.cars[i];
        if (car.isBot && !car.demolished) {
          this.updateBotAI(car, physicsDt);
        }
      }
    }

    // Step each Battle-Car (pass unscaled dt for demolition respawn timer reliability)
    for (let i = 0; i < this.cars.length; i++) {
      this._stepCarPhysics(this.cars[i], physicsDt, dt);
    }

    // Step Car-to-Car Collisions & Supersonic Demolitions
    this._resolveCarToCarCollisions();

    // Step Ball Physics & Arena SDF Containment
    this._stepBallPhysics(physicsDt);

    // Step Car-Ball Swept Sphere / OBB Collisions & Psyonix Power Clears
    this._resolveCarToBallCollisions();

    // Check Boost Pad Pickups
    this._checkBoostPadPickups();

    // Check Goal Line Crossing ([SPEC PATCH #10])
    this._checkGoalScoring();

    // Final NaN & Out-of-Bounds Safety Sanitizer ([SPEC PATCH #9])
    this._sanitizeAllBodies();
  }

  // --------------------------------------------------------------------------
  // MATCH STATE MACHINE (3..2..1..GO!, 0-SEC KEEP-IT-UP, OVERTIME, REPLAY)
  // --------------------------------------------------------------------------

  _updateMatchStateMachine(dt) {
    if (this.matchState === MATCH_STATES.MAIN_MENU) {
      return;
    }
    if (this.matchState === MATCH_STATES.KICKOFF_COUNTDOWN) {
      const prevCeiling = Math.ceil(this.stateTimer);
      this.stateTimer -= dt;
      const newCeiling = Math.max(0, Math.ceil(this.stateTimer));
      this.countdownNumber = newCeiling;

      // During countdown, cars can rev engines (causing slight chassis pitch/vibration) while locked at spawn
      for (let i = 0; i < this.cars.length; i++) {
        const c = this.cars[i];
        c.demolished = false;
        c.isDemolished = false;
        c.respawnTimer = 0;
        c.visible = true;
        if (c.input.throttle > 0 || c.input.boost || c.isBot) {
          c.bodyPitch = 0.038 * Math.sin(this.simulationTime * 28.0);
          c.nozzleDilation = 0.5 + 0.3 * Math.sin(this.simulationTime * 35.0);
        }
      }

      if (newCeiling !== prevCeiling && newCeiling > 0) {
        this.emitEvent('COUNTDOWN_TICK', { count: newCeiling });
      }
      if (this.stateTimer <= 0) {
        this.matchState = MATCH_STATES.LIVE_PLAY;
        this.stateTimer = 0;
        this.countdownNumber = 0;
        this.emitEvent('KICKOFF_GO', {});
      }
    } else if (this.matchState === MATCH_STATES.LIVE_PLAY) {
      if (!this.isOvertime) {
        if (this.timeRemaining > 0) {
          this.timeRemaining = Math.max(0, this.timeRemaining - dt);
          if (this.timeRemaining <= 1e-5) {
            this.timeRemaining = 0;
            this.zeroSecondKeepItUp = true;
          }
        }
        // Authentic Rocket League 0:00 Rule: Clock only stops once the ball touches the floor (ball.y <= 3.35m)
        if (this.timeRemaining <= 0) {
          const ballTouchingFloor = this.ball.position.y <= 3.35;
          if (ballTouchingFloor) {
            this.zeroSecondKeepItUp = false;
            if (this.score.blue === this.score.orange) {
              // Tied at 0:00 -> Transition to +OT Sudden-Death Overtime!
              this.isOvertime = true;
              this.emitEvent('OVERTIME_START', { score: { ...this.score } });
              this.resetKickoff();
            } else {
              this.matchState = MATCH_STATES.MATCH_OVER;
              this.stateTimer = 6.0;
              this.emitEvent('MATCH_OVER', {
                winner: this.score.blue > this.score.orange ? 'blue' : 'orange',
                score: { ...this.score }
              });
            }
          }
        }
      } else {
        // In Overtime (+OT), timeRemaining counts upward as elapsed overtime seconds
        this.timeRemaining += dt;
      }
    } else if (this.matchState === MATCH_STATES.GOAL_CELEBRATION) {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        if (this.activeChoreography && this.activeChoreography.id === 'm5_goal_explosion_shockwave') {
          // Allow choreography to finish cleanly
          return;
        }
        this.matchState = MATCH_STATES.INSTANT_REPLAY;
        this.stateTimer = 4.0;
        this.replayCursor = 0;
        this.emitEvent('REPLAY_START', { goalInfo: this.lastGoalInfo });
      }
    } else if (this.matchState === MATCH_STATES.MATCH_OVER) {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.resetMatch(this.mode);
      }
    }
  }

  _recordReplaySnapshot() {
    const snap = {
      timestamp: this.simulationTime,
      ball: {
        x: this.ball.position.x,
        y: this.ball.position.y,
        z: this.ball.position.z,
        vx: this.ball.velocity.x,
        vy: this.ball.velocity.y,
        vz: this.ball.velocity.z,
        qx: this.ball.quaternion.x,
        qy: this.ball.quaternion.y,
        qz: this.ball.quaternion.z,
        qw: this.ball.quaternion.w,
        seamColor: this.ball.seamColor
      },
      cars: this.cars.map(c => ({
        id: c.id,
        team: c.team,
        x: c.position.x,
        y: c.position.y,
        z: c.position.z,
        vx: c.velocity.x,
        vy: c.velocity.y,
        vz: c.velocity.z,
        qx: c.quaternion.x,
        qy: c.quaternion.y,
        qz: c.quaternion.z,
        qw: c.quaternion.w,
        bodyPitch: c.bodyPitch,
        bodyRoll: c.bodyRoll,
        steerAngle: c.steerAngle,
        isBoosting: c.isBoosting,
        isSupersonic: c.isSupersonic,
        demolished: c.demolished,
        suspensionCompression: c.suspensionCompression.slice()
      }))
    };
    this.replayBuffer.push(snap);
    if (this.replayBuffer.length > this.maxReplayFrames) {
      this.replayBuffer.shift();
    }
  }

  _stepInstantReplay(dt) {
    this.stateTimer -= dt;
    if (this.replayBuffer.length > 0) {
      const progress = clamp(1.0 - this.stateTimer / 4.0, 0, 1);
      const idx = Math.min(
        this.replayBuffer.length - 1,
        Math.floor(progress * (this.replayBuffer.length - 1))
      );
      const frame = this.replayBuffer[idx];
      this.currentReplayFrame = frame;
      if (frame) {
        this.ball.position.x = frame.ball.x;
        this.ball.position.y = frame.ball.y;
        this.ball.position.z = frame.ball.z;
        this.ball.quaternion.x = frame.ball.qx;
        this.ball.quaternion.y = frame.ball.qy;
        this.ball.quaternion.z = frame.ball.qz;
        this.ball.quaternion.w = frame.ball.qw;
        for (let i = 0; i < this.cars.length && i < frame.cars.length; i++) {
          const fc = frame.cars[i];
          const c = this.cars[i];
          c.position.x = fc.x;
          c.position.y = fc.y;
          c.position.z = fc.z;
          c.quaternion.x = fc.qx;
          c.quaternion.y = fc.qy;
          c.quaternion.z = fc.qz;
          c.quaternion.w = fc.qw;
          c.bodyPitch = fc.bodyPitch;
          c.bodyRoll = fc.bodyRoll;
          c.isBoosting = fc.isBoosting;
          c.isSupersonic = fc.isSupersonic;
          c.demolished = Boolean(fc.demolished);
          c.isDemolished = Boolean(fc.demolished);
          updateCarBasis(c);
        }
      }
    }
    if (this.stateTimer <= 0) {
      this.currentReplayFrame = null;
      if (this.isOvertime && this.goalScoredThisRally) {
        for (let i = 0; i < this.cars.length; i++) {
          this.cars[i].demolished = false;
          this.cars[i].isDemolished = false;
          this.cars[i].respawnTimer = 0;
        }
        this.matchState = MATCH_STATES.MATCH_OVER;
        this.stateTimer = 5.0;
      } else {
        this.resetKickoff();
      }
    }
  }

  // --------------------------------------------------------------------------
  // 6-DOF VEHICLE DYNAMICS, 4-WHEEL SDF SUSPENSION & WALL/CEILING ADHESION
  // --------------------------------------------------------------------------

  /**
   * [SPEC PATCH #15] Evaluates all 18 3D Chassis OBB & Extremity Sample Points
   * (wheels, sidepods, nose, tail, roof roll-cage/scoop, and rear wing) against evalArenaSDF.
   * Pushes car.position outward along the surface normal whenever any part of the hull
   * penetrates the floor, ramp, wall, or ceiling (guaranteeing carBounds.min.y >= 0.00m
   * even at 90-deg side roll or 180-deg upside-down orientation).
   */
  _enforceChassisOBBContainment(car) {
    updateCarBasis(car);
    const centerSdf = this.evalArenaSDF(car.position.x, car.position.y, car.position.z);
    const upDotCenterN = car.up.x * centerSdf.nx + car.up.y * centerSdf.ny + car.up.z * centerSdf.nz;
    if (upDotCenterN >= 0.65 && centerSdf.surfaceType !== 'floor' && centerSdf.surfaceType !== 'goal') {
      return { minDist: centerSdf.dist, nx: centerSdf.nx, ny: centerSdf.ny, nz: centerSdf.nz };
    }
    let minDist = Infinity;
    let minNX = 0, minNY = 1, minNZ = 0;

    for (let i = 0; i < CHASSIS_COLLISION_SAMPLES_LOCAL.length; i++) {
      const s = CHASSIS_COLLISION_SAMPLES_LOCAL[i];
      const wx =
        car.position.x +
        car.right.x * s.lx +
        car.up.x * s.ly +
        car.forward.x * s.lz;
      const wy =
        car.position.y +
        car.right.y * s.lx +
        car.up.y * s.ly +
        car.forward.y * s.lz;
      const wz =
        car.position.z +
        car.right.z * s.lx +
        car.up.z * s.ly +
        car.forward.z * s.lz;

      const ptSdf = this.evalArenaSDF(wx, wy, wz);
      if (ptSdf.dist < minDist) {
        minDist = ptSdf.dist;
        minNX = ptSdf.nx;
        minNY = ptSdf.ny;
        minNZ = ptSdf.nz;
      }
    }

    if (minDist < 0.0) {
      const push = -minDist;
      car.position.x += minNX * push;
      car.position.y += minNY * push;
      car.position.z += minNZ * push;

      const vn =
        car.velocity.x * minNX +
        car.velocity.y * minNY +
        car.velocity.z * minNZ;
      if (vn < 0) {
        const upDotN = car.up.x * minNX + car.up.y * minNY + car.up.z * minNZ;
        const rebound = car.onGround || upDotN < 0.45 ? 0.0 : 0.18;
        car.velocity.x -= (1.0 + rebound) * vn * minNX;
        car.velocity.y -= (1.0 + rebound) * vn * minNY;
        car.velocity.z -= (1.0 + rebound) * vn * minNZ;
      }
      minDist = 0.0;
    }

    return { minDist, nx: minNX, ny: minNY, nz: minNZ };
  }

  _stepCarPhysics(car, dt, rawSubStepDt = dt) {
    // Handle Demolished Respawn Timer ([SPEC PATCH #14])
    if (car.demolished) {
      car.isDemolished = true;
      car.respawnTimer -= rawSubStepDt;
      if (car.respawnTimer <= 0 || this.matchState === MATCH_STATES.KICKOFF_COUNTDOWN) {
        this._respawnDemolishedCar(car);
      }
      return;
    }

    // Lock movement during KICKOFF_COUNTDOWN or MAIN_MENU (except engine revving handled in state machine)
    if (
      (this.matchState === MATCH_STATES.KICKOFF_COUNTDOWN ||
        this.matchState === MATCH_STATES.MAIN_MENU) &&
      !this.activeChoreography
    ) {
      car.velocity.x = 0;
      car.velocity.y = 0;
      car.velocity.z = 0;
      return;
    }

    updateCarBasis(car);
    const preObb = this._enforceChassisOBBContainment(car);

    const inp = car.input;
    const grav = -22.5 * clamp(safeFinite(this.mutators.gravityScale, 1.0), 0.2, 3.0);
    const boostMult = clamp(safeFinite(this.mutators.boostStrength, 1.0), 0.3, 3.0);

    // 1. Evaluate Arena SDF at Car Center of Mass
    const sdfCenter = this.evalArenaSDF(car.position.x, car.position.y, car.position.z);
    car.surfaceDist = sdfCenter.dist;
    car.surfaceType = sdfCenter.surfaceType;

    // 2. 4-Wheel Raycast Suspension & Surface-Normal Adhesion
    //    Only evaluate wheel contact rays when wheels face the surface (upDotNormal >= 0.45)
    const upDotNormal =
      car.up.x * sdfCenter.nx + car.up.y * sdfCenter.ny + car.up.z * sdfCenter.nz;
    const jumpEscaping = car.hasJumped && car.airTime < 0.14;
    let touchingWheels = 0;
    let avgSurfNX = 0, avgSurfNY = 0, avgSurfNZ = 0;

    if (sdfCenter.dist <= 1.65 && !jumpEscaping && upDotNormal >= 0.45) {
      for (let w = 0; w < 4; w++) {
        const wSpec = WHEEL_OFFSETS_LOCAL[w];
        // Transform wheel mount offset to world space
        const wx =
          car.position.x +
          car.right.x * wSpec.x +
          car.up.x * wSpec.y +
          car.forward.x * wSpec.z;
        const wy =
          car.position.y +
          car.right.y * wSpec.x +
          car.up.y * wSpec.y +
          car.forward.y * wSpec.z;
        const wz =
          car.position.z +
          car.right.z * wSpec.x +
          car.up.z * wSpec.y +
          car.forward.z * wSpec.z;

        car.wheelWorldPositions[w].x = wx;
        car.wheelWorldPositions[w].y = wy;
        car.wheelWorldPositions[w].z = wz;

        const wSdf = this.evalArenaSDF(wx, wy, wz);
        // Ray distance along local -up from wheel center to surface
        const restLength = wSpec.radius + 0.12;
        const wheelDist = wSdf.dist;
        const penetration = restLength - wheelDist;

        if (penetration > -0.28) {
          car.wheelContacts[w] = true;
          touchingWheels++;
          const targetComp = clamp(penetration, 0.0, 0.18);
          // Hooke's Law spring-damper (omega_n = 18 rad/s, zeta = 0.52)
          const kSpring = 324.0;
          const cDamp = 18.7;
          const compErr = targetComp - car.suspensionCompression[w];
          const accelComp = kSpring * compErr - cDamp * car.suspensionVelocity[w];
          car.suspensionVelocity[w] += accelComp * dt;
          car.suspensionCompression[w] = clamp(
            car.suspensionCompression[w] + car.suspensionVelocity[w] * dt,
            0.0,
            0.18
          );
          avgSurfNX += wSdf.nx;
          avgSurfNY += wSdf.ny;
          avgSurfNZ += wSdf.nz;
        } else {
          car.wheelContacts[w] = false;
          car.suspensionCompression[w] *= Math.exp(-12.0 * dt);
          car.suspensionVelocity[w] = 0;
        }
      }
    } else {
      for (let w = 0; w < 4; w++) {
        car.wheelContacts[w] = false;
        car.suspensionCompression[w] *= Math.exp(-10.0 * dt);
        car.suspensionVelocity[w] = 0;
      }
    }

    // Check if speed or surface normal supports grounded adhesion (including walls & ceiling when speed >= 16 m/s)
    const currentSpeed = Math.hypot(car.velocity.x, car.velocity.y, car.velocity.z);
    const vDotSurfaceNormal =
      car.velocity.x * sdfCenter.nx +
      car.velocity.y * sdfCenter.ny +
      car.velocity.z * sdfCenter.nz;

    const canStickToSurface =
      !jumpEscaping &&
      vDotSurfaceNormal < 3.5 &&
      sdfCenter.dist <= 1.65 &&
      upDotNormal >= 0.72 &&
      (sdfCenter.ny > 0.35 || currentSpeed >= 15.0);

    if (canStickToSurface && (touchingWheels >= 2 || sdfCenter.dist <= 1.25)) {
      const wasAirborne = !car.onGround && car.airTime > 0.18;
      car.onGround = true;
      car.isGrounded = true;
      car.airTime = 0;
      car.hasJumped = false;
      car.hasDoubleJumped = false;
      car.isFlipping = false;
      car.flipTimer = 0;
      car.flipProgress = 0;
      car.flipVerticalLockTimer = 0;

      // Landing compression impulse on all 4 struts
      if (wasAirborne) {
        for (let w = 0; w < 4; w++) {
          car.suspensionCompression[w] = clamp(car.suspensionCompression[w] + 0.11, 0, 0.18);
          car.suspensionVelocity[w] = 0.45;
        }
        car.bodyPitchVel -= 1.8;
      }

      // Compute smoothed analytical surface normal
      let snx = touchingWheels > 0 ? avgSurfNX : sdfCenter.nx;
      let sny = touchingWheels > 0 ? avgSurfNY : sdfCenter.ny;
      let snz = touchingWheels > 0 ? avgSurfNZ : sdfCenter.nz;
      const snLen = Math.hypot(snx, sny, snz) || 1;
      snx /= snLen; sny /= snLen; snz /= snLen;
      car.surfaceNormal.x = snx;
      car.surfaceNormal.y = sny;
      car.surfaceNormal.z = snz;

      // Smoothly slerp car's local up vector toward analytical surface normal (snx, sny, snz)
      const alignQuat = quatFromUnitVectors(car.up, car.surfaceNormal);
      const targetQuat = quatMultiply(alignQuat, car.quaternion);
      quatSlerp(car.quaternion, targetQuat, clamp(28.0 * dt, 0, 1), car.quaternion);
      updateCarBasis(car);

      // Maintain ride height offset (0.42m) above surface when upright without pulling tilted sidepods into the floor
      const rideHeight = 0.42;
      const distErr = rideHeight - sdfCenter.dist;
      const newUpDotN = car.up.x * snx + car.up.y * sny + car.up.z * snz;
      if (distErr > 0 || (newUpDotN >= 0.92 && Math.abs(distErr) < 1.25)) {
        car.position.x += snx * distErr * clamp(24.0 * dt, 0, 1);
        car.position.y += sny * distErr * clamp(24.0 * dt, 0, 1);
        car.position.z += snz * distErr * clamp(24.0 * dt, 0, 1);
      }
      const vDotN =
        car.velocity.x * snx + car.velocity.y * sny + car.velocity.z * snz;
      if (vDotN < 0) {
        car.velocity.x -= snx * vDotN;
        car.velocity.y -= sny * vDotN;
        car.velocity.z -= snz * vDotN;
      } else if (vDotN > 0 && currentSpeed >= 15.0) {
        // Keep car planted on curved ramp transitions (R_fillet = 8.0m) without launching off tangent
        car.velocity.x -= snx * vDotN * clamp(18.0 * dt, 0, 1);
        car.velocity.y -= sny * vDotN * clamp(18.0 * dt, 0, 1);
        car.velocity.z -= snz * vDotN * clamp(18.0 * dt, 0, 1);
      }

      // Aerodynamic Downforce proportional to forward speed (enables seamless wall & ceiling driving >= 16 m/s)
      const downforce = 14.0 + 0.65 * currentSpeed;
      car.velocity.x -= snx * downforce * dt;
      car.velocity.y -= sny * downforce * dt;
      car.velocity.z -= snz * downforce * dt;

      // Project gravity onto tangent plane (when speed >= 16 m/s on walls/ceiling, surface adhesion counters gravity slip)
      const wallAdhesionFactor = currentSpeed >= 16.0 ? 0.12 : 1.0;
      const gDotN = grav * sny;
      car.velocity.x += (0 - snx * gDotN) * wallAdhesionFactor * dt;
      car.velocity.y += (grav - sny * gDotN) * wallAdhesionFactor * dt;
      car.velocity.z += (0 - snz * gDotN) * wallAdhesionFactor * dt;

      // 3. Pacejka-Inspired Tire Slip & Handbrake Powerslide (`Shift`)
      const vLong =
        car.velocity.x * car.forward.x +
        car.velocity.y * car.forward.y +
        car.velocity.z * car.forward.z;
      const vLat =
        car.velocity.x * car.right.x +
        car.velocity.y * car.right.y +
        car.velocity.z * car.right.z;

      car.forwardSpeed = vLong;
      car.lateralSpeed = vLat;
      car.slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.5));

      car.isPowersliding = Boolean(inp.handbrake && Math.abs(vLong) > 4.0);
      car.isDrifting = car.isPowersliding || Math.abs(car.slipAngle) > 0.28;

      // Longitudinal Throttle & Coasting Braking
      let longAccel = 0;
      if (Math.abs(inp.throttle) > 0.02) {
        if (inp.throttle * vLong < -0.5) {
          // Active braking
          longAccel = inp.throttle * 38.0;
        } else {
          // Normal throttle curve: 0 -> 23 m/s (83 KPH)
          const maxThrottleSpeed = 23.0;
          const speedRatio = clamp(Math.abs(vLong) / maxThrottleSpeed, 0, 1);
          const availableTorque = Math.abs(vLong) < maxThrottleSpeed ? (1.0 - 0.65 * speedRatio) : 0.0;
          longAccel = inp.throttle * 26.0 * availableTorque;
        }
      } else {
        // Rolling resistance when throttle released
        longAccel = -Math.sign(vLong) * Math.min(Math.abs(vLong) / dt, 5.5);
      }

      // Rocket Boost (+28 m/s^2 thrust consuming 33.3 boost/sec, up to 46.0 m/s max speed)
      if (inp.boost && (car.boost > 0 || this.matchState === MATCH_STATES.FREE_PLAY)) {
        car.isBoosting = true;
        if (this.matchState !== MATCH_STATES.FREE_PLAY) {
          car.boost = Math.max(0, car.boost - 33.3 * dt);
        }
        if (vLong < 46.0) {
          longAccel += 28.0 * boostMult;
        }
      } else {
        car.isBoosting = false;
      }

      // Apply longitudinal acceleration along car.forward
      car.velocity.x += car.forward.x * longAccel * dt;
      car.velocity.y += car.forward.y * longAccel * dt;
      car.velocity.z += car.forward.z * longAccel * dt;

      // Lateral Cornering Friction (mu_lat = 2.4 normal -> 0.55 when Handbrake Shift is held)
      const muLat = car.isPowersliding ? 0.55 : 2.4;
      const gMagnitude = 22.5;
      const maxLatDelta = muLat * gMagnitude * dt;
      const latCorrection = clamp(-vLat, -maxLatDelta, maxLatDelta);
      car.velocity.x += car.right.x * latCorrection;
      car.velocity.y += car.right.y * latCorrection;
      car.velocity.z += car.right.z * latCorrection;

      // Steering Yaw Rate (increases by 1.45x during Handbrake Powerslide)
      const steerInput = clamp(inp.steer, -1, 1);
      car.steerAngle = steerInput * 0.56; // ~32 deg max wheel lock
      const speedFactor = clamp(Math.abs(vLong) / 8.0, 0.25, 1.0);
      const highSpeedDamp = 1.0 / (1.0 + 0.018 * Math.abs(vLong));
      const powerslideYawMult = car.isPowersliding ? 1.45 : 1.0;
      const reverseSign = vLong < -0.5 ? -1.0 : 1.0;
      const yawRate = steerInput * 2.65 * speedFactor * highSpeedDamp * powerslideYawMult * reverseSign;

      if (Math.abs(yawRate) > 1e-4) {
        const dqYaw = quatFromAxisAngle(
          car.surfaceNormal.x,
          car.surfaceNormal.y,
          car.surfaceNormal.z,
          yawRate * dt
        );
        quatMultiply(dqYaw, car.quaternion, car.quaternion);
        updateCarBasis(car);
      }

      car.angularVelocity.x = car.surfaceNormal.x * yawRate;
      car.angularVelocity.y = car.surfaceNormal.y * yawRate;
      car.angularVelocity.z = car.surfaceNormal.z * yawRate;

      // Coupled 2nd-Order Chassis Pitch & Roll Dynamics (zeta = 0.52, omega_n = 18 rad/s)
      const targetPitch = clamp(longAccel * 0.0022, -0.08, 0.085); // Squat/nose-up under boost, nose-dive under brake
      const targetRoll = clamp(-steerInput * (car.isPowersliding ? 0.115 : 0.055), -0.14, 0.14); // +6.5 deg powerslide roll
      const omegaN = 18.0;
      const zeta = car.isPowersliding ? 0.48 : 0.52;

      const pitchAcc =
        omegaN * omegaN * (targetPitch - car.bodyPitch) - 2 * zeta * omegaN * car.bodyPitchVel;
      car.bodyPitchVel += pitchAcc * dt;
      car.bodyPitch += car.bodyPitchVel * dt;

      const rollAcc =
        omegaN * omegaN * (targetRoll - car.bodyRoll) - 2 * zeta * omegaN * car.bodyRollVel;
      car.bodyRollVel += rollAcc * dt;
      car.bodyRoll += car.bodyRollVel * dt;

      // Distribute suspension squat/roll across the 4 struts
      const squatRear = clamp(car.bodyPitch * 0.85, -0.06, 0.09);
      const rollTransfer = clamp(car.bodyRoll * 0.75, -0.09, 0.09);
      car.suspensionCompression[0] = clamp(0.04 - squatRear + rollTransfer, 0.0, 0.18); // FL
      car.suspensionCompression[1] = clamp(0.04 - squatRear - rollTransfer, 0.0, 0.18); // FR
      car.suspensionCompression[2] = clamp(0.04 + squatRear + rollTransfer, 0.0, 0.18); // RL
      car.suspensionCompression[3] = clamp(0.04 + squatRear - rollTransfer, 0.0, 0.18); // RR

      // First Jump (`Space`) -> Fires +14.5 m/s impulse along surface normal n
      const jumpJustPressed = inp.jumpPressed || (inp.jump && !car.prevJumpInput);
      if (jumpJustPressed) {
        const jumpImpulse = 14.5;
        car.velocity.x += car.surfaceNormal.x * jumpImpulse;
        car.velocity.y += car.surfaceNormal.y * jumpImpulse;
        car.velocity.z += car.surfaceNormal.z * jumpImpulse;
        car.onGround = false;
        car.isGrounded = false;
        car.hasJumped = true;
        car.hasDoubleJumped = false;
        car.airTime = 0.001;
        car.jumpHoldTimer = 0.20; // 200ms sustained hold-force window
        inp.jumpPressed = false;
        this.emitEvent('JUMP', { carId: car.id, position: { ...car.position } });
      }
    } else {
      // ======================================================================
      // AIRBORNE & TURTLE SELF-RIGHTING DYNAMICS
      // ======================================================================
      car.onGround = false;
      car.isGrounded = false;
      car.isPowersliding = false;
      car.isDrifting = false;
      car.airTime += dt;

      // Sustained upward hold-force (+18 m/s^2) while Space remains held during first 200ms
      if (car.hasJumped && car.jumpHoldTimer > 0 && inp.jump) {
        const holdDt = Math.min(dt, car.jumpHoldTimer);
        car.jumpHoldTimer -= dt;
        car.velocity.x += car.up.x * 18.0 * holdDt;
        car.velocity.y += car.up.y * 18.0 * holdDt;
        car.velocity.z += car.up.z * 18.0 * holdDt;
      } else {
        car.jumpHoldTimer = 0;
      }

      // Gravity (with vertical velocity lock during the first 0.35s of a directional Dodge Flip)
      if (car.flipVerticalLockTimer > 0) {
        car.flipVerticalLockTimer = Math.max(0, car.flipVerticalLockTimer - dt);
        car.velocity.y *= Math.exp(-10.0 * dt);
      } else {
        car.velocity.y += grav * dt;
      }

      // Airborne Rocket Boost Thruster along car.forward
      if (inp.boost && (car.boost > 0 || this.matchState === MATCH_STATES.FREE_PLAY)) {
        car.isBoosting = true;
        if (this.matchState !== MATCH_STATES.FREE_PLAY) {
          car.boost = Math.max(0, car.boost - 33.3 * dt);
        }
        car.velocity.x += car.forward.x * 28.0 * boostMult * dt;
        car.velocity.y += car.forward.y * 28.0 * boostMult * dt;
        car.velocity.z += car.forward.z * 28.0 * boostMult * dt;
      } else {
        car.isBoosting = false;
      }

      // [SPEC PATCH #15] Rocket League Self-Righting (Turtle / Side-Roll Recovery)
      // When tilted on its side (90 deg) or upside-down (180 deg) near a surface (upDotNormal < 0.88),
      // smoothly rotate car.up toward sdfCenter.n without sinking into the floor!
      const isTiltedNearSurface =
        !car.isFlipping &&
        upDotNormal < 0.88 &&
        (preObb.minDist <= 0.25 || sdfCenter.dist <= 1.75);

      if (isTiltedNearSurface) {
        let ax = car.up.y * sdfCenter.nz - car.up.z * sdfCenter.ny;
        let ay = car.up.z * sdfCenter.nx - car.up.x * sdfCenter.nz;
        let az = car.up.x * sdfCenter.ny - car.up.y * sdfCenter.nx;
        let aLen = Math.hypot(ax, ay, az);
        if (aLen < 1e-4) {
          // 180-deg upside-down antiparallel fallback: roll around car.forward
          ax = car.forward.x;
          ay = car.forward.y;
          az = car.forward.z;
          aLen = Math.hypot(ax, ay, az) || 1.0;
        }
        ax /= aLen;
        ay /= aLen;
        az /= aLen;

        const hasRecoveryInput = Boolean(
          inp.jump ||
          inp.jumpPressed ||
          Math.abs(inp.steer) > 0.05 ||
          Math.abs(inp.throttle) > 0.05 ||
          Math.abs(inp.roll) > 0.05
        );
        const rightingRate = hasRecoveryInput ? 8.4 : 7.4;
        const dqRight = quatFromAxisAngle(ax, ay, az, rightingRate * dt);
        quatMultiply(dqRight, car.quaternion, car.quaternion);
        updateCarBasis(car);

        car.angularVelocity.x = ax * rightingRate;
        car.angularVelocity.y = ay * rightingRate;
        car.angularVelocity.z = az * rightingRate;

        const jumpJustPressed = inp.jumpPressed || (inp.jump && !car.prevJumpInput);
        if (jumpJustPressed && car.velocity.y < 2.5) {
          car.velocity.x += sdfCenter.nx * 3.2;
          car.velocity.y += sdfCenter.ny * 3.2;
          car.velocity.z += sdfCenter.nz * 3.2;
          inp.jumpPressed = false;
        }
      } else {
        // Second Jump / Directional Dodge (Flip) within 1.45s airborne window
        const jumpJustPressed = inp.jumpPressed || (inp.jump && !car.prevJumpInput);
        if (jumpJustPressed && !car.hasDoubleJumped && car.airTime > 0.04 && car.airTime < 1.45) {
          car.hasDoubleJumped = true;
          inp.jumpPressed = false;

          const dirFwd = Math.abs(inp.throttle) > 0.15 ? inp.throttle : -inp.pitch;
          const dirSide = Math.abs(inp.steer) > 0.15 ? inp.steer : inp.yaw;
          const hasDirectionalInput = Math.hypot(dirFwd, dirSide) > 0.2;

          if (hasDirectionalInput) {
            // Trigger Directional Dodge Flip!
            car.isFlipping = true;
            car.flipTimer = 0;
            car.flipDuration = 0.62;
            car.flipProgress = 0;
            car.flipVerticalLockTimer = 0.35;

            // Compute horizontal world dodge direction
            const horizFwdX = car.forward.x;
            const horizFwdZ = car.forward.z;
            const hLen = Math.hypot(horizFwdX, horizFwdZ) || 1;
            const fx = horizFwdX / hLen;
            const fz = horizFwdZ / hLen;
            const rx = -fz; // right vector in XZ
            const rz = fx;

            let dodgeX = fx * dirFwd - rx * dirSide;
            let dodgeZ = fz * dirFwd - rz * dirSide;
            const dLen = Math.hypot(dodgeX, dodgeZ) || 1;
            dodgeX /= dLen;
            dodgeZ /= dLen;

            car.flipDirection.x = dodgeX;
            car.flipDirection.y = 0;
            car.flipDirection.z = dodgeZ;

            // Inject +11.0 m/s horizontal velocity impulse along dodge direction
            car.velocity.x += dodgeX * 11.0;
            car.velocity.z += dodgeZ * 11.0;

            // Full 360-deg (2*PI) rotation over 0.62s (~10.13 rad/s)
            const normFwd = dirFwd / (Math.hypot(dirFwd, dirSide) || 1);
            const normSide = dirSide / (Math.hypot(dirFwd, dirSide) || 1);
            car.flipPitchRate = normFwd * ((Math.PI * 2.0) / car.flipDuration);
            car.flipRollRate = normSide * ((Math.PI * 2.0) / car.flipDuration);

            this.emitEvent('DODGE_FLIP', {
              carId: car.id,
              direction: { x: dodgeX, y: 0, z: dodgeZ }
            });
          } else {
            // Neutral Double-Jump: fires second upward jump impulse (+12.5 m/s)
            car.velocity.x += car.up.x * 12.5;
            car.velocity.y += car.up.y * 12.5;
            car.velocity.z += car.up.z * 12.5;
            this.emitEvent('DOUBLE_JUMP', { carId: car.id });
          }
        }

        // Active Dodge Flip 360-deg rotation vs. Sustained Aerial Pitch/Yaw/Roll Thrusters
        if (car.isFlipping) {
          car.flipTimer += dt;
          car.flipProgress = clamp(car.flipTimer / car.flipDuration, 0, 1);

          const dPitch = car.flipPitchRate * dt;
          const dRoll = car.flipRollRate * dt;
          if (Math.abs(dPitch) > 1e-5) {
            const qp = quatFromAxisAngle(car.right.x, car.right.y, car.right.z, dPitch);
            quatMultiply(qp, car.quaternion, car.quaternion);
          }
          if (Math.abs(dRoll) > 1e-5) {
            const qr = quatFromAxisAngle(car.forward.x, car.forward.y, car.forward.z, dRoll);
            quatMultiply(qr, car.quaternion, car.quaternion);
          }
          updateCarBasis(car);

          car.angularVelocity.x = car.right.x * car.flipPitchRate + car.forward.x * car.flipRollRate;
          car.angularVelocity.y = car.right.y * car.flipPitchRate + car.forward.y * car.flipRollRate;
          car.angularVelocity.z = car.right.z * car.flipPitchRate + car.forward.z * car.flipRollRate;

          if (car.flipTimer >= car.flipDuration) {
            car.isFlipping = false;
            car.flipProgress = 1;
            // Damped overshoot settle on flip completion
            car.bodyPitchVel = -1.4 * Math.sign(car.flipPitchRate || 1);
          }
        } else {
          // [SPEC PATCH #2] Ergonomic 140ms Post-Jump Pitch Deadband:
          // During the first 140ms after leaving the ground, holding W/S does NOT pitch the car nose-down into the turf!
          let pitchCmd = inp.pitch;
          if (Math.abs(pitchCmd) < 0.05 && car.airTime >= 0.14) {
            // After 140ms airborne, W (+1) pitches nose-down (+1), S (-1) pitches nose-up (-1)
            pitchCmd = inp.throttle;
          }

          const yawCmd = inp.handbrake ? 0 : (Math.abs(inp.yaw) > 0.05 ? inp.yaw : inp.steer);
          const rollCmd = Math.abs(inp.roll) > 0.05 ? inp.roll : (inp.handbrake ? inp.steer : 0);

          const pitchTorque = pitchCmd * 6.5;
          const yawTorque = yawCmd * 5.2;
          const rollTorque = rollCmd * 7.5;

          // Integrate angular velocity in world space with damping (omega_damp = 4.2/s)
          const damp = Math.exp(-4.2 * dt);
          car.angularVelocity.x =
            (car.angularVelocity.x +
              (car.right.x * pitchTorque + car.up.x * yawTorque + car.forward.x * rollTorque) * dt) *
            damp;
          car.angularVelocity.y =
            (car.angularVelocity.y +
              (car.right.y * pitchTorque + car.up.y * yawTorque + car.forward.y * rollTorque) * dt) *
            damp;
          car.angularVelocity.z =
            (car.angularVelocity.z +
              (car.right.z * pitchTorque + car.up.z * yawTorque + car.forward.z * rollTorque) * dt) *
            damp;

          const omegaMag = Math.hypot(
            car.angularVelocity.x,
            car.angularVelocity.y,
            car.angularVelocity.z
          );
          if (omegaMag > 1e-5) {
            const dq = quatFromAxisAngle(
              car.angularVelocity.x / omegaMag,
              car.angularVelocity.y / omegaMag,
              car.angularVelocity.z / omegaMag,
              omegaMag * dt
            );
            quatMultiply(dq, car.quaternion, car.quaternion);
            updateCarBasis(car);
          }
        }
      }

      // Relax visual chassis pitch/roll back to neutral while airborne
      car.bodyPitch *= Math.exp(-8.0 * dt);
      car.bodyRoll *= Math.exp(-8.0 * dt);
    }

    car.prevJumpInput = Boolean(inp.jump);

    // 4. Speed Clamping & Supersonic Threshold (42.0 m/s = 151 KPH, Max Speed = 46.0 m/s = 165 KPH)
    let speed = Math.hypot(car.velocity.x, car.velocity.y, car.velocity.z);
    if (speed > 46.0) {
      const scale = 46.0 / speed;
      car.velocity.x *= scale;
      car.velocity.y *= scale;
      car.velocity.z *= scale;
      speed = 46.0;
    }

    const wasSupersonic = car.isSupersonic;
    if (speed >= 42.0) {
      car.isSupersonic = true;
      car.supersonicTimer = 0.8;
      if (!wasSupersonic) {
        this.emitEvent('SUPERSONIC_ENTER', { carId: car.id, speedKph: Math.round(speed * 3.6) });
      }
    } else if (car.supersonicTimer > 0 && speed >= 39.5 && car.isBoosting) {
      car.supersonicTimer -= dt;
      car.isSupersonic = true;
    } else {
      car.isSupersonic = false;
      car.supersonicTimer = 0;
    }

    car.speed = speed;
    car.speedKph = speed * 3.6;
    car.forwardSpeed =
      car.velocity.x * car.forward.x +
      car.velocity.y * car.forward.y +
      car.velocity.z * car.forward.z;
    car.wheelSpinRate = car.forwardSpeed / 0.42;
    car.wheelSpinAngle = (car.wheelSpinAngle + car.wheelSpinRate * dt) % (Math.PI * 2);
    car.nozzleDilation = car.isBoosting ? 1.0 : clamp(Math.abs(car.forwardSpeed) / 30.0, 0.15, 0.65);

    // 5. Integrate Car Position & Enforce 18-Point OBB + Arena SDF Boundary Containment ([SPEC PATCH #15])
    car.position.x += car.velocity.x * dt;
    car.position.y += car.velocity.y * dt;
    car.position.z += car.velocity.z * dt;

    this._enforceChassisOBBContainment(car);

    const postSdf = this.evalArenaSDF(car.position.x, car.position.y, car.position.z);
    const minCarClearance = 0.42;
    if (postSdf.dist < minCarClearance) {
      const push = minCarClearance - postSdf.dist;
      car.position.x += postSdf.nx * push;
      car.position.y += postSdf.ny * push;
      car.position.z += postSdf.nz * push;

      const vn =
        car.velocity.x * postSdf.nx +
        car.velocity.y * postSdf.ny +
        car.velocity.z * postSdf.nz;
      if (vn < 0) {
        const rebound = car.onGround ? 0.0 : 0.18;
        car.velocity.x -= (1.0 + rebound) * vn * postSdf.nx;
        car.velocity.y -= (1.0 + rebound) * vn * postSdf.ny;
        car.velocity.z -= (1.0 + rebound) * vn * postSdf.nz;
      }
    }

    car.bodyYaw = Math.atan2(car.forward.x, car.forward.z);
  }

  // --------------------------------------------------------------------------
  // BALL PHYSICS: SWEPT SPHERE VS. ARENA SDF, ROLLING LOCK & MAGNUS LIFT ([SPEC PATCH #13])
  // --------------------------------------------------------------------------

  _stepBallPhysics(dt) {
    const ball = this.ball;
    const R = ball.radius; // 3.20m
    const grav = -20.0 * clamp(safeFinite(this.mutators.gravityScale, 1.0), 0.2, 3.0);
    const restitution = clamp(safeFinite(this.mutators.ballBounciness, 0.60), 0.2, 0.95);

    const preSdf = this.evalArenaSDF(ball.position.x, ball.position.y, ball.position.z);
    const nearSurface = preSdf.dist <= R + 0.05;

    // 1. Gravity
    ball.velocity.y += grav * dt;

    // 2. Magnus Spin Lift Force in flight: F_M = C_M * (omega x v) with C_M = 0.035
    if (!nearSurface) {
      const CM = 0.035;
      const mx =
        CM * (ball.angularVelocity.y * ball.velocity.z - ball.angularVelocity.z * ball.velocity.y);
      const my =
        CM * (ball.angularVelocity.z * ball.velocity.x - ball.angularVelocity.x * ball.velocity.z);
      const mz =
        CM * (ball.angularVelocity.x * ball.velocity.y - ball.angularVelocity.y * ball.velocity.x);
      ball.velocity.x += mx * dt;
      ball.velocity.y += my * dt;
      ball.velocity.z += mz * dt;
    }

    // 3. Light aerodynamic drag ([SPEC PATCH #13]: Math.exp(-0.045 * dt) so rolling shots carry across the pitch)
    const drag = Math.exp(-0.045 * dt);
    ball.velocity.x *= drag;
    ball.velocity.y *= drag;
    ball.velocity.z *= drag;

    // Clamp max ball speed to 60 m/s (216 KPH)
    let speed = Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z);
    if (speed > 60.0) {
      const scale = 60.0 / speed;
      ball.velocity.x *= scale;
      ball.velocity.y *= scale;
      ball.velocity.z *= scale;
      speed = 60.0;
    }

    // 4. Integrate Position
    ball.position.x += ball.velocity.x * dt;
    ball.position.y += ball.velocity.y * dt;
    ball.position.z += ball.velocity.z * dt;

    // 5. Swept Sphere Collision & Rolling-Without-Slipping Kinematics against evalArenaSDF ([SPEC PATCH #13])
    const sdf = this.evalArenaSDF(ball.position.x, ball.position.y, ball.position.z);
    const inContact = sdf.dist <= R + 0.02;
    if (sdf.dist < R) {
      const penetration = R - sdf.dist;
      ball.position.x += sdf.nx * penetration;
      ball.position.y += sdf.ny * penetration;
      ball.position.z += sdf.nz * penetration;
    }

    if (inContact) {
      const vn =
        ball.velocity.x * sdf.nx + ball.velocity.y * sdf.ny + ball.velocity.z * sdf.nz;
      if (vn < 0) {
        // Normal impulse with restitution (zero micro-bounces when |vn| < 1.35 m/s so horizontal momentum is preserved)
        const effRestitution = Math.abs(vn) < 1.35 ? 0.0 : restitution;
        ball.velocity.x -= (1.0 + effRestitution) * vn * sdf.nx;
        ball.velocity.y -= (1.0 + effRestitution) * vn * sdf.ny;
        ball.velocity.z -= (1.0 + effRestitution) * vn * sdf.nz;

        if (Math.abs(vn) > 6.0) {
          this.emitEvent('WALL_IMPACT', {
            position: {
              x: ball.position.x - sdf.nx * R,
              y: ball.position.y - sdf.ny * R,
              z: ball.position.z - sdf.nz * R
            },
            normal: { x: sdf.nx, y: sdf.ny, z: sdf.nz },
            impactSpeed: Math.abs(vn),
            surfaceType: sdf.surfaceType
          });
        }
      }

      // Decompose updated velocity into normal and tangential components
      const curVn =
        ball.velocity.x * sdf.nx + ball.velocity.y * sdf.ny + ball.velocity.z * sdf.nz;
      let vtX = ball.velocity.x - curVn * sdf.nx;
      let vtY = ball.velocity.y - curVn * sdf.ny;
      let vtZ = ball.velocity.z - curVn * sdf.nz;

      // Contact point on sphere is r_c = -R * n; rotational surface velocity is R * (omega x n).
      // True contact slip velocity: v_slip = v_t - R * (omega x n)
      const wxnX = ball.angularVelocity.y * sdf.nz - ball.angularVelocity.z * sdf.ny;
      const wxnY = ball.angularVelocity.z * sdf.nx - ball.angularVelocity.x * sdf.nz;
      const wxnZ = ball.angularVelocity.x * sdf.ny - ball.angularVelocity.y * sdf.nx;

      const slipX = vtX - R * wxnX;
      const slipY = vtY - R * wxnY;
      const slipZ = vtZ - R * wxnZ;

      // Smoothly relax initial slide into rolling spin (zero slip drag once omega == (n x v_t) / R!)
      const slipBlend = (1.0 - Math.exp(-5.0 * dt)) * 0.05;
      vtX -= slipX * slipBlend;
      vtY -= slipY * slipBlend;
      vtZ -= slipZ * slipBlend;

      // Ultra-low rolling resistance on turf/wall (0.22 m/s^2)
      const vtMag = Math.hypot(vtX, vtY, vtZ);
      if (vtMag > 1e-5) {
        const rollDecel = Math.min(vtMag, 0.22 * dt);
        const scale = (vtMag - rollDecel) / vtMag;
        vtX *= scale;
        vtY *= scale;
        vtZ *= scale;
      }

      ball.velocity.x = vtX + curVn * sdf.nx;
      ball.velocity.y = vtY + curVn * sdf.ny;
      ball.velocity.z = vtZ + curVn * sdf.nz;

      // Lock angular velocity to pure rolling: omega_roll = (n x v_t) / R
      const rollX = (sdf.ny * vtZ - sdf.nz * vtY) / R;
      const rollY = (sdf.nz * vtX - sdf.nx * vtZ) / R;
      const rollZ = (sdf.nx * vtY - sdf.ny * vtX) / R;
      const spinLock = 1.0 - Math.exp(-22.0 * dt);
      ball.angularVelocity.x += (rollX - ball.angularVelocity.x) * spinLock;
      ball.angularVelocity.y += (rollY - ball.angularVelocity.y) * spinLock;
      ball.angularVelocity.z += (rollZ - ball.angularVelocity.z) * spinLock;
    }

    // 6. Integrate Ball Orientation Quaternion from angularVelocity
    const wMag = Math.hypot(
      ball.angularVelocity.x,
      ball.angularVelocity.y,
      ball.angularVelocity.z
    );
    if (wMag > 1e-5) {
      const dq = quatFromAxisAngle(
        ball.angularVelocity.x / wMag,
        ball.angularVelocity.y / wMag,
        ball.angularVelocity.z / wMag,
        wMag * dt
      );
      quatMultiply(dq, ball.quaternion, ball.quaternion);
      if (!inContact) {
        const airSpinDamp = Math.exp(-0.08 * dt);
        ball.angularVelocity.x *= airSpinDamp;
        ball.angularVelocity.y *= airSpinDamp;
        ball.angularVelocity.z *= airSpinDamp;
      }
    }

    ball.speed = Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z);
    ball.speedKph = ball.speed * 3.6;
  }

  // --------------------------------------------------------------------------
  // PSYONIX-STYLE CAR-BALL HIT IMPULSE & MEDAL AWARDS
  // --------------------------------------------------------------------------

  _resolveCarToBallCollisions() {
    const ball = this.ball;
    const R = ball.radius; // 3.20m
    // Octane-RLX Oriented Hitbox Half-Extents: width 2.10m (hx = 1.05), height 1.40m (hy = 0.70), length 4.20m (hz = 2.10)
    const hx = 1.08;
    const hy = 0.72;
    const hz = 2.12;

    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (car.demolished) continue;

      // Hitbox center is slightly above car.position along car.up (+0.32m)
      const cx = car.position.x + car.up.x * 0.32;
      const cy = car.position.y + car.up.y * 0.32;
      const cz = car.position.z + car.up.z * 0.32;

      const dx = ball.position.x - cx;
      const dy = ball.position.y - cy;
      const dz = ball.position.z - cz;

      // Quick bounding sphere pre-reject
      if (dx * dx + dy * dy + dz * dz > (R + 2.8) * (R + 2.8)) continue;

      // Project delta into Car's local OBB axes
      const lx = dx * car.right.x + dy * car.right.y + dz * car.right.z;
      const ly = dx * car.up.x + dy * car.up.y + dz * car.up.z;
      const lz = dx * car.forward.x + dy * car.forward.y + dz * car.forward.z;

      const clampedLX = clamp(lx, -hx, hx);
      const clampedLY = clamp(ly, -hy, hy);
      const clampedLZ = clamp(lz, -hz, hz);

      // Closest point on car OBB in world space
      const closestX =
        cx + car.right.x * clampedLX + car.up.x * clampedLY + car.forward.x * clampedLZ;
      const closestY =
        cy + car.right.y * clampedLX + car.up.y * clampedLY + car.forward.y * clampedLZ;
      const closestZ =
        cz + car.right.z * clampedLX + car.up.z * clampedLZ + car.forward.z * clampedLZ;

      let nx = ball.position.x - closestX;
      let ny = ball.position.y - closestY;
      let nz = ball.position.z - closestZ;
      let dist = Math.hypot(nx, ny, nz);

      if (dist < R) {
        if (dist > 1e-5) {
          nx /= dist;
          ny /= dist;
          nz /= dist;
        } else {
          nx = car.forward.x;
          ny = 0.3;
          nz = car.forward.z;
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l; ny /= l; nz /= l;
        }

        // Separate ball from car OBB
        const overlap = R - dist + 0.04;
        ball.position.x += nx * overlap;
        ball.position.y += ny * overlap;
        ball.position.z += nz * overlap;

        // Relative velocity along contact normal
        const rvx = ball.velocity.x - car.velocity.x;
        const rvy = ball.velocity.y - car.velocity.y;
        const rvz = ball.velocity.z - car.velocity.z;
        const relVn = rvx * nx + rvy * ny + rvz * nz;

        // Psyonix-style forward-and-upward directed bias vector from car COM to ball center
        let biasX = ball.position.x - car.position.x + car.forward.x * 1.4;
        let biasY = (ball.position.y - car.position.y) * 0.45 + 0.38 * R;
        let biasZ = ball.position.z - car.position.z + car.forward.z * 1.4;
        const bLen = Math.hypot(biasX, biasY, biasZ) || 1;
        biasX /= bLen;
        biasY /= bLen;
        biasZ /= bLen;

        // Blend 55% physical contact normal + 45% Psyonix directed bias normal
        let hitDirX = nx * 0.55 + biasX * 0.45;
        let hitDirY = Math.max(0.08, ny * 0.55 + biasY * 0.45);
        let hitDirZ = nz * 0.55 + biasZ * 0.45;
        const hLen = Math.hypot(hitDirX, hitDirY, hitDirZ) || 1;
        hitDirX /= hLen;
        hitDirY /= hLen;
        hitDirZ /= hLen;

        // Check if ball was heading into defender's own goal before hit (for EPIC SAVE +75 detection)
        const ownGoalZ = car.team === 'blue' ? -100.0 : 100.0;
        const distToOwnGoal = Math.hypot(ball.position.x, ball.position.z - ownGoalZ);
        const movingTowardOwnGoal =
          (car.team === 'blue' && ball.velocity.z < -8.0) ||
          (car.team === 'orange' && ball.velocity.z > 8.0);
        const wasDangerousShot = distToOwnGoal <= 22.0 && movingTowardOwnGoal && Math.abs(ball.position.x) < 16.0;

        // Compute hit launch speed with 1.35x power multiplier when mid-Dodge-Flip or Supersonic
        const powerMultiplier = (car.isFlipping || car.isSupersonic) ? 1.35 : 1.0;
        const closingSpeed = Math.max(0, -relVn);
        const carSpeed = car.speed;
        const baseLaunch = Math.max(carSpeed * 1.15 + closingSpeed * 0.55, 14.0) * powerMultiplier;

        if (relVn < 6.0) {
          ball.velocity.x = car.velocity.x * 0.35 + hitDirX * baseLaunch;
          ball.velocity.y = Math.max(ball.velocity.y * 0.25 + hitDirY * baseLaunch, 4.5);
          ball.velocity.z = car.velocity.z * 0.35 + hitDirZ * baseLaunch;
        }

        // Impart forward rolling spin + impact spin to the ball
        ball.angularVelocity.x = ball.velocity.z / R + (car.up.y * hitDirZ - car.up.z * hitDirY) * 2.5;
        ball.angularVelocity.y += (car.forward.z * hitDirX - car.forward.x * hitDirZ) * 3.5;
        ball.angularVelocity.z = -ball.velocity.x / R + (car.right.x * hitDirY - car.right.y * hitDirX) * 2.5;

        // Subtle recoil on car
        car.velocity.x -= nx * 1.8;
        car.velocity.z -= nz * 1.8;

        // Update ball touch metadata & glowing seam color
        ball.lastTouchTeam = car.team;
        ball.lastTouchCarId = car.id;
        ball.lastTouchTime = this.simulationTime;
        ball.seamColor = car.team === 'blue' ? '#2979ff' : '#ff6d00';
        ball.speed = Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z);
        ball.speedKph = ball.speed * 3.6;

        // Trigger 45ms hit-stop on high-power flip/supersonic strikes
        if (car.isFlipping || car.isSupersonic) {
          ball.hitStopTimer = 0.045;
        }

        this.emitEvent('CAR_BALL_HIT', {
          carId: car.id,
          team: car.team,
          contactPoint: { x: closestX, y: closestY, z: closestZ },
          ballSpeedKph: Math.round(ball.speedKph),
          isPowerStrike: Boolean(car.isFlipping || car.isSupersonic)
        });

        // Emit Award Medals per Spec Section 2.3
        if (!ball.firstTouchAwarded && this.matchState === MATCH_STATES.LIVE_PLAY) {
          ball.firstTouchAwarded = true;
          this.emitEvent('AWARD', {
            type: 'FIRST TOUCH',
            label: 'FIRST TOUCH +10',
            points: 10,
            carId: car.id,
            team: car.team
          });
        }
        if (ball.position.y >= 8.5 && !car.onGround) {
          this.emitEvent('AWARD', {
            type: 'AERIAL HIT',
            label: 'AERIAL HIT +50',
            points: 50,
            carId: car.id,
            team: car.team
          });
        }
        if (wasDangerousShot) {
          this.emitEvent('AWARD', {
            type: 'EPIC SAVE',
            label: 'EPIC SAVE +75',
            points: 75,
            carId: car.id,
            team: car.team
          });
        } else {
          // Check SHOT ON GOAL +20 if ball velocity points toward opponent goal aperture
          const oppGoalZ = car.team === 'blue' ? 100.0 : -100.0;
          const dzGoal = oppGoalZ - ball.position.z;
          if (dzGoal * ball.velocity.z > 0 && Math.abs(ball.velocity.z) > 16.0) {
            const tGoal = dzGoal / ball.velocity.z;
            if (tGoal > 0 && tGoal < 3.5) {
              const predX = ball.position.x + ball.velocity.x * tGoal;
              if (Math.abs(predX) < 13.5) {
                this.emitEvent('AWARD', {
                  type: 'SHOT ON GOAL',
                  label: 'SHOT ON GOAL +20',
                  points: 20,
                  carId: car.id,
                  team: car.team
                });
              }
            }
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // CAR-ON-CAR COLLISION & SUPERSONIC DEMOLITION ([SPEC PATCH #14])
  // --------------------------------------------------------------------------

  _resolveCarToCarCollisions() {
    const minSep = 2.65;
    for (let i = 0; i < this.cars.length; i++) {
      const a = this.cars[i];
      if (a.demolished) continue;
      for (let j = i + 1; j < this.cars.length; j++) {
        const b = this.cars[j];
        if (b.demolished) continue;

        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dz = b.position.z - a.position.z;
        const dist = Math.hypot(dx, dy, dz);

        if (dist < minSep) {
          let nx = 0, ny = 0, nz = 1;
          if (dist > 1e-4) {
            nx = dx / dist;
            ny = clamp(dy / dist, -0.25, 0.25);
            nz = dz / dist;
            const nLen = Math.hypot(nx, ny, nz) || 1;
            nx /= nLen;
            ny /= nLen;
            nz /= nLen;
          } else {
            nz = a.team === 'blue' ? 1 : -1;
          }

          const relVx = a.velocity.x - b.velocity.x;
          const relVy = a.velocity.y - b.velocity.y;
          const relVz = a.velocity.z - b.velocity.z;
          const closingSpeed = relVx * nx + relVy * ny + relVz * nz;

          const speedA = Math.hypot(a.velocity.x, a.velocity.y, a.velocity.z);
          const speedB = Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z);
          const aSuper = Boolean(a.isSupersonic || speedA >= 41.5);
          const bSuper = Boolean(b.isSupersonic || speedB >= 41.5);

          // Check Supersonic Demolition (speed >= 41.5 m/s and closing speed >= 24.0 m/s against opponent)
          if (a.team !== b.team && closingSpeed >= 24.0 && (aSuper || bSuper)) {
            if (aSuper && !bSuper) {
              this._triggerDemolition(b, a);
              continue;
            } else if (bSuper && !aSuper) {
              this._triggerDemolition(a, b);
              continue;
            } else if (aSuper && bSuper) {
              // Head-on mutual supersonic impact: prioritize demolishing the AI bot (or slower car)
              if (a.isPlayer && !b.isPlayer) {
                this._triggerDemolition(b, a);
              } else if (b.isPlayer && !a.isPlayer) {
                this._triggerDemolition(a, b);
              } else if (speedA >= speedB) {
                this._triggerDemolition(b, a);
              } else {
                this._triggerDemolition(a, b);
              }
              continue;
            }
          }

          // Elastic push-apart without driving either car below floor ride height
          const push = (minSep - dist) * 0.5 + 0.01;
          a.position.x -= nx * push;
          a.position.y = Math.max(0.42, a.position.y - ny * push);
          a.position.z -= nz * push;
          b.position.x += nx * push;
          b.position.y = Math.max(0.42, b.position.y + ny * push);
          b.position.z += nz * push;

          if (closingSpeed > 0) {
            const impulse = closingSpeed * 0.65;
            a.velocity.x -= nx * impulse;
            a.velocity.y -= ny * impulse * 0.25;
            a.velocity.z -= nz * impulse;
            b.velocity.x += nx * impulse;
            b.velocity.y += ny * impulse * 0.25;
            b.velocity.z += nz * impulse;
          }
        }
      }
    }
  }

  _triggerDemolition(victim, attacker) {
    victim.demolished = true;
    victim.isDemolished = true;
    victim.respawnTimer = 2.75;
    const blastPos = { ...victim.position };
    victim.velocity.x = 0;
    victim.velocity.y = 0;
    victim.velocity.z = 0;
    victim.angularVelocity.x = 0;
    victim.angularVelocity.y = 0;
    victim.angularVelocity.z = 0;

    this.emitEvent('DEMOLITION', {
      victimId: victim.id,
      victimTeam: victim.team,
      attackerId: attacker.id,
      attackerTeam: attacker.team,
      position: blastPos
    });
    this.emitEvent('AWARD', {
      type: 'DEMOLITION',
      label: 'DEMOLITION +30',
      points: 30,
      carId: attacker.id,
      team: attacker.team
    });
  }

  // --------------------------------------------------------------------------
  // BOOST PADS & GOAL DETECTION ([SPEC PATCH #10])
  // --------------------------------------------------------------------------

  _updateBoostPads(dt) {
    for (let i = 0; i < this.boostPads.length; i++) {
      const pad = this.boostPads[i];
      if (!pad.active) {
        pad.cooldown = Math.max(0, pad.cooldown - dt);
        pad.timer = pad.cooldown;
        if (pad.cooldown <= 0) {
          pad.active = true;
        }
      }
    }
  }

  _checkBoostPadPickups() {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (car.demolished || car.boost >= 99.9) continue;

      for (let p = 0; p < this.boostPads.length; p++) {
        const pad = this.boostPads[p];
        if (!pad.active) continue;

        const dx = car.position.x - pad.x;
        const dy = car.position.y - pad.y;
        const dz = car.position.z - pad.z;
        if (dx * dx + dz * dz <= (pad.radius + 1.15) * (pad.radius + 1.15) && Math.abs(dy) < 2.8) {
          pad.active = false;
          pad.cooldown = pad.respawn;
          pad.timer = pad.respawn;
          car.boost = Math.min(100.0, car.boost + pad.boost);
          this.emitEvent('BOOST_PICKUP', {
            carId: car.id,
            padId: pad.id,
            padType: pad.type,
            boostAmount: pad.boost,
            position: { x: pad.x, y: pad.y, z: pad.z }
          });
        }
      }
    }
  }

  _checkGoalScoring() {
    if (this.goalScoredThisRally) return;
    if (
      this.matchState !== MATCH_STATES.LIVE_PLAY &&
      this.matchState !== MATCH_STATES.FREE_PLAY &&
      this.matchState !== MATCH_STATES.AUTOPILOT_SHOWCASE
    ) {
      return;
    }

    const b = this.ball;
    // [SPEC PATCH #10] When Math.abs(ball.z) >= 100.8 && Math.abs(ball.x) < 13.5 && ball.y < 10.6
    if (Math.abs(b.position.z) >= 100.8 && Math.abs(b.position.x) < 13.5 && b.position.y < 10.6) {
      const scoringTeam = b.position.z > 0 ? 'blue' : 'orange';
      this._triggerGoalExplosion(scoringTeam);
    }
  }

  _triggerGoalExplosion(scoringTeam) {
    if (this.goalScoredThisRally) return;
    this.goalScoredThisRally = true;

    if (scoringTeam === 'blue') {
      this.score.blue += 1;
    } else {
      this.score.orange += 1;
    }

    const shotSpeedKph = Math.max(
      42,
      Math.round(Math.hypot(this.ball.velocity.x, this.ball.velocity.y, this.ball.velocity.z) * 3.6)
    );
    const explosionCenter = {
      x: clamp(this.ball.position.x, -12, 12),
      y: clamp(this.ball.position.y, 2.5, 9.0),
      z: scoringTeam === 'blue' ? 102.0 : -102.0
    };

    // Apply radial supernova shockwave blast impulse (45 m/s outward + +18 m/s upward + angular tumble) to all cars!
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (car.demolished) continue;
      let rx = car.position.x - explosionCenter.x;
      let ry = car.position.y - explosionCenter.y;
      let rz = car.position.z - explosionCenter.z;
      const dist = Math.hypot(rx, ry, rz) || 1.0;
      rx /= dist;
      ry /= dist;
      rz /= dist;

      const falloff = clamp(1.25 - dist / 180.0, 0.45, 1.15);
      car.onGround = false;
      car.isGrounded = false;
      car.hasJumped = true;
      car.airTime = 0.001;
      car.velocity.x += rx * 45.0 * falloff;
      car.velocity.y = Math.max(car.velocity.y, 0) + 18.0 * falloff + Math.abs(ry) * 10.0;
      car.velocity.z += rz * 45.0 * falloff;

      // Impart dramatic mid-air tumble
      car.angularVelocity.x = (i % 2 === 0 ? 1 : -1) * 6.8;
      car.angularVelocity.y = (i % 2 === 0 ? -1 : 1) * 4.2;
      car.angularVelocity.z = 5.4;
    }

    this.lastGoalInfo = {
      scoringTeam,
      scorerCarId: this.ball.lastTouchCarId || (scoringTeam === 'blue' ? 'blue_0' : 'orange_0'),
      shotSpeedKph,
      position: explosionCenter,
      score: { ...this.score }
    };

    if (this.matchState === MATCH_STATES.FREE_PLAY) {
      this.matchState = MATCH_STATES.GOAL_CELEBRATION;
      this.stateTimer = 2.8;
    } else {
      this.matchState = MATCH_STATES.GOAL_CELEBRATION;
      this.stateTimer = 2.8;
    }

    this.emitEvent('GOAL_EXPLOSION', this.lastGoalInfo);
    this.emitEvent('GOAL_SCORED', this.lastGoalInfo);
    this.emitEvent('AWARD', {
      type: 'GOAL',
      label: `GOAL! (${shotSpeedKph} KPH)`,
      points: 100,
      team: scoringTeam,
      shotSpeedKph
    });
  }

  // --------------------------------------------------------------------------
  // COMPETITIVE UTILITY-BASED BOT AI (STRIKER & GOALIE/SUPPORT ROLES)
  // --------------------------------------------------------------------------

  _assignTeamRoles() {
    const teams = ['blue', 'orange'];
    for (let t = 0; t < teams.length; t++) {
      const teamName = teams[t];
      const teamCars = this.cars.filter(c => c.team === teamName && !c.demolished);
      if (teamCars.length === 0) continue;
      if (teamCars.length === 1) {
        teamCars[0].role = 'striker';
        continue;
      }

      // Closest car to offensive ball vector is Striker; second/others are Goalie/Support
      const oppGoalZ = teamName === 'blue' ? 100.0 : -100.0;
      let bestStriker = teamCars[0];
      let bestScore = Infinity;

      for (let i = 0; i < teamCars.length; i++) {
        const c = teamCars[i];
        const distBall = Math.hypot(
          c.position.x - this.ball.position.x,
          c.position.z - this.ball.position.z
        );
        // Prefer car that is already on its defensive side of the ball
        const onSideBonus =
          (teamName === 'blue' && c.position.z < this.ball.position.z) ||
          (teamName === 'orange' && c.position.z > this.ball.position.z)
            ? -12.0
            : 12.0;
        const metric = distBall + onSideBonus + (oppGoalZ * 0);
        if (metric < bestScore) {
          bestScore = metric;
          bestStriker = c;
        }
      }

      for (let i = 0; i < teamCars.length; i++) {
        teamCars[i].role = teamCars[i] === bestStriker ? 'striker' : 'goalie';
      }
    }
  }

  _updateBotAI(car, dt) {
    return this.updateBotAI(car, dt);
  }

  updateBotAI(car, dt) {
    updateCarBasis(car);

    const diff = String(this.mutators.botDifficulty || 'pro').toLowerCase();
    const skillHorizon = diff === 'all-star' || diff === 'allstar' ? 1.0 : diff === 'pro' ? 0.78 : 0.48;
    const allowBoost = diff !== 'rookie';

    const oppGoalZ = car.team === 'blue' ? 102.0 : -102.0;
    const ownGoalZ = car.team === 'blue' ? -100.0 : 100.0;

    const ballX = this.ball.position.x;
    const ballY = this.ball.position.y;
    const ballZ = this.ball.position.z;
    const ballVx = this.ball.velocity.x;
    const ballVy = this.ball.velocity.y;
    const ballVz = this.ball.velocity.z;
    const ballSpeed = Math.hypot(ballVx, ballVy, ballVz);

    const carSpeed = Math.hypot(car.velocity.x, car.velocity.y, car.velocity.z);
    const vLong =
      car.velocity.x * car.forward.x +
      car.velocity.y * car.forward.y +
      car.velocity.z * car.forward.z;

    const distToBall = Math.hypot(ballX - car.position.x, ballZ - car.position.z);

    // Lead time shrinks smoothly as the car closes within 12m so the strike connects cleanly through ball center
    const rawLead = clamp((distToBall / Math.max(18.0, carSpeed)) * skillHorizon, 0.04, 0.55);
    const closeBlend = clamp((distToBall - 4.5) / 8.5, 0.05, 1.0);
    const tLead = rawLead * closeBlend;

    const predBallX = clamp(ballX + ballVx * tLead, -54.0, 54.0);
    const predBallZ = clamp(ballZ + ballVz * tLead, -96.0, 96.0);

    // Unit shot vector u_shot from predBall to opponent goal target
    const aimGoalX = clamp(predBallX * 0.25, -8.0, 8.0);
    let uShotX = aimGoalX - predBallX;
    let uShotZ = oppGoalZ - predBallZ;
    const shotLen = Math.hypot(uShotX, uShotZ) || 1.0;
    uShotX /= shotLen;
    uShotZ /= shotLen;

    // Unit vector from car to predBall & alignment with shot vector
    let uCarToBallX = predBallX - car.position.x;
    let uCarToBallZ = predBallZ - car.position.z;
    const c2bLen = Math.hypot(uCarToBallX, uCarToBallZ) || 1.0;
    uCarToBallX /= c2bLen;
    uCarToBallZ /= c2bLen;

    const align = uCarToBallX * uShotX + uCarToBallZ * uShotZ;

    // Direct angle to actual ball center
    const dxBall = ballX - car.position.x;
    const dzBall = ballZ - car.position.z;
    const fwdBall = dxBall * car.forward.x + dzBall * car.forward.z;
    const rightBall = dxBall * car.right.x + dzBall * car.right.z;
    const angleToBall = Math.atan2(rightBall, fwdBall);

    let targetX = predBallX;
    let targetZ = predBallZ;
    let tacticalState = 'DIRECT_STRIKE';
    let shouldDodgeStrike = false;

    const isKickoffBall = Math.abs(ballX) < 3.5 && Math.abs(ballZ) < 3.5 && ballSpeed < 4.0;

    if (car.role === 'goalie' && this.cars.length > 2) {
      // Multi-car 2v2/3v3 support goalie: clear if close to own goal or ball is in defensive third, else shadow
      const ballDistToOwnGoal = Math.hypot(ballX, ballZ - ownGoalZ);
      if (ballDistToOwnGoal < 48.0 || distToBall < 24.0) {
        tacticalState = 'DIRECT_STRIKE';
        targetX = predBallX + uShotX * 0.6;
        targetZ = predBallZ + uShotZ * 0.6;
        if (distToBall <= 8.5 && Math.abs(angleToBall) < 0.35 && ballY < 4.6 && vLong > 12.5 && align > -0.1) {
          shouldDodgeStrike = true;
        }
      } else {
        tacticalState = 'SHADOW_DEFEND';
        targetX = clamp(predBallX * 0.45, -16.0, 16.0);
        targetZ = ownGoalZ * 0.58 + predBallZ * 0.42;
      }
    } else if (isKickoffBall && align > 0.15) {
      // State 1 — KICKOFF_BLITZ: Aim directly at ball.position (offset = 0) with full boost
      tacticalState = 'KICKOFF_BLITZ';
      car._bypassSide = 0;
      targetX = ballX;
      targetZ = ballZ;
      if (distToBall >= 5.2 && distToBall <= 8.5 && Math.abs(angleToBall) < 0.32 && ballY < 4.6 && vLong > 13.0) {
        shouldDodgeStrike = true;
      }
    } else if (align > -0.15) {
      // State 2 — DIRECT_STRIKE: Car is on the attacking side (or perpendicular at close range)
      tacticalState = 'DIRECT_STRIKE';
      car._bypassSide = 0;

      if (distToBall < 10.5 || align > 0.65) {
        // Drive straight through the center of the ball toward opponent goal (zero orbit offset!)
        targetX = predBallX + uShotX * 0.8;
        targetZ = predBallZ + uShotZ * 0.8;
      } else {
        const alignClamped = clamp(align, 0.0, 1.0);
        const dOff = clamp(0.20 * distToBall, 0.0, 3.8) * (1.0 - alignClamped) * (1.0 - alignClamped);
        targetX = predBallX - uShotX * dOff;
        targetZ = predBallZ - uShotZ * dOff;
      }

      // Optional inline boost pad pickup ONLY if directly along the path to the ball (< 18 deg)
      if (car.boost < 25 && distToBall > 18.0) {
        const toTargetX = targetX - car.position.x;
        const toTargetZ = targetZ - car.position.z;
        const toTargetLen = Math.hypot(toTargetX, toTargetZ) || 1.0;
        for (let p = 0; p < this.boostPads.length; p++) {
          const pad = this.boostPads[p];
          if (!pad.active) continue;
          const pdx = pad.x - car.position.x;
          const pdz = pad.z - car.position.z;
          const pDist = Math.hypot(pdx, pdz);
          if (pDist > 1.5 && pDist < 10.0) {
            const dot = (pdx * toTargetX + pdz * toTargetZ) / (pDist * toTargetLen);
            if (dot > 0.92) {
              targetX = pad.x;
              targetZ = pad.z;
              break;
            }
          }
        }
      }

      if (
        distToBall >= 5.2 &&
        distToBall <= 8.5 &&
        Math.abs(angleToBall) < 0.34 &&
        ballY < 4.6 &&
        vLong > 13.0 &&
        align > 0.15
      ) {
        shouldDodgeStrike = true;
      }
    } else {
      // State 3 — WRONG_SIDE_BYPASS_OR_SAVE (align <= -0.15: car is between ball and opponent goal)
      tacticalState = 'WRONG_SIDE_BYPASS_OR_SAVE';
      const inOwnDefensiveThird = car.team === 'blue' ? predBallZ < -48.0 : predBallZ > 48.0;
      const movingTowardOwnGoal = (car.team === 'blue' ? ballVz < -3.0 : ballVz > 3.0);

      if (inOwnDefensiveThird && movingTowardOwnGoal && Math.abs(car.position.x - predBallX) > 4.0) {
        // Emergency defensive block/clear between ball and own goal mouth
        targetX = predBallX - uShotX * 1.2;
        targetZ = predBallZ - uShotZ * 1.2;
      } else {
        // Tangential bypass waypoint so the car sweeps wide around the ball without hitting it backward
        const perpX = -uShotZ;
        const perpZ = uShotX;
        const relX = car.position.x - predBallX;
        const relZ = car.position.z - predBallZ;
        const latProj = relX * perpX + relZ * perpZ;

        if (!car._bypassSide) {
          if (Math.abs(latProj) > 0.6) {
            car._bypassSide = latProj >= 0 ? 1 : -1;
          } else {
            const fwdLat = car.forward.x * perpX + car.forward.z * perpZ;
            car._bypassSide = fwdLat >= 0 ? 1 : -1;
          }
        }

        // Keep away from side walls when choosing bypass side
        if (Math.abs(predBallX + car._bypassSide * perpX * 6.5) > 48.0) {
          car._bypassSide = -car._bypassSide;
        }

        targetX = predBallX - uShotX * 5.2 + car._bypassSide * perpX * 6.5;
        targetZ = predBallZ - uShotZ * 5.2 + car._bypassSide * perpZ * 6.5;
      }
    }

    // Clamp target within playable interior
    targetX = clamp(targetX, -52.0, 52.0);
    targetZ = clamp(targetZ, -95.0, 95.0);

    // [SPEC PATCH #14] Goal-chamber escape navigation: if inside either goal recess (|z| > 95m),
    // steer directly toward the center of the goal aperture (x = 0) first.
    if (Math.abs(car.position.z) > 95.0) {
      targetX = 0.0;
      targetZ = Math.sign(car.position.z) * 84.0;
      shouldDodgeStrike = false;
      car._reversingJTurn = false;
    }

    // ========================================================================
    // VERIFIED LOCAL STEERING ANGLE & ANTI-ORBIT KINEMATIC CONTROLLER
    // ========================================================================
    // In PhysicsWorld, car.up x car.forward = +car.right, and positive yawRate
    // (steerInput > 0 when driving forward) rotates car.forward toward +car.right.
    // Therefore steer = +angleToTarget ALWAYS reduces |angleToTarget|!
    const dx = targetX - car.position.x;
    const dz = targetZ - car.position.z;
    const forwardDist = dx * car.forward.x + dz * car.forward.z;
    const rightDist = dx * car.right.x + dz * car.right.z;
    const D = Math.hypot(forwardDist, rightDist);
    const angleToTarget = Math.atan2(rightDist, forwardDist);
    const absTheta = Math.abs(angleToTarget);
    const steerDir = angleToTarget >= 0 ? 1.0 : -1.0;

    // Manage Reverse J-Turn hysteresis state (Case A)
    if (
      absTheta > 2.02 &&
      D < 11.0 &&
      vLong < 7.0 &&
      tacticalState !== 'KICKOFF_BLITZ' &&
      Math.abs(car.position.z) <= 95.0
    ) {
      car._reversingJTurn = true;
    } else if (car._reversingJTurn && (absTheta < 1.05 || D > 13.5)) {
      car._reversingJTurn = false;
    }

    if (car._reversingJTurn) {
      // Case A — Reverse J-Turn: back up and invert steer when vLong < -0.5 so nose swings toward target
      car.input.throttle = -1.0;
      car.input.steer = vLong < -0.5 ? -steerDir : steerDir;
      car.input.boost = false;
      car.input.handbrake = false;
    } else if (absTheta > 0.72 && vLong > 5.5) {
      // Case B — Sharp Turn / Powerslide Snap-Turn (|theta| > 41 deg and v_f > 5.5 m/s)
      // Engage handbrake powerslide (1.45x yaw rate) and modulate throttle/brake to whip nose around without orbiting
      car.input.steer = clamp(angleToTarget * 3.2, -1.0, 1.0);
      car.input.handbrake = true;
      car.input.boost = false;
      if (D < 16.0 && vLong > 10.5) {
        // Active brake while powersliding to shed tangential orbit speed into tight turning radius
        car.input.throttle = -0.75;
      } else {
        car.input.throttle = absTheta > 1.35 ? 0.38 : 0.55;
      }
    } else if (D < 16.0 && absTheta > 0.52) {
      // Case C — Inside Turning Circle Anti-Orbit Guard (D < 16.0m and |theta| > 30 deg)
      car.input.steer = clamp(angleToTarget * 3.0, -1.0, 1.0);
      car.input.boost = false;
      car.input.handbrake = Boolean(absTheta > 0.65 && vLong > 4.5);
      if (vLong > 9.5) {
        car.input.throttle = -0.35;
      } else {
        car.input.throttle = Math.max(0.26, 0.75 * (1.0 - absTheta / Math.PI));
      }
    } else {
      // Case D — Lined Up on Target (|theta| <= 30 deg or long-range approach)
      car.input.steer = clamp(angleToTarget * 2.8, -1.0, 1.0);
      car.input.handbrake = false;
      car.input.throttle = 1.0;
      car.input.boost = Boolean(
        allowBoost &&
        absTheta < 0.28 &&
        (D > 6.5 || tacticalState === 'KICKOFF_BLITZ' || tacticalState === 'DIRECT_STRIKE') &&
        car.boost > 6.0 &&
        car.onGround
      );
    }

    // State 4 — FRONT_FLIP_DODGE_STRIKE Execution (and completing any active airborne flip)
    if (!car.onGround && car.hasJumped && !car.hasDoubleJumped && car.airTime >= 0.08 && car.airTime <= 0.42) {
      car.input.throttle = 1.0;
      car.input.steer = 0.0;
      car.input.pitch = 0.0;
      car.input.jump = true;
      car.input.jumpPressed = true;
    } else if (shouldDodgeStrike && car.onGround) {
      car.input.jump = true;
      car.input.jumpPressed = true;
    } else {
      car.input.jump = false;
      car.input.jumpPressed = false;
    }
  }

  // --------------------------------------------------------------------------
  // 4-PHASE KINEMATIC CHOREOGRAPHER (t0..t3), TELEMETRY & AUTOPILOT
  // --------------------------------------------------------------------------

  triggerMovement(movementId) {
    const manifestEntry =
      MOVEMENTS_MANIFEST.find(m => m.id === movementId) ||
      MOVEMENTS_MANIFEST[Number(movementId) - 1] ||
      MOVEMENTS_MANIFEST[0];

    // Ensure at least 1v1 cars exist so both Blue and Orange cars participate in showcase
    if (this.cars.length < 2) {
      this.populateCars('1v1');
    }

    const id = manifestEntry.id;
    const hero = this.playerCar || this.cars[0];
    const opp = this.cars.find(c => c.team === 'orange') || this.cars[1] || null;

    this.goalScoredThisRally = false;
    this.matchState = MATCH_STATES.AUTOPILOT_SHOWCASE;
    this.stateTimer = 0;

    // Configure deterministic initial conditions for each movement so all 4 phases (t0..t3) execute cleanly
    if (id === 'm1_supersonic_boost_blitz') {
      this._resetCarPose(hero, 0.0, 0.42, -55.0, 0.0, 100.0);
      hero.velocity.z = 16.0;
      this.ball.position.x = 0.0;
      this.ball.position.y = 3.20;
      this.ball.position.z = 42.0;
      this.ball.velocity.x = 0; this.ball.velocity.y = 0; this.ball.velocity.z = 0;
      if (opp) this._resetCarPose(opp, -24.0, 0.42, 48.0, Math.PI, 50.0);
    } else if (id === 'm2_powerslide_drift_hook') {
      this._resetCarPose(hero, -18.0, 0.42, -25.0, 0.0, 100.0);
      hero.velocity.z = 34.0;
      this.ball.position.x = 12.0;
      this.ball.position.y = 3.20;
      this.ball.position.z = 10.0;
      this.ball.velocity.x = 0; this.ball.velocity.y = 0; this.ball.velocity.z = 0;
      if (opp) this._resetCarPose(opp, 26.0, 0.42, 35.0, Math.PI, 50.0);
    } else if (id === 'm3_double_jump_front_flip_strike') {
      this._resetCarPose(hero, 0.0, 0.42, -16.0, 0.0, 100.0);
      hero.velocity.z = 22.0;
      this.ball.position.x = 0.0;
      this.ball.position.y = 4.20;
      this.ball.position.z = 4.5;
      this.ball.velocity.x = 0; this.ball.velocity.y = 1.2; this.ball.velocity.z = 2.0;
      if (opp) this._resetCarPose(opp, -18.0, 0.42, 55.0, Math.PI, 50.0);
    } else if (id === 'm4_aerial_pitch_thruster_flight') {
      this._resetCarPose(hero, 0.0, 0.42, -22.0, 0.0, 100.0);
      hero.velocity.z = 20.0;
      this.ball.position.x = 0.0;
      this.ball.position.y = 16.5;
      this.ball.position.z = 24.0;
      this.ball.velocity.x = 0; this.ball.velocity.y = 4.5; this.ball.velocity.z = 3.0;
      if (opp) this._resetCarPose(opp, 16.0, 0.42, 65.0, Math.PI, 50.0);
    } else if (id === 'm5_goal_explosion_shockwave') {
      this._resetCarPose(hero, 0.0, 0.42, 74.0, 0.0, 100.0);
      hero.velocity.z = 28.0;
      if (opp) {
        this._resetCarPose(opp, 9.5, 0.42, 86.0, Math.PI * 0.85, 50.0);
      }
      this.ball.position.x = 0.0;
      this.ball.position.y = 4.0;
      this.ball.position.z = 97.5;
      this.ball.velocity.x = 0.0;
      this.ball.velocity.y = 1.5;
      this.ball.velocity.z = 36.0;
      this.ball.lastTouchTeam = 'blue';
      this.ball.lastTouchCarId = hero.id;
      this.ball.seamColor = '#2979ff';
    }

    this.activeChoreography = {
      id,
      manifest: manifestEntry,
      elapsedMs: 0,
      durationMs: manifestEntry.duration_ms,
      currentPhase: 't0_anticipation',
      phaseProgress: 0,
      stageFlags: {}
    };

    this._updateChoreographyTelemetry();
    return this.activeChoreography;
  }

  startAutopilot() {
    this.autopilotActive = true;
    this.autopilotQueue = [
      'm1_supersonic_boost_blitz',
      'm2_powerslide_drift_hook',
      'm3_double_jump_front_flip_strike',
      'm4_aerial_pitch_thruster_flight',
      'm5_goal_explosion_shockwave'
    ];
    this.telemetry.frameHistory = [];
    const firstId = this.autopilotQueue.shift();
    this.triggerMovement(firstId);
    return this.telemetry;
  }

  _stepChoreography(dt) {
    const ch = this.activeChoreography;
    if (!ch) return;

    const hero = this.playerCar || this.cars[0];
    ch.elapsedMs += dt * 1000.0;
    const tMs = ch.elapsedMs;

    // Determine active phase from manifest window_ms
    const phases = ch.manifest.phases;
    let activePhaseName = 't3_overshoot_settle';
    let phaseProg = 1.0;

    const phaseKeys = [
      't0_anticipation',
      't1_primary_drive',
      't2_apex_secondary',
      't3_overshoot_settle'
    ];
    for (let i = 0; i < phaseKeys.length; i++) {
      const k = phaseKeys[i];
      const win = phases[k].window_ms;
      if (tMs >= win[0] && tMs <= win[1]) {
        activePhaseName = k;
        phaseProg = clamp((tMs - win[0]) / Math.max(1, win[1] - win[0]), 0, 1);
        break;
      }
    }
    ch.currentPhase = activePhaseName;
    ch.phaseProgress = phaseProg;

    // Reset hero inputs before applying phase-specific choreography
    hero.input.throttle = 0;
    hero.input.steer = 0;
    hero.input.jump = false;
    hero.input.jumpPressed = false;
    hero.input.boost = false;
    hero.input.handbrake = false;
    hero.input.pitch = 0;
    hero.input.yaw = 0;
    hero.input.roll = 0;

    // Execute movement-specific 4-phase physical curves
    if (ch.id === 'm1_supersonic_boost_blitz') {
      if (activePhaseName === 't0_anticipation') {
        // Rear suspension squats -0.09m, chassis pitches nose-up +3.8 deg (0.066 rad), nozzle iris dilates
        hero.input.throttle = 1.0;
        hero.input.boost = true;
        hero.bodyPitch = 0.066 * Math.sin(phaseProg * Math.PI * 0.5);
        hero.suspensionCompression = [0.02, 0.02, 0.13, 0.13];
        hero.nozzleDilation = 0.85 + 0.15 * phaseProg;
      } else if (activePhaseName === 't1_primary_drive') {
        // Continuous +28 m/s^2 rocket thrust accelerating past 42 m/s Supersonic threshold
        hero.input.throttle = 1.0;
        hero.input.boost = true;
        hero.boost = 100.0;
        if (hero.velocity.z < 43.5) {
          hero.velocity.z += 24.0 * dt;
        }
        hero.bodyPitch = 0.058;
        hero.suspensionCompression = [0.02, 0.02, 0.12, 0.12];
      } else if (activePhaseName === 't2_apex_secondary') {
        // Peak Supersonic cruise at 44.5 m/s (160 KPH) with Mach shock cone & wheel plasma ribbons
        hero.input.throttle = 1.0;
        hero.input.boost = true;
        hero.boost = 100.0;
        hero.velocity.z = Math.max(hero.velocity.z, 44.5);
        hero.isSupersonic = true;
        hero.bodyPitch = 0.045;
      } else {
        // t3_overshoot_settle: Throttle release triggers nose-dive pitch overshoot (-2.4 deg = -0.042 rad) & harmonic recovery
        hero.input.throttle = 0.0;
        hero.input.boost = false;
        const osc = Math.exp(-3.2 * phaseProg) * Math.cos(phaseProg * Math.PI * 2.5);
        hero.bodyPitch = -0.042 * osc;
        hero.suspensionCompression = [
          clamp(0.06 + 0.05 * osc, 0, 0.18),
          clamp(0.06 + 0.05 * osc, 0, 0.18),
          clamp(0.04 - 0.03 * osc, 0, 0.18),
          clamp(0.04 - 0.03 * osc, 0, 0.18)
        ];
      }
    } else if (ch.id === 'm2_powerslide_drift_hook') {
      if (activePhaseName === 't0_anticipation') {
        // Front wheels snap to 32 deg steer lock, outer strut compresses -0.11m, chassis rolls +6.5 deg (0.113 rad)
        hero.input.throttle = 1.0;
        hero.input.steer = -1.0;
        hero.input.handbrake = true;
        hero.steerAngle = -0.56;
        hero.bodyRoll = 0.113 * phaseProg;
        hero.suspensionCompression = [0.15, 0.02, 0.12, 0.03];
      } else if (activePhaseName === 't1_primary_drive') {
        // Wide 110-deg slip-angle yaw arc while maintaining tangential momentum
        hero.input.throttle = 1.0;
        hero.input.steer = -1.0;
        hero.input.handbrake = true;
        hero.isPowersliding = true;
        hero.isDrifting = true;
        hero.bodyRoll = 0.115;
        hero.suspensionCompression = [0.15, 0.02, 0.14, 0.02];
      } else if (activePhaseName === 't2_apex_secondary') {
        // Peak 48-deg slip angle with counter-steer wheel lock, tire smoke & rim sparks
        hero.input.throttle = 1.0;
        hero.input.steer = 0.65; // Counter-steer lock!
        hero.input.handbrake = true;
        hero.isPowersliding = true;
        hero.isDrifting = true;
        hero.steerAngle = 0.48;
        hero.bodyRoll = 0.095;
      } else {
        // t3_overshoot_settle: Handbrake release snaps grip back with damped roll sway oscillation (zeta = 0.48)
        hero.input.throttle = 1.0;
        hero.input.steer = 0.0;
        hero.input.handbrake = false;
        const sway = Math.exp(-3.0 * phaseProg) * Math.sin(phaseProg * Math.PI * 3.0);
        hero.bodyRoll = 0.08 * sway;
      }
    } else if (ch.id === 'm3_double_jump_front_flip_strike') {
      if (activePhaseName === 't0_anticipation') {
        // All 4 suspension struts compress -0.12m before firing primary vertical jump impulse (+14.5 m/s)
        hero.input.throttle = 1.0;
        if (phaseProg < 0.55) {
          hero.suspensionCompression = [0.14, 0.14, 0.14, 0.14];
          hero.bodyPitch = -0.05;
        } else if (!ch.stageFlags.jumped) {
          ch.stageFlags.jumped = true;
          hero.input.jump = true;
          hero.input.jumpPressed = true;
        } else {
          hero.input.jump = true;
        }
      } else if (activePhaseName === 't1_primary_drive') {
        // Second directional dodge input initiates rapid 360-deg forward pitch flip + +11 m/s lunge toward ball
        hero.input.throttle = 1.0;
        if (!ch.stageFlags.flipped) {
          ch.stageFlags.flipped = true;
          hero.hasDoubleJumped = false;
          hero.airTime = 0.22;
          hero.input.jump = true;
          hero.input.jumpPressed = true;
          // Guide ball directly into strike apex so nose splitter connects cleanly at t2
          this.ball.position.x = hero.position.x;
          this.ball.position.y = hero.position.y + 1.8;
          this.ball.position.z = hero.position.z + 5.2;
          this.ball.velocity.x = 0;
          this.ball.velocity.y = 0.5;
          this.ball.velocity.z = hero.velocity.z * 0.55;
        }
      } else if (activePhaseName === 't2_apex_secondary') {
        // Nose splitter strikes soccer ball at flip apex: 115+ KPH ball launch
        if (!ch.stageFlags.struck && this.ball.speedKph < 115) {
          ch.stageFlags.struck = true;
          this.ball.velocity.x = 0.0;
          this.ball.velocity.y = 9.5;
          this.ball.velocity.z = 36.0; // > 130 KPH power shot
          this.ball.speed = Math.hypot(0, 9.5, 36.0);
          this.ball.speedKph = this.ball.speed * 3.6;
          this.ball.lastTouchTeam = 'blue';
          this.ball.lastTouchCarId = hero.id;
          this.ball.seamColor = '#2979ff';
          this.emitEvent('CAR_BALL_HIT', {
            carId: hero.id,
            team: 'blue',
            contactPoint: { ...this.ball.position },
            ballSpeedKph: Math.round(this.ball.speedKph),
            isPowerStrike: true
          });
        }
      } else {
        // t3_overshoot_settle: 4 wheels touch down on turf compressing struts to max travel before harmonic rebound
        hero.input.throttle = 0.8;
        if (hero.onGround) {
          const bounce = Math.exp(-3.5 * phaseProg) * Math.sin(phaseProg * Math.PI * 2.5);
          const comp = clamp(0.08 + 0.08 * Math.abs(bounce), 0.02, 0.18);
          hero.suspensionCompression = [comp, comp, comp, comp];
          hero.bodyPitch = -0.05 * bounce;
        }
      }
    } else if (ch.id === 'm4_aerial_pitch_thruster_flight') {
      if (activePhaseName === 't0_anticipation') {
        // Launch jump combined with immediate nose-up pitch rotation (+52 deg = -0.90 rad pitch)
        if (!ch.stageFlags.aerialJump) {
          ch.stageFlags.aerialJump = true;
          hero.input.jump = true;
          hero.input.jumpPressed = true;
        } else {
          hero.input.jump = true;
        }
        hero.input.pitch = -1.0; // Pull nose up
        hero.input.boost = true;
        const targetPitchQuat = quatFromAxisAngle(1, 0, 0, -0.88 * phaseProg);
        hero.quaternion = targetPitchQuat;
        updateCarBasis(hero);
      } else if (activePhaseName === 't1_primary_drive') {
        // Sustained rocket boost lifts battle-car along steep 3D climbing parabola up to Y = 18m
        hero.input.boost = true;
        hero.boost = 100.0;
        const pitchAngle = -0.85 + 0.25 * phaseProg;
        hero.quaternion = quatFromAxisAngle(1, 0, 0, pitchAngle);
        updateCarBasis(hero);
        hero.velocity.x = 0;
        hero.velocity.y = 14.5 * (1.0 - 0.35 * phaseProg);
        hero.velocity.z = 26.0;
        // Keep airborne ball on intercept trajectory at Y ~ 17..19m
        this.ball.position.x = hero.position.x;
        this.ball.position.y = Math.max(hero.position.y + 2.4, 16.5);
        this.ball.position.z = hero.position.z + 4.8 * (1.0 - phaseProg * 0.75);
      } else if (activePhaseName === 't2_apex_secondary') {
        // Mid-air barrel-roll alignment (Air-Roll) & high-altitude nose redirect + 'AERIAL HIT +50' medal
        hero.input.boost = true;
        hero.input.roll = 1.0;
        const rollAngle = phaseProg * Math.PI * 1.25;
        const qPitch = quatFromAxisAngle(1, 0, 0, -0.42);
        const qRoll = quatFromAxisAngle(0, 0, 1, rollAngle);
        hero.quaternion = quatMultiply(qPitch, qRoll);
        updateCarBasis(hero);

        if (!ch.stageFlags.aerialRedirect) {
          ch.stageFlags.aerialRedirect = true;
          this.ball.velocity.x = 0.0;
          this.ball.velocity.y = -4.0;
          this.ball.velocity.z = 42.0;
          this.ball.lastTouchTeam = 'blue';
          this.ball.lastTouchCarId = hero.id;
          this.ball.seamColor = '#2979ff';
          this.emitEvent('AWARD', {
            type: 'AERIAL HIT',
            label: 'AERIAL HIT +50',
            points: 50,
            carId: hero.id,
            team: 'blue'
          });
        }
      } else {
        // t3_overshoot_settle: Graceful banked descent back to pitch with progressive 4-wheel suspension compression
        const settleQ = quatIdentity();
        quatSlerp(hero.quaternion, settleQ, clamp(8.0 * dt, 0, 1), hero.quaternion);
        updateCarBasis(hero);
        hero.bodyRoll = 0.06 * Math.cos(phaseProg * Math.PI * 2.0) * (1.0 - phaseProg);
      }
    } else if (ch.id === 'm5_goal_explosion_shockwave') {
      if (activePhaseName === 't0_anticipation') {
        // Ball crosses laser goal curtain; time dilates to 0.35x as ball compresses into singularity core
        hero.input.throttle = 1.0;
        hero.input.boost = true;
        if (this.ball.position.z < 100.5) {
          this.ball.position.z += 20.0 * dt;
        }
      } else if (activePhaseName === 't1_primary_drive') {
        // Supernova plasma detonation + radial shockwave impulse (45 m/s) launching all cars airborne
        if (!this.goalScoredThisRally) {
          this.ball.position.z = 101.5;
          this._triggerGoalExplosion('blue');
        }
      } else if (activePhaseName === 't2_apex_secondary') {
        // Blasted cars soar and tumble in mid-air while crowd light-sticks erupt
        hero.bodyPitch = 0.25 * Math.sin(phaseProg * Math.PI * 2);
        hero.bodyRoll = 0.22 * Math.cos(phaseProg * Math.PI * 2);
      } else {
        // t3_overshoot_settle: Blasted cars settle across pitch
        const settleQ = quatIdentity();
        quatSlerp(hero.quaternion, settleQ, clamp(5.0 * dt, 0, 1), hero.quaternion);
        updateCarBasis(hero);
      }
    }

    this._updateChoreographyTelemetry();

    // Advance Autopilot Queue if current movement completed its duration
    if (ch.elapsedMs >= ch.durationMs) {
      if (this.autopilotActive && this.autopilotQueue.length > 0) {
        const nextId = this.autopilotQueue.shift();
        this.triggerMovement(nextId);
      } else {
        this.activeChoreography = null;
        if (this.autopilotActive) {
          this.autopilotActive = false;
          // Transition smoothly into competitive AI showcase play
          this.resetKickoff();
          this.matchState = MATCH_STATES.LIVE_PLAY;
          this.stateTimer = 0;
        }
      }
    }
  }

  _updateChoreographyTelemetry() {
    const hero = this.playerCar || this.cars[0];
    if (!hero) return;

    const ch = this.activeChoreography;
    const pitchDeg = Number(((hero.bodyPitch + Math.asin(clamp(hero.forward.y, -1, 1))) * (180 / Math.PI)).toFixed(2));
    const rollDeg = Number(((hero.bodyRoll + Math.asin(clamp(-hero.right.y, -1, 1))) * (180 / Math.PI)).toFixed(2));
    const yawDeg = Number((Math.atan2(hero.forward.x, hero.forward.z) * (180 / Math.PI)).toFixed(2));

    this.telemetry.activeMovementId = ch ? ch.id : null;
    this.telemetry.currentPhase = ch ? ch.currentPhase : 'live_play';
    this.telemetry.phaseProgress = ch ? Number(ch.phaseProgress.toFixed(3)) : 0;
    this.telemetry.velocity = {
      x: Number(hero.velocity.x.toFixed(3)),
      y: Number(hero.velocity.y.toFixed(3)),
      z: Number(hero.velocity.z.toFixed(3))
    };
    this.telemetry.speedKph = Number(hero.speedKph.toFixed(1));
    this.telemetry.angularVelocity = {
      x: Number(hero.angularVelocity.x.toFixed(3)),
      y: Number(hero.angularVelocity.y.toFixed(3)),
      z: Number(hero.angularVelocity.z.toFixed(3))
    };
    this.telemetry.bodyPitchRollYaw = {
      pitch: pitchDeg,
      roll: rollDeg,
      yaw: yawDeg
    };
    this.telemetry.suspensionCompression = hero.suspensionCompression.map(v =>
      Number(v.toFixed(4))
    );
    this.telemetry.secondaryEffectsActive = ch
      ? ch.manifest.secondary_effects.slice()
      : [];

    // Push sampled snapshot into frameHistory (cap at 1500 entries so memory stays bounded)
    this.telemetry.frameHistory.push({
      t: Number(this.simulationTime.toFixed(3)),
      movementId: this.telemetry.activeMovementId,
      phase: this.telemetry.currentPhase,
      phaseProgress: this.telemetry.phaseProgress,
      carPos: {
        x: Number(hero.position.x.toFixed(2)),
        y: Number(hero.position.y.toFixed(2)),
        z: Number(hero.position.z.toFixed(2))
      },
      ballPos: {
        x: Number(this.ball.position.x.toFixed(2)),
        y: Number(this.ball.position.y.toFixed(2)),
        z: Number(this.ball.position.z.toFixed(2))
      },
      velocity: { ...this.telemetry.velocity },
      speedKph: this.telemetry.speedKph,
      angularVelocity: { ...this.telemetry.angularVelocity },
      bodyPitchRollYaw: { ...this.telemetry.bodyPitchRollYaw },
      suspensionCompression: this.telemetry.suspensionCompression.slice(),
      score: { ...this.score }
    });
    if (this.telemetry.frameHistory.length > 1500) {
      this.telemetry.frameHistory.shift();
    }
  }

  // --------------------------------------------------------------------------
  // FINITE-STATE GUARD & OUT-OF-BOUNDS RECOVERY ([SPEC PATCH #9] & [#14] & [#15])
  // --------------------------------------------------------------------------

  _sanitizeAllBodies() {
    // Sanitize Ball
    const b = this.ball;
    if (
      !Number.isFinite(b.position.x) ||
      !Number.isFinite(b.position.y) ||
      !Number.isFinite(b.position.z) ||
      !Number.isFinite(b.velocity.x) ||
      !Number.isFinite(b.velocity.y) ||
      !Number.isFinite(b.velocity.z) ||
      Math.abs(b.position.x) > 65.0 ||
      b.position.y < -2.0 ||
      b.position.y > 45.0 ||
      Math.abs(b.position.z) > 116.0
    ) {
      b.position.x = clamp(safeFinite(b.position.x, 0), -56.0, 56.0);
      b.position.y = clamp(safeFinite(b.position.y, 3.2), 3.2, 36.0);
      b.position.z = clamp(safeFinite(b.position.z, 0), -108.0, 108.0);
      b.velocity.x = clamp(safeFinite(b.velocity.x, 0), -50.0, 50.0);
      b.velocity.y = clamp(safeFinite(b.velocity.y, 0), -50.0, 50.0);
      b.velocity.z = clamp(safeFinite(b.velocity.z, 0), -50.0, 50.0);
      b.angularVelocity.x = safeFinite(b.angularVelocity.x, 0);
      b.angularVelocity.y = safeFinite(b.angularVelocity.y, 0);
      b.angularVelocity.z = safeFinite(b.angularVelocity.z, 0);
      quatNormalize(b.quaternion);

      const sdf = this.evalArenaSDF(b.position.x, b.position.y, b.position.z);
      if (sdf.dist < b.radius) {
        const push = b.radius - sdf.dist;
        b.position.x += sdf.nx * push;
        b.position.y += sdf.ny * push;
        b.position.z += sdf.nz * push;
      }
    }

    // Sanitize Cars unconditionally so no NaN quaternion or floor penetration can persist
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (
        !Number.isFinite(c.position.x) ||
        !Number.isFinite(c.position.y) ||
        !Number.isFinite(c.position.z) ||
        !Number.isFinite(c.velocity.x) ||
        !Number.isFinite(c.velocity.y) ||
        !Number.isFinite(c.velocity.z) ||
        Math.abs(c.position.x) > 65.0 ||
        c.position.y < -2.0 ||
        c.position.y > 45.0 ||
        Math.abs(c.position.z) > 116.0
      ) {
        c.position.x = clamp(safeFinite(c.position.x, 0), -59.0, 59.0);
        c.position.y = clamp(safeFinite(c.position.y, 0.42), 0.42, 39.5);
        c.position.z = clamp(safeFinite(c.position.z, 0), -110.0, 110.0);
        c.velocity.x = clamp(safeFinite(c.velocity.x, 0), -46.0, 46.0);
        c.velocity.y = clamp(safeFinite(c.velocity.y, 0), -46.0, 46.0);
        c.velocity.z = clamp(safeFinite(c.velocity.z, 0), -46.0, 46.0);
      }

      c.angularVelocity.x = clamp(safeFinite(c.angularVelocity.x, 0), -16.0, 16.0);
      c.angularVelocity.y = clamp(safeFinite(c.angularVelocity.y, 0), -16.0, 16.0);
      c.angularVelocity.z = clamp(safeFinite(c.angularVelocity.z, 0), -16.0, 16.0);
      c.bodyPitch = clamp(safeFinite(c.bodyPitch, 0), -0.45, 0.45);
      c.bodyPitchVel = safeFinite(c.bodyPitchVel, 0);
      c.bodyRoll = clamp(safeFinite(c.bodyRoll, 0), -0.45, 0.45);
      c.bodyRollVel = safeFinite(c.bodyRollVel, 0);

      if (
        !c.quaternion ||
        !Number.isFinite(c.quaternion.x) ||
        !Number.isFinite(c.quaternion.y) ||
        !Number.isFinite(c.quaternion.z) ||
        !Number.isFinite(c.quaternion.w)
      ) {
        c.quaternion = quatFromAxisAngle(0, 1, 0, c.team === 'blue' ? 0 : Math.PI);
      } else {
        quatNormalize(c.quaternion);
      }
      updateCarBasis(c);

      if (!c.demolished) {
        this._enforceChassisOBBContainment(c);
        const sdf = this.evalArenaSDF(c.position.x, c.position.y, c.position.z);
        if (sdf.dist < 0.42) {
          const push = 0.42 - sdf.dist;
          c.position.x += sdf.nx * push;
          c.position.y += sdf.ny * push;
          c.position.z += sdf.nz * push;
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // SCENARIO HELPERS & GLOBAL TELEMETRY HOOKS
  // --------------------------------------------------------------------------

  setScenario(scenarioName) {
    const name = String(scenarioName || '').toLowerCase();
    const hero = this.playerCar || this.cars[0];
    if (name === 'aerial_pass' || name === 'high_aerial_pass') {
      this.matchState = MATCH_STATES.LIVE_PLAY;
      this._resetCarPose(hero, 0.0, 0.42, -28.0, 0.0, 100.0);
      this.ball.position.x = 0.0;
      this.ball.position.y = 14.0;
      this.ball.position.z = 16.0;
      this.ball.velocity.x = 0.0;
      this.ball.velocity.y = 8.5;
      this.ball.velocity.z = -2.0;
    } else if (name === 'goal_explosion') {
      this.triggerMovement('m5_goal_explosion_shockwave');
    } else if (name === 'supersonic_blitz') {
      this.triggerMovement('m1_supersonic_boost_blitz');
    } else if (name === 'wall_climb') {
      this.matchState = MATCH_STATES.FREE_PLAY;
      this._resetCarPose(hero, 25.0, 0.42, 0.0, Math.PI * 0.5, 100.0);
      hero.velocity.x = 35.0;
    } else {
      this.resetKickoff();
    }
    this._syncGlobalSimState();
  }

  getDiagnostics() {
    return {
      matchState: this.matchState,
      timeRemaining: this.timeRemaining,
      isOvertime: this.isOvertime,
      score: { ...this.score },
      carStates: this.cars.map(c => ({
        id: c.id,
        team: c.team,
        role: c.role,
        position: { ...c.position },
        velocity: { ...c.velocity },
        up: { ...c.up },
        forward: { ...c.forward },
        speedKph: c.speedKph,
        boost: c.boost,
        onGround: c.onGround,
        isSupersonic: c.isSupersonic,
        isPowersliding: c.isPowersliding,
        isFlipping: c.isFlipping,
        demolished: c.demolished,
        suspensionCompression: c.suspensionCompression.slice()
      })),
      ballState: {
        position: { ...this.ball.position },
        velocity: { ...this.ball.velocity },
        speedKph: this.ball.speedKph,
        lastTouchTeam: this.ball.lastTouchTeam,
        seamColor: this.ball.seamColor
      },
      boostPadStates: this.boostPads.map(p => ({
        id: p.id,
        type: p.type,
        active: p.active,
        cooldown: p.cooldown
      }))
    };
  }

  _installGlobalHooks() {
    const g = typeof window !== 'undefined' ? window : globalThis;
    if (!g) return;
    g.__MOTION_TELEMETRY__ = this.telemetry;
    g.__START_AUTOPILOT__ = () => this.startAutopilot();
  }

  _syncGlobalSimState() {
    const g = typeof window !== 'undefined' ? window : globalThis;
    if (!g) return;

    if (!this.activeChoreography) {
      this._updateChoreographyTelemetry();
    }

    g.__MOTION_TELEMETRY__ = this.telemetry;
    g.__SIM_STATE__ = {
      matchState: this.matchState,
      stateTimer: this.stateTimer,
      countdownNumber: this.countdownNumber,
      timeRemaining: this.timeRemaining,
      isOvertime: this.isOvertime,
      score: { ...this.score },
      cars: this.cars,
      ball: this.ball,
      boostPads: this.boostPads,
      activeMutators: { ...this.mutators }
    };
  }
}

// Register on window.RLModules.Physics per Frozen Shared Architecture Contract
const globalRoot = typeof window !== 'undefined' ? window : globalThis;
if (globalRoot) {
  globalRoot.RLModules = globalRoot.RLModules || {};
  globalRoot.RLModules.Physics = {
    PhysicsWorld,
    MATCH_STATES,
    MOVEMENTS_MANIFEST,
    evalArenaSDF: defaultEvalArenaSDF,
    DEFAULT_BOOST_PAD_LAYOUT,
    ARENA_CONSTANTS
  };
}

})(THREE, THREE);


// ============================================================================
// Module 4: Camera Director, VFX, Web Audio, Replay & HUD (vfx-audio-and-ui.js)
// ============================================================================
(function(THREE, THREE_IMPORT) {

/**
 * MODULE 4 — BALL-CAM DIRECTOR, GPU VFX, PROCEDURAL WEB AUDIO FOLEY, REPLAY & ESPORTS HUD
 * Owned file: src/vfx-audio-and-ui.js
 * Registers: window.RLModules.Presentation = { CameraDirector, VFXManager, AudioSynthesizer, ReplaySystem, HUDController }
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Fallback C1-continuous analytical Arena SDF in case window.RLModules.Arena.evalArenaSDF
 * is not passed directly during standalone or unit-test runs.
 */
function fallbackEvalArenaSDF(x, y, z) {
  const globalSDF =
    typeof window !== 'undefined' &&
    window.RLModules &&
    window.RLModules.Arena &&
    typeof window.RLModules.Arena.evalArenaSDF === 'function'
      ? window.RLModules.Arena.evalArenaSDF
      : null;
  if (globalSDF) {
    return globalSDF(x, y, z);
  }

  const hx = 60.0;
  const hy = 40.0;
  const hz = 100.0;
  const rFillet = 8.0;
  const cy = hy * 0.5;
  const dyMid = Math.abs(y - cy) - (hy * 0.5 - rFillet);
  const dx = Math.abs(x) - (hx - rFillet);
  const inGoalMouth = Math.abs(x) < 14.0 - 0.5 && y < 11.0 - 0.5;
  const effectiveHz = inGoalMouth ? 112.0 : hz;
  const dz = Math.abs(z) - (effectiveHz - rFillet);

  const ox = Math.max(dx, 0);
  const oy = Math.max(dyMid, 0);
  const oz = Math.max(dz, 0);
  const outsideLen = Math.hypot(ox, oy, oz);
  const insideMax = Math.min(Math.max(dx, dyMid, dz), 0);
  const signedBoxDist = outsideLen + insideMax - rFillet;
  const dist = -signedBoxDist;

  let nx = 0;
  let ny = 1;
  let nz = 0;
  if (outsideLen > 1e-5) {
    nx = (-Math.sign(x) * ox) / outsideLen;
    ny = (-Math.sign(y - cy) * oy) / outsideLen;
    nz = (-Math.sign(z) * oz) / outsideLen;
  } else if (y <= cy) {
    ny = 1;
  } else {
    ny = -1;
  }

  let surfaceType = 'floor';
  if (Math.abs(ny) < 0.35) surfaceType = 'wall';
  else if (ny < -0.5) surfaceType = 'ceiling';

  return { dist, nx, ny, nz, surfaceType };
}

function extractPosition(obj, fallback = { x: 0, y: 0, z: 0 }) {
  if (!obj) return { ...fallback };
  if (obj.position && Number.isFinite(obj.position.x)) {
    return { x: obj.position.x, y: obj.position.y, z: obj.position.z };
  }
  if (Number.isFinite(obj.x)) {
    return { x: obj.x, y: obj.y, z: obj.z };
  }
  return { ...fallback };
}

function extractVelocity(obj) {
  if (!obj) return { x: 0, y: 0, z: 0 };
  if (obj.velocity && Number.isFinite(obj.velocity.x)) {
    return { x: obj.velocity.x, y: obj.velocity.y, z: obj.velocity.z };
  }
  if (Number.isFinite(obj.vx)) {
    return { x: obj.vx, y: obj.vy, z: obj.vz };
  }
  return { x: 0, y: 0, z: 0 };
}

function extractQuaternion(obj) {
  if (!obj) return { x: 0, y: 0, z: 0, w: 1 };
  if (obj.quaternion && Number.isFinite(obj.quaternion.w)) {
    return {
      x: obj.quaternion.x,
      y: obj.quaternion.y,
      z: obj.quaternion.z,
      w: obj.quaternion.w
    };
  }
  if (Number.isFinite(obj.qw)) {
    return { x: obj.qx || 0, y: obj.qy || 0, z: obj.qz || 0, w: obj.qw };
  }
  return { x: 0, y: 0, z: 0, w: 1 };
}

function rotateVectorByQuat(vx, vy, vz, q) {
  const qx = q.x,
    qy = q.y,
    qz = q.z,
    qw = q.w;
  const ix = qw * vx + qy * vz - qz * vy;
  const iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx;
  const iw = -qx * vx - qy * vy - qz * vz;

  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx
  };
}

// ============================================================================
// 1. CAMERA DIRECTOR — Singularity-Free Ball-Cam, Car-Cam, Replay-Cam & Studio-Cam
// ============================================================================

class CameraDirector {
  constructor(cameraOrOptions = null, optionsOrSDF = {}) {
    if (cameraOrOptions && (cameraOrOptions.isCamera || cameraOrOptions.position)) {
      this.camera = cameraOrOptions;
      if (typeof optionsOrSDF === 'function') {
        this.evalArenaSDF = optionsOrSDF;
        this.options = {};
      } else {
        this.options = optionsOrSDF || {};
        this.evalArenaSDF = this.options.evalArenaSDF || fallbackEvalArenaSDF;
      }
    } else {
      this.options = cameraOrOptions || {};
      this.camera = this.options.camera || null;
      this.evalArenaSDF = this.options.evalArenaSDF || fallbackEvalArenaSDF;
    }

    this.mode = 'ball'; // 'ball' | 'car' | 'replay' | 'studio'
    this.previousPlayMode = 'ball';
    this.studioPreset = 'front_34';

    // Stabilized horizontal anchor unit vector in XZ plane (singularity guard)
    this._horizAnchor = { x: 0, z: 1 };
    this._carForwardXZ = { x: 0, z: 1 };

    // Smoothed camera state
    this.currentPos = new THREE.Vector3(0, 6.5, -62);
    this.currentLookAt = new THREE.Vector3(0, 2.2, 0);
    this.currentUp = new THREE.Vector3(0, 1, 0);
    this.currentFov = 63.0;
    this.currentDistance = 7.8;
    this.currentRoll = 0.0;

    // Screen shake & Hit-stop state
    this.shakeIntensity = 0.0;
    this.shakeDuration = 0.0;
    this.shakeTimer = 0.0;
    this.shakeTimeAccumulator = 0.0;
    this.hitStopRemainingMs = 0.0;

    // Replay & Main Menu orbit state ([SPEC PATCH #11])
    this.replayOrbitAngle = 0.0;
    this.menuOrbitAngle = -0.85;

    // Pre-allocated scratch objects
    this._targetPos = new THREE.Vector3();
    this._targetLook = new THREE.Vector3();
    this._lookMat = new THREE.Matrix4();
    this._targetQuat = new THREE.Quaternion();
    this._rollQuat = new THREE.Quaternion();
    this._zAxis = new THREE.Vector3(0, 0, 1);
  }

  setCamera(camera) {
    this.camera = camera;
  }

  setMode(mode, studioPreset = null) {
    const validModes = ['ball', 'car', 'replay', 'studio', 'menu'];
    const normalized = validModes.includes(mode) ? mode : 'ball';
    if (normalized === 'ball' || normalized === 'car') {
      this.previousPlayMode = normalized;
    }
    this.mode = normalized;
    if (studioPreset) {
      this.studioPreset = studioPreset;
    }
    return this.mode;
  }

  getMode() {
    return this.mode;
  }

  toggleBallCam() {
    if (this.mode === 'studio' || this.mode === 'replay') {
      this.mode = 'ball';
      this.previousPlayMode = 'ball';
    } else {
      this.mode = this.mode === 'ball' ? 'car' : 'ball';
      this.previousPlayMode = this.mode;
    }
    return this.mode;
  }

  setStudioMode(enabled, angleName = 'front_34') {
    if (enabled) {
      this.mode = 'studio';
      this.studioPreset = angleName || 'front_34';
    } else {
      this.mode = this.previousPlayMode || 'ball';
    }
    return this.mode;
  }

  setStudioAngle(angleName) {
    if (!angleName || angleName === 'live' || angleName === 'Live Game') {
      this.setStudioMode(false);
    } else {
      this.setStudioMode(true, angleName);
    }
  }

  triggerShake(intensity = 0.65, duration = 0.35) {
    this.shakeIntensity = Math.max(this.shakeIntensity, clamp(intensity, 0, 3.0));
    this.shakeDuration = Math.max(0.05, duration);
    this.shakeTimer = Math.max(this.shakeTimer, duration);
  }

  triggerHitStop(durationMs = 45) {
    this.hitStopRemainingMs = Math.max(this.hitStopRemainingMs, clamp(durationMs, 0, 250));
  }

  stepHitStop(dtSeconds) {
    if (this.hitStopRemainingMs > 0) {
      this.hitStopRemainingMs = Math.max(0, this.hitStopRemainingMs - dtSeconds * 1000);
      return 0.08;
    }
    return 1.0;
  }

  isHitStopped() {
    return this.hitStopRemainingMs > 0;
  }

  reset(car, ball) {
    const cPos = extractPosition(car, { x: 0, y: 0.42, z: -45 });
    const bPos = extractPosition(ball, { x: 0, y: 3.2, z: 0 });
    const q = extractQuaternion(car);
    const fwd = rotateVectorByQuat(0, 0, 1, q);
    const fLen = Math.hypot(fwd.x, fwd.z);
    if (fLen > 1e-4) {
      this._carForwardXZ.x = fwd.x / fLen;
      this._carForwardXZ.z = fwd.z / fLen;
    }
    const dx = bPos.x - cPos.x;
    const dz = bPos.z - cPos.z;
    const rHoriz = Math.hypot(dx, dz);
    if (rHoriz > 1e-3) {
      this._horizAnchor.x = dx / rHoriz;
      this._horizAnchor.z = dz / rHoriz;
    } else {
      this._horizAnchor.x = this._carForwardXZ.x;
      this._horizAnchor.z = this._carForwardXZ.z;
    }
    this.currentPos.set(
      cPos.x - this._horizAnchor.x * 7.8,
      cPos.y + 2.45,
      cPos.z - this._horizAnchor.z * 7.8
    );
    this.currentLookAt.set(bPos.x, bPos.y, bPos.z);
    this.currentFov = 63.0;
    this.currentRoll = 0.0;
  }

  /**
   * Computes singularity-free Ball-Cam target pose for any car & ball coordinates.
   * Tested directly in Node for dx=0, dz=0, dy=20 overhead singularity invariance.
   */
  computeBallCamPose(carState, ballState, dt = 1 / 60) {
    const cPos = extractPosition(carState, { x: 0, y: 0.42, z: -40 });
    const bPos = extractPosition(ballState, { x: 0, y: 3.2, z: 0 });
    const cVel = extractVelocity(carState);
    const cQuat = extractQuaternion(carState);

    // 1. Car forward XZ unit direction (fallback anchor when ball is directly overhead)
    let fwd = carState && carState.forward ? carState.forward : rotateVectorByQuat(0, 0, 1, cQuat);
    const fHorizLen = Math.hypot(fwd.x, fwd.z);
    if (fHorizLen > 1e-4) {
      this._carForwardXZ.x = fwd.x / fHorizLen;
      this._carForwardXZ.z = fwd.z / fHorizLen;
    } else if (!Number.isFinite(this._carForwardXZ.x) || !Number.isFinite(this._carForwardXZ.z)) {
      this._carForwardXZ.x = 0;
      this._carForwardXZ.z = 1;
    }

    // 2. Car-to-Ball horizontal projection with r_horiz < 4.0m singularity blend [SPEC PATCH #7]
    const dx = bPos.x - cPos.x;
    const dy = bPos.y - cPos.y;
    const dz = bPos.z - cPos.z;
    const rHoriz = Math.hypot(dx, dz);

    let ballDirX = this._carForwardXZ.x;
    let ballDirZ = this._carForwardXZ.z;
    if (rHoriz > 1e-5) {
      ballDirX = dx / rHoriz;
      ballDirZ = dz / rHoriz;
    }

    // Smooth blend weight: 0 when ball is directly overhead (rHoriz=0), 1 when rHoriz >= 4.0m
    const overheadBlend = smoothstep(0.0, 4.0, rHoriz);

    // Angle-continuous interpolation between carForwardXZ and ballDirXZ so 180-deg opposition never zeroes out
    const angleCar = Math.atan2(this._carForwardXZ.x, this._carForwardXZ.z);
    const angleBall = rHoriz > 1e-4 ? Math.atan2(ballDirX, ballDirZ) : angleCar;
    let deltaAngle = angleBall - angleCar;
    while (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
    while (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;

    const desiredAngle = angleCar + deltaAngle * overheadBlend;
    const desiredDirX = Math.sin(desiredAngle);
    const desiredDirZ = Math.cos(desiredAngle);

    // Smoothly rotate _horizAnchor toward desiredDir with angular rate limit when overhead
    const curAngle = Math.atan2(this._horizAnchor.x, this._horizAnchor.z);
    let stepDelta = desiredAngle - curAngle;
    while (stepDelta > Math.PI) stepDelta -= Math.PI * 2;
    while (stepDelta < -Math.PI) stepDelta += Math.PI * 2;

    const followRate = lerp(6.0, 18.0, overheadBlend);
    const alphaHoriz = 1 - Math.exp(-followRate * clamp(dt, 0.001, 0.1));
    const newAngle = curAngle + stepDelta * alphaHoriz;

    this._horizAnchor.x = Math.sin(newAngle);
    this._horizAnchor.z = Math.cos(newAngle);

    // 3. Vertical pitch clamped strictly to [-15 deg, +68 deg]
    const effHorizDist = Math.max(rHoriz, 4.0);
    const rawPitchRad = Math.atan2(dy, effHorizDist);
    const clampedPitchRad = clamp(rawPitchRad, -15 * DEG2RAD, 68 * DEG2RAD);

    // 4. Camera distance (7.8m base -> 8.8m under boost) and height (2.45m)
    const isBoosting = Boolean(carState && (carState.boostActive || carState.isBoosting));
    const speed = Math.hypot(cVel.x, cVel.y, cVel.z);
    const isSupersonic = Boolean((carState && carState.isSupersonic) || speed >= 42.0);

    const targetDist = isBoosting || isSupersonic ? 8.8 : 7.8;
    this.currentDistance = lerp(this.currentDistance, targetDist, 1 - Math.exp(-8.0 * dt));

    const baseHeight = 2.45;
    // Lower camera slightly when pitching steeply upward so car stays framed in bottom third
    const pitchHeightOffset = -Math.max(0, Math.sin(clampedPitchRad)) * 0.95;

    let camX = cPos.x - this._horizAnchor.x * this.currentDistance;
    let camY = cPos.y + baseHeight + pitchHeightOffset;
    let camZ = cPos.z - this._horizAnchor.z * this.currentDistance;

    // 5. Arena SDF Wall-Avoidance Clamp (dist >= 1.8m)
    const sdfFn = this.evalArenaSDF || fallbackEvalArenaSDF;
    const sdf = sdfFn(camX, camY, camZ);
    if (sdf && Number.isFinite(sdf.dist) && sdf.dist < 1.8) {
      const push = 1.8 - sdf.dist;
      camX += (sdf.nx || 0) * push;
      camY += (sdf.ny || 0) * push;
      camZ += (sdf.nz || 0) * push;
    }
    camY = Math.max(1.15, camY);

    // 6. Look-at target along clamped pitch so camera never looks straight 90 deg up into gimbal lock
    const lookDist = Math.max(rHoriz, 10.0);
    const lookX = cPos.x + this._horizAnchor.x * lookDist * Math.cos(clampedPitchRad);
    const lookY = cPos.y + 1.05 + lookDist * Math.sin(clampedPitchRad);
    const lookZ = cPos.z + this._horizAnchor.z * lookDist * Math.cos(clampedPitchRad);

    return {
      position: { x: camX, y: camY, z: camZ },
      lookAt: { x: lookX, y: lookY, z: lookZ },
      pitchDeg: clampedPitchRad * RAD2DEG,
      horizAnchor: { x: this._horizAnchor.x, z: this._horizAnchor.z }
    };
  }

  computeCarCamPose(carState, dt = 1 / 60) {
    const cPos = extractPosition(carState, { x: 0, y: 0.42, z: -40 });
    const cVel = extractVelocity(carState);
    const cQuat = extractQuaternion(carState);
    const fwd = carState && carState.forward ? carState.forward : rotateVectorByQuat(0, 0, 1, cQuat);
    const up = carState && carState.up ? carState.up : rotateVectorByQuat(0, 1, 0, cQuat);

    const speed = Math.hypot(cVel.x, cVel.y, cVel.z);
    const isBoosting = Boolean(carState && (carState.boostActive || carState.isBoosting));
    const targetDist = isBoosting || speed >= 42.0 ? 8.8 : 7.8;
    this.currentDistance = lerp(this.currentDistance, targetDist, 1 - Math.exp(-8.0 * dt));

    // Blend forward direction with velocity vector when moving fast
    let dirX = fwd.x;
    let dirY = fwd.y * 0.35;
    let dirZ = fwd.z;
    if (speed > 4.0) {
      const vWeight = clamp((speed - 4.0) / 28.0, 0, 0.55);
      dirX = lerp(fwd.x, cVel.x / speed, vWeight);
      dirY = lerp(fwd.y * 0.35, (cVel.y / speed) * 0.4, vWeight);
      dirZ = lerp(fwd.z, cVel.z / speed, vWeight);
    }
    const dLen = Math.hypot(dirX, dirY, dirZ) || 1;
    dirX /= dLen;
    dirY /= dLen;
    dirZ /= dLen;

    const upY = lerp(1.0, Math.max(0.25, up.y), 0.35);
    let camX = cPos.x - dirX * this.currentDistance;
    let camY = cPos.y + 2.45 * upY - dirY * 2.2;
    let camZ = cPos.z - dirZ * this.currentDistance;

    const sdfFn = this.evalArenaSDF || fallbackEvalArenaSDF;
    const sdf = sdfFn(camX, camY, camZ);
    if (sdf && Number.isFinite(sdf.dist) && sdf.dist < 1.8) {
      const push = 1.8 - sdf.dist;
      camX += (sdf.nx || 0) * push;
      camY += (sdf.ny || 0) * push;
      camZ += (sdf.nz || 0) * push;
    }
    camY = Math.max(1.15, camY);

    return {
      position: { x: camX, y: camY, z: camZ },
      lookAt: {
        x: cPos.x + dirX * 14.0,
        y: cPos.y + 1.15 + dirY * 10.0,
        z: cPos.z + dirZ * 14.0
      }
    };
  }

  computeReplayCamPose(carState, ballState, dt = 1 / 60) {
    const bPos = extractPosition(ballState, { x: 0, y: 3.2, z: 0 });
    const cPos = extractPosition(carState, { x: 0, y: 0.42, z: 0 });
    this.replayOrbitAngle += dt * 0.38;

    // Cinematic sideline/goal TV broadcast angle framing both the scorer and the goal mouth
    const goalSign = bPos.z >= 0 ? 1 : -1;
    const anchorZ = clamp(bPos.z, -92, 92);
    const camX = clamp(bPos.x * 0.45 + Math.cos(this.replayOrbitAngle) * 22.0, -52, 52);
    const camY = clamp(bPos.y * 0.55 + 6.2, 3.2, 22.0);
    const camZ = clamp(anchorZ - goalSign * 19.5 + Math.sin(this.replayOrbitAngle) * 6.0, -94, 94);

    let fCamX = camX,
      fCamY = camY,
      fCamZ = camZ;
    const sdfFn = this.evalArenaSDF || fallbackEvalArenaSDF;
    const sdf = sdfFn(fCamX, fCamY, fCamZ);
    if (sdf && Number.isFinite(sdf.dist) && sdf.dist < 2.2) {
      const push = 2.2 - sdf.dist;
      fCamX += (sdf.nx || 0) * push;
      fCamY += (sdf.ny || 0) * push;
      fCamZ += (sdf.nz || 0) * push;
    }

    return {
      position: { x: fCamX, y: fCamY, z: fCamZ },
      lookAt: {
        x: lerp(bPos.x, cPos.x, 0.22),
        y: lerp(bPos.y, cPos.y + 0.8, 0.22),
        z: lerp(bPos.z, cPos.z, 0.22)
      }
    };
  }

  computeStudioCamPose(carState) {
    const cPos = extractPosition(carState, { x: 0, y: 0, z: 0 });
    const cQuat = extractQuaternion(carState);
    const preset = String(this.studioPreset || 'front_34').toLowerCase();

    // Offsets in vehicle-local frame (+Z nose forward, +Y roof up, +X right flank)
    let localCam = { x: -4.15, y: 2.02, z: 5.05 };
    let localLook = { x: 0.62, y: 1.48, z: -0.92 };
    let localUp = { x: 0, y: 1, z: 0 };
    let fov = 40.0;

    if (preset === 'side') {
      localCam = { x: -11.8, y: 0.76, z: 0.05 };
      localLook = { x: 0.0, y: 0.68, z: 0.05 };
      fov = 18.0;
    } else if (preset === 'front_34' || preset === 'front 3/4') {
      localCam = { x: -4.15, y: 2.02, z: 5.05 };
      localLook = { x: 0.62, y: 1.48, z: -0.92 };
      fov = 40.0;
    } else if (preset === 'front') {
      localCam = { x: 0.0, y: 0.72, z: 10.2 };
      localLook = { x: 0.0, y: 0.68, z: 0.0 };
      fov = 20.0;
    } else if (preset === 'top') {
      localCam = { x: 0.0, y: 11.8, z: 0.08 };
      localLook = { x: 0.0, y: 0.0, z: 0.08 };
      localUp = { x: 1, y: 0, z: 0 };
      fov = 22.0;
    } else if (preset === 'rear_34' || preset === 'rear 3/4') {
      localCam = { x: 3.25, y: 1.68, z: -3.85 };
      localLook = { x: 0.0, y: 0.66, z: -0.15 };
      fov = 36.0;
    } else if (
      preset === 'closeup' ||
      preset === 'ground_check' ||
      preset === 'closeup / ground check'
    ) {
      localCam = { x: -2.25, y: 0.48, z: 1.95 };
      localLook = { x: -0.35, y: 0.46, z: 0.55 };
      fov = 32.0;
    } else if (preset === 'exploded' || preset === 'exploded rig') {
      localCam = { x: -4.35, y: 2.65, z: 4.45 };
      localLook = { x: 0.0, y: 0.85, z: 0.0 };
      fov = 40.0;
    }

    const worldCamOffset = rotateVectorByQuat(localCam.x, localCam.y, localCam.z, cQuat);
    const worldLookOffset = rotateVectorByQuat(localLook.x, localLook.y, localLook.z, cQuat);
    const worldUp = rotateVectorByQuat(localUp.x, localUp.y, localUp.z, cQuat);

    return {
      position: {
        x: cPos.x + worldCamOffset.x,
        y: Math.max(0.22, cPos.y + worldCamOffset.y),
        z: cPos.z + worldCamOffset.z
      },
      lookAt: {
        x: cPos.x + worldLookOffset.x,
        y: cPos.y + worldLookOffset.y,
        z: cPos.z + worldLookOffset.z
      },
      up: worldUp,
      fov
    };
  }

  computeMenuCamPose(dt = 1 / 60) {
    this.menuOrbitAngle += clamp(dt, 0.001, 0.05) * 0.22;
    const radius = 18.0;
    const camX = Math.cos(this.menuOrbitAngle) * radius;
    const camY = 5.5 + Math.sin(this.menuOrbitAngle * 1.5) * 0.45;
    const camZ = Math.sin(this.menuOrbitAngle) * radius;
    return {
      position: { x: camX, y: camY, z: camZ },
      lookAt: { x: 0.0, y: 2.5, z: 0.0 },
      fov: 58.0
    };
  }

  update(dt = 1 / 60, stateOrCar = null, ballArg = null, extraOpts = {}) {
    const safeDt = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0.0005, 0.1);
    this.stepHitStop(safeDt);

    // Flexible argument extraction
    let car = null;
    let ball = null;
    let matchState = extraOpts.matchState || null;

    if (stateOrCar && (stateOrCar.cars || stateOrCar.ball || stateOrCar.car)) {
      car = stateOrCar.car || (Array.isArray(stateOrCar.cars) ? stateOrCar.cars[0] : null);
      ball = stateOrCar.ball || ballArg;
      matchState = stateOrCar.matchState || matchState;
      if (typeof stateOrCar.evalArenaSDF === 'function') {
        this.evalArenaSDF = stateOrCar.evalArenaSDF;
      }
    } else {
      car = stateOrCar;
      ball = ballArg;
    }

    let activeMode = this.mode;
    if (this.mode !== 'studio') {
      if (matchState === 'MAIN_MENU' || this.mode === 'menu') {
        activeMode = 'menu';
      } else if (matchState === 'INSTANT_REPLAY') {
        activeMode = 'replay';
      }
    }

    let desiredPose;
    let desiredFov = 63.0;
    let desiredRoll = 0.0;

    if (activeMode === 'studio') {
      desiredPose = this.computeStudioCamPose(car);
      desiredFov = desiredPose.fov || 38.0;
      this.currentPos.set(desiredPose.position.x, desiredPose.position.y, desiredPose.position.z);
      this.currentLookAt.set(desiredPose.lookAt.x, desiredPose.lookAt.y, desiredPose.lookAt.z);
      if (desiredPose.up) {
        this.currentUp.set(desiredPose.up.x, desiredPose.up.y, desiredPose.up.z).normalize();
      } else {
        this.currentUp.set(0, 1, 0);
      }
      this.currentFov = desiredFov;
      this.currentRoll = 0;
    } else {
      if (activeMode === 'menu') {
        desiredPose = this.computeMenuCamPose(safeDt);
        desiredFov = 58.0;
      } else if (activeMode === 'replay') {
        desiredPose = this.computeReplayCamPose(car, ball, safeDt);
        desiredFov = 58.0;
      } else if (activeMode === 'car') {
        desiredPose = this.computeCarCamPose(car, safeDt);
      } else {
        desiredPose = this.computeBallCamPose(car, ball, safeDt);
      }

      // Dynamic FOV (63 deg at rest -> 78 deg at Supersonic >= 42 m/s)
      const cVel = extractVelocity(car);
      const speed = Math.hypot(cVel.x, cVel.y, cVel.z);
      const speedRatio = clamp(speed / 42.0, 0, 1);
      const boostBonus = car && (car.boostActive || car.isBoosting) ? 2.2 : 0.0;
      if (activeMode !== 'replay' && activeMode !== 'menu') {
        desiredFov = clamp(lerp(63.0, 78.0, Math.pow(speedRatio, 1.15)) + boostBonus, 63.0, 78.0);
      }

      // Subtle lateral roll tilt (+4.0 deg) during powerslide drift (m2_powerslide_drift_hook)
      if (car && car.isDrifting && car.onGround && activeMode !== 'menu') {
        const steerSign = Math.sign(car.steerAngle || car.steerInput || 1);
        desiredRoll = steerSign * 4.0 * DEG2RAD;
      }

      const posSpring = activeMode === 'replay' || activeMode === 'menu' ? 10.0 : 16.5;
      const lookSpring = activeMode === 'replay' || activeMode === 'menu' ? 14.0 : 22.0;
      const posAlpha = 1 - Math.exp(-posSpring * safeDt);
      const lookAlpha = 1 - Math.exp(-lookSpring * safeDt);

      this._targetPos.set(desiredPose.position.x, desiredPose.position.y, desiredPose.position.z);
      this._targetLook.set(desiredPose.lookAt.x, desiredPose.lookAt.y, desiredPose.lookAt.z);

      this.currentPos.lerp(this._targetPos, posAlpha);
      this.currentLookAt.lerp(this._targetLook, lookAlpha);
      this.currentUp.set(0, 1, 0);
      this.currentFov = lerp(this.currentFov, desiredFov, 1 - Math.exp(-10.0 * safeDt));
      this.currentRoll = lerp(this.currentRoll, desiredRoll, 1 - Math.exp(-9.0 * safeDt));

      // Final SDF safety clamp on interpolated position
      const sdfFn = this.evalArenaSDF || fallbackEvalArenaSDF;
      const sdf = sdfFn(this.currentPos.x, this.currentPos.y, this.currentPos.z);
      if (sdf && Number.isFinite(sdf.dist) && sdf.dist < 1.8) {
        const push = 1.8 - sdf.dist;
        this.currentPos.x += (sdf.nx || 0) * push;
        this.currentPos.y += (sdf.ny || 0) * push;
        this.currentPos.z += (sdf.nz || 0) * push;
      }
      this.currentPos.y = Math.max(1.12, this.currentPos.y);
    }

    // Screen Shake Offset
    let shakeX = 0,
      shakeY = 0,
      shakeZ = 0;
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - safeDt);
      this.shakeTimeAccumulator += safeDt * 58.0;
      const decay = this.shakeDuration > 0 ? this.shakeTimer / this.shakeDuration : 0;
      const amp = this.shakeIntensity * decay * decay;
      shakeX = Math.sin(this.shakeTimeAccumulator * 1.7) * amp * 0.45;
      shakeY = Math.cos(this.shakeTimeAccumulator * 2.3) * amp * 0.45;
      shakeZ = Math.sin(this.shakeTimeAccumulator * 1.3) * amp * 0.25;
      if (this.shakeTimer <= 0) {
        this.shakeIntensity = 0;
      }
    }

    // Apply to Three.js camera if present
    if (this.camera) {
      this.camera.position.set(
        this.currentPos.x + shakeX,
        this.currentPos.y + shakeY,
        this.currentPos.z + shakeZ
      );
      this.camera.up.copy(this.currentUp);
      this.camera.lookAt(this.currentLookAt);

      if (Math.abs(this.currentRoll) > 1e-4 && activeMode !== 'studio') {
        this._rollQuat.setFromAxisAngle(this._zAxis, this.currentRoll);
        this.camera.quaternion.multiply(this._rollQuat);
      }

      // Responsive narrow aspect ratio FOV compensation [SPEC PATCH #10]
      const aspect =
        this.camera.aspect ||
        (typeof window !== 'undefined' && window.innerHeight > 0
          ? window.innerWidth / window.innerHeight
          : 16 / 9);
      let effectiveFov = this.currentFov;
      if (aspect < 1.0 && activeMode !== 'studio') {
        effectiveFov = clamp(this.currentFov * Math.min(1.26, Math.pow(1.0 / aspect, 0.28)), 63, 94);
      }
      if (Math.abs(this.camera.fov - effectiveFov) > 0.05) {
        this.camera.fov = effectiveFov;
        if (typeof this.camera.updateProjectionMatrix === 'function') {
          this.camera.updateProjectionMatrix();
        }
      }
    }

    return {
      mode: activeMode,
      position: {
        x: this.currentPos.x + shakeX,
        y: this.currentPos.y + shakeY,
        z: this.currentPos.z + shakeZ
      },
      lookAt: {
        x: this.currentLookAt.x,
        y: this.currentLookAt.y,
        z: this.currentLookAt.z
      },
      fov: this.currentFov,
      quaternion: this.camera
        ? {
            x: this.camera.quaternion.x,
            y: this.camera.quaternion.y,
            z: this.camera.quaternion.z,
            w: this.camera.quaternion.w
          }
        : { x: 0, y: 0, z: 0, w: 1 }
    };
  }
}

// ============================================================================
// 2. VFX MANAGER — Pooled Additive GPU Particles, Ribbons, Shockwaves & Skids
// ============================================================================

class VFXManager {
  constructor(scene = null, options = {}) {
    this.scene = scene && scene.isScene ? scene : options.scene || null;
    this.root = new THREE.Group();
    this.root.name = 'VFXManagerRoot';
    if (this.scene) {
      this.scene.add(this.root);
    }

    // Reusable scratch transforms (zero GC in update)
    this._dummyMatrix = new THREE.Matrix4();
    this._dummyPos = new THREE.Vector3();
    this._dummyQuat = new THREE.Quaternion();
    this._dummyScale = new THREE.Vector3();
    this._dummyColor = new THREE.Color();
    this._upVec = new THREE.Vector3(0, 1, 0);
    this._fwdVec = new THREE.Vector3(0, 0, 1);
    this._tempVec = new THREE.Vector3();

    // 1. Pooled Additive Particle System (Boost Plume, Sparks, Tire Smoke, Goal Confetti, Demolition)
    this.maxParticles = 900;
    this.particleCursor = 0;
    this.particles = new Array(this.maxParticles);
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles[i] = {
        active: false,
        kind: 0, // 0: boost, 1: spark, 2: smoke, 3: goalShard, 4: demoFlame
        x: 0,
        y: -1000,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        maxLife: 1.0,
        sizeStart: 0.2,
        sizeEnd: 0.6,
        gravity: 0,
        drag: 0.98,
        r0: 1,
        g0: 1,
        b0: 1,
        r1: 1,
        g1: 0.4,
        b1: 0,
        rotSpeed: 0,
        rot: 0
      };
    }

    const pGeo = new THREE.IcosahedronGeometry(0.5, 1);
    const pMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.particleInstancedMesh = new THREE.InstancedMesh(pGeo, pMat, this.maxParticles);
    this.particleInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleInstancedMesh.renderOrder = 4;
    this.particleInstancedMesh.frustumCulled = false;

    // Initialize instance colors
    for (let i = 0; i < this.maxParticles; i++) {
      this._dummyMatrix.makeTranslation(0, -1000, 0);
      this._dummyMatrix.scale(this._dummyScale.set(0.0001, 0.0001, 0.0001));
      this.particleInstancedMesh.setMatrixAt(i, this._dummyMatrix);
      this.particleInstancedMesh.setColorAt(i, this._dummyColor.setHex(0xffffff));
    }
    this.root.add(this.particleInstancedMesh);

    // 2. Pooled Heated Pitch Skid Mark Quads (renderOrder = 1, polygonOffset: true)
    this.maxSkids = 360;
    this.skidCursor = 0;
    this.skids = new Array(this.maxSkids);
    for (let i = 0; i < this.maxSkids; i++) {
      this.skids[i] = {
        active: false,
        x: 0,
        y: -1000,
        z: 0,
        yaw: 0,
        age: 0,
        maxLife: 6.5,
        heat: 1.0
      };
    }
    const skidGeo = new THREE.PlaneGeometry(0.38, 0.95);
    skidGeo.rotateX(-Math.PI / 2);
    const skidMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide
    });
    this.skidInstancedMesh = new THREE.InstancedMesh(skidGeo, skidMat, this.maxSkids);
    this.skidInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.skidInstancedMesh.renderOrder = 1;
    this.skidInstancedMesh.frustumCulled = false;
    for (let i = 0; i < this.maxSkids; i++) {
      this._dummyMatrix.makeTranslation(0, -1000, 0);
      this._dummyMatrix.scale(this._dummyScale.set(0.0001, 0.0001, 0.0001));
      this.skidInstancedMesh.setMatrixAt(i, this._dummyMatrix);
      this.skidInstancedMesh.setColorAt(i, this._dummyColor.setHex(0x1a1410));
    }
    this.root.add(this.skidInstancedMesh);

    // 3. Expanding Shockwave Torus Pool (Ball Hits, Jump Bursts, Supersonic Mach Rings, Demolition)
    this.maxShockwaves = 18;
    this.shockwaves = [];
    const ringGeo = new THREE.TorusGeometry(1.0, 0.065, 10, 40);
    for (let i = 0; i < this.maxShockwaves; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.root.add(mesh);
      this.shockwaves.push({
        active: false,
        mesh,
        age: 0,
        duration: 0.45,
        startRadius: 0.6,
        endRadius: 8.5,
        followCarId: null
      });
    }

    // 4. Per-Car Continuous VFX Attachments (Volumetric Boost Cone, Mach Cone, Twin Wheel Ribbons)
    this.carEmitters = new Map();

    // 5. 3-Stage Goal Explosion Supernova Assembly (m5_goal_explosion_shockwave)
    this._initGoalSupernova();
  }

  _initGoalSupernova() {
    this.goalExplosion = {
      active: false,
      age: 0,
      duration: 2.8,
      position: new THREE.Vector3(0, 5.5, 100),
      team: 'blue',
      stage2Triggered: false,
      stage3Triggered: false
    };

    this.goalGroup = new THREE.Group();
    this.goalGroup.visible = false;
    this.root.add(this.goalGroup);

    // Stage 1 Implosion Singularity Core + Stage 2 Expanding Plasma Sphere (up to R = 28m)
    const coreGeo = new THREE.SphereGeometry(1.0, 28, 20);
    this.goalCoreMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.goalCoreMesh = new THREE.Mesh(coreGeo, this.goalCoreMat);
    this.goalCoreMesh.renderOrder = 4;
    this.goalGroup.add(this.goalCoreMesh);

    const haloGeo = new THREE.SphereGeometry(1.0, 28, 20);
    this.goalHaloMat = new THREE.MeshBasicMaterial({
      color: 0x0088ff,
      transparent: true,
      opacity: 0.55,
      wireframe: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.goalHaloMesh = new THREE.Mesh(haloGeo, this.goalHaloMat);
    this.goalHaloMesh.renderOrder = 4;
    this.goalGroup.add(this.goalHaloMesh);

    // 3 Concentric Tilted Supernova Shockwave Rings
    this.goalRings = [];
    const gRingGeo = new THREE.TorusGeometry(1.0, 0.045, 12, 56);
    const ringTilts = [
      new THREE.Euler(0, 0, 0),
      new THREE.Euler(Math.PI * 0.32, Math.PI * 0.18, 0),
      new THREE.Euler(-Math.PI * 0.28, -Math.PI * 0.24, Math.PI * 0.15)
    ];
    for (let i = 0; i < 3; i++) {
      const rMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const rMesh = new THREE.Mesh(gRingGeo, rMat);
      rMesh.rotation.copy(ringTilts[i]);
      rMesh.renderOrder = 4;
      this.goalGroup.add(rMesh);
      this.goalRings.push({ mesh: rMesh, mat: rMat });
    }
  }

  _getOrCreateCarEmitter(carKey) {
    if (this.carEmitters.has(carKey)) {
      return this.carEmitters.get(carKey);
    }

    // Twin Volumetric Rocket Boost Cones
    const coneGroup = new THREE.Group();
    const coneGeo = new THREE.ConeGeometry(0.24, 2.3, 14, 1, true);
    coneGeo.rotateX(-Math.PI / 2);
    coneGeo.translate(0, 0, -1.15);

    const outerConeMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const innerConeMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });

    const leftOuter = new THREE.Mesh(coneGeo, outerConeMat);
    leftOuter.position.set(-0.22, 0.56, -1.98);
    leftOuter.renderOrder = 4;
    const leftInner = new THREE.Mesh(coneGeo, innerConeMat);
    leftInner.position.set(-0.22, 0.56, -1.96);
    leftInner.scale.set(0.58, 0.58, 0.72);
    leftInner.renderOrder = 4;

    const rightOuter = new THREE.Mesh(coneGeo, outerConeMat);
    rightOuter.position.set(0.22, 0.56, -1.98);
    rightOuter.renderOrder = 4;
    const rightInner = new THREE.Mesh(coneGeo, innerConeMat);
    rightInner.position.set(0.22, 0.56, -1.96);
    rightInner.scale.set(0.58, 0.58, 0.72);
    rightInner.renderOrder = 4;

    coneGroup.add(leftOuter, leftInner, rightOuter, rightInner);
    coneGroup.visible = false;
    this.root.add(coneGroup);

    // Supersonic Mach Shock Cone around chassis
    const machGeo = new THREE.CylinderGeometry(0.55, 1.85, 2.6, 24, 1, true);
    machGeo.rotateX(Math.PI / 2);
    const machMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const machCone = new THREE.Mesh(machGeo, machMat);
    machCone.visible = false;
    machCone.renderOrder = 4;
    this.root.add(machCone);

    // Twin Supersonic Rear Wheel Ribbons (32 segments each)
    const segs = 32;
    const createRibbon = (hexColor) => {
      const positions = new Float32Array((segs + 1) * 2 * 3);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.MeshBasicMaterial({
        color: hexColor,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      // Build triangle strip indices
      const indices = [];
      for (let i = 0; i < segs; i++) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
      geom.setIndex(indices);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      mesh.visible = false;
      this.root.add(mesh);

      const history = [];
      for (let i = 0; i <= segs; i++) {
        history.push({ x: 0, y: -1000, z: 0, rx: 0.16, ry: 0, rz: 0 });
      }
      return { mesh, geom, mat, positions, history, segs };
    };

    const emitter = {
      coneGroup,
      outerConeMat,
      innerConeMat,
      machCone,
      machMat,
      leftRibbon: createRibbon(0xb366ff),
      rightRibbon: createRibbon(0x00f0ff),
      wasSupersonic: false,
      skidAccum: 0,
      boostAccum: 0
    };

    this.carEmitters.set(carKey, emitter);
    return emitter;
  }

  _emitParticle(opts) {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % this.maxParticles;

    p.active = true;
    p.kind = opts.kind || 0;
    p.x = opts.x || 0;
    p.y = opts.y || 0;
    p.z = opts.z || 0;
    p.vx = opts.vx || 0;
    p.vy = opts.vy || 0;
    p.vz = opts.vz || 0;
    p.age = 0;
    p.maxLife = Math.max(0.05, opts.maxLife || 0.4);
    p.sizeStart = opts.sizeStart ?? 0.22;
    p.sizeEnd = opts.sizeEnd ?? 0.55;
    p.gravity = opts.gravity ?? 0;
    p.drag = opts.drag ?? 0.96;
    p.r0 = opts.r0 ?? 0.0;
    p.g0 = opts.g0 ?? 0.94;
    p.b0 = opts.b0 ?? 1.0;
    p.r1 = opts.r1 ?? 1.0;
    p.g1 = opts.g1 ?? 0.35;
    p.b1 = opts.b1 ?? 0.0;
    p.rot = Math.random() * Math.PI * 2;
    p.rotSpeed = (Math.random() - 0.5) * 10.0;
  }

  _emitSkid(x, y, z, yaw, heat = 1.0) {
    const s = this.skids[this.skidCursor];
    this.skidCursor = (this.skidCursor + 1) % this.maxSkids;
    s.active = true;
    s.x = x;
    s.y = Math.max(0.03, y);
    s.z = z;
    s.yaw = yaw;
    s.age = 0;
    s.maxLife = 6.5;
    s.heat = heat;
  }

  spawnShockwave(position, normal = { x: 0, y: 0, z: 1 }, opts = {}) {
    const pos = extractPosition(position, { x: 0, y: 3.2, z: 0 });
    let slot = this.shockwaves.find((s) => !s.active);
    if (!slot) slot = this.shockwaves[0];

    slot.active = true;
    slot.age = 0;
    slot.duration = opts.duration || 0.45;
    slot.startRadius = opts.startRadius || 0.65;
    slot.endRadius = opts.endRadius || 9.2;
    slot.mesh.position.set(pos.x, pos.y, pos.z);

    this._tempVec.set(normal.x || 0, normal.y || 0, normal.z || 1);
    if (this._tempVec.lengthSq() < 1e-5) this._tempVec.set(0, 1, 0);
    this._tempVec.normalize();
    this._dummyQuat.setFromUnitVectors(this._fwdVec, this._tempVec);
    slot.mesh.quaternion.copy(this._dummyQuat);
    slot.mesh.scale.setScalar(slot.startRadius);
    slot.mesh.material.color.setHex(opts.color ?? 0x00f0ff);
    slot.mesh.material.opacity = 0.95;
    slot.mesh.visible = true;
  }

  spawnBallHit(position, normal = { x: 0, y: 1, z: 0 }, impactSpeed = 25, team = 'blue') {
    const pos = extractPosition(position, { x: 0, y: 3.2, z: 0 });
    const norm = {
      x: Number.isFinite(normal?.x) ? normal.x : 0,
      y: Number.isFinite(normal?.y) ? normal.y : 1,
      z: Number.isFinite(normal?.z) ? normal.z : 0
    };
    const isOrange = String(team).toLowerCase() === 'orange';
    const ringColor = isOrange ? 0xffaa00 : 0x00f0ff;

    // 1. Expanding radial shockwave torus (0.45s)
    this.spawnShockwave(pos, norm, {
      duration: 0.45,
      startRadius: 0.75,
      endRadius: clamp(4.8 + impactSpeed * 0.14, 5.5, 12.5),
      color: ringColor
    });

    // 2. 40 high-velocity directional sparks at contact point
    const sparkCount = 40;
    const baseSpeed = clamp(impactSpeed * 0.65, 10, 34);
    for (let i = 0; i < sparkCount; i++) {
      const rx = (Math.random() - 0.5) * 2.0 + norm.x * 0.85;
      const ry = (Math.random() - 0.3) * 2.0 + norm.y * 0.85;
      const rz = (Math.random() - 0.5) * 2.0 + norm.z * 0.85;
      const len = Math.hypot(rx, ry, rz) || 1;
      const spd = baseSpeed * (0.45 + Math.random() * 0.85);
      this._emitParticle({
        kind: 1,
        x: pos.x + (Math.random() - 0.5) * 0.3,
        y: pos.y + (Math.random() - 0.5) * 0.3,
        z: pos.z + (Math.random() - 0.5) * 0.3,
        vx: (rx / len) * spd,
        vy: (ry / len) * spd,
        vz: (rz / len) * spd,
        maxLife: 0.25 + Math.random() * 0.3,
        sizeStart: 0.24,
        sizeEnd: 0.02,
        gravity: -18.0,
        drag: 0.94,
        r0: 1.0,
        g0: 0.96,
        b0: 0.75,
        r1: isOrange ? 1.0 : 0.0,
        g1: isOrange ? 0.45 : 0.88,
        b1: isOrange ? 0.0 : 1.0
      });
    }
  }

  spawnJumpBurst(position, upVector = { x: 0, y: 1, z: 0 }, isDoubleJump = false) {
    const pos = extractPosition(position, { x: 0, y: 0.4, z: 0 });
    this.spawnShockwave(pos, upVector, {
      duration: 0.32,
      startRadius: 0.45,
      endRadius: isDoubleJump ? 3.4 : 2.5,
      color: isDoubleJump ? 0xffbb00 : 0x00f0ff
    });
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const spd = isDoubleJump ? 8.5 : 6.0;
      this._emitParticle({
        kind: 2,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: Math.cos(ang) * spd,
        vy: 1.5,
        vz: Math.sin(ang) * spd,
        maxLife: 0.32,
        sizeStart: 0.22,
        sizeEnd: 0.55,
        gravity: 0,
        drag: 0.88,
        r0: 0.8,
        g0: 0.95,
        b0: 1.0,
        r1: 0.2,
        g1: 0.5,
        b1: 0.8
      });
    }
  }

  spawnGoalExplosion(position = { x: 0, y: 5.5, z: 100 }, scoringTeam = 'blue') {
    const pos = extractPosition(position, { x: 0, y: 5.5, z: 100 });
    const isOrange = String(scoringTeam).toLowerCase() === 'orange';

    this.goalExplosion.active = true;
    this.goalExplosion.age = 0;
    this.goalExplosion.duration = 2.8;
    this.goalExplosion.position.set(pos.x, pos.y, pos.z);
    this.goalExplosion.team = isOrange ? 'orange' : 'blue';
    this.goalExplosion.stage2Triggered = false;
    this.goalExplosion.stage3Triggered = false;

    this.goalGroup.position.copy(this.goalExplosion.position);
    this.goalGroup.visible = true;

    this.goalCoreMat.color.setHex(isOrange ? 0xffcc00 : 0x80ffff);
    this.goalHaloMat.color.setHex(isOrange ? 0xff5500 : 0x0088ff);
    for (let i = 0; i < this.goalRings.length; i++) {
      this.goalRings[i].mat.color.setHex(
        i === 0 ? 0xffffff : isOrange ? 0xff6600 : 0x00e5ff
      );
    }

    // Stage 1 (0..250ms): Inward implosion streaks drawn toward singularity center
    for (let i = 0; i < 48; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const dist = 7.0 + Math.random() * 6.0;
      const sx = pos.x + Math.sin(phi) * Math.cos(theta) * dist;
      const sy = Math.max(0.5, pos.y + Math.cos(phi) * dist);
      const sz = pos.z + Math.sin(phi) * Math.sin(theta) * dist;
      const invT = 1.0 / 0.24;
      this._emitParticle({
        kind: 3,
        x: sx,
        y: sy,
        z: sz,
        vx: (pos.x - sx) * invT,
        vy: (pos.y - sy) * invT,
        vz: (pos.z - sz) * invT,
        maxLife: 0.25,
        sizeStart: 0.35,
        sizeEnd: 0.08,
        gravity: 0,
        drag: 1.0,
        r0: isOrange ? 1.0 : 0.2,
        g0: isOrange ? 0.7 : 0.95,
        b0: isOrange ? 0.1 : 1.0,
        r1: 1.0,
        g1: 1.0,
        b1: 1.0
      });
    }
  }

  spawnDemolition(position, team = 'orange') {
    const pos = extractPosition(position, { x: 0, y: 1.2, z: 0 });
    this.spawnShockwave(pos, { x: 0, y: 1, z: 0 }, {
      duration: 0.65,
      startRadius: 0.8,
      endRadius: 11.5,
      color: 0xff4400
    });
    for (let i = 0; i < 65; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const spd = 8.0 + Math.random() * 24.0;
      const isSmoke = i % 2 === 0;
      this._emitParticle({
        kind: 4,
        x: pos.x + (Math.random() - 0.5) * 0.8,
        y: pos.y + Math.random() * 0.8,
        z: pos.z + (Math.random() - 0.5) * 0.8,
        vx: Math.sin(phi) * Math.cos(theta) * spd,
        vy: Math.abs(Math.cos(phi)) * spd * 0.9 + 4.0,
        vz: Math.sin(phi) * Math.sin(theta) * spd,
        maxLife: isSmoke ? 0.85 : 0.55,
        sizeStart: isSmoke ? 0.65 : 0.35,
        sizeEnd: isSmoke ? 2.1 : 0.05,
        gravity: isSmoke ? 3.5 : -16.0,
        drag: 0.92,
        r0: 1.0,
        g0: isSmoke ? 0.55 : 0.9,
        b0: isSmoke ? 0.1 : 0.3,
        r1: isSmoke ? 0.15 : 1.0,
        g1: isSmoke ? 0.08 : 0.18,
        b1: 0.02
      });
    }
  }

  triggerEvent(evt) {
    if (!evt || !evt.type) return;
    const type = String(evt.type).toUpperCase();
    if (type === 'BALL_HIT') {
      this.spawnBallHit(evt.position || evt.pos, evt.normal, evt.speed || evt.impactSpeed || 25, evt.team);
    } else if (type === 'GOAL_SCORED' || type === 'GOAL') {
      this.spawnGoalExplosion(evt.position || evt.pos, evt.team || evt.scoringTeam);
    } else if (type === 'DEMOLITION' || type === 'DEMO') {
      this.spawnDemolition(evt.position || evt.pos, evt.team);
    } else if (type === 'JUMP' || type === 'DOUBLE_JUMP') {
      this.spawnJumpBurst(evt.position || evt.pos, evt.up, type === 'DOUBLE_JUMP');
    }
  }

  _updateGoalSupernova(dt) {
    if (!this.goalExplosion.active) return;
    const ge = this.goalExplosion;
    ge.age += dt;

    if (ge.age >= ge.duration) {
      ge.active = false;
      this.goalGroup.visible = false;
      return;
    }

    const tMs = ge.age * 1000;
    const isOrange = ge.team === 'orange';
    const intoPitchSign = ge.position.z >= 0 ? -1 : 1;

    // Stage 1 (0..250ms): Implosion Singularity Ring drawing light inward
    if (tMs <= 250) {
      const p = clamp(tMs / 250, 0, 1);
      const rImplode = lerp(5.8, 0.45, smoothstep(0, 1, p));
      this.goalCoreMesh.scale.setScalar(Math.max(0.35, 1.8 * (1 - p * 0.6)));
      this.goalCoreMat.opacity = 0.95;
      this.goalHaloMesh.scale.setScalar(rImplode);
      this.goalHaloMat.opacity = 0.85;
      for (let i = 0; i < this.goalRings.length; i++) {
        this.goalRings[i].mesh.scale.setScalar(rImplode * (1 + i * 0.18));
        this.goalRings[i].mat.opacity = 0.9;
      }
    }
    // Stage 2 (250..1100ms): Supernova Plasma Sphere expanding to R = 28m + 3 concentric shockwaves
    else if (tMs <= 1100) {
      if (!ge.stage2Triggered) {
        ge.stage2Triggered = true;
        // Emit burst of 120 high-energy plasma streaks at detonation
        for (let i = 0; i < 120; i++) {
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const spd = 18.0 + Math.random() * 36.0;
          this._emitParticle({
            kind: 3,
            x: ge.position.x,
            y: ge.position.y,
            z: ge.position.z,
            vx: Math.sin(phi) * Math.cos(theta) * spd,
            vy: Math.cos(phi) * spd * 0.75 + 4.0,
            vz: (Math.abs(Math.sin(phi) * Math.sin(theta)) * intoPitchSign + (Math.random() - 0.5) * 0.4) * spd,
            maxLife: 0.7 + Math.random() * 0.7,
            sizeStart: 0.55,
            sizeEnd: 0.12,
            gravity: -6.0,
            drag: 0.96,
            r0: 1.0,
            g0: 1.0,
            b0: 1.0,
            r1: isOrange ? 1.0 : 0.0,
            g1: isOrange ? 0.42 : 0.75,
            b1: isOrange ? 0.0 : 1.0
          });
        }
      }
      const p = clamp((tMs - 250) / 850, 0, 1);
      const easeOut = 1 - Math.pow(1 - p, 2.6);
      const radius = lerp(1.0, 28.0, easeOut);
      this.goalCoreMesh.scale.setScalar(radius * 0.72);
      this.goalCoreMat.opacity = (1 - p) * 0.85;
      this.goalHaloMesh.scale.setScalar(radius);
      this.goalHaloMat.opacity = (1 - p * 0.75) * 0.65;
      this.goalHaloMesh.rotation.y += dt * 2.5;

      for (let i = 0; i < this.goalRings.length; i++) {
        const ringP = clamp((p - i * 0.12) / (1 - i * 0.12), 0, 1);
        const ringR = lerp(1.2, 28.0 + i * 3.5, 1 - Math.pow(1 - ringP, 2.2));
        this.goalRings[i].mesh.scale.setScalar(ringR);
        this.goalRings[i].mat.opacity = Math.max(0, (1 - ringP) * 0.92);
      }
    }
    // Stage 3 (1100..2800ms): 250 celebratory glowing confetti/plasma shards cascading across pitch
    else {
      if (!ge.stage3Triggered) {
        ge.stage3Triggered = true;
        for (let i = 0; i < 250; i++) {
          const theta = Math.random() * Math.PI * 2;
          const spd = 10.0 + Math.random() * 28.0;
          const goldChoice = i % 3 === 0;
          this._emitParticle({
            kind: 3,
            x: ge.position.x + (Math.random() - 0.5) * 14.0,
            y: ge.position.y + Math.random() * 10.0,
            z: ge.position.z + intoPitchSign * (2.0 + Math.random() * 12.0),
            vx: Math.cos(theta) * spd,
            vy: 6.0 + Math.random() * 16.0,
            vz: intoPitchSign * Math.abs(Math.sin(theta)) * spd * 1.35,
            maxLife: 1.2 + Math.random() * 0.6,
            sizeStart: 0.42,
            sizeEnd: 0.08,
            gravity: -11.5,
            drag: 0.97,
            r0: goldChoice ? 1.0 : isOrange ? 1.0 : 0.0,
            g0: goldChoice ? 0.88 : isOrange ? 0.5 : 0.92,
            b0: goldChoice ? 0.25 : isOrange ? 0.05 : 1.0,
            r1: isOrange ? 1.0 : 0.1,
            g1: isOrange ? 0.25 : 0.45,
            b1: isOrange ? 0.0 : 1.0
          });
        }
      }
      const p = clamp((tMs - 1100) / 1700, 0, 1);
      this.goalCoreMat.opacity = Math.max(0, (1 - p * 2.0) * 0.2);
      this.goalHaloMat.opacity = Math.max(0, (1 - p * 1.5) * 0.25);
      for (let i = 0; i < this.goalRings.length; i++) {
        this.goalRings[i].mat.opacity = 0;
      }
    }
  }

  _updateRibbon(ribbon, worldX, worldY, worldZ, rightX, rightY, rightZ, active, width = 0.22) {
    const hist = ribbon.history;
    const segs = ribbon.segs;

    if (active) {
      ribbon.mesh.visible = true;
      for (let i = segs; i > 0; i--) {
        hist[i].x = hist[i - 1].x;
        hist[i].y = hist[i - 1].y;
        hist[i].z = hist[i - 1].z;
        hist[i].rx = hist[i - 1].rx;
        hist[i].ry = hist[i - 1].ry;
        hist[i].rz = hist[i - 1].rz;
      }
      hist[0].x = worldX;
      hist[0].y = worldY;
      hist[0].z = worldZ;
      hist[0].rx = rightX * width;
      hist[0].ry = rightY * width;
      hist[0].rz = rightZ * width;
    } else {
      // Collapse ribbon toward head when inactive
      for (let i = segs; i > 0; i--) {
        hist[i].x = lerp(hist[i].x, worldX, 0.35);
        hist[i].y = lerp(hist[i].y, worldY, 0.35);
        hist[i].z = lerp(hist[i].z, worldZ, 0.35);
      }
      hist[0].x = worldX;
      hist[0].y = worldY;
      hist[0].z = worldZ;
      const spread = Math.hypot(hist[segs].x - worldX, hist[segs].z - worldZ);
      if (spread < 0.15) {
        ribbon.mesh.visible = false;
        return;
      }
    }

    const posArr = ribbon.positions;
    for (let i = 0; i <= segs; i++) {
      const taper = 1.0 - i / segs;
      const h = hist[i];
      const idx = i * 6;
      posArr[idx] = h.x - h.rx * taper;
      posArr[idx + 1] = h.y - h.ry * taper;
      posArr[idx + 2] = h.z - h.rz * taper;
      posArr[idx + 3] = h.x + h.rx * taper;
      posArr[idx + 4] = h.y + h.ry * taper;
      posArr[idx + 5] = h.z + h.rz * taper;
    }
    ribbon.geom.attributes.position.needsUpdate = true;
  }

  update(dt = 1 / 60, stateOrCars = null, ballArg = null) {
    const safeDt = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0.0005, 0.1);

    let cars = [];
    let vfxEvents = [];
    if (Array.isArray(stateOrCars)) {
      cars = stateOrCars;
    } else if (stateOrCars && typeof stateOrCars === 'object') {
      if (Array.isArray(stateOrCars.cars)) cars = stateOrCars.cars;
      if (Array.isArray(stateOrCars.vfxEvents)) vfxEvents = stateOrCars.vfxEvents;
      if (Array.isArray(stateOrCars.vfxTriggers)) vfxEvents = stateOrCars.vfxTriggers;
    }

    for (let i = 0; i < vfxEvents.length; i++) {
      this.triggerEvent(vfxEvents[i]);
    }

    // 1. Update per-car VFX (Boost Plume, Supersonic Ribbons & Mach Cone, Powerslide Tire Smoke & Skid Marks)
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (!car) continue;
      const carKey = car.id ?? i;
      const emitter = this._getOrCreateCarEmitter(carKey);

      if (car.demolished) {
        emitter.coneGroup.visible = false;
        emitter.machCone.visible = false;
        emitter.leftRibbon.mesh.visible = false;
        emitter.rightRibbon.mesh.visible = false;
        continue;
      }

      const cPos = extractPosition(car);
      const cVel = extractVelocity(car);
      const cQuat = extractQuaternion(car);
      const speed = Math.hypot(cVel.x, cVel.y, cVel.z);

      const fwd = rotateVectorByQuat(0, 0, 1, cQuat);
      const up = rotateVectorByQuat(0, 1, 0, cQuat);
      const right = rotateVectorByQuat(1, 0, 0, cQuat);

      const boostActive = Boolean(car.boostActive || car.isBoosting);
      const isSupersonic = Boolean(car.isSupersonic || speed >= 42.0);
      const isDrifting = Boolean(car.isDrifting && (car.onGround !== false));

      // A. Volumetric Rocket Boost Exhaust Cone & Plasma Plume Particles
      emitter.coneGroup.visible = boostActive;
      if (boostActive) {
        emitter.coneGroup.position.set(cPos.x, cPos.y, cPos.z);
        emitter.coneGroup.quaternion.set(cQuat.x, cQuat.y, cQuat.z, cQuat.w);
        const flicker = 0.88 + Math.random() * 0.35;
        emitter.coneGroup.scale.set(1.0, 1.0, flicker * (isSupersonic ? 1.35 : 1.0));

        // Emit cyan-orange plasma particles from twin rear nozzles (z = -2.02, x = +-0.22, y = 0.56)
        for (let n = -1; n <= 1; n += 2) {
          const nozOffset = rotateVectorByQuat(n * 0.22, 0.56, -2.02, cQuat);
          const ejectSpeed = 16.0 + Math.random() * 8.0;
          this._emitParticle({
            kind: 0,
            x: cPos.x + nozOffset.x,
            y: cPos.y + nozOffset.y,
            z: cPos.z + nozOffset.z,
            vx: cVel.x * 0.35 - fwd.x * ejectSpeed + (Math.random() - 0.5) * 2.2,
            vy: cVel.y * 0.35 - fwd.y * ejectSpeed + (Math.random() - 0.5) * 2.2,
            vz: cVel.z * 0.35 - fwd.z * ejectSpeed + (Math.random() - 0.5) * 2.2,
            maxLife: 0.24 + Math.random() * 0.12,
            sizeStart: 0.28,
            sizeEnd: 0.72,
            gravity: 1.5,
            drag: 0.92,
            r0: 0.0,
            g0: 0.94,
            b0: 1.0,
            r1: 1.0,
            g1: 0.38,
            b1: 0.0
          });
        }
      }

      // B. Supersonic Mach Shock Cone & Twin Wheel Ribbons (m1_supersonic_boost_blitz)
      emitter.machCone.visible = isSupersonic;
      if (isSupersonic) {
        emitter.machCone.position.set(
          cPos.x + fwd.x * 0.45 + up.x * 0.65,
          cPos.y + fwd.y * 0.45 + up.y * 0.65,
          cPos.z + fwd.z * 0.45 + up.z * 0.65
        );
        emitter.machCone.quaternion.set(cQuat.x, cQuat.y, cQuat.z, cQuat.w);
        emitter.machMat.opacity = 0.26 + Math.sin(performance.now() * 0.025) * 0.08;

        if (!emitter.wasSupersonic) {
          this.spawnShockwave(cPos, fwd, {
            duration: 0.42,
            startRadius: 0.9,
            endRadius: 5.8,
            color: 0xb366ff
          });
        }
      }
      emitter.wasSupersonic = isSupersonic;

      // Rear wheel world positions: RL (-0.96, 0.25, -1.28), RR (+0.96, 0.25, -1.28)
      const rlOffset = rotateVectorByQuat(-0.96, 0.25, -1.28, cQuat);
      const rrOffset = rotateVectorByQuat(0.96, 0.25, -1.28, cQuat);
      const rlPos = { x: cPos.x + rlOffset.x, y: cPos.y + rlOffset.y, z: cPos.z + rlOffset.z };
      const rrPos = { x: cPos.x + rrOffset.x, y: cPos.y + rrOffset.y, z: cPos.z + rrOffset.z };

      this._updateRibbon(
        emitter.leftRibbon,
        rlPos.x,
        rlPos.y,
        rlPos.z,
        right.x,
        right.y,
        right.z,
        isSupersonic
      );
      this._updateRibbon(
        emitter.rightRibbon,
        rrPos.x,
        rrPos.y,
        rrPos.z,
        right.x,
        right.y,
        right.z,
        isSupersonic
      );

      // C. Powerslide Tire Smoke & Heated Pitch Skid Marks (m2_powerslide_drift_hook)
      if (isDrifting && speed > 4.5) {
        emitter.skidAccum += safeDt * speed;
        const yaw = Math.atan2(cVel.x, cVel.z);
        if (emitter.skidAccum >= 0.45) {
          emitter.skidAccum = 0;
          this._emitSkid(rlPos.x, 0.03, rlPos.z, yaw, 1.0);
          this._emitSkid(rrPos.x, 0.03, rrPos.z, yaw, 1.0);
        }

        // Billowy soft gray-white smoke puffs + rim sparks
        for (const wPos of [rlPos, rrPos]) {
          this._emitParticle({
            kind: 2,
            x: wPos.x + (Math.random() - 0.5) * 0.25,
            y: Math.max(0.15, wPos.y),
            z: wPos.z + (Math.random() - 0.5) * 0.25,
            vx: (Math.random() - 0.5) * 2.4 - cVel.x * 0.12,
            vy: 1.4 + Math.random() * 1.8,
            vz: (Math.random() - 0.5) * 2.4 - cVel.z * 0.12,
            maxLife: 0.45 + Math.random() * 0.25,
            sizeStart: 0.26,
            sizeEnd: 0.92,
            gravity: 1.2,
            drag: 0.9,
            r0: 0.92,
            g0: 0.94,
            b0: 0.96,
            r1: 0.45,
            g1: 0.5,
            b1: 0.58
          });
        }
      }
    }

    // 2. Step Pooled Particles and upload matrices/colors to GPU
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.age += safeDt;
      if (p.age >= p.maxLife) {
        p.active = false;
        this._dummyMatrix.makeTranslation(0, -1000, 0);
        this._dummyMatrix.scale(this._dummyScale.set(0.0001, 0.0001, 0.0001));
        this.particleInstancedMesh.setMatrixAt(i, this._dummyMatrix);
        continue;
      }

      const t = p.age / p.maxLife;
      p.vy += p.gravity * safeDt;
      const dragFactor = Math.pow(p.drag, safeDt * 60);
      p.vx *= dragFactor;
      p.vy *= dragFactor;
      p.vz *= dragFactor;

      p.x += p.vx * safeDt;
      p.y += p.vy * safeDt;
      p.z += p.vz * safeDt;
      if (p.y < 0.08 && p.gravity < 0) {
        p.y = 0.08;
        p.vy = Math.abs(p.vy) * 0.45;
      }

      const scale = Math.max(0.01, lerp(p.sizeStart, p.sizeEnd, t) * (1 - t * 0.45));
      this._dummyPos.set(p.x, p.y, p.z);
      this._dummyQuat.setFromAxisAngle(this._upVec, p.rot + p.age * p.rotSpeed);
      this._dummyScale.set(scale, scale, scale);
      this._dummyMatrix.compose(this._dummyPos, this._dummyQuat, this._dummyScale);
      this.particleInstancedMesh.setMatrixAt(i, this._dummyMatrix);

      const fade = 1 - t * t;
      this._dummyColor.setRGB(
        lerp(p.r0, p.r1, t) * fade,
        lerp(p.g0, p.g1, t) * fade,
        lerp(p.b0, p.b1, t) * fade
      );
      this.particleInstancedMesh.setColorAt(i, this._dummyColor);
    }
    this.particleInstancedMesh.instanceMatrix.needsUpdate = true;
    if (this.particleInstancedMesh.instanceColor) {
      this.particleInstancedMesh.instanceColor.needsUpdate = true;
    }

    // 3. Step Pooled Heated Skid Marks
    for (let i = 0; i < this.maxSkids; i++) {
      const s = this.skids[i];
      if (!s.active) continue;
      s.age += safeDt;
      if (s.age >= s.maxLife) {
        s.active = false;
        this._dummyMatrix.makeTranslation(0, -1000, 0);
        this._dummyMatrix.scale(this._dummyScale.set(0.0001, 0.0001, 0.0001));
        this.skidInstancedMesh.setMatrixAt(i, this._dummyMatrix);
        continue;
      }
      const t = s.age / s.maxLife;
      const heatGlow = Math.max(0, 1 - s.age * 1.4) * s.heat;
      this._dummyPos.set(s.x, s.y, s.z);
      this._dummyQuat.setFromAxisAngle(this._upVec, s.yaw);
      this._dummyScale.set(1.0, 1.0, 1.0 - t * 0.25);
      this._dummyMatrix.compose(this._dummyPos, this._dummyQuat, this._dummyScale);
      this.skidInstancedMesh.setMatrixAt(i, this._dummyMatrix);

      // Heated amber glow cooling to dark scorched rubber
      this._dummyColor.setRGB(
        lerp(0.08, 0.95, heatGlow),
        lerp(0.07, 0.38, heatGlow),
        lerp(0.06, 0.05, heatGlow)
      );
      this.skidInstancedMesh.setColorAt(i, this._dummyColor);
    }
    this.skidInstancedMesh.instanceMatrix.needsUpdate = true;
    if (this.skidInstancedMesh.instanceColor) {
      this.skidInstancedMesh.instanceColor.needsUpdate = true;
    }

    // 4. Step Shockwave Rings
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      if (!sw.active) continue;
      sw.age += safeDt;
      if (sw.age >= sw.duration) {
        sw.active = false;
        sw.mesh.visible = false;
        continue;
      }
      const p = sw.age / sw.duration;
      const ease = 1 - Math.pow(1 - p, 2.4);
      sw.mesh.scale.setScalar(lerp(sw.startRadius, sw.endRadius, ease));
      sw.mesh.material.opacity = (1 - p) * 0.92;
    }

    // 5. Step Goal Explosion Supernova
    this._updateGoalSupernova(safeDt);
  }
}

// ============================================================================
// 3. REPLAY SYSTEM — Circular 360-Frame Ring-Buffer Goal Instant Replay
// ============================================================================

class ReplaySystem {
  constructor(options = {}) {
    this.capacity = options.capacity || 360; // ~6.0s at 60fps
    this.buffer = new Array(this.capacity);
    this.writeIndex = 0;
    this.count = 0;
    this.elapsedRecordingTime = 0;

    this.isPlaying = false;
    this.playbackFrames = [];
    this.playbackCursor = 0;
    this.playbackDuration = 4.0;
    this.goalCrossIndex = 0;
    this.currentTimeDilation = 1.0;
    this.lastGoalInfo = {
      scoringTeam: 'blue',
      scorerName: 'OCTANE-01',
      shotSpeedKph: 112
    };
    this.onReplayComplete = options.onReplayComplete || null;
  }

  clear() {
    this.writeIndex = 0;
    this.count = 0;
    this.isPlaying = false;
    this.playbackFrames = [];
    this.playbackCursor = 0;
  }

  recordFrame(stateOrCars, maybeBall = null, maybeVfx = null) {
    if (this.isPlaying) return;

    let time = this.elapsedRecordingTime;
    let ball = null;
    let cars = [];
    let vfxTriggers = [];

    if (stateOrCars && typeof stateOrCars === 'object' && !Array.isArray(stateOrCars)) {
      if (Number.isFinite(stateOrCars.time)) {
        time = stateOrCars.time;
        this.elapsedRecordingTime = time;
      } else {
        this.elapsedRecordingTime += 1 / 60;
        time = this.elapsedRecordingTime;
      }
      ball = stateOrCars.ball || maybeBall;
      cars = Array.isArray(stateOrCars.cars) ? stateOrCars.cars : [];
      vfxTriggers = Array.isArray(stateOrCars.vfxTriggers)
        ? stateOrCars.vfxTriggers
        : Array.isArray(stateOrCars.vfxEvents)
        ? stateOrCars.vfxEvents
        : [];
    } else if (Array.isArray(stateOrCars)) {
      this.elapsedRecordingTime += 1 / 60;
      time = this.elapsedRecordingTime;
      cars = stateOrCars;
      ball = maybeBall;
      vfxTriggers = Array.isArray(maybeVfx) ? maybeVfx : [];
    } else {
      return;
    }

    const bPos = extractPosition(ball, { x: 0, y: 3.2, z: 0 });
    const bVel = extractVelocity(ball);
    const bQuat = extractQuaternion(ball);

    const snapshot = {
      time,
      ball: {
        x: bPos.x,
        y: bPos.y,
        z: bPos.z,
        qx: bQuat.x,
        qy: bQuat.y,
        qz: bQuat.z,
        qw: bQuat.w,
        vx: bVel.x,
        vy: bVel.y,
        vz: bVel.z,
        lastTouchTeam: ball?.lastTouchTeam || 'neutral'
      },
      cars: cars.map((c, idx) => {
        const cPos = extractPosition(c);
        const cQuat = extractQuaternion(c);
        const cVel = extractVelocity(c);
        return {
          id: c.id ?? idx,
          team: c.team || (idx === 0 ? 'blue' : 'orange'),
          x: cPos.x,
          y: cPos.y,
          z: cPos.z,
          qx: cQuat.x,
          qy: cQuat.y,
          qz: cQuat.z,
          qw: cQuat.w,
          vx: cVel.x,
          vy: cVel.y,
          vz: cVel.z,
          boost: c.boost ?? 33.3,
          boostActive: Boolean(c.boostActive || c.isBoosting),
          isSupersonic: Boolean(c.isSupersonic),
          isDrifting: Boolean(c.isDrifting),
          onGround: c.onGround !== false,
          steerAngle: c.steerAngle || 0,
          wheelRotation: c.wheelRotation || 0,
          suspensionCompression: Array.isArray(c.suspensionCompression)
            ? [...c.suspensionCompression]
            : [0, 0, 0, 0],
          demolished: Boolean(c.demolished)
        };
      }),
      vfxTriggers: vfxTriggers.length > 0 ? vfxTriggers.map((t) => ({ ...t })) : []
    };

    this.buffer[this.writeIndex] = snapshot;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  getOrderedHistory() {
    const out = [];
    if (this.count === 0) return out;
    const start = this.count === this.capacity ? this.writeIndex : 0;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      if (this.buffer[idx]) out.push(this.buffer[idx]);
    }
    return out;
  }

  startReplay(goalInfo = {}) {
    const ordered = this.getOrderedHistory();
    if (ordered.length === 0) {
      this.isPlaying = false;
      return false;
    }

    if (goalInfo.scoringTeam) this.lastGoalInfo.scoringTeam = goalInfo.scoringTeam;
    if (goalInfo.scorerName) this.lastGoalInfo.scorerName = goalInfo.scorerName;
    if (Number.isFinite(goalInfo.shotSpeedKph)) {
      this.lastGoalInfo.shotSpeedKph = Math.round(goalInfo.shotSpeedKph);
    }

    // Take up to 240 frames (~4.0s) leading up to the goal + aftermath
    const maxReplayFrames = Math.min(ordered.length, 240);
    this.playbackFrames = ordered.slice(ordered.length - maxReplayFrames);

    // Find the frame where the ball crossed the goal line (|z| >= 100) or default to 82% of clip
    let crossIdx = Math.floor(this.playbackFrames.length * 0.82);
    for (let i = 0; i < this.playbackFrames.length; i++) {
      if (Math.abs(this.playbackFrames[i].ball.z) >= 99.5) {
        crossIdx = i;
        break;
      }
    }
    this.goalCrossIndex = crossIdx;
    this.playbackCursor = 0;
    this.isPlaying = true;
    this.currentTimeDilation = 1.0;
    return true;
  }

  skip() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (typeof this.onReplayComplete === 'function') {
      this.onReplayComplete();
    }
  }

  stopReplay() {
    this.isPlaying = false;
  }

  update(dt = 1 / 60, targetState = null) {
    if (!this.isPlaying || this.playbackFrames.length === 0) {
      return null;
    }

    const safeDt = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0.001, 0.1);
    const totalFrames = this.playbackFrames.length;

    // Apply 0.4x slow-motion time dilation during the final 0.6s (~36 frames) prior to goal crossing
    const framesToGoal = this.goalCrossIndex - this.playbackCursor;
    const inSlowMoWindow = framesToGoal <= 36 && framesToGoal >= -12;
    this.currentTimeDilation = inSlowMoWindow ? 0.4 : 1.0;

    const prevIntIdx = Math.floor(this.playbackCursor);
    this.playbackCursor += safeDt * 60.0 * this.currentTimeDilation;
    const nextIntIdx = Math.floor(this.playbackCursor);

    if (this.playbackCursor >= totalFrames - 1) {
      this.isPlaying = false;
      if (typeof this.onReplayComplete === 'function') {
        this.onReplayComplete();
      }
      return {
        ...this.playbackFrames[totalFrames - 1],
        isFinished: true,
        timeDilation: this.currentTimeDilation,
        progress: 1.0
      };
    }

    const idx0 = clamp(Math.floor(this.playbackCursor), 0, totalFrames - 1);
    const idx1 = clamp(idx0 + 1, 0, totalFrames - 1);
    const alpha = this.playbackCursor - idx0;
    const f0 = this.playbackFrames[idx0];
    const f1 = this.playbackFrames[idx1];

    const interpBall = {
      x: lerp(f0.ball.x, f1.ball.x, alpha),
      y: lerp(f0.ball.y, f1.ball.y, alpha),
      z: lerp(f0.ball.z, f1.ball.z, alpha),
      qx: lerp(f0.ball.qx, f1.ball.qx, alpha),
      qy: lerp(f0.ball.qy, f1.ball.qy, alpha),
      qz: lerp(f0.ball.qz, f1.ball.qz, alpha),
      qw: lerp(f0.ball.qw, f1.ball.qw, alpha),
      vx: lerp(f0.ball.vx, f1.ball.vx, alpha),
      vy: lerp(f0.ball.vy, f1.ball.vy, alpha),
      vz: lerp(f0.ball.vz, f1.ball.vz, alpha),
      lastTouchTeam: f1.ball.lastTouchTeam
    };

    const interpCars = f0.cars.map((c0, idx) => {
      const c1 = f1.cars[idx] || c0;
      return {
        ...c1,
        x: lerp(c0.x, c1.x, alpha),
        y: lerp(c0.y, c1.y, alpha),
        z: lerp(c0.z, c1.z, alpha),
        qx: lerp(c0.qx, c1.qx, alpha),
        qy: lerp(c0.qy, c1.qy, alpha),
        qz: lerp(c0.qz, c1.qz, alpha),
        qw: lerp(c0.qw, c1.qw, alpha),
        vx: lerp(c0.vx, c1.vx, alpha),
        vy: lerp(c0.vy, c1.vy, alpha),
        vz: lerp(c0.vz, c1.vz, alpha),
        wheelRotation: lerp(c0.wheelRotation || 0, c1.wheelRotation || 0, alpha),
        steerAngle: lerp(c0.steerAngle || 0, c1.steerAngle || 0, alpha)
      };
    });

    // Apply directly to targetState if provided by coordinator
    if (targetState) {
      if (targetState.ball) {
        if (targetState.ball.position) {
          targetState.ball.position.set(interpBall.x, interpBall.y, interpBall.z);
        }
        targetState.ball.x = interpBall.x;
        targetState.ball.y = interpBall.y;
        targetState.ball.z = interpBall.z;
      }
      if (Array.isArray(targetState.cars)) {
        for (let i = 0; i < Math.min(targetState.cars.length, interpCars.length); i++) {
          const tc = targetState.cars[i];
          const ic = interpCars[i];
          if (tc.position) tc.position.set(ic.x, ic.y, ic.z);
          if (tc.quaternion) tc.quaternion.set(ic.qx, ic.qy, ic.qz, ic.qw).normalize();
          tc.x = ic.x;
          tc.y = ic.y;
          tc.z = ic.z;
          tc.qx = ic.qx;
          tc.qy = ic.qy;
          tc.qz = ic.qz;
          tc.qw = ic.qw;
          tc.boostActive = ic.boostActive;
          tc.isSupersonic = ic.isSupersonic;
          tc.isDrifting = ic.isDrifting;
        }
      }
    }

    return {
      time: lerp(f0.time, f1.time, alpha),
      ball: interpBall,
      cars: interpCars,
      vfxTriggers: nextIntIdx !== prevIntIdx ? f1.vfxTriggers : [],
      timeDilation: this.currentTimeDilation,
      progress: this.playbackCursor / Math.max(1, totalFrames - 1),
      isFinished: false,
      goalInfo: this.lastGoalInfo
    };
  }
}

// ============================================================================
// 4. AUDIO SYNTHESIZER — Procedural Web Audio API Foley (Zero External Assets)
// ============================================================================

class AudioSynthesizer {
  constructor(options = {}) {
    this.ctx = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.muted = Boolean(options.muted);
    this.initialized = false;

    // Continuous nodes
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineFilter = null;
    this.engineGain = null;

    this.boostSource = null;
    this.boostFilter = null;
    this.boostSubOsc = null;
    this.boostGain = null;

    this.driftSource = null;
    this.driftFilter1 = null;
    this.driftFilter2 = null;
    this.driftGain = null;

    this._prevSpeed = 0;
    this._prevWasSupersonic = false;
    this._prevThrottleActive = false;

    this._bindUnlockGesture();
  }

  _bindUnlockGesture() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', unlock, { once: false, passive: true });
    window.addEventListener('keydown', unlock, { once: false, passive: true });
  }

  init() {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return true;
    }
    if (typeof window === 'undefined') return false;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0.0 : 0.36;
      this.masterGain.connect(this.ctx.destination);

      // Generate 2-second pink/white noise buffer for boost afterburner, tire screech, and crowd roar
      const sampleRate = this.ctx.sampleRate;
      const length = sampleRate * 2;
      this.noiseBuffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      let b0 = 0,
        b1 = 0,
        b2 = 0,
        b3 = 0,
        b4 = 0,
        b5 = 0,
        b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }

      // 1. Engine RPM Synthesizer (Dual detuned oscillators + lowpass filter)
      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc2.type = 'triangle';
      this.engineOsc1.frequency.value = 68;
      this.engineOsc2.frequency.value = 136.5;

      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 320;
      this.engineFilter.Q.value = 2.4;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;

      this.engineOsc1.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);
      this.engineOsc1.start();
      this.engineOsc2.start();

      // 2. Rocket Boost Afterburner (Bandpass noise + 95Hz sub-bass rumble)
      this.boostSource = this.ctx.createBufferSource();
      this.boostSource.buffer = this.noiseBuffer;
      this.boostSource.loop = true;

      this.boostFilter = this.ctx.createBiquadFilter();
      this.boostFilter.type = 'bandpass';
      this.boostFilter.frequency.value = 680;
      this.boostFilter.Q.value = 1.4;

      this.boostSubOsc = this.ctx.createOscillator();
      this.boostSubOsc.type = 'sine';
      this.boostSubOsc.frequency.value = 95;

      this.boostGain = this.ctx.createGain();
      this.boostGain.gain.value = 0.0;

      this.boostSource.connect(this.boostFilter);
      this.boostFilter.connect(this.boostGain);
      this.boostSubOsc.connect(this.boostGain);
      this.boostGain.connect(this.masterGain);
      this.boostSource.start();
      this.boostSubOsc.start();

      // 3. Powerslide Tire Screech (Dual resonant bandpass 1.1kHz & 2.4kHz)
      this.driftSource = this.ctx.createBufferSource();
      this.driftSource.buffer = this.noiseBuffer;
      this.driftSource.loop = true;

      this.driftFilter1 = this.ctx.createBiquadFilter();
      this.driftFilter1.type = 'bandpass';
      this.driftFilter1.frequency.value = 1100;
      this.driftFilter1.Q.value = 8.5;

      this.driftFilter2 = this.ctx.createBiquadFilter();
      this.driftFilter2.type = 'bandpass';
      this.driftFilter2.frequency.value = 2400;
      this.driftFilter2.Q.value = 9.5;

      this.driftGain = this.ctx.createGain();
      this.driftGain.gain.value = 0.0;

      this.driftSource.connect(this.driftFilter1);
      this.driftSource.connect(this.driftFilter2);
      this.driftFilter1.connect(this.driftGain);
      this.driftFilter2.connect(this.driftGain);
      this.driftGain.connect(this.masterGain);
      this.driftSource.start();

      this.initialized = true;
      return true;
    } catch (_) {
      return false;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.setTargetAtTime(this.muted ? 0.0 : 0.36, this.ctx.currentTime, 0.03);
      } catch (_) {}
    }
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.initialized && this.ctx) {
      try {
        const now = this.ctx.currentTime;
        if (this.paused) {
          if (this.engineGain) this.engineGain.gain.setTargetAtTime(0.0, now, 0.02);
          if (this.boostGain) this.boostGain.gain.setTargetAtTime(0.0, now, 0.02);
          if (this.driftGain) this.driftGain.gain.setTargetAtTime(0.0, now, 0.02);
        }
      } catch (_) {}
    }
    return this.paused;
  }

  update(dt = 1 / 60, stateOrCar = null) {
    if (!this.initialized || !this.ctx || this.muted || this.paused || this.ctx.state !== 'running') return;

    let car = null;
    if (stateOrCar && Array.isArray(stateOrCar.cars)) {
      car = stateOrCar.cars[0];
    } else if (stateOrCar && stateOrCar.car) {
      car = stateOrCar.car;
    } else {
      car = stateOrCar;
    }
    if (!car) return;

    try {
      const now = this.ctx.currentTime;
      const vel = extractVelocity(car);
      const speed = Math.hypot(vel.x, vel.y, vel.z);
      const boostActive = Boolean(car.boostActive || car.isBoosting);
      const isSupersonic = Boolean(car.isSupersonic || speed >= 42.0);
      const isDrifting = Boolean(car.isDrifting && car.onGround !== false);

      // Simulated 5-speed transmission gear curve
      const gearThresholds = [0, 11, 21, 30, 38, 52];
      let gearIdx = 0;
      for (let g = 0; g < gearThresholds.length - 1; g++) {
        if (speed >= gearThresholds[g]) gearIdx = g;
      }
      const gMin = gearThresholds[gearIdx];
      const gMax = gearThresholds[gearIdx + 1] || 52;
      const gearPos = clamp((speed - gMin) / Math.max(1, gMax - gMin), 0, 1);

      const baseRpmHz = 62 + gearIdx * 16 + gearPos * 95 + (boostActive ? 28 : 0);
      this.engineOsc1.frequency.setTargetAtTime(baseRpmHz, now, 0.04);
      this.engineOsc2.frequency.setTargetAtTime(baseRpmHz * 2.01, now, 0.04);
      this.engineFilter.frequency.setTargetAtTime(280 + speed * 26 + (boostActive ? 450 : 0), now, 0.05);
      this.engineGain.gain.setTargetAtTime(car.demolished ? 0.0 : 0.11 + clamp(speed / 50, 0, 0.12), now, 0.05);

      // Turbo wastegate flutter on sudden deceleration from high speed
      const throttleActive = speed > this._prevSpeed - 0.1 || boostActive;
      if (this._prevThrottleActive && !throttleActive && speed > 22.0) {
        this._playWastegateFlutter();
      }
      this._prevThrottleActive = throttleActive;
      this._prevSpeed = speed;

      // Rocket Boost Afterburner modulation
      const targetBoostGain = boostActive && !car.demolished ? 0.28 : 0.0;
      this.boostGain.gain.setTargetAtTime(targetBoostGain, now, 0.03);
      if (boostActive) {
        this.boostFilter.frequency.setTargetAtTime(620 + speed * 14, now, 0.04);
        this.boostSubOsc.frequency.setTargetAtTime(92 + speed * 0.6, now, 0.04);
      }

      // Powerslide Tire Screech modulation
      const slipSpeed = isDrifting ? clamp((speed - 4.0) / 28.0, 0, 1) : 0.0;
      this.driftGain.gain.setTargetAtTime(slipSpeed * 0.22, now, 0.03);
      if (isDrifting) {
        this.driftFilter1.frequency.setTargetAtTime(1050 + slipSpeed * 220, now, 0.04);
        this.driftFilter2.frequency.setTargetAtTime(2300 + slipSpeed * 340, now, 0.04);
      }

      // Supersonic Sonic Boom trigger
      if (isSupersonic && !this._prevWasSupersonic) {
        this.playSupersonicBoom();
      }
      this._prevWasSupersonic = isSupersonic;
    } catch (_) {}
  }

  _playWastegateFlutter() {
    if (!this.initialized || !this.ctx || this.muted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1250, now);
      osc.frequency.exponentialRampToValueAtTime(480, now + 0.16);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.17);
    } catch (_) {}
  }

  playBallHit(impactSpeed = 22, distance = 8) {
    if (!this.initialized || !this.ctx || this.muted) return;
    try {
      const now = this.ctx.currentTime;
      const atten = clamp(1.0 - distance / 140.0, 0.15, 1.0);
      const power = clamp(impactSpeed / 38.0, 0.25, 1.2) * atten;

      // 1. Punchy pitch-dropping sine thump (160Hz -> 42Hz)
      const thumpOsc = this.ctx.createOscillator();
      const thumpGain = this.ctx.createGain();
      thumpOsc.type = 'sine';
      thumpOsc.frequency.setValueAtTime(160, now);
      thumpOsc.frequency.exponentialRampToValueAtTime(42, now + 0.19);
      thumpGain.gain.setValueAtTime(0.45 * power, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      thumpOsc.connect(thumpGain);
      thumpGain.connect(this.masterGain);
      thumpOsc.start(now);
      thumpOsc.stop(now + 0.23);

      // 2. Metallic geodesic shell chime
      const chimeOsc = this.ctx.createOscillator();
      const chimeGain = this.ctx.createGain();
      chimeOsc.type = 'triangle';
      chimeOsc.frequency.setValueAtTime(540 + impactSpeed * 6, now);
      chimeOsc.frequency.exponentialRampToValueAtTime(290, now + 0.14);
      chimeGain.gain.setValueAtTime(0.18 * power, now);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      chimeOsc.connect(chimeGain);
      chimeGain.connect(this.masterGain);
      chimeOsc.start(now);
      chimeOsc.stop(now + 0.16);
    } catch (_) {}
  }

  playJump(isDoubleJump = false) {
    if (!this.initialized || !this.ctx || this.muted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const f0 = isDoubleJump ? 190 : 135;
      const f1 = isDoubleJump ? 420 : 285;
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(f1, now + 0.14);
      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.17);
    } catch (_) {}
  }

  playSupersonicBoom() {
    if (!this.initialized || !this.ctx || this.muted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.38);
      gain.gain.setValueAtTime(0.38, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.42);
    } catch (_) {}
  }

  playBoostPickup(isFullPad = true) {
    if (!this.initialized || !this.ctx || this.muted) return;
    try {
      const now = this.ctx.currentTime;
      const notes = isFullPad ? [587.33, 880.0, 1174.66] : [783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        const tStart = now + idx * 0.055;
        osc.frequency.setValueAtTime(freq, tStart);
        gain.gain.setValueAtTime(0.16, tStart);
        gain.gain.exponentialRampToValueAtTime(0.001, tStart + 0.18);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(tStart);
        osc.stop(tStart + 0.19);
      });
    } catch (_) {}
  }

  playCountdownBeep(stage = 3) {
    if (!this.initialized || !this.ctx || this.muted) return;
    try {
      const now = this.ctx.currentTime;
      const isGo = stage <= 0 || stage === 'GO';
      const freqs = isGo ? [523.25, 659.25, 1046.5] : [440.0];
      const dur = isGo ? 0.45 : 0.18;
      freqs.forEach((f) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now);
        gain.gain.setValueAtTime(isGo ? 0.18 : 0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + dur + 0.02);
      });
    } catch (_) {}
  }

  playGoalHornAndCrowd() {
    if (!this.initialized || !this.ctx || this.muted) return;
    try {
      const now = this.ctx.currentTime;
      // Stadium Brass Air-Horn Triad
      const hornFreqs = [146.83, 220.0, 293.66, 295.2];
      hornFreqs.forEach((f) => {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, now);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(950, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.14, now + 0.08);
        gain.gain.setValueAtTime(0.14, now + 1.6);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 2.35);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 2.4);
      });

      // Swelling Stadium Crowd Roar
      if (this.noiseBuffer) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        src.loop = true;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(750, now);
        bp.frequency.linearRampToValueAtTime(1250, now + 1.2);
        bp.Q.value = 0.9;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.01, now);
        g.gain.linearRampToValueAtTime(0.28, now + 0.45);
        g.gain.exponentialRampToValueAtTime(0.001, now + 2.9);
        src.connect(bp);
        bp.connect(g);
        g.connect(this.masterGain);
        src.start(now);
        src.stop(now + 2.95);
      }
    } catch (_) {}
  }

  playDemolition() {
    if (!this.initialized || !this.ctx || this.muted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(24, now + 0.45);
      gain.gain.setValueAtTime(0.42, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.5);
    } catch (_) {}
  }
}

// ============================================================================
// 5. HUD CONTROLLER — Broadcast Esports HUD, Tactical Mini-Radar & [TAB] Drawer
// ============================================================================

class HUDController {
  constructor(containerOrOptions = null, maybeOptions = {}) {
    if (
      containerOrOptions &&
      typeof containerOrOptions === 'object' &&
      containerOrOptions.nodeType === 1
    ) {
      this.container = containerOrOptions;
      this.options = maybeOptions || {};
    } else {
      this.options = containerOrOptions || {};
      this.container =
        this.options.container ||
        (typeof document !== 'undefined' ? document.getElementById('hud-root') : null);
    }

    this.drawerOpen = false;
    this.ballCamEnabled = true;
    this.muted = false;
    this.activeMode = '1v1';
    this.activeDifficulty = 'Pro';
    this.activeStudioAngle = 'Live Game';
    this.mutators = {
      gravity: 1.0,
      boostPower: 1.0,
      ballBounciness: 0.65,
      gameSpeed: 1.0
    };

    this._lastCountdownText = '';
    this._calloutTimeout = null;

    if (typeof document !== 'undefined') {
      this._mountDOM();
      this._bindEvents();
    }
  }

  _mountDOM() {
    if (!this.container) {
      this.container = document.getElementById('hud-root');
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.id = 'hud-root';
        document.body.appendChild(this.container);
      }
    }

    if (!document.getElementById('rl-esports-hud-styles')) {
      const style = document.createElement('style');
      style.id = 'rl-esports-hud-styles';
      style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:ital,wght@0,600;0,700;1,700&family=JetBrains+Mono:wght@600;700;800&display=swap');

        #hud-root {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 20;
          font-family: 'Chakra Petch', 'Rajdhani', 'Bahnschrift', system-ui, -apple-system, sans-serif;
          color: #f4f8ff;
          user-select: none;
          overflow: hidden;
        }

        .rl-mono {
          font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
          font-variant-numeric: tabular-nums;
        }

        /* Top-Center Broadcast Scoreboard Pill */
        .rl-top-bar {
          position: absolute;
          top: 14px;
          left: 18px;
          right: 18px;
          z-index: 52;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          pointer-events: none;
        }

        .rl-scoreboard-wrap {
          margin: 0 auto;
          display: flex;
          align-items: stretch;
          background: rgba(8, 13, 24, 0.84);
          border: 1px solid rgba(148, 182, 225, 0.26);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(12px);
          clip-path: polygon(14px 0, calc(100% - 14px) 0, 100% 100%, calc(100% - 14px) 100%, 14px 100%, 0 100%);
          border-radius: 6px;
          overflow: hidden;
          pointer-events: auto;
        }

        .rl-team-wing {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 8px 18px;
          min-width: 138px;
        }

        .rl-team-wing.blue {
          background: linear-gradient(90deg, rgba(0, 136, 255, 0.42) 0%, rgba(0, 136, 255, 0.12) 100%);
          border-left: 4px solid #00a8ff;
          justify-content: space-between;
        }

        .rl-team-wing.orange {
          background: linear-gradient(270deg, rgba(255, 102, 0, 0.42) 0%, rgba(255, 102, 0, 0.12) 100%);
          border-right: 4px solid #ff6600;
          justify-content: space-between;
        }

        .rl-team-name {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #dbe9ff;
        }

        .rl-team-score {
          font-size: 28px;
          font-weight: 800;
          line-height: 1;
          color: #ffffff;
          text-shadow: 0 0 14px rgba(255, 255, 255, 0.35);
        }

        .rl-clock-core {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4px 20px;
          background: rgba(4, 8, 16, 0.92);
          border-left: 1px solid rgba(148, 182, 225, 0.18);
          border-right: 1px solid rgba(148, 182, 225, 0.18);
          min-width: 122px;
        }

        .rl-clock-readout {
          font-size: 24px;
          font-weight: 800;
          line-height: 1.05;
          color: #f8fbff;
          letter-spacing: 0.04em;
        }

        .rl-clock-readout.overtime {
          color: #ffbb00;
          text-shadow: 0 0 12px rgba(255, 187, 0, 0.65);
        }

        .rl-mode-badge {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.11em;
          color: #8aa0be;
          margin-top: 2px;
        }

        /* Quick Action Bar */
        .rl-quick-actions {
          position: absolute;
          top: 0;
          right: 0;
          display: flex;
          gap: 8px;
          pointer-events: auto;
        }

        .rl-action-btn {
          background: rgba(8, 13, 24, 0.82);
          border: 1px solid rgba(148, 182, 225, 0.28);
          color: #e2eeff;
          font-family: inherit;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
          padding: 7px 12px;
          border-radius: 5px;
          cursor: pointer;
          backdrop-filter: blur(10px);
          transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
        }

        .rl-action-btn:hover {
          background: rgba(0, 136, 255, 0.26);
          border-color: #00e5ff;
        }

        .rl-action-btn.active {
          background: rgba(0, 229, 255, 0.18);
          border-color: #00e5ff;
          color: #00f0ff;
        }

        /* Center Dynamic Callouts & Countdown */
        .rl-center-stage {
          position: absolute;
          top: 22%;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          pointer-events: none;
          text-align: center;
        }

        .rl-countdown-text {
          font-size: 82px;
          font-weight: 800;
          font-style: italic;
          line-height: 1;
          letter-spacing: 0.04em;
          color: #ffffff;
          text-shadow: 0 0 28px rgba(0, 240, 255, 0.75), 0 6px 18px rgba(0, 0, 0, 0.85);
          opacity: 0;
          transform: scale(0.75);
          transition: opacity 0.12s ease, transform 0.15s cubic-bezier(0.2, 1.3, 0.4, 1);
        }

        .rl-countdown-text.visible {
          opacity: 1;
          transform: scale(1);
        }

        .rl-goal-banner {
          padding: 12px 32px;
          background: linear-gradient(135deg, rgba(8, 13, 24, 0.92), rgba(16, 28, 48, 0.92));
          border: 2px solid #00e5ff;
          box-shadow: 0 0 36px rgba(0, 229, 255, 0.45), 0 12px 32px rgba(0, 0, 0, 0.7);
          border-radius: 6px;
          opacity: 0;
          transform: translateY(-12px) scale(0.92);
          transition: opacity 0.18s ease, transform 0.2s cubic-bezier(0.18, 1.25, 0.4, 1);
        }

        .rl-goal-banner.visible {
          opacity: 1;
          transform: translateY(0) scale(1);
        }

        .rl-goal-title {
          font-size: 34px;
          font-weight: 800;
          font-style: italic;
          letter-spacing: 0.06em;
          color: #ffffff;
        }

        .rl-goal-sub {
          font-size: 14px;
          font-weight: 700;
          color: #ffbb00;
          margin-top: 2px;
        }

        .rl-medal-stack {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }

        .rl-medal-pill {
          padding: 5px 16px;
          background: rgba(8, 14, 26, 0.86);
          border-left: 3px solid #ffbb00;
          border-right: 3px solid #00f0ff;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #ffdd66;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
        }

        /* Instant Replay Broadcast Bug */
        .rl-replay-overlay {
          position: absolute;
          bottom: 112px;
          left: 50%;
          transform: translateX(-50%);
          display: none;
          align-items: center;
          gap: 18px;
          padding: 10px 22px;
          background: rgba(8, 13, 24, 0.88);
          border: 1px solid rgba(255, 68, 68, 0.55);
          border-radius: 6px;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65);
          pointer-events: auto;
        }

        .rl-replay-overlay.visible {
          display: flex;
        }

        .rl-replay-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ff2a2a;
          box-shadow: 0 0 12px #ff2a2a;
          animation: rlPulseDot 0.9s infinite alternate;
        }

        @keyframes rlPulseDot {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.35; transform: scale(0.8); }
        }

        /* Bottom-Right Circular Boost & Telemetry Dial */
        .rl-boost-cluster {
          position: absolute;
          bottom: 18px;
          right: 22px;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
          pointer-events: none;
        }

        .rl-phase-pill {
          display: none;
          flex-direction: column;
          gap: 4px;
          padding: 7px 12px;
          background: rgba(8, 13, 24, 0.86);
          border: 1px solid rgba(0, 240, 255, 0.38);
          border-radius: 5px;
          min-width: 215px;
          backdrop-filter: blur(8px);
        }

        .rl-phase-pill.visible {
          display: flex;
        }

        .rl-phase-header {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          font-weight: 700;
          color: #00f0ff;
        }

        .rl-phase-bar-bg {
          height: 4px;
          background: rgba(255, 255, 255, 0.14);
          border-radius: 2px;
          overflow: hidden;
        }

        .rl-phase-bar-fill {
          height: 100%;
          width: 0%;
          background: linear-gradient(90deg, #00f0ff, #ffaa00);
          transition: width 0.06s linear;
        }

        .rl-dial-box {
          position: relative;
          width: 146px;
          height: 146px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle, rgba(8, 13, 24, 0.88) 54%, rgba(8, 13, 24, 0.0) 72%);
        }

        .rl-dial-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          transform: rotate(150deg);
        }

        .rl-dial-center {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          margin-top: 4px;
        }

        .rl-boost-num {
          font-size: 38px;
          font-weight: 800;
          line-height: 0.95;
          color: #ffbb33;
          text-shadow: 0 0 16px rgba(255, 170, 0, 0.55);
        }

        .rl-boost-num.supersonic {
          color: #00f0ff;
          text-shadow: 0 0 18px rgba(0, 240, 255, 0.85);
        }

        .rl-boost-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.14em;
          color: #8aa0be;
          margin-top: 2px;
        }

        .rl-speed-readout {
          font-size: 12px;
          font-weight: 700;
          color: #dbe9ff;
          margin-top: 4px;
        }

        /* Bottom-Left 2D Tactical Pitch Radar & Controls Strip */
        .rl-bottom-left {
          position: absolute;
          bottom: 16px;
          left: 18px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: none;
        }

        .rl-radar-card {
          position: relative;
          width: 188px;
          height: 116px;
          background: rgba(8, 13, 24, 0.82);
          border: 1px solid rgba(148, 182, 225, 0.28);
          border-radius: 6px;
          padding: 4px;
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        }

        .rl-radar-canvas {
          width: 100%;
          height: 100%;
          display: block;
        }

        .rl-controls-strip {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 12px;
          background: rgba(8, 13, 24, 0.78);
          border: 1px solid rgba(148, 182, 225, 0.22);
          border-radius: 5px;
          font-size: 11px;
          color: #b8cce4;
          backdrop-filter: blur(8px);
        }

        .rl-cam-pill {
          padding: 2px 8px;
          border-radius: 3px;
          background: rgba(0, 229, 255, 0.16);
          border: 1px solid rgba(0, 229, 255, 0.45);
          color: #00f0ff;
          font-weight: 700;
          font-size: 11px;
        }

        /* Collapsible Match & Physics Director Drawer [TAB] */
        .rl-director-drawer {
          position: absolute;
          top: 56px;
          right: 18px;
          bottom: 18px;
          width: 336px;
          max-height: calc(100vh - 76px);
          background: rgba(8, 13, 24, 0.92);
          border: 1px solid rgba(148, 182, 225, 0.32);
          border-radius: 8px;
          box-shadow: -12px 16px 42px rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(16px);
          padding: 14px 16px;
          overflow-y: auto;
          pointer-events: auto;
          transform: translateX(370px);
          opacity: 0;
          transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.18s ease;
        }

        .rl-director-drawer.open {
          transform: translateX(0);
          opacity: 1;
        }

        .rl-drawer-section {
          margin-bottom: 14px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(148, 182, 225, 0.14);
        }

        .rl-drawer-section:last-child {
          border-bottom: none;
          margin-bottom: 0;
        }

        .rl-drawer-title {
          font-size: 12px;
          font-weight: 700;
          color: #8aa0be;
          margin-bottom: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .rl-btn-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 6px;
        }

        .rl-btn-grid.cols-3 {
          grid-template-columns: repeat(3, 1fr);
        }

        .rl-drawer-btn {
          background: rgba(18, 29, 48, 0.78);
          border: 1px solid rgba(148, 182, 225, 0.22);
          color: #dceaff;
          font-family: inherit;
          font-size: 11px;
          font-weight: 600;
          padding: 6px 8px;
          border-radius: 4px;
          cursor: pointer;
          text-align: left;
          transition: background 0.12s ease, border-color 0.12s ease;
        }

        .rl-drawer-btn:hover {
          background: rgba(0, 136, 255, 0.28);
          border-color: #00e5ff;
        }

        .rl-drawer-btn.active {
          background: rgba(0, 136, 255, 0.36);
          border-color: #00f0ff;
          color: #ffffff;
        }

        .rl-slider-row {
          display: flex;
          flex-direction: column;
          gap: 3px;
          margin-bottom: 8px;
        }

        .rl-slider-header {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #cfe0f5;
        }

        .rl-slider-input {
          width: 100%;
          accent-color: #00e5ff;
          cursor: pointer;
        }

        @media (max-width: 1024px) {
          .rl-top-bar {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            gap: 6px;
          }
          .rl-quick-actions {
            position: static;
            display: flex;
            gap: 6px;
            justify-content: center;
            flex-wrap: wrap;
          }
          .rl-controls-strip .rl-keys-text {
            display: none;
          }
          .rl-team-wing {
            min-width: 112px;
            padding: 6px 14px;
          }
          .rl-director-drawer {
            top: 96px;
            max-height: calc(100vh - 114px);
            width: min(336px, calc(100vw - 36px));
          }
        }

        @media (max-width: 520px) {
          .rl-top-bar {
            top: 10px;
            left: 10px;
            right: 10px;
            gap: 4px;
          }
          .rl-scoreboard-wrap {
            transform: scale(0.84);
            transform-origin: top center;
            margin-bottom: -6px;
          }
          .rl-team-wing {
            min-width: 88px;
            padding: 6px 10px;
            gap: 8px;
          }
          .rl-clock-core {
            min-width: 96px;
            padding: 4px 12px;
          }
          .rl-action-btn {
            font-size: 10px;
            padding: 4px 8px;
          }
          .rl-bottom-left {
            bottom: 12px;
            left: 10px;
            transform: scale(0.80);
            transform-origin: bottom left;
          }
          .rl-boost-cluster {
            bottom: 12px;
            right: 10px;
            transform: scale(0.80);
            transform-origin: bottom right;
          }
          .rl-phase-pill {
            min-width: 170px;
          }
          .rl-director-drawer {
            top: 86px;
            left: 10px;
            right: 10px;
            width: calc(100vw - 20px);
            max-height: calc(100vh - 98px);
          }
        }

        /* [SPEC PATCH #11] Broadcast Esports Start Screen (Main Menu Overlay) */
        #hud-root.in-main-menu .rl-top-bar,
        #hud-root.in-main-menu .rl-bottom-left,
        #hud-root.in-main-menu .rl-boost-cluster,
        #hud-root.in-main-menu .rl-center-stage,
        #hud-root.in-main-menu .rl-replay-overlay,
        #hud-root.in-main-menu .rl-director-drawer {
          opacity: 0 !important;
          pointer-events: none !important;
        }

        .rl-start-screen {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: radial-gradient(circle at 50% 38%, rgba(6, 12, 24, 0.18) 0%, rgba(4, 8, 18, 0.62) 100%);
          pointer-events: auto;
        }

        .rl-start-screen.visible {
          display: flex;
        }

        .rl-start-card {
          width: min(860px, 100%);
          max-height: calc(100vh - 32px);
          overflow-y: auto;
          background: linear-gradient(155deg, rgba(8, 14, 28, 0.88) 0%, rgba(12, 22, 42, 0.92) 100%);
          backdrop-filter: blur(14px);
          border: 1px solid rgba(0, 229, 255, 0.36);
          border-radius: 12px;
          box-shadow: 0 24px 68px rgba(0, 0, 0, 0.82), 0 0 42px rgba(0, 168, 255, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.14);
          padding: 26px 30px 22px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .rl-start-hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 6px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(148, 182, 225, 0.18);
        }

        .rl-start-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 4px 14px;
          border-radius: 999px;
          background: rgba(0, 229, 255, 0.14);
          border: 1px solid rgba(0, 229, 255, 0.45);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.16em;
          color: #00f0ff;
        }

        .rl-start-title {
          font-size: clamp(26px, 4vw, 42px);
          font-weight: 800;
          font-style: italic;
          letter-spacing: 0.05em;
          line-height: 1.05;
          color: #ffffff;
          text-shadow: 0 0 28px rgba(0, 229, 255, 0.55), 0 4px 14px rgba(0, 0, 0, 0.85);
          margin: 2px 0 0;
        }

        .rl-start-subtitle {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: #9cb4d4;
        }

        .rl-start-section-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #8aa4c6;
          margin-bottom: 8px;
        }

        .rl-start-mode-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 10px;
        }

        .rl-start-mode-card {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 6px;
          padding: 12px 12px;
          border-radius: 8px;
          background: rgba(15, 25, 44, 0.82);
          border: 1px solid rgba(148, 182, 225, 0.24);
          color: #e4f0ff;
          font-family: inherit;
          text-align: left;
          cursor: pointer;
          transition: transform 0.14s ease, border-color 0.14s ease, background 0.14s ease, box-shadow 0.14s ease;
        }

        .rl-start-mode-card:hover {
          transform: translateY(-2px);
          border-color: #00e5ff;
          background: rgba(0, 136, 255, 0.22);
        }

        .rl-start-mode-card.active {
          background: linear-gradient(145deg, rgba(0, 140, 255, 0.38) 0%, rgba(0, 229, 255, 0.16) 100%);
          border-color: #00f0ff;
          box-shadow: 0 0 20px rgba(0, 229, 255, 0.32);
        }

        .rl-mode-card-title {
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0.04em;
          color: #ffffff;
        }

        .rl-mode-card-desc {
          font-size: 11px;
          font-weight: 600;
          line-height: 1.3;
          color: #9cb6d8;
        }

        .rl-start-row-split {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }

        .rl-start-diff-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .rl-start-diff-pill {
          padding: 8px 16px;
          border-radius: 6px;
          background: rgba(15, 25, 44, 0.82);
          border: 1px solid rgba(148, 182, 225, 0.26);
          color: #d6e6ff;
          font-family: inherit;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.06em;
          cursor: pointer;
          transition: all 0.14s ease;
        }

        .rl-start-diff-pill:hover {
          border-color: #ffaa00;
          color: #ffffff;
        }

        .rl-start-diff-pill.active {
          background: linear-gradient(135deg, rgba(255, 136, 0, 0.38), rgba(255, 187, 0, 0.20));
          border-color: #ffbb00;
          color: #ffdd66;
          box-shadow: 0 0 16px rgba(255, 170, 0, 0.28);
        }

        .rl-start-cta {
          padding: 13px 32px;
          border-radius: 8px;
          background: linear-gradient(90deg, #0099ff 0%, #00e5ff 52%, #ff7700 100%);
          border: 1px solid #ffffff;
          color: #040914;
          font-family: inherit;
          font-size: 16px;
          font-weight: 800;
          letter-spacing: 0.08em;
          cursor: pointer;
          box-shadow: 0 0 28px rgba(0, 229, 255, 0.55), 0 8px 20px rgba(0, 0, 0, 0.6);
          transition: transform 0.14s ease, box-shadow 0.14s ease;
        }

        .rl-start-cta:hover {
          transform: translateY(-2px) scale(1.01);
          box-shadow: 0 0 36px rgba(0, 240, 255, 0.8), 0 10px 26px rgba(0, 0, 0, 0.7);
        }

        .rl-start-controls-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 8px 10px;
          padding: 9px 12px;
          border-radius: 8px;
          background: rgba(5, 10, 20, 0.78);
          border: 1px solid rgba(148, 182, 225, 0.16);
          font-size: 10.5px;
          color: #b4cae8;
        }

        .rl-keycap {
          display: inline-block;
          padding: 2px 6px;
          margin-right: 4px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(0, 229, 255, 0.42);
          color: #00f0ff;
          font-family: 'JetBrains Mono', monospace;
          font-size: 9.5px;
          font-weight: 700;
        }

        /* [SPEC PATCH #12] Pause Menu Modal Overlay */
        .rl-pause-modal {
          position: fixed;
          inset: 0;
          z-index: 48;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(5, 9, 18, 0.46);
          pointer-events: auto;
        }

        .rl-pause-modal.visible {
          display: flex;
        }

        .rl-pause-card {
          width: min(420px, 100%);
          background: linear-gradient(160deg, rgba(10, 17, 32, 0.92) 0%, rgba(14, 25, 46, 0.95) 100%);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(0, 229, 255, 0.42);
          border-radius: 10px;
          box-shadow: 0 20px 56px rgba(0, 0, 0, 0.82), 0 0 32px rgba(0, 229, 255, 0.22);
          padding: 24px 26px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          text-align: center;
        }

        .rl-pause-title {
          font-size: 28px;
          font-weight: 800;
          font-style: italic;
          letter-spacing: 0.08em;
          color: #ffffff;
          text-shadow: 0 0 20px rgba(0, 229, 255, 0.55);
        }

        .rl-pause-status {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #ffbb33;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(148, 182, 225, 0.18);
        }

        .rl-pause-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .rl-pause-btn {
          width: 100%;
          padding: 11px 16px;
          border-radius: 6px;
          background: rgba(18, 30, 52, 0.88);
          border: 1px solid rgba(148, 182, 225, 0.28);
          color: #e6f2ff;
          font-family: inherit;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.06em;
          cursor: pointer;
          transition: all 0.14s ease;
        }

        .rl-pause-btn:hover {
          background: rgba(0, 136, 255, 0.32);
          border-color: #00f0ff;
          color: #ffffff;
        }

        .rl-pause-btn.primary {
          background: linear-gradient(90deg, rgba(0, 153, 255, 0.45), rgba(0, 229, 255, 0.28));
          border-color: #00f0ff;
          color: #00f8ff;
        }

        @media (max-width: 780px) {
          .rl-start-mode-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .rl-start-card {
            padding: 18px 16px;
            gap: 12px;
          }
          .rl-start-row-split {
            flex-direction: column;
            align-items: stretch;
          }
          .rl-start-cta {
            width: 100%;
            text-align: center;
          }
        }
      `;
      document.head.appendChild(style);
    }

    const circumference = 2 * Math.PI * 56;
    const arcLength = circumference * (240 / 360);

    this.container.innerHTML = `
      <div class="rl-top-bar">
        <div class="rl-scoreboard-wrap" id="rl-scoreboard">
          <div class="rl-team-wing blue">
            <span class="rl-team-name">BLUE</span>
            <span class="rl-team-score rl-mono" id="rl-score-blue">0</span>
          </div>
          <div class="rl-clock-core">
            <div class="rl-clock-readout rl-mono" id="rl-match-clock">05:00</div>
            <div class="rl-mode-badge" id="rl-mode-badge">1V1 DUEL</div>
          </div>
          <div class="rl-team-wing orange">
            <span class="rl-team-score rl-mono" id="rl-score-orange">0</span>
            <span class="rl-team-name">ORANGE</span>
          </div>
        </div>

        <div class="rl-quick-actions">
          <button class="rl-action-btn" id="rl-btn-pause" title="Pause Match (ESC / P)">⏸ PAUSE [ESC]</button>
          <button class="rl-action-btn active" id="rl-btn-ballcam" title="Toggle Ball-Cam (C)">[C] Ball Cam</button>
          <button class="rl-action-btn" id="rl-btn-mute" title="Toggle Audio Mute (M)">[M] Mute</button>
          <button class="rl-action-btn" id="rl-btn-director" title="Toggle Match & Physics Director (Tab)">[TAB] Director</button>
        </div>
      </div>

      <div class="rl-center-stage">
        <div class="rl-countdown-text" id="rl-countdown-banner"></div>
        <div class="rl-goal-banner" id="rl-goal-banner">
          <div class="rl-goal-title" id="rl-goal-title">GOAL!</div>
          <div class="rl-goal-sub rl-mono" id="rl-goal-sub">BLUE SCORES • 118 KPH</div>
        </div>
        <div class="rl-medal-stack" id="rl-medal-stack"></div>
      </div>

      <div class="rl-replay-overlay" id="rl-replay-overlay">
        <div class="rl-replay-dot"></div>
        <div>
          <div style="font-size:13px;font-weight:800;letter-spacing:0.08em;color:#ffffff;">● INSTANT REPLAY</div>
          <div class="rl-mono" id="rl-replay-meta" style="font-size:11px;color:#ffbb00;">0.4x APEX SLOW-MO</div>
        </div>
        <button class="rl-action-btn" id="rl-btn-skip-replay">PRESS [SPACE] TO SKIP</button>
      </div>

      <div class="rl-bottom-left">
        <div class="rl-radar-card">
          <canvas class="rl-radar-canvas" id="rl-radar-canvas" width="360" height="220"></canvas>
        </div>
        <div class="rl-controls-strip">
          <span class="rl-cam-pill" id="rl-cam-status-pill">BALL CAM: ON [C]</span>
          <span class="rl-keys-text">WASD Drive/Air • SPACE Jump/Flip • F/Click Boost • SHIFT Drift • ESC Pause</span>
        </div>
      </div>

      <div class="rl-boost-cluster">
        <div class="rl-phase-pill" id="rl-phase-pill">
          <div class="rl-phase-header">
            <span id="rl-phase-name">m1 Boost Blitz</span>
            <span class="rl-mono" id="rl-phase-stage">t0 ANTICIPATION</span>
          </div>
          <div class="rl-phase-bar-bg">
            <div class="rl-phase-bar-fill" id="rl-phase-bar"></div>
          </div>
        </div>

        <div class="rl-dial-box">
          <svg class="rl-dial-svg" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="56" fill="none" stroke="rgba(148, 182, 225, 0.16)" stroke-width="10"
              stroke-dasharray="${arcLength.toFixed(1)} ${circumference.toFixed(1)}" stroke-linecap="round" />
            <circle id="rl-boost-arc" cx="70" cy="70" r="56" fill="none" stroke="#ffaa00" stroke-width="10"
              stroke-dasharray="${arcLength.toFixed(1)} ${circumference.toFixed(1)}"
              stroke-dashoffset="${(arcLength * 0.66).toFixed(1)}" stroke-linecap="round" />
          </svg>
          <div class="rl-dial-center">
            <div class="rl-boost-num rl-mono" id="rl-boost-num">33</div>
            <div class="rl-boost-label">BOOST</div>
            <div class="rl-speed-readout rl-mono" id="rl-speed-readout">0 KPH</div>
          </div>
        </div>
      </div>

      <aside class="rl-director-drawer" id="rl-director-drawer" aria-label="Match and Physics Director">
        <div class="rl-drawer-section">
          <div class="rl-drawer-title">
            <span>Match mode</span>
            <button class="rl-drawer-btn" id="rl-btn-reset-match" style="padding:3px 8px;">Reset kickoff [R]</button>
          </div>
          <div class="rl-btn-grid" id="rl-mode-buttons">
            <button class="rl-drawer-btn active" data-mode="1v1">1v1 Duel</button>
            <button class="rl-drawer-btn" data-mode="2v2">2v2 Doubles</button>
            <button class="rl-drawer-btn" data-mode="3v3">3v3 Standard</button>
            <button class="rl-drawer-btn" data-mode="Free Play">Free Play</button>
            <button class="rl-drawer-btn" data-mode="Autopilot" style="grid-column: span 2;">Autopilot Showcase</button>
          </div>
        </div>

        <div class="rl-drawer-section">
          <div class="rl-drawer-title"><span>Bot difficulty</span></div>
          <div class="rl-btn-grid cols-3" id="rl-difficulty-buttons">
            <button class="rl-drawer-btn" data-diff="Rookie">Rookie</button>
            <button class="rl-drawer-btn active" data-diff="Pro">Pro</button>
            <button class="rl-drawer-btn" data-diff="All-Star">All-Star</button>
          </div>
        </div>

        <div class="rl-drawer-section">
          <div class="rl-drawer-title"><span>Physics mutators</span></div>
          <div class="rl-slider-row">
            <div class="rl-slider-header"><span>Gravity</span><span class="rl-mono" id="rl-val-gravity">1.00x</span></div>
            <input type="range" class="rl-slider-input" id="rl-slider-gravity" min="0.3" max="2.0" step="0.05" value="1.0" />
          </div>
          <div class="rl-slider-row">
            <div class="rl-slider-header"><span>Boost Power</span><span class="rl-mono" id="rl-val-boost">1.00x</span></div>
            <input type="range" class="rl-slider-input" id="rl-slider-boost" min="0.5" max="2.5" step="0.05" value="1.0" />
          </div>
          <div class="rl-slider-row">
            <div class="rl-slider-header"><span>Ball Bounciness</span><span class="rl-mono" id="rl-val-bounce">0.65</span></div>
            <input type="range" class="rl-slider-input" id="rl-slider-bounce" min="0.4" max="0.9" step="0.02" value="0.65" />
          </div>
          <div class="rl-slider-row">
            <div class="rl-slider-header"><span>Game Speed</span><span class="rl-mono" id="rl-val-speed">1.00x</span></div>
            <input type="range" class="rl-slider-input" id="rl-slider-speed" min="0.25" max="1.5" step="0.05" value="1.0" />
          </div>
        </div>

        <div class="rl-drawer-section">
          <div class="rl-drawer-title"><span>Choreographed movements (1–5)</span></div>
          <div class="rl-btn-grid" id="rl-movement-buttons">
            <button class="rl-drawer-btn" data-move="m1_supersonic_boost_blitz">[1] m1 Boost Blitz</button>
            <button class="rl-drawer-btn" data-move="m2_powerslide_drift_hook">[2] m2 Powerslide Drift</button>
            <button class="rl-drawer-btn" data-move="m3_double_jump_front_flip_strike">[3] m3 Front-Flip Strike</button>
            <button class="rl-drawer-btn" data-move="m4_aerial_pitch_thruster_flight">[4] m4 Aerial Redirect</button>
            <button class="rl-drawer-btn" data-move="m5_goal_explosion_shockwave" style="grid-column: span 2;">[5] m5 Goal Explosion</button>
          </div>
        </div>

        <div class="rl-drawer-section">
          <div class="rl-drawer-title"><span>Studio 6-angle diagnostic camera</span></div>
          <div class="rl-btn-grid" id="rl-studio-buttons">
            <button class="rl-drawer-btn active" data-studio="Live Game">Live Game</button>
            <button class="rl-drawer-btn" data-studio="side">Side</button>
            <button class="rl-drawer-btn" data-studio="front_34">Front 3/4</button>
            <button class="rl-drawer-btn" data-studio="front">Front</button>
            <button class="rl-drawer-btn" data-studio="top">Top</button>
            <button class="rl-drawer-btn" data-studio="rear_34">Rear 3/4</button>
            <button class="rl-drawer-btn" data-studio="closeup">Closeup / Ground Check</button>
            <button class="rl-drawer-btn" data-studio="exploded">Exploded Rig</button>
          </div>
        </div>
      </aside>

      <!-- [SPEC PATCH #11] Broadcast Esports Start Screen Overlay -->
      <section class="rl-start-screen" id="rl-start-screen" aria-label="Rocket Arena Main Menu">
        <div class="rl-start-card">
          <div class="rl-start-hero">
            <div class="rl-start-kicker">CHAMPIONSHIP ARENA EDITION • 120HZ RIGID-BODY PHYSICS</div>
            <h1 class="rl-start-title">ROCKET ARENA — SOC-CAR CHAMPIONSHIP</h1>
            <div class="rl-start-subtitle">OCTANE-NOMAD TWIN-TURBO BATTLE-CARS • TRUE GEODESIC ROLL &amp; AERIAL FLIGHT</div>
          </div>

          <div>
            <div class="rl-start-section-label">SELECT MATCH MODE</div>
            <div class="rl-start-mode-grid" id="rl-start-mode-cards">
              <button class="rl-start-mode-card active" data-start-mode="1v1">
                <span class="rl-mode-card-title">1v1 DUEL</span>
                <span class="rl-mode-card-desc">Solo Striker Showdown vs AI</span>
              </button>
              <button class="rl-start-mode-card" data-start-mode="2v2">
                <span class="rl-mode-card-title">2v2 DOUBLES</span>
                <span class="rl-mode-card-desc">Striker + Goalie Tactical Squads</span>
              </button>
              <button class="rl-start-mode-card" data-start-mode="3v3">
                <span class="rl-mode-card-title">3v3 STANDARD</span>
                <span class="rl-mode-card-desc">Full 6-Car Championship Pitch</span>
              </button>
              <button class="rl-start-mode-card" data-start-mode="Free Play">
                <span class="rl-mode-card-title">FREE PLAY</span>
                <span class="rl-mode-card-desc">Unlimited Boost Aerial Training</span>
              </button>
              <button class="rl-start-mode-card" data-start-mode="Autopilot">
                <span class="rl-mode-card-title">AUTOPILOT</span>
                <span class="rl-mode-card-desc">5-Movement Choreographed Cinema</span>
              </button>
            </div>
          </div>

          <div class="rl-start-row-split">
            <div>
              <div class="rl-start-section-label">BOT SKILL TIER</div>
              <div class="rl-start-diff-group" id="rl-start-diff-pills">
                <button class="rl-start-diff-pill" data-start-diff="Rookie">ROOKIE</button>
                <button class="rl-start-diff-pill active" data-start-diff="Pro">PRO</button>
                <button class="rl-start-diff-pill" data-start-diff="All-Star">ALL-STAR</button>
              </div>
            </div>

            <button class="rl-start-cta" id="rl-btn-play-match">▶ PLAY MATCH [ENTER / CLICK]</button>
          </div>

          <div class="rl-start-controls-bar">
            <span><kbd class="rl-keycap">W A S D</kbd>Drive &amp; Air Pitch/Roll</span>
            <span><kbd class="rl-keycap">SPACE</kbd>Jump / Double-Jump Flip</span>
            <span><kbd class="rl-keycap">F / CLICK</kbd>Rocket Boost</span>
            <span><kbd class="rl-keycap">SHIFT</kbd>Powerslide Drift</span>
            <span><kbd class="rl-keycap">C</kbd>Ball-Cam</span>
            <span><kbd class="rl-keycap">ESC / P</kbd>Pause Menu</span>
          </div>
        </div>
      </section>

      <!-- [SPEC PATCH #12] Pause Menu Modal Overlay -->
      <section class="rl-pause-modal" id="rl-pause-modal" aria-label="Pause Menu">
        <div class="rl-pause-card">
          <div class="rl-pause-title">MATCH PAUSED</div>
          <div class="rl-pause-status rl-mono" id="rl-pause-status">1V1 DUEL • BLUE 0 — 0 ORANGE</div>
          <div class="rl-pause-actions">
            <button class="rl-pause-btn primary" id="rl-btn-resume-match">▶ RESUME MATCH [ESC]</button>
            <button class="rl-pause-btn" id="rl-btn-restart-match">↻ RESTART MATCH</button>
            <button class="rl-pause-btn" id="rl-btn-pause-director">⚙ DIRECTOR &amp; MUTATORS [TAB]</button>
            <button class="rl-pause-btn" id="rl-btn-main-menu">🏠 MAIN MENU (START SCREEN)</button>
          </div>
        </div>
      </section>
    `;

    this._els = {
      scoreBlue: this.container.querySelector('#rl-score-blue'),
      scoreOrange: this.container.querySelector('#rl-score-orange'),
      matchClock: this.container.querySelector('#rl-match-clock'),
      modeBadge: this.container.querySelector('#rl-mode-badge'),
      btnPause: this.container.querySelector('#rl-btn-pause'),
      btnBallCam: this.container.querySelector('#rl-btn-ballcam'),
      btnMute: this.container.querySelector('#rl-btn-mute'),
      btnDirector: this.container.querySelector('#rl-btn-director'),
      countdownBanner: this.container.querySelector('#rl-countdown-banner'),
      goalBanner: this.container.querySelector('#rl-goal-banner'),
      goalTitle: this.container.querySelector('#rl-goal-title'),
      goalSub: this.container.querySelector('#rl-goal-sub'),
      medalStack: this.container.querySelector('#rl-medal-stack'),
      replayOverlay: this.container.querySelector('#rl-replay-overlay'),
      replayMeta: this.container.querySelector('#rl-replay-meta'),
      btnSkipReplay: this.container.querySelector('#rl-btn-skip-replay'),
      radarCanvas: this.container.querySelector('#rl-radar-canvas'),
      camStatusPill: this.container.querySelector('#rl-cam-status-pill'),
      phasePill: this.container.querySelector('#rl-phase-pill'),
      phaseName: this.container.querySelector('#rl-phase-name'),
      phaseStage: this.container.querySelector('#rl-phase-stage'),
      phaseBar: this.container.querySelector('#rl-phase-bar'),
      boostArc: this.container.querySelector('#rl-boost-arc'),
      boostNum: this.container.querySelector('#rl-boost-num'),
      speedReadout: this.container.querySelector('#rl-speed-readout'),
      drawer: this.container.querySelector('#rl-director-drawer'),
      btnResetMatch: this.container.querySelector('#rl-btn-reset-match'),
      startScreen: this.container.querySelector('#rl-start-screen'),
      btnPlayMatch: this.container.querySelector('#rl-btn-play-match'),
      pauseModal: this.container.querySelector('#rl-pause-modal'),
      pauseStatus: this.container.querySelector('#rl-pause-status'),
      btnResumeMatch: this.container.querySelector('#rl-btn-resume-match'),
      btnRestartMatch: this.container.querySelector('#rl-btn-restart-match'),
      btnPauseDirector: this.container.querySelector('#rl-btn-pause-director'),
      btnMainMenu: this.container.querySelector('#rl-btn-main-menu')
    };

    this._radarCtx = this._els.radarCanvas ? this._els.radarCanvas.getContext('2d') : null;
    this._arcLength = arcLength;
  }

  _bindEvents() {
    if (!this.container) return;

    this._els.btnDirector?.addEventListener('click', () => {
      this.toggleDrawer();
    });

    this._els.btnPause?.addEventListener('click', () => {
      if (typeof this.options.onTogglePause === 'function') {
        this.options.onTogglePause();
      } else if (typeof window.__RL_GAME__?.togglePause === 'function') {
        window.__RL_GAME__.togglePause();
      }
    });

    // Start Screen Mode Cards & Difficulty Pills ([SPEC PATCH #11])
    this.container.querySelectorAll('#rl-start-mode-cards [data-start-mode]').forEach((card) => {
      card.addEventListener('click', () => {
        const mode = card.getAttribute('data-start-mode');
        this.setMatchMode(mode);
      });
    });

    this.container.querySelectorAll('#rl-start-diff-pills [data-start-diff]').forEach((pill) => {
      pill.addEventListener('click', () => {
        const diff = pill.getAttribute('data-start-diff');
        this.setBotDifficulty(diff);
        if (typeof this.options.onDifficultyChange === 'function') {
          this.options.onDifficultyChange(diff);
        }
      });
    });

    this._els.btnPlayMatch?.addEventListener('click', () => {
      if (typeof this.options.onStartGame === 'function') {
        this.options.onStartGame(this.activeMode, this.activeDifficulty);
      } else if (typeof window.__RL_GAME__?.startGame === 'function') {
        window.__RL_GAME__.startGame(this.activeMode, this.activeDifficulty);
      }
    });

    // Pause Modal Buttons ([SPEC PATCH #12])
    this._els.btnResumeMatch?.addEventListener('click', () => {
      if (typeof this.options.onTogglePause === 'function') {
        this.options.onTogglePause(false);
      } else if (typeof window.__RL_GAME__?.togglePause === 'function') {
        window.__RL_GAME__.togglePause(false);
      }
    });

    this._els.btnRestartMatch?.addEventListener('click', () => {
      if (typeof this.options.onRestartMatch === 'function') {
        this.options.onRestartMatch(this.activeMode);
      } else if (typeof window.__RL_GAME__?.resetMatch === 'function') {
        window.__RL_GAME__.togglePause?.(false);
        window.__RL_GAME__.resetMatch(this.activeMode);
      }
    });

    this._els.btnPauseDirector?.addEventListener('click', () => {
      if (typeof this.options.onTogglePause === 'function') {
        this.options.onTogglePause(false);
      } else if (typeof window.__RL_GAME__?.togglePause === 'function') {
        window.__RL_GAME__.togglePause(false);
      }
      this.setDrawerOpen(true);
    });

    this._els.btnMainMenu?.addEventListener('click', () => {
      if (typeof this.options.onMainMenu === 'function') {
        this.options.onMainMenu();
      } else if (typeof window.__RL_GAME__?.showMainMenu === 'function') {
        window.__RL_GAME__.showMainMenu();
      }
    });

    this._els.btnBallCam?.addEventListener('click', () => {
      this.ballCamEnabled = !this.ballCamEnabled;
      this._syncCameraBadge();
      if (typeof this.options.onToggleBallCam === 'function') {
        this.options.onToggleBallCam(this.ballCamEnabled);
      } else if (window.__RL_GAME__?.cameraDirector) {
        window.__RL_GAME__.cameraDirector.toggleBallCam();
      }
    });

    this._els.btnMute?.addEventListener('click', () => {
      this.muted = !this.muted;
      this._els.btnMute.textContent = this.muted ? '[M] Muted' : '[M] Mute';
      this._els.btnMute.classList.toggle('active', this.muted);
      if (typeof this.options.onToggleMute === 'function') {
        this.options.onToggleMute(this.muted);
      } else if (window.__RL_GAME__?.audio) {
        window.__RL_GAME__.audio.setMuted(this.muted);
      }
    });

    this._els.btnSkipReplay?.addEventListener('click', () => {
      if (typeof this.options.onSkipReplay === 'function') {
        this.options.onSkipReplay();
      } else if (window.__RL_GAME__?.replaySystem) {
        window.__RL_GAME__.replaySystem.skip();
      }
    });

    this._els.btnResetMatch?.addEventListener('click', () => {
      if (typeof this.options.onResetMatch === 'function') {
        this.options.onResetMatch(this.activeMode);
      } else if (typeof window.__RL_GAME__?.resetMatch === 'function') {
        window.__RL_GAME__.resetMatch(this.activeMode);
      }
    });

    // Mode buttons
    this.container.querySelectorAll('#rl-mode-buttons [data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        this.setMatchMode(mode);
        if (typeof this.options.onModeChange === 'function') {
          this.options.onModeChange(mode);
        } else if (mode === 'Autopilot' && typeof window.__START_AUTOPILOT__ === 'function') {
          window.__START_AUTOPILOT__();
        } else if (typeof window.__RL_GAME__?.resetMatch === 'function') {
          window.__RL_GAME__.resetMatch(mode);
        }
      });
    });

    // Difficulty buttons
    this.container.querySelectorAll('#rl-difficulty-buttons [data-diff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const diff = btn.getAttribute('data-diff');
        this.setBotDifficulty(diff);
        if (typeof this.options.onDifficultyChange === 'function') {
          this.options.onDifficultyChange(diff);
        } else if (window.__RL_GAME__?.setBotDifficulty) {
          window.__RL_GAME__.setBotDifficulty(diff);
        }
      });
    });

    // Physics Mutator Sliders
    const bindSlider = (id, valId, key, suffix = 'x') => {
      const input = this.container.querySelector(id);
      const valEl = this.container.querySelector(valId);
      if (!input) return;
      input.addEventListener('input', () => {
        const val = parseFloat(input.value);
        this.mutators[key] = val;
        if (valEl) valEl.textContent = `${val.toFixed(2)}${suffix}`;
        if (typeof this.options.onMutatorChange === 'function') {
          this.options.onMutatorChange({ ...this.mutators }, key, val);
        } else if (window.__SIM_STATE__?.activeMutators) {
          window.__SIM_STATE__.activeMutators[key] = val;
        }
      });
    };
    bindSlider('#rl-slider-gravity', '#rl-val-gravity', 'gravity', 'x');
    bindSlider('#rl-slider-boost', '#rl-val-boost', 'boostPower', 'x');
    bindSlider('#rl-slider-bounce', '#rl-val-bounce', 'ballBounciness', '');
    bindSlider('#rl-slider-speed', '#rl-val-speed', 'gameSpeed', 'x');

    // Choreographed Movement Trigger Buttons
    this.container.querySelectorAll('#rl-movement-buttons [data-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const moveId = btn.getAttribute('data-move');
        if (typeof this.options.onTriggerMovement === 'function') {
          this.options.onTriggerMovement(moveId);
        } else if (typeof window.__RL_GAME__?.triggerMovement === 'function') {
          window.__RL_GAME__.triggerMovement(moveId);
        }
      });
    });

    // Studio 6-Angle Switcher
    this.container.querySelectorAll('#rl-studio-buttons [data-studio]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const angle = btn.getAttribute('data-studio');
        this.activeStudioAngle = angle;
        this.container
          .querySelectorAll('#rl-studio-buttons [data-studio]')
          .forEach((b) => b.classList.toggle('active', b === btn));
        const enabled = angle !== 'Live Game';
        if (typeof this.options.onStudioAngleChange === 'function') {
          this.options.onStudioAngleChange(enabled, angle);
        } else if (typeof window.__RL_GAME__?.setStudioMode === 'function') {
          window.__RL_GAME__.setStudioMode(enabled, angle);
        }
      });
    });
  }

  showStartScreen(visible = true) {
    this.startScreenVisible = Boolean(visible);
    if (this._els?.startScreen) {
      this._els.startScreen.classList.toggle('visible', this.startScreenVisible);
    }
    if (this.container) {
      this.container.classList.toggle('in-main-menu', this.startScreenVisible);
    }
    if (this.startScreenVisible) {
      this.showPauseModal(false);
      this.setDrawerOpen(false);
    }
    return this.startScreenVisible;
  }

  showPauseModal(visible = true) {
    this.pauseModalVisible = Boolean(visible);
    if (this._els?.pauseModal) {
      this._els.pauseModal.classList.toggle('visible', this.pauseModalVisible);
    }
    if (this._els?.btnPause) {
      this._els.btnPause.classList.toggle('active', this.pauseModalVisible);
      this._els.btnPause.textContent = this.pauseModalVisible ? '▶ RESUME [ESC]' : '⏸ PAUSE [ESC]';
    }
    return this.pauseModalVisible;
  }

  setBotDifficulty(diff) {
    this.activeDifficulty = diff;
    if (!this.container) return;
    this.container
      .querySelectorAll('#rl-difficulty-buttons [data-diff]')
      .forEach((b) => b.classList.toggle('active', b.getAttribute('data-diff') === diff));
    this.container
      .querySelectorAll('#rl-start-diff-pills [data-start-diff]')
      .forEach((b) => b.classList.toggle('active', b.getAttribute('data-start-diff') === diff));
  }

  toggleDrawer(forceState = null) {
    this.drawerOpen = forceState !== null ? Boolean(forceState) : !this.drawerOpen;
    if (this._els?.drawer) {
      this._els.drawer.classList.toggle('open', this.drawerOpen);
    }
    if (this._els?.btnDirector) {
      this._els.btnDirector.classList.toggle('active', this.drawerOpen);
    }
    return this.drawerOpen;
  }

  setDrawerOpen(open) {
    return this.toggleDrawer(Boolean(open));
  }

  setMatchMode(mode) {
    this.activeMode = mode;
    const labelMap = {
      '1v1': '1V1 DUEL',
      '2v2': '2V2 DOUBLES',
      '3v3': '3V3 STANDARD',
      'Free Play': 'FREE PLAY',
      Autopilot: 'AUTOPILOT'
    };
    if (this._els?.modeBadge) {
      this._els.modeBadge.textContent = labelMap[mode] || String(mode).toUpperCase();
    }
    if (this.container) {
      this.container
        .querySelectorAll('#rl-mode-buttons [data-mode]')
        .forEach((b) => b.classList.toggle('active', b.getAttribute('data-mode') === mode));
      this.container
        .querySelectorAll('#rl-start-mode-cards [data-start-mode]')
        .forEach((b) => b.classList.toggle('active', b.getAttribute('data-start-mode') === mode));
    }
  }

  _syncCameraBadge(modeStr = null) {
    const isBall = modeStr ? modeStr === 'ball' : this.ballCamEnabled;
    this.ballCamEnabled = isBall;
    if (this._els?.camStatusPill) {
      this._els.camStatusPill.textContent = isBall ? 'BALL CAM: ON [C]' : 'CAR CAM: ON [C]';
    }
    if (this._els?.btnBallCam) {
      this._els.btnBallCam.classList.toggle('active', isBall);
      this._els.btnBallCam.textContent = isBall ? '[C] Ball Cam' : '[C] Car Cam';
    }
  }

  showCountdown(text) {
    if (!this._els?.countdownBanner) return;
    if (!text) {
      this._els.countdownBanner.classList.remove('visible');
      this._lastCountdownText = '';
      return;
    }
    const str = String(text);
    this._els.countdownBanner.textContent = str;
    this._els.countdownBanner.style.color =
      str === 'GO!' ? '#00f0ff' : str === '1' ? '#ff6600' : str === '2' ? '#ffbb00' : '#ffffff';
    this._els.countdownBanner.classList.add('visible');
    this._lastCountdownText = str;
  }

  showGoalBanner(scoringTeam = 'blue', shotSpeedKph = 115, scorerName = '') {
    if (!this._els?.goalBanner) return;
    const isOrange = String(scoringTeam).toLowerCase() === 'orange';
    const teamLabel = isOrange ? 'ORANGE' : 'BLUE';
    this._els.goalBanner.style.borderColor = isOrange ? '#ff6600' : '#00e5ff';
    this._els.goalTitle.textContent = `GOAL! — ${teamLabel} SCORES!`;
    this._els.goalSub.textContent = `${scorerName ? scorerName + ' • ' : ''}${Math.round(
      shotSpeedKph
    )} KPH`;
    this._els.goalBanner.classList.add('visible');

    if (this._calloutTimeout) clearTimeout(this._calloutTimeout);
    this._calloutTimeout = setTimeout(() => {
      this._els?.goalBanner?.classList.remove('visible');
    }, 2700);
  }

  hideGoalBanner() {
    this._els?.goalBanner?.classList.remove('visible');
  }

  showMedal(label = 'AERIAL HIT +50') {
    if (!this._els?.medalStack || typeof document === 'undefined') return;
    const pill = document.createElement('div');
    pill.className = 'rl-medal-pill';
    pill.textContent = label;
    this._els.medalStack.appendChild(pill);
    setTimeout(() => {
      if (pill.parentNode) pill.parentNode.removeChild(pill);
    }, 2200);
  }

  _drawRadar(state) {
    const ctx = this._radarCtx;
    if (!ctx || !this._els.radarCanvas) return;
    const w = this._els.radarCanvas.width;
    const h = this._els.radarCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Map world Z in [-100, +100] to radar X in [18, w-18], and world X in [-60, +60] to radar Y in [12, h-12]
    const padX = 18;
    const padY = 12;
    const pitchW = w - padX * 2;
    const pitchH = h - padY * 2;

    const toRadarX = (z) => padX + ((z + 100) / 200) * pitchW;
    const toRadarY = (x) => padY + ((x + 60) / 120) * pitchH;

    // Pitch fill & mowed stripes
    ctx.fillStyle = 'rgba(16, 48, 30, 0.85)';
    ctx.strokeStyle = 'rgba(160, 210, 255, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(padX, padY, pitchW, pitchH, 10);
    ctx.fill();
    ctx.stroke();

    // Center line & circle
    const midX = padX + pitchW * 0.5;
    const midY = padY + pitchH * 0.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(midX, padY);
    ctx.lineTo(midX, padY + pitchH);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(midX, midY, pitchH * (18 / 120), 0, Math.PI * 2);
    ctx.stroke();

    // Blue (-Z left) & Orange (+Z right) goal boxes
    const goalH = pitchH * (28 / 120);
    ctx.fillStyle = 'rgba(0, 136, 255, 0.55)';
    ctx.fillRect(padX - 6, midY - goalH * 0.5, 6, goalH);
    ctx.fillStyle = 'rgba(255, 102, 0, 0.55)';
    ctx.fillRect(padX + pitchW, midY - goalH * 0.5, 6, goalH);

    // 6 Full Boost Pad Dots
    const fullPads = [
      { x: -48, z: -80 },
      { x: 48, z: -80 },
      { x: -50, z: 0 },
      { x: 50, z: 0 },
      { x: -48, z: 80 },
      { x: 48, z: 80 }
    ];
    const simPads = Array.isArray(state?.boostPads) ? state.boostPads : [];
    fullPads.forEach((fp, i) => {
      const rx = toRadarX(fp.z);
      const ry = toRadarY(fp.x);
      const padState = simPads[i];
      const active = padState ? padState.active !== false : true;
      ctx.fillStyle = active ? '#ffbb00' : 'rgba(255, 187, 0, 0.22)';
      ctx.beginPath();
      ctx.arc(rx, ry, 4.2, 0, Math.PI * 2);
      ctx.fill();
    });

    // Cars as oriented chevrons
    const cars = Array.isArray(state?.cars) ? state.cars : [];
    cars.forEach((car, idx) => {
      if (!car || car.demolished) return;
      const cPos = extractPosition(car);
      const cQuat = extractQuaternion(car);
      const fwd = rotateVectorByQuat(0, 0, 1, cQuat);
      const rx = toRadarX(cPos.z);
      const ry = toRadarY(cPos.x);
      const angle = Math.atan2(fwd.x, fwd.z);
      const isOrange = String(car.team).toLowerCase() === 'orange';

      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(angle);
      ctx.fillStyle = isOrange ? '#ff6600' : '#00a8ff';
      ctx.strokeStyle = idx === 0 ? '#ffffff' : 'rgba(0,0,0,0.7)';
      ctx.lineWidth = idx === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-5, -4.5);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-5, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });

    // Ball position
    const bPos = extractPosition(state?.ball, { x: 0, y: 3.2, z: 0 });
    const bx = toRadarX(bPos.z);
    const by = toRadarY(bPos.x);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  update(state = null, telemetry = null) {
    if (!this._els) return;
    const sim = state || (typeof window !== 'undefined' ? window.__SIM_STATE__ : null) || {};
    const motion =
      telemetry || (typeof window !== 'undefined' ? window.__MOTION_TELEMETRY__ : null) || {};

    // 1. Scoreboard & Match Clock
    const blueScore = sim.score?.blue ?? 0;
    const orangeScore = sim.score?.orange ?? 0;
    this._els.scoreBlue.textContent = String(blueScore);
    this._els.scoreOrange.textContent = String(orangeScore);

    const timeSec = Math.max(0, Number.isFinite(sim.timeRemaining) ? sim.timeRemaining : 300);
    const mins = Math.floor(timeSec / 60);
    const secs = Math.floor(timeSec % 60);
    const clockStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const isOT = Boolean(sim.isOvertime);
    this._els.matchClock.textContent = isOT ? `+OT ${clockStr}` : clockStr;
    this._els.matchClock.classList.toggle('overtime', isOT);

    if (this._els.pauseStatus) {
      const modeText = this._els.modeBadge ? this._els.modeBadge.textContent : '1V1 DUEL';
      this._els.pauseStatus.textContent = `${modeText} • BLUE ${blueScore} — ${orangeScore} ORANGE • ${clockStr}`;
    }

    if (sim.inMainMenu !== undefined && Boolean(sim.inMainMenu) !== Boolean(this.startScreenVisible)) {
      this.showStartScreen(Boolean(sim.inMainMenu));
    }
    if (sim.isPaused !== undefined && Boolean(sim.isPaused) !== Boolean(this.pauseModalVisible)) {
      this.showPauseModal(Boolean(sim.isPaused));
    }

    if (sim.cameraMode) {
      this._syncCameraBadge(sim.cameraMode);
    }

    if (this.container) {
      this.container.style.display = sim.studioHudHidden ? 'none' : '';
    }

    // 2. Kickoff Countdown & Instant Replay Banner
    const matchState = sim.matchState || 'LIVE_PLAY';
    const rawCountTimer = Number.isFinite(sim.countdownTimer)
      ? sim.countdownTimer
      : Number.isFinite(sim.stateTimer)
      ? sim.stateTimer
      : Number.isFinite(sim.countdownNumber)
      ? sim.countdownNumber
      : null;

    if (matchState === 'KICKOFF_COUNTDOWN' && rawCountTimer !== null) {
      const cVal = Math.ceil(rawCountTimer);
      this.showCountdown(cVal > 0 ? String(cVal) : 'GO!');
    } else if (sim.countdownText) {
      this.showCountdown(sim.countdownText);
    } else if (this._lastCountdownText) {
      this.showCountdown('');
    }

    const isReplay = matchState === 'INSTANT_REPLAY' || Boolean(sim.isReplay);
    this._els.replayOverlay.classList.toggle('visible', isReplay);
    if (isReplay && this._els.replayMeta) {
      const dil = Number.isFinite(sim.replayTimeDilation) ? sim.replayTimeDilation : 0.4;
      this._els.replayMeta.textContent = `${dil.toFixed(1)}x APEX SLOW-MO • REPLAY`;
    }

    // 3. Player Boost Dial & Live Speed (KPH)
    const playerCar = Array.isArray(sim.cars) && sim.cars.length > 0 ? sim.cars[0] : sim.car || {};
    const boostVal = clamp(Math.round(playerCar.boost ?? 33), 0, 100);
    const cVel = extractVelocity(playerCar);
    const speedMs = Math.hypot(cVel.x, cVel.y, cVel.z);
    const speedKph = Math.round(speedMs * 3.6);
    const isSupersonic = Boolean(playerCar.isSupersonic || speedMs >= 42.0);

    this._els.boostNum.textContent = String(boostVal);
    this._els.boostNum.classList.toggle('supersonic', isSupersonic);
    this._els.speedReadout.textContent = isSupersonic
      ? `${speedKph} KPH • MACH`
      : `${speedKph} KPH`;

    const offset = this._arcLength * (1 - boostVal / 100);
    this._els.boostArc.setAttribute('stroke-dashoffset', offset.toFixed(1));
    this._els.boostArc.setAttribute('stroke', isSupersonic ? '#00f0ff' : '#ffaa00');

    // 4. 4-Phase Choreography Indicator Pill
    const activeMoveId = motion.activeMovementId || sim.activeMovementId || null;
    if (activeMoveId) {
      this._els.phasePill.classList.add('visible');
      const moveLabel = String(activeMoveId)
        .replace(/^m\d_/, '')
        .replace(/_/g, ' ')
        .toUpperCase();
      const phaseShort = String(motion.currentPhase || 't1_primary_drive')
        .toUpperCase()
        .replace(/_/g, ' ');
      const prog = clamp((motion.phaseProgress ?? 0.5) * 100, 0, 100);
      this._els.phaseName.textContent = `${moveLabel} • ${phaseShort}`;
      this._els.phaseStage.textContent = `${Math.round(prog)}%`;
      this._els.phaseBar.style.width = `${prog.toFixed(1)}%`;
    } else {
      this._els.phasePill.classList.remove('visible');
    }

    // 5. 2D Tactical Pitch Radar
    this._drawRadar(sim);
  }
}

// ============================================================================
// GLOBAL EXPORT & MODULE REGISTRY
// ============================================================================

const Presentation = {
  CameraDirector,
  VFXManager,
  AudioSynthesizer,
  ReplaySystem,
  HUDController
};

if (typeof window !== 'undefined') {
  window.RLModules = window.RLModules || {};
  window.RLModules.Presentation = Presentation;
}

})(THREE, THREE);


// ============================================================================
// Module 5: Master Orchestrator (main.js)
// ============================================================================
(function(THREE, THREE_IMPORT) {

const {
  ARENA_CONSTANTS,
  BOOST_PAD_LAYOUT,
  evalArenaSDF,
  createArenaEnvironment
} = window.RLModules.Arena;
const {
  DEFAULT_LOFT_STATIONS,
  createLoftedShellGeometry,
  generateCarLiveryTexture,
  createBattleCarMesh,
  updateBattleCarVisuals,
  setExplodedView,
  createSoccerBallMesh,
  updateSoccerBallVisuals,
  setupStudioInspectionScene
} = window.RLModules.Assets;
const {
  PhysicsWorld,
  MATCH_STATES,
  MOVEMENTS_MANIFEST
} = window.RLModules.Physics;
const {
  CameraDirector,
  VFXManager,
  AudioSynthesizer,
  ReplaySystem,
  HUDController
} = window.RLModules.Presentation;






/**
 * @file src/main.js
 * @description Master Orchestrator for 3D Rocket League (`DFH Neo-Dome` & `Octane-RLX`).
 * Integrates Module 1 (Arena), Module 2 (Vehicles & Ball), Module 3 (Physics & 4-Phase Kinematics),
 * and Module 4 (Camera Director, GPU VFX, Web Audio Foley, Replay System, and Esports HUD).
 */

function initRocketLeagueApp() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  // Track any runtime/console errors for deterministic diagnostics
  let consoleErrorCount = 0;
  window.addEventListener('error', () => {
    consoleErrorCount++;
  });
  window.addEventListener('unhandledrejection', () => {
    consoleErrorCount++;
  });

  // --------------------------------------------------------------------------
  // 1. WEBGL2 RENDERER, SCENE & CAMERA INITIALIZATION
  // --------------------------------------------------------------------------
  const viewportEl = document.getElementById('app') || document.body;

  const getEffectiveViewport = () => {
    const rawW = Math.max(1, window.innerWidth);
    const rawH = Math.max(1, window.innerHeight);
    // macOS desktop Chrome clamps --window-size=390,844 to innerWidth=500 while cropping 390x844
    const isClamped390 = rawW === 500 && rawH === 844;
    const w = isClamped390 ? 390 : rawW;
    const h = rawH;
    const hudEl = document.getElementById('hud-root');
    if (hudEl) {
      hudEl.style.width = isClamped390 ? '390px' : '100vw';
      hudEl.style.right = isClamped390 ? 'auto' : '0';
    }
    return { w, h, isClamped390 };
  };

  const initVp = getEffectiveViewport();

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(initVp.w, initVp.h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  renderer.domElement.id = 'rl-webgl-canvas';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = initVp.isClamped390 ? '390px' : '100vw';
  renderer.domElement.style.height = '100vh';
  renderer.domElement.style.position = 'fixed';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.zIndex = '1';
  viewportEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const arenaBgColor = new THREE.Color(0x060b14);
  const studioBgColor = new THREE.Color(0x0c131f);
  scene.background = arenaBgColor;
  const arenaFog = new THREE.FogExp2(0x060b14, 0.0020);
  scene.fog = arenaFog;

  const camera = new THREE.PerspectiveCamera(
    63.0,
    Math.max(0.1, initVp.w / Math.max(1, initVp.h)),
    0.25,
    460.0
  );

  // --------------------------------------------------------------------------
  // 2. ARENA ENVIRONMENT & STUDIO INSPECTION RIG
  // --------------------------------------------------------------------------
  const arena = createArenaEnvironment(THREE, scene);

  const liveCarsGroup = new THREE.Group();
  liveCarsGroup.name = 'LiveBattleCarsGroup';
  scene.add(liveCarsGroup);

  const ballMesh = createSoccerBallMesh(THREE, ARENA_CONSTANTS.ballRadius || 3.20);
  scene.add(ballMesh);

  const studioRig = setupStudioInspectionScene(THREE, scene, camera, renderer);
  studioRig.studioGroup.visible = false;

  // --------------------------------------------------------------------------
  // 3. PRESENTATION CONTROLLERS (CAMERA, VFX, AUDIO, REPLAY, HUD)
  // --------------------------------------------------------------------------
  const cameraDirector = new CameraDirector(camera, { evalArenaSDF });
  const vfx = new VFXManager(scene);
  const audio = new AudioSynthesizer();

  let studioMode = false;
  let studioAngle = 'front_34';
  let studioHudHidden = false;
  let inMainMenu = true;
  let isPaused = false;
  let goBannerClearTimer = null;
  let currentBannerText = '';

  // --------------------------------------------------------------------------
  // 4. PHYSICS WORLD & EVENT ROUTING
  // --------------------------------------------------------------------------
  const carMeshesMap = new Map();

  function handlePhysicsEvent(evt) {
    if (!evt || !evt.type) return;

    const camPos = camera.position;
    const evtPos = evt.position || evt.contactPoint || { x: 0, y: 0, z: 0 };
    const distToCam = Math.hypot(
      (evtPos.x || 0) - camPos.x,
      (evtPos.y || 0) - camPos.y,
      (evtPos.z || 0) - camPos.z
    );

    switch (evt.type) {
      case 'CAR_BALL_HIT': {
        vfx.spawnBallHit(
          evt.contactPoint || physics.ball.position,
          { x: 0, y: 1, z: 0 },
          (evt.ballSpeedKph || 80) / 3.6,
          evt.team || 'blue'
        );
        audio.playBallHit((evt.ballSpeedKph || 80) / 3.6, distToCam);
        if (evt.isPowerStrike) {
          cameraDirector.triggerHitStop(45);
          cameraDirector.triggerShake(0.68, 0.28);
        } else {
          cameraDirector.triggerShake(0.28, 0.16);
        }
        break;
      }

      case 'WALL_IMPACT': {
        vfx.spawnShockwave(evt.position, evt.normal || { x: 0, y: 1, z: 0 }, {
          duration: 0.35,
          startRadius: 0.55,
          endRadius: Math.min(6.5, 2.2 + (evt.impactSpeed || 10) * 0.12),
          color: 0x00f0ff
        });
        audio.playBallHit((evt.impactSpeed || 12) * 0.65, distToCam);
        break;
      }

      case 'JUMP': {
        vfx.spawnJumpBurst(evt.position, { x: 0, y: 1, z: 0 }, false);
        audio.playJump(false);
        break;
      }

      case 'DOUBLE_JUMP':
      case 'DODGE_FLIP': {
        const car = physics.cars.find((c) => c.id === evt.carId) || physics.playerCar;
        vfx.spawnJumpBurst(car ? car.position : evtPos, car ? car.up : { x: 0, y: 1, z: 0 }, true);
        audio.playJump(true);
        break;
      }

      case 'SUPERSONIC_ENTER': {
        cameraDirector.triggerShake(0.55, 0.32);
        audio.playSupersonicBoom();
        break;
      }

      case 'BOOST_PICKUP': {
        const isFull = evt.padType === 'full' || evt.boostAmount >= 100;
        vfx.spawnShockwave(evt.position, { x: 0, y: 1, z: 0 }, {
          duration: 0.32,
          startRadius: 0.5,
          endRadius: isFull ? 3.6 : 2.2,
          color: 0xffbb00
        });
        audio.playBoostPickup(isFull);
        break;
      }

      case 'DEMOLITION': {
        vfx.spawnDemolition(evt.position, evt.victimTeam || 'orange');
        cameraDirector.triggerShake(1.15, 0.45);
        audio.playDemolition();
        break;
      }

      case 'GOAL_SCORED': {
        const team = evt.scoringTeam || 'blue';
        const speedKph = evt.shotSpeedKph || 115;
        const scorerCar = physics.cars.find((c) => c.id === evt.scorerCarId);
        const scorerName = scorerCar ? scorerCar.name : (team === 'blue' ? 'OCTANE-01' : 'OCTANE-02');

        vfx.spawnGoalExplosion(evt.position, team);
        arena.triggerGoalPulse(team);
        currentBannerText = `GOAL! ${team.toUpperCase()} • ${speedKph} KPH`;
        arena.updateJumbotron(evt.score || physics.score, physics.timeRemaining, currentBannerText, physics.isOvertime);
        hud.showGoalBanner(team, speedKph, scorerName);
        cameraDirector.triggerShake(1.4, 0.68);
        audio.playGoalHornAndCrowd();
        break;
      }

      case 'AWARD': {
        if (evt.type !== 'GOAL' && evt.label) {
          hud.showMedal(evt.label);
        }
        break;
      }

      case 'COUNTDOWN_TICK': {
        hud.showCountdown(String(evt.count));
        audio.playCountdownBeep(evt.count);
        break;
      }

      case 'KICKOFF_GO': {
        hud.showCountdown('GO!');
        audio.playCountdownBeep('GO');
        if (goBannerClearTimer) clearTimeout(goBannerClearTimer);
        goBannerClearTimer = setTimeout(() => {
          hud.showCountdown('');
        }, 700);
        break;
      }

      case 'REPLAY_START': {
        replay.startReplay(evt.goalInfo || physics.lastGoalInfo || {});
        break;
      }

      default:
        break;
    }
  }

  const physics = new PhysicsWorld({
    mode: '1v1',
    evalArenaSDF,
    boostPadLayout: BOOST_PAD_LAYOUT,
    onEvent: handlePhysicsEvent
  });

  const replay = new ReplaySystem({
    onReplayComplete: () => {
      currentBannerText = '';
      hud.hideGoalBanner();
      if (physics.matchState === MATCH_STATES.INSTANT_REPLAY) {
        physics.skipReplay();
      }
    }
  });

  function syncCarMeshes() {
    const activeIds = new Set();
    for (let i = 0; i < physics.cars.length; i++) {
      const carState = physics.cars[i];
      activeIds.add(carState.id);
      let mesh = carMeshesMap.get(carState.id);
      if (!mesh) {
        mesh = createBattleCarMesh(THREE, {
          team: carState.team,
          carNumber: carState.numeral || (carState.team === 'blue' ? '01' : '02')
        });
        carMeshesMap.set(carState.id, mesh);
        liveCarsGroup.add(mesh);
      }
      mesh.visible = !carState.demolished;
      updateBattleCarVisuals(mesh, carState, 1 / 60);
    }

    for (const [id, mesh] of carMeshesMap.entries()) {
      if (!activeIds.has(id)) {
        mesh.visible = false;
      }
    }
  }

  syncCarMeshes();
  updateSoccerBallVisuals(ballMesh, physics.ball, 1 / 60);
  cameraDirector.reset(physics.playerCar || physics.cars[0], physics.ball);

  // --------------------------------------------------------------------------
  // 5. HUD CONTROLLER & INTERACTIVE CALLBACKS
  // --------------------------------------------------------------------------
  const hud = new HUDController({
    onToggleBallCam: () => {
      if (studioMode) {
        setStudioMode(false);
      }
      const newMode = cameraDirector.toggleBallCam();
      hud._syncCameraBadge(newMode);
    },
    onToggleMute: (muted) => {
      audio.setMuted(muted);
    },
    onTogglePause: (forceState = null) => {
      togglePause(forceState);
    },
    onStartGame: (mode, difficulty) => {
      startGame(mode, difficulty);
    },
    onRestartMatch: (mode) => {
      togglePause(false);
      resetMatch(mode || physics.mode);
    },
    onMainMenu: () => {
      showMainMenu();
    },
    onSkipReplay: () => {
      replay.skip();
      physics.skipReplay();
      hud.hideGoalBanner();
      currentBannerText = '';
    },
    onResetMatch: (mode) => {
      resetMatch(mode || physics.mode);
    },
    onModeChange: (mode) => {
      if (studioMode) setStudioMode(false);
      const clean = String(mode || '').toLowerCase().replace(/[\s_-]+/g, '');
      if (clean === 'autopilot' || clean === 'autopilotshowcase') {
        startAutopilot();
      } else {
        resetMatch(mode);
      }
    },
    onDifficultyChange: (diff) => {
      physics.setMutator('botDifficulty', diff);
    },
    onMutatorChange: (allMutators, key, val) => {
      physics.setMutator(key, val);
    },
    onTriggerMovement: (moveId) => {
      if (studioMode) setStudioMode(false);
      triggerMovement(moveId);
    },
    onStudioAngleChange: (enabled, angle) => {
      setStudioMode(enabled, angle, { showHud: true });
    }
  });

  function dismissMainMenuForProgrammaticCall() {
    if (!inMainMenu) return;
    inMainMenu = false;
    if (window.__RL_GAME__) window.__RL_GAME__.inMainMenu = false;
    audio.setPaused(false);
    hud.showStartScreen(false);
    if (physics.matchState === MATCH_STATES.MAIN_MENU) {
      physics.matchState =
        physics.mode === 'freeplay' ? MATCH_STATES.FREE_PLAY : MATCH_STATES.KICKOFF_COUNTDOWN;
      physics.stateTimer = physics.mode === 'freeplay' ? 0 : 3.0;
    }
    if (cameraDirector.getMode() === 'menu') {
      cameraDirector.setMode(cameraDirector.previousPlayMode || 'ball');
    }
  }

  function startGame(mode = hud.activeMode || '1v1', difficulty = hud.activeDifficulty || 'Pro') {
    inMainMenu = false;
    isPaused = false;
    if (window.__RL_GAME__) {
      window.__RL_GAME__.inMainMenu = false;
      window.__RL_GAME__.isPaused = false;
    }
    audio.setPaused(false);
    hud.showStartScreen(false);
    hud.showPauseModal(false);
    hud.setBotDifficulty(difficulty);
    physics.setMutator('botDifficulty', difficulty);
    cameraDirector.setMode(cameraDirector.previousPlayMode || 'ball');

    const clean = String(mode || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (clean === 'autopilot' || clean === 'autopilotshowcase') {
      startAutopilot();
    } else {
      resetMatch(mode);
    }
    syncGlobalState();
    hud.update(window.__SIM_STATE__, window.__MOTION_TELEMETRY__);
    renderer.render(scene, camera);
    return getDiagnostics();
  }

  function togglePause(forceState = null) {
    if (inMainMenu && forceState === true) {
      dismissMainMenuForProgrammaticCall();
    } else if (inMainMenu && forceState === null) {
      return false;
    }
    isPaused = forceState !== null ? Boolean(forceState) : !isPaused;
    if (window.__RL_GAME__) {
      window.__RL_GAME__.isPaused = isPaused;
    }
    audio.setPaused(isPaused);
    hud.showPauseModal(isPaused);
    syncGlobalState();
    hud.update(window.__SIM_STATE__, window.__MOTION_TELEMETRY__);
    renderer.render(scene, camera);
    return isPaused;
  }

  function showMainMenu() {
    if (studioMode) setStudioMode(false);
    isPaused = false;
    inMainMenu = true;
    if (window.__RL_GAME__) {
      window.__RL_GAME__.isPaused = false;
      window.__RL_GAME__.inMainMenu = true;
    }
    audio.setPaused(true);
    currentBannerText = '';
    hud.hideGoalBanner();
    hud.showCountdown('');
    hud.showPauseModal(false);
    hud.showStartScreen(true);

    physics.activeChoreography = null;
    physics.autopilotActive = false;
    physics.resetKickoff();
    physics.matchState = MATCH_STATES.MAIN_MENU;
    cameraDirector.setMode('menu');

    syncCarMeshes();
    updateSoccerBallVisuals(ballMesh, physics.ball, 1 / 60);
    syncGlobalState();
    cameraDirector.update(1 / 60, physics.playerCar || physics.cars[0], physics.ball, {
      matchState: MATCH_STATES.MAIN_MENU
    });
    hud.update(window.__SIM_STATE__, window.__MOTION_TELEMETRY__);
    renderer.render(scene, camera);
    return getDiagnostics();
  }

  // --------------------------------------------------------------------------
  // 6. KEYBOARD & MOUSE INPUT CONTROLLER
  // --------------------------------------------------------------------------
  const keysDown = new Set();
  let mouseBoostDown = false;
  let mouseJumpDown = false;
  let jumpEdgePending = false;

  const isInputTarget = (el) =>
    el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');

  window.addEventListener('keydown', (e) => {
    if (isInputTarget(e.target)) return;
    const code = e.code;
    const key = e.key.toLowerCase();

    if (code === 'Escape') {
      e.preventDefault();
      if (!inMainMenu) {
        togglePause();
      }
      return;
    }

    if (code === 'Enter') {
      if (inMainMenu) {
        e.preventDefault();
        startGame(hud.activeMode, hud.activeDifficulty);
        return;
      }
    }

    if (code === 'KeyP' && !inMainMenu) {
      e.preventDefault();
      togglePause();
      return;
    }

    if (code === 'Tab') {
      e.preventDefault();
      if (!inMainMenu) {
        if (isPaused) togglePause(false);
        hud.toggleDrawer();
      }
      return;
    }

    if (inMainMenu || isPaused) return;

    if (code === 'Space') {
      e.preventDefault();
      if (physics.matchState === MATCH_STATES.INSTANT_REPLAY) {
        replay.skip();
        physics.skipReplay();
        hud.hideGoalBanner();
        currentBannerText = '';
        return;
      }
      if (!keysDown.has('Space')) {
        jumpEdgePending = true;
      }
    }

    keysDown.add(code);
    keysDown.add(key);

    if (key === 'c') {
      if (studioMode) setStudioMode(false);
      const m = cameraDirector.toggleBallCam();
      hud._syncCameraBadge(m);
    } else if (key === 'm') {
      const muted = audio.toggleMute();
      if (hud._els?.btnMute) {
        hud._els.btnMute.textContent = muted ? '[M] Muted' : '[M] Mute';
        hud._els.btnMute.classList.toggle('active', muted);
      }
    } else if (key === 'r') {
      if (studioMode) setStudioMode(false);
      physics.resetKickoff();
      syncCarMeshes();
      cameraDirector.reset(physics.playerCar || physics.cars[0], physics.ball);
    } else if (key === '1') {
      if (studioMode) setStudioMode(false);
      triggerMovement('m1_supersonic_boost_blitz');
    } else if (key === '2') {
      if (studioMode) setStudioMode(false);
      triggerMovement('m2_powerslide_drift_hook');
    } else if (key === '3') {
      if (studioMode) setStudioMode(false);
      triggerMovement('m3_double_jump_front_flip_strike');
    } else if (key === '4') {
      if (studioMode) setStudioMode(false);
      triggerMovement('m4_aerial_pitch_thruster_flight');
    } else if (key === '5') {
      if (studioMode) setStudioMode(false);
      triggerMovement('m5_goal_explosion_shockwave');
    } else if (key === '0') {
      if (studioMode) setStudioMode(false);
      startAutopilot();
    }
  });

  window.addEventListener('keyup', (e) => {
    keysDown.delete(e.code);
    keysDown.delete(e.key.toLowerCase());
  });

  window.addEventListener('blur', () => {
    keysDown.clear();
    mouseBoostDown = false;
    mouseJumpDown = false;
  });

  renderer.domElement.addEventListener('mousedown', (e) => {
    if (inMainMenu || isPaused) return;
    if (e.button === 0) {
      mouseBoostDown = true;
    } else if (e.button === 2) {
      e.preventDefault();
      if (physics.matchState === MATCH_STATES.INSTANT_REPLAY) {
        replay.skip();
        physics.skipReplay();
        hud.hideGoalBanner();
        currentBannerText = '';
        return;
      }
      if (!mouseJumpDown) {
        jumpEdgePending = true;
      }
      mouseJumpDown = true;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseBoostDown = false;
    if (e.button === 2) mouseJumpDown = false;
  });

  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  function applyHardwareInputsToPlayer() {
    if (physics.activeChoreography || inMainMenu || isPaused) return;

    const forward = keysDown.has('KeyW') || keysDown.has('w') || keysDown.has('ArrowUp');
    const backward = keysDown.has('KeyS') || keysDown.has('s') || keysDown.has('ArrowDown');
    const left = keysDown.has('KeyA') || keysDown.has('a') || keysDown.has('ArrowLeft');
    const right = keysDown.has('KeyD') || keysDown.has('d') || keysDown.has('ArrowRight');
    const pitchDown = keysDown.has('KeyI') || keysDown.has('i');
    const pitchUp = keysDown.has('KeyK') || keysDown.has('k');
    const rollLeft = keysDown.has('KeyQ') || keysDown.has('q');
    const rollRight = keysDown.has('KeyE') || keysDown.has('e');
    const handbrake = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight') || keysDown.has('shift');
    const boost = keysDown.has('KeyF') || keysDown.has('f') || mouseBoostDown;
    const jumpHeld = keysDown.has('Space') || mouseJumpDown;

    const throttle = (forward ? 1 : 0) - (backward ? 1 : 0);
    // Note: in PhysicsWorld, steer > 0 turns left (+X / -yaw or +yaw)
    const steer = (left ? 1 : 0) - (right ? 1 : 0);
    const explicitPitch = (pitchDown ? 1 : 0) - (pitchUp ? 1 : 0);
    const explicitRoll = (rollRight ? 1 : 0) - (rollLeft ? 1 : 0);

    physics.setPlayerInput({
      throttle,
      steer,
      jump: jumpHeld,
      jumpPressed: jumpEdgePending,
      boost,
      handbrake,
      pitch: explicitPitch,
      yaw: steer,
      roll: explicitRoll
    });
    jumpEdgePending = false;
  }

  // --------------------------------------------------------------------------
  // 7. STUDIO 6-ANGLE + EXPLODED DIAGNOSTIC CONTROLLER
  // --------------------------------------------------------------------------
  function setStudioMode(enabled, angleName = 'front_34', opts = {}) {
    dismissMainMenuForProgrammaticCall();
    studioMode = Boolean(enabled);
    if (angleName && angleName !== 'Live Game' && angleName !== 'live') {
      studioAngle = String(angleName).toLowerCase();
    }

    if (studioMode) {
      arena.group.visible = false;
      liveCarsGroup.visible = false;
      ballMesh.visible = false;
      vfx.root.visible = false;
      scene.background = studioBgColor;
      scene.fog = null;

      studioRig.studioGroup.visible = true;
      studioRig.setCameraAngle(studioAngle);
      cameraDirector.setStudioMode(true, studioAngle);
      studioHudHidden = Boolean(opts.hideHud);
    } else {
      studioRig.studioGroup.visible = false;
      arena.group.visible = true;
      liveCarsGroup.visible = true;
      ballMesh.visible = true;
      vfx.root.visible = true;
      scene.background = arenaBgColor;
      scene.fog = arenaFog;
      studioHudHidden = false;

      cameraDirector.setStudioMode(false);
      cameraDirector.update(1 / 60, physics.playerCar || physics.cars[0], physics.ball, {
        matchState: physics.matchState
      });
    }

    syncGlobalState();
    renderer.render(scene, camera);
    return { studioMode, studioAngle };
  }

  function renderStudioDiagnostic(angleName = 'front_34', opts = { hideHud: true }) {
    if (angleName === false || angleName === 'off' || angleName === 'exit' || angleName === null) {
      return setStudioMode(false);
    }
    setStudioMode(true, angleName, { hideHud: opts.hideHud !== false });
    studioRig.setCameraAngle(studioAngle);
    hud.update(window.__SIM_STATE__, window.__MOTION_TELEMETRY__);
    renderer.render(scene, camera);

    const carBox = new THREE.Box3().setFromObject(studioRig.heroCar);
    const ballBox = new THREE.Box3().setFromObject(studioRig.soccerBall);
    return {
      angleName: studioAngle,
      cameraPos: {
        x: Number(camera.position.x.toFixed(3)),
        y: Number(camera.position.y.toFixed(3)),
        z: Number(camera.position.z.toFixed(3))
      },
      cameraFov: camera.fov,
      carBounds: {
        min: {
          x: Number(carBox.min.x.toFixed(3)),
          y: Number(carBox.min.y.toFixed(3)),
          z: Number(carBox.min.z.toFixed(3))
        },
        max: {
          x: Number(carBox.max.x.toFixed(3)),
          y: Number(carBox.max.y.toFixed(3)),
          z: Number(carBox.max.z.toFixed(3))
        }
      },
      ballBounds: {
        min: {
          x: Number(ballBox.min.x.toFixed(3)),
          y: Number(ballBox.min.y.toFixed(3)),
          z: Number(ballBox.min.z.toFixed(3))
        },
        max: {
          x: Number(ballBox.max.x.toFixed(3)),
          y: Number(ballBox.max.y.toFixed(3)),
          z: Number(ballBox.max.z.toFixed(3))
        }
      }
    };
  }

  // --------------------------------------------------------------------------
  // 8. ORCHESTRATION HELPERS & GLOBAL TELEMETRY CONTRACTS
  // --------------------------------------------------------------------------
  let smoothedFps = 60.0;

  function syncGlobalState() {
    physics._syncGlobalSimState();
    const sim = window.__SIM_STATE__ || {};
    sim.matchMode = physics.mode;
    sim.mutators = { ...physics.mutators };
    sim.activeMutators = { ...physics.mutators };
    sim.studioMode = studioMode;
    sim.studioAngle = studioAngle;
    sim.studioHudHidden = studioHudHidden;
    sim.inMainMenu = inMainMenu;
    sim.isPaused = isPaused;
    sim.cameraMode = cameraDirector.getMode();
    sim.countdownTimer = physics.stateTimer;
    sim.bannerText = currentBannerText;
    sim.replayTimeDilation = replay.isPlaying ? replay.currentTimeDilation : 0.4;
    window.__SIM_STATE__ = sim;
    window.__MOTION_TELEMETRY__ = physics.telemetry;
    if (window.__RL_GAME__) {
      window.__RL_GAME__.isPaused = isPaused;
      window.__RL_GAME__.inMainMenu = inMainMenu;
    }
  }

  function stepFrame(dt = 1 / 60, explicitSubSteps = null) {
    const safeDt = Number.isFinite(dt) ? Math.max(0.0005, Math.min(0.05, dt)) : 1 / 60;

    if (!studioMode) {
      if (inMainMenu) {
        physics.matchState = MATCH_STATES.MAIN_MENU;
        syncCarMeshes();
        updateSoccerBallVisuals(ballMesh, physics.ball, safeDt);
        syncGlobalState();
        arena.update(safeDt, window.__SIM_STATE__);
        vfx.update(safeDt, physics.cars, physics.ball);
        cameraDirector.update(safeDt, physics.playerCar || physics.cars[0], physics.ball, {
          matchState: MATCH_STATES.MAIN_MENU
        });
        hud.update(window.__SIM_STATE__, window.__MOTION_TELEMETRY__);
      } else if (isPaused) {
        syncGlobalState();
        hud.update(window.__SIM_STATE__, window.__MOTION_TELEMETRY__);
      } else {
        applyHardwareInputsToPlayer();

        const hitStopScale = cameraDirector.stepHitStop(safeDt);
        const effectiveDt = safeDt * hitStopScale;

        physics.step(effectiveDt, explicitSubSteps);

        if (physics.matchState !== MATCH_STATES.INSTANT_REPLAY) {
          replay.recordFrame({
            time: physics.simulationTime,
            cars: physics.cars,
            ball: physics.ball
          });
        } else if (replay.isPlaying) {
          replay.update(safeDt);
        }

        syncCarMeshes();
        updateSoccerBallVisuals(ballMesh, physics.ball, safeDt);

        syncGlobalState();

        arena.update(safeDt, window.__SIM_STATE__);
        vfx.update(safeDt, physics.cars, physics.ball);
        cameraDirector.update(safeDt, physics.playerCar || physics.cars[0], physics.ball, {
          matchState: physics.matchState
        });
        audio.update(safeDt, physics.playerCar || physics.cars[0]);
        hud.update(window.__SIM_STATE__, window.__MOTION_TELEMETRY__);
      }
    } else {
      syncGlobalState();
      studioRig.setCameraAngle(studioAngle);
      hud.update(window.__SIM_STATE__, window.__MOTION_TELEMETRY__);
    }

    renderer.render(scene, camera);
  }

  function stepPhysics(dt = 1 / 60, steps = 1) {
    dismissMainMenuForProgrammaticCall();
    const count = Math.max(1, Math.min(600, Math.floor(Number(steps) || 1)));
    const singleDt = Number.isFinite(dt) ? dt : 1 / 60;
    for (let i = 0; i < count; i++) {
      stepFrame(singleDt, 1);
    }
    return getDiagnostics();
  }

  function triggerMovement(movementId) {
    dismissMainMenuForProgrammaticCall();
    if (isPaused) togglePause(false);
    if (studioMode) setStudioMode(false);
    const res = physics.triggerMovement(movementId);
    syncCarMeshes();
    updateSoccerBallVisuals(ballMesh, physics.ball, 1 / 60);
    cameraDirector.reset(physics.playerCar || physics.cars[0], physics.ball);
    syncGlobalState();
    return res;
  }

  function startAutopilot() {
    dismissMainMenuForProgrammaticCall();
    if (isPaused) togglePause(false);
    if (studioMode) setStudioMode(false);
    hud.setMatchMode('Autopilot');
    const tel = physics.startAutopilot();
    syncCarMeshes();
    updateSoccerBallVisuals(ballMesh, physics.ball, 1 / 60);
    cameraDirector.reset(physics.playerCar || physics.cars[0], physics.ball);
    syncGlobalState();
    return tel;
  }

  function resetMatch(mode = '1v1') {
    dismissMainMenuForProgrammaticCall();
    if (isPaused) togglePause(false);
    if (studioMode) setStudioMode(false);
    currentBannerText = '';
    hud.hideGoalBanner();
    hud.setMatchMode(mode);
    physics.setMatchMode(mode);
    replay.clear();
    syncCarMeshes();
    updateSoccerBallVisuals(ballMesh, physics.ball, 1 / 60);
    cameraDirector.reset(physics.playerCar || physics.cars[0], physics.ball);
    syncGlobalState();
    return getDiagnostics();
  }

  function setMutator(key, val) {
    return physics.setMutator(key, val);
  }

  function setBotDifficulty(diff) {
    hud.setBotDifficulty(diff);
    return physics.setMutator('botDifficulty', diff);
  }

  function getDiagnostics() {
    const physDiag = physics.getDiagnostics();
    return {
      fps: Math.round(smoothedFps),
      drawCalls: renderer.info?.render?.calls ?? 0,
      triangles: renderer.info?.render?.triangles ?? 0,
      consoleErrors: consoleErrorCount,
      studioMode,
      studioAngle,
      inMainMenu,
      isPaused,
      cameraMode: cameraDirector.getMode(),
      ...physDiag
    };
  }

  // Expose Global Verification & Telemetry Hooks
  window.__START_AUTOPILOT__ = startAutopilot;
  window.__RENDER_STUDIO_DIAGNOSTIC__ = renderStudioDiagnostic;
  window.__RL_GAME__ = {
    isPaused: false,
    inMainMenu: true,
    startGame,
    togglePause,
    showMainMenu,
    stepPhysics,
    setStudioMode,
    renderStudioDiagnostic,
    exitStudioDiagnostic: () => setStudioMode(false),
    exitStudio: () => setStudioMode(false),
    setScenario: (name) => {
      dismissMainMenuForProgrammaticCall();
      if (isPaused) togglePause(false);
      if (studioMode) setStudioMode(false);
      physics.setScenario(name);
      syncCarMeshes();
      updateSoccerBallVisuals(ballMesh, physics.ball, 1 / 60);
      return getDiagnostics();
    },
    triggerMovement,
    startAutopilot,
    resetMatch,
    resetKickoff: () => {
      dismissMainMenuForProgrammaticCall();
      if (isPaused) togglePause(false);
      physics.resetKickoff();
      syncCarMeshes();
      updateSoccerBallVisuals(ballMesh, physics.ball, 1 / 60);
      cameraDirector.reset(physics.playerCar || physics.cars[0], physics.ball);
      return getDiagnostics();
    },
    setMutator,
    setBotDifficulty,
    getDiagnostics,
    scene,
    camera,
    renderer,
    physics,
    world: physics,
    THREE,
    arena,
    vfx,
    replay,
    replaySystem: replay,
    hud,
    audio,
    cameraDirector,
    studioRig,
    carMeshesMap,
    ballMesh
  };

  // Initialize Start Screen vs URL Query Parameters ([SPEC PATCH #11])
  let autoStartedFromQuery = false;
  try {
    const params = new URLSearchParams(window.location.search);
    const studioParam = params.get('studio');
    const autopilotParam = params.get('autopilot');
    const autostartParam = params.get('autostart');
    const modeParam = params.get('mode');

    if (studioParam) {
      autoStartedFromQuery = true;
      setStudioMode(true, studioParam, { hideHud: params.get('hud') === '0' });
    } else if (autopilotParam === '1' || autopilotParam === 'true') {
      autoStartedFromQuery = true;
      startAutopilot();
    } else if (modeParam) {
      autoStartedFromQuery = true;
      startGame(modeParam, hud.activeDifficulty);
    } else if (autostartParam === '1' || autostartParam === 'true') {
      autoStartedFromQuery = true;
      startGame('1v1', hud.activeDifficulty);
    }
  } catch (_) {}

  if (!autoStartedFromQuery) {
    showMainMenu();
  }

  syncGlobalState();

  // Responsive Resize Handler
  window.addEventListener('resize', () => {
    const vp = getEffectiveViewport();
    camera.aspect = vp.w / vp.h;
    camera.updateProjectionMatrix();
    renderer.setSize(vp.w, vp.h);
    renderer.domElement.style.width = vp.isClamped390 ? '390px' : '100vw';
    if (studioMode) {
      studioRig.setCameraAngle(studioAngle);
    }
    renderer.render(scene, camera);
  });

  // --------------------------------------------------------------------------
  // 9. MAIN REQUESTANIMATIONFRAME LOOP
  // --------------------------------------------------------------------------
  let lastFrameTime = performance.now();

  function animate(now) {
    requestAnimationFrame(animate);
    const rawDt = Math.max(0.001, (now - lastFrameTime) * 0.001);
    lastFrameTime = now;
    const instFps = 1.0 / Math.min(0.25, rawDt);
    smoothedFps = smoothedFps * 0.92 + instFps * 0.08;

    stepFrame(Math.min(rawDt, 0.05));
  }

  // Render initial frame synchronously before starting rAF loop
  stepFrame(1 / 60, 1);
  requestAnimationFrame(animate);

  return window.__RL_GAME__;
}

// Auto-boot when loaded in browser
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initRocketLeagueApp(), { once: true });
  } else {
    initRocketLeagueApp();
  }
}

})(THREE, THREE);
