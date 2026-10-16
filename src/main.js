import * as THREE from 'three';
import {
  ARENA_CONSTANTS,
  BOOST_PAD_LAYOUT,
  evalArenaSDF,
  createArenaEnvironment
} from './arena-and-environment.js';
import {
  DEFAULT_LOFT_STATIONS,
  createLoftedShellGeometry,
  generateCarLiveryTexture,
  createBattleCarMesh,
  updateBattleCarVisuals,
  setExplodedView,
  createSoccerBallMesh,
  updateSoccerBallVisuals,
  setupStudioInspectionScene
} from './vehicles-and-ball.js';
import {
  PhysicsWorld,
  MATCH_STATES,
  MOVEMENTS_MANIFEST
} from './physics-and-kinematics.js';
import {
  CameraDirector,
  VFXManager,
  AudioSynthesizer,
  ReplaySystem,
  HUDController
} from './vfx-audio-and-ui.js';

/**
 * @file src/main.js
 * @description Master Orchestrator for 3D Rocket League (`DFH Neo-Dome` & `Octane-RLX`).
 * Integrates Module 1 (Arena), Module 2 (Vehicles & Ball), Module 3 (Physics & 4-Phase Kinematics),
 * and Module 4 (Camera Director, GPU VFX, Web Audio Foley, Replay System, and Esports HUD).
 */

export function initRocketLeagueApp() {
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
