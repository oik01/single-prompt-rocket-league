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

export const ARENA_CONSTANTS = {
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

export const BOOST_PAD_LAYOUT = [
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
export function getBottomFilletRadiusAt(x, z) {
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
export function evalArenaSDF(x, y, z) {
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
export function createArenaEnvironment(THREE, scene) {
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
