import * as THREE from 'three';

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

export class CameraDirector {
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

export class VFXManager {
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

export class ReplaySystem {
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

export class AudioSynthesizer {
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

export class HUDController {
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

export const Presentation = {
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
