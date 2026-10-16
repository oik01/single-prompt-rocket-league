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

export const MATCH_STATES = Object.freeze({
  MAIN_MENU: 'MAIN_MENU',
  KICKOFF_COUNTDOWN: 'KICKOFF_COUNTDOWN',
  LIVE_PLAY: 'LIVE_PLAY',
  GOAL_CELEBRATION: 'GOAL_CELEBRATION',
  INSTANT_REPLAY: 'INSTANT_REPLAY',
  FREE_PLAY: 'FREE_PLAY',
  AUTOPILOT_SHOWCASE: 'AUTOPILOT_SHOWCASE',
  MATCH_OVER: 'MATCH_OVER'
});

export const ARENA_CONSTANTS = Object.freeze({
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

export const DEFAULT_BOOST_PAD_LAYOUT = Object.freeze([
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

export const MOVEMENTS_MANIFEST = Object.freeze([
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
export function defaultEvalArenaSDF(x, y, z) {
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

export class PhysicsWorld {
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

export default PhysicsWorld;
