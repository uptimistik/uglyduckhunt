import './style.css';
import { io } from 'socket.io-client';
import { CapacitorVolumeButtons } from 'capacitor-volume-buttons';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { CapacitorFlash } from '@capgo/capacitor-flash';

// ============================================================
// Air Mouse Controller — v2
//
// Strategy:
//  - Use `deviceorientation` (alpha/beta/gamma). The OS already runs
//    a high-quality sensor fusion filter for these values, so we don't
//    need to roll our own Madgwick. This dramatically reduces failure
//    modes (no unit bugs, no axis-mapping bugs).
//  - Convert (alpha,beta,gamma) -> quaternion (W3C formula).
//  - On calibrate: snapshot the current quaternion as q_base.
//  - Each frame: q_rel = q_base^-1 * q_now, then extract small yaw/pitch.
//    A relative quaternion never wraps because we stay near identity.
//  - Send a normalized (nx, ny) target in [-1, 1] at up to 60 Hz.
//  - All sensor data and connection state are visible in a live debug
//    panel so we can SEE what's happening when something doesn't work.
//  - Touch the aim pad to aim manually if sensors aren't available.
// ============================================================

const EMIT_HZ = 60;
const DEFAULT_HALF = 25 * Math.PI / 180; // fallback half-FOV until user calibrates
const MIN_HALF = 3 * Math.PI / 180;      // safety floor so divisions never blow up

// Adaptive one-euro-style filter parameters. Low cutoff when the user is
// nearly still (kills jitter) but the cutoff opens up automatically as soon
// as they aim quickly, so there's almost no lag during fast motion.
const MIN_CUTOFF = 2.0;   // Hz, baseline cutoff (higher = less lag)
const BETA       = 0.4;   // Higher beta = much more responsive during movement
const D_CUTOFF   = 1.0;   // Hz, smoothing for the derivative itself

const state = {
  socket: null,
  roomCode: '',
  serverIP: localStorage.getItem('custom_ip') || 'cryptoduckhunt.replit.app',
  connected: false,
  qBase: null,
  qNow: { w: 1, x: 0, y: 0, z: 0 },
  haveOrientation: false,
  orientationCount: 0,
  motionCount: 0,
  lastEmitAt: 0,
  filt: { x: 0, y: 0, dx: 0, dy: 0, lastT: 0, primed: false },
  lastRaw: { alpha: 0, beta: 0, gamma: 0 },
  invalidOrientationCount: 0,
  invalidEmitCount: 0,
  relayOkCount: 0,
  relayMissCount: 0,
  // Per-edge sweep calibration. We record the SIGNED yaw/pitch at each edge
  // so the runtime mapping auto-corrects for however the user held the phone.
  calib: {
    step: 0, // 0 = not started, 1..5 = steps, 6 = done
    yawLeft:   -DEFAULT_HALF,
    yawRight:   DEFAULT_HALF,
    pitchUp:    DEFAULT_HALF,
    pitchDown: -DEFAULT_HALF,
    done: false,
  },
};

// ---------------- UI ----------------
document.querySelector('#app').innerHTML = `
  <div class="ctrl-root">
    <header class="bar">
      <div class="logo">🎯 Air Mouse</div>
      <div class="badge" id="connBadge">Disconnected</div>
    </header>

    <section class="card" id="setupCard">
      <div class="logo" style="font-size: 14px; margin-bottom: 20px; color: #ff9d00;">Connecting to Production Cloud...</div>
      <label>Room Code</label>
      <input id="roomInput" type="text" placeholder="ABCD" maxlength="6" autocapitalize="characters" />
      <button id="connectBtn" class="primary">Connect</button>
      <button id="enableSensorsBtn" class="secondary">Enable Motion Sensors</button>
      <div class="hint">Tip: tap <b>Enable Motion Sensors</b> first — iOS requires a tap before granting access.</div>
      <div id="setupStatus" class="status"></div>
    </section>

    <section class="card hidden" id="calibCard">
      <h2 id="calibTitle">Calibration</h2>
      <p id="calibSub" class="hint"></p>
      <div class="calib-target" id="calibTarget">
        <div class="calib-arrow" id="calibArrow">·</div>
      </div>
      <button id="calibCaptureBtn" class="primary">Capture</button>
      <button id="calibRestartBtn" class="secondary">Restart calibration</button>
      <div id="calibStatus" class="status"></div>
    </section>

    <section class="card hidden" id="blankCard" style="text-align:center; height:80vh; display:flex; flex-direction:column; justify-content:center; align-items:center; user-select:none;">
      <h2 style="color:#4caf50; font-size:32px; margin-bottom:10px;">Connected</h2>
      <p style="color:#aaa; font-size:18px;">Look at your PC screen.</p>
      
      <div style="margin-top: 40px; display:flex; flex-direction:column; align-items:center; gap:20px; width:80%;">
        <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
          <label style="color:#eee; font-size:16px;">Vibrate</label>
          <input type="checkbox" id="vibrateToggle" checked style="width:24px; height:24px;" />
        </div>
        <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
          <label style="color:#eee; font-size:16px;">Muzzle Flash (Torch)</label>
          <input type="checkbox" id="torchToggle" checked style="width:24px; height:24px;" />
        </div>
      </div>
    </section>

    <section class="card hidden" id="playCard">
      <div class="play-status">
        <div><b>Aim with the phone.</b> Press <b>Volume Up/Down</b> to fire.</div>
      </div>
      <button id="fireBtn" class="fire">FIRE (tap)</button>
      <button id="recalibBtn" class="secondary">Recalibrate</button>

      <details class="diag">
        <summary>Live diagnostics</summary>
        <div class="grid">
          <div><span>orientation events</span><b id="dOri">0</b></div>
          <div><span>motion events</span><b id="dMot">0</b></div>
          <div><span>α (yaw)</span><b id="dA">—</b></div>
          <div><span>β (pitch)</span><b id="dB">—</b></div>
          <div><span>γ (roll)</span><b id="dG">—</b></div>
          <div><span>nx, ny</span><b id="dN">0, 0</b></div>
          <div><span>emit rate</span><b id="dHz">0</b></div>
          <div><span>relay ok</span><b id="dROk">0</b></div>
          <div><span>relay miss</span><b id="dRMiss">0</b></div>
        </div>
      </details>

      <div id="playStatus" class="status"></div>
    </section>
  </div>
`;

const $ = (id) => document.getElementById(id);
const setupCard = $('setupCard');
const calibCard = $('calibCard');
const playCard = $('playCard');
const blankCard = $('blankCard');
const playStatus = $('playStatus');
const setupStatus = $('setupStatus');
const connBadge = $('connBadge');

$('connectBtn').addEventListener('click', onConnect);
$('enableSensorsBtn').addEventListener('click', requestSensorPermissions);
$('calibCaptureBtn').addEventListener('click', captureCalibStep);
$('calibRestartBtn').addEventListener('click', startCalibrationWizard);
$('recalibBtn').addEventListener('click', startCalibrationWizard);
$('fireBtn').addEventListener('click', fire);
$('fireBtn').addEventListener('touchstart', (e) => { e.preventDefault(); fire(); }, { passive: false });

// ---------------- Permissions ----------------
async function requestSensorPermissions() {
  let motionGranted = true;
  let orientGranted = true;
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      motionGranted = (await DeviceMotionEvent.requestPermission()) === 'granted';
    }
  } catch (e) { motionGranted = false; }
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      orientGranted = (await DeviceOrientationEvent.requestPermission()) === 'granted';
    }
  } catch (e) { orientGranted = false; }

  attachSensorListeners();
  setupStatus.textContent = `Sensors: motion=${motionGranted ? 'OK' : 'denied'}, orientation=${orientGranted ? 'OK' : 'denied'}.`;
}

function attachSensorListeners() {
  // Prefer 'deviceorientation' for the OS-fused absolute attitude.
  window.addEventListener('deviceorientation', onOrientation, true);
  // Some platforms use deviceorientationabsolute. Listen to both.
  window.addEventListener('deviceorientationabsolute', onOrientation, true);
  window.addEventListener('devicemotion', () => { state.motionCount++; }, true);

  // Debug: log sensor listener attachment
  console.log('[Sensors] Attached listeners for deviceorientation, deviceorientationabsolute, devicemotion');

  // Test if sensors are firing by logging the first few events
  let orientationTestCount = 0;
  const orientationTestHandler = (e) => {
    if (orientationTestCount < 5) {
      console.log('[Sensors] deviceorientation event:', { alpha: e.alpha, beta: e.beta, gamma: e.gamma, absolute: e.absolute });
      orientationTestCount++;
    }
  };
  window.addEventListener('deviceorientation', orientationTestHandler, true);

  setTimeout(() => {
    console.log('[Sensors] Orientation count after 2s:', state.orientationCount, 'Motion count:', state.motionCount);
    window.removeEventListener('deviceorientation', orientationTestHandler, true);
  }, 2000);
}

// ---------------- Sensor handling ----------------
function onOrientation(e) {
  const alphaRaw = e.alpha; // 0..360, rotation around z (yaw)
  const betaRaw  = e.beta;  // -180..180, rotation around x (front/back tilt)
  const gammaRaw = e.gamma; // -90..90,  rotation around y (left/right tilt)

  const alpha = Number.isFinite(alphaRaw) ? alphaRaw : state.lastRaw.alpha;
  const beta  = Number.isFinite(betaRaw)  ? betaRaw  : state.lastRaw.beta;
  const gamma = Number.isFinite(gammaRaw) ? gammaRaw : state.lastRaw.gamma;

  if (!Number.isFinite(alpha) || !Number.isFinite(beta) || !Number.isFinite(gamma)) {
    state.invalidOrientationCount++;
    return;
  }

  state.haveOrientation = true;
  state.orientationCount++;
  state.lastRaw = { alpha, beta, gamma };

  const qCandidate = normalizeQuat(orientationToQuat(alpha, beta, gamma));
  if (!isFiniteQuat(qCandidate)) {
    state.invalidOrientationCount++;
    return;
  }
  state.qNow = qCandidate;

  emit();
}

// W3C device orientation -> quaternion. Reference:
// https://developer.mozilla.org/docs/Web/API/Device_orientation_events/Orientation_and_motion_data_explained
function orientationToQuat(alphaDeg, betaDeg, gammaDeg) {
  const _x = betaDeg  * Math.PI / 180;  // beta around x
  const _y = gammaDeg * Math.PI / 180;  // gamma around y
  const _z = alphaDeg * Math.PI / 180;  // alpha around z

  const cX = Math.cos(_x / 2), sX = Math.sin(_x / 2);
  const cY = Math.cos(_y / 2), sY = Math.sin(_y / 2);
  const cZ = Math.cos(_z / 2), sZ = Math.sin(_z / 2);

  // Z * X * Y intrinsic rotation order, per spec.
  const w = cX * cY * cZ - sX * sY * sZ;
  const x = sX * cY * cZ - cX * sY * sZ;
  const y = cX * sY * cZ + sX * cY * sZ;
  const z = cX * cY * sZ + sX * sY * cZ;
  return { w, x, y, z };
}

function quatMul(a, b) {
  return {
    w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
  };
}
function quatConj(q) { return { w: q.w, x: -q.x, y: -q.y, z: -q.z }; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function isFiniteQuat(q) {
  return Number.isFinite(q.w) && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z);
}
function normalizeQuat(q) {
  const n = Math.hypot(q.w, q.x, q.y, q.z);
  if (!Number.isFinite(n) || n === 0) return q;
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

// One-Euro adaptive low-pass. `xKey` is the filtered-value field on `state`,
// `dKey` is the filtered-derivative field. Returns the filtered value.
function oneEuro(s, xKey, dKey, x, tNow) {
  if (!s.primed) { s[xKey] = x; s[dKey] = 0; return x; }
  const dt = Math.max(1e-3, tNow - s.lastT);
  const dx = (x - s[xKey]) / dt;
  const aD = lpAlpha(D_CUTOFF, dt);
  const dHat = aD * dx + (1 - aD) * s[dKey];
  s[dKey] = dHat;
  const cutoff = MIN_CUTOFF + BETA * Math.abs(dHat);
  const a = lpAlpha(cutoff, dt);
  const xHat = a * x + (1 - a) * s[xKey];
  s[xKey] = xHat;
  return xHat;
}
function lpAlpha(cutoffHz, dt) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

// Maps a signed value `v` to [-1, +1] using the SIGNED calibration captures.
// negEdge is whatever we recorded when the user pointed at the "-1" edge
// (left or bottom), posEdge for the "+1" edge. The sign convention of the
// underlying sensor/axis doesn't matter — we just find the captured edge
// that lies on the same side of zero as v and scale accordingly.
function mapToNormalized(v, negEdge, posEdge) {
  if (!Number.isFinite(v) || v === 0) return 0;
  if (Math.sign(v) === Math.sign(posEdge) && Math.abs(posEdge) >= MIN_HALF) {
    return clamp(v / posEdge, -1.05, 1.05);          // posEdge maps to +1
  }
  if (Math.sign(v) === Math.sign(negEdge) && Math.abs(negEdge) >= MIN_HALF) {
    return clamp(-(v / negEdge), -1.05, 1.05);       // negEdge maps to -1
  }
  return 0;
}

// Returns yaw/pitch as rotation-vector components (log map of the relative
// quaternion). For a TV-remote pose (top edge pointing at the screen) this
// maps directly: yaw = rotation around vertical (Z), pitch = rotation around
// horizontal X. Unlike asin-based Euler extraction, this does not zero-out
// when the motion is primarily around the X axis, which was the pitch bug.
function relativeYawPitch() {
  if (!state.qBase) return { yaw: 0, pitch: 0 };
  let qRel = quatMul(quatConj(state.qBase), state.qNow);
  let { w, x, y, z } = qRel;
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; } // shortest-arc form
  const vlen = Math.hypot(x, y, z);
  if (vlen < 1e-10) return { yaw: 0, pitch: 0 };
  const theta = 2 * Math.atan2(vlen, w);
  const s = theta / vlen;
  const rx = x * s; // rotation around X -> YAW in gun mode
  // const ry = y * s; // rotation around base-frame Y (roll) - unused
  const rz = z * s; // rotation around Z -> PITCH in gun mode
  return { yaw: rx, pitch: rz };
}

// ---------------- Emit loop ----------------
function emit() {
  const now = performance.now();
  if (now - state.lastEmitAt < 1000 / EMIT_HZ) return;
  state.lastEmitAt = now;

  let nx, ny;
  if (state.qBase) {
    const { yaw, pitch } = relativeYawPitch();
    nx = mapToNormalized(yaw,   state.calib.yawLeft,   state.calib.yawRight); // -1 at left, +1 at right
    ny = mapToNormalized(pitch, state.calib.pitchDown, state.calib.pitchUp);   // -1 at bottom, +1 at top
  } else {
    nx = 0; ny = 0;
  }

  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    state.invalidEmitCount++;
    playStatus.textContent = `Sensor packet invalid (${state.invalidEmitCount}). Holding last good target.`;
    return;
  }

  const tNow = now / 1000;
  const fx = oneEuro(state.filt, 'x', 'dx', nx, tNow);
  const fy = oneEuro(state.filt, 'y', 'dy', ny, tNow);
  state.filt.lastT = tNow;
  state.filt.primed = true;

  if (!Number.isFinite(fx) || !Number.isFinite(fy)) {
    state.invalidEmitCount++;
    state.filt.x = 0; state.filt.y = 0; state.filt.dx = 0; state.filt.dy = 0;
    state.filt.primed = false;
    playStatus.textContent = `Filter reset (${state.invalidEmitCount}).`;
    return;
  }

  // Rolling 16-bit sequence so the screen can drop stale packets that
  // arrive out of order on the unreliable/unordered gyro channel.
  state.gyroSeq = ((state.gyroSeq | 0) + 1) & 0xffff;

  // Hot path. Prefer the direct WebRTC data channel (≈LAN latency).
  // Fall back to the relay socket if the channel isn't open yet or has
  // dropped — gameplay never stops because of that.
  if (state.gyroDC && state.gyroDC.readyState === 'open') {
    // bufferedAmount guard: if the channel is backed up we'd rather drop
    // this packet than make it worse.
    if (state.gyroDC.bufferedAmount < 64 * 1024) {
      try { state.gyroDC.send(JSON.stringify({ nx: fx, ny: fy, seq: state.gyroSeq })); } catch(e) {}
    }
  } else if (state.socket?.connected) {
    // volatile: if the socket is busy/buffering, drop this packet instead
    // of queueing it. Queuing on a slow WAN link is what creates rubber-band lag.
    state.socket.volatile.emit('gyro_data', { roomCode: state.roomCode, nx: fx, ny: fy, seq: state.gyroSeq });
  }
  updateDiag();
}

// Also drive emits at a steady cadence even if orientation events stall (e.g. manual aim, no sensors).
setInterval(emit, 1000 / EMIT_HZ);

// ---------------- Diagnostics ----------------
let lastDiagAt = 0, lastEmitCount = 0, emitCount = 0;
function updateDiag() {
  emitCount++;
  $('dOri').textContent = state.orientationCount;
  $('dMot').textContent = state.motionCount;
  $('dA').textContent = state.lastRaw.alpha.toFixed(1);
  $('dB').textContent = state.lastRaw.beta.toFixed(1);
  $('dG').textContent = state.lastRaw.gamma.toFixed(1);
  $('dN').textContent = `${state.filt.x.toFixed(2)}, ${state.filt.y.toFixed(2)} | bad:${state.invalidEmitCount}`;
  $('dROk').textContent = String(state.relayOkCount);
  $('dRMiss').textContent = String(state.relayMissCount);
  // Live preview during calibration: show where the phone is pointing inside the target box.
  const target = $('calibTarget');
  const arrow  = $('calibArrow');
  if (target && arrow && state.qBase) {
    const w = target.clientWidth, h = target.clientHeight;
    arrow.style.left = `${(0.5 + clamp(state.filt.x, -1, 1) * 0.5) * w}px`;
    arrow.style.top  = `${(0.5 - clamp(state.filt.y, -1, 1) * 0.5) * h}px`;
  }
  const now = performance.now();
  if (now - lastDiagAt > 500) {
    const dt = (now - lastDiagAt) / 1000;
    const hz = Math.round((emitCount - lastEmitCount) / dt);
    $('dHz').textContent = String(hz);
    lastDiagAt = now;
    lastEmitCount = emitCount;
  }
}

// ---------------- Event channel helper ----------------
// Send a discrete event (trigger / calib_*) over the reliable WebRTC data
// channel when available; fall back to the socket relay otherwise.
function sendEvent(type, payload) {
  if (state.eventDC && state.eventDC.readyState === 'open') {
    try {
      state.eventDC.send(JSON.stringify({ type, ...(payload || {}) }));
      return;
    } catch (e) { /* fall through to socket */ }
  }
  if (!state.socket?.connected) return;
  if (type === 'trigger') {
    state.socket.emit('trigger', state.roomCode);
  } else if (type === 'calib_start') {
    state.socket.emit('calib_start', state.roomCode);
  } else if (type === 'calib_done') {
    state.socket.emit('calib_done', state.roomCode);
  } else if (type === 'calib_state') {
    state.socket.emit('calib_state', { roomCode: state.roomCode, to: state.screenId, ...(payload || {}) });
  }
}

// ---------------- Calibration wizard ----------------
const CALIB_STEPS = [
  { key: 'center', title: 'Aim at CENTER of TV',
    sub: 'Hold phone like a GUN: charging port pointing at TV, volume buttons facing the FLOOR. Aim at the middle and press the Volume Button.' },
  { key: 'left',   title: 'Aim at LEFT edge',
    sub: 'Keeping the gun pose, rotate to aim at the LEFT edge of the TV, then press Volume Button.' },
  { key: 'right',  title: 'Aim at RIGHT edge',
    sub: 'Rotate to aim at the RIGHT edge of the TV, then press Volume Button.' },
  { key: 'top',    title: 'Aim at TOP edge',
    sub: 'Tilt up to aim at the TOP edge of the TV, then press Volume Button.' },
  { key: 'bottom', title: 'Aim at BOTTOM edge',
    sub: 'Tilt down to aim at the BOTTOM edge of the TV, then press Volume Button.' },
];

function startCalibrationWizard() {
  if (!state.haveOrientation) {
    playStatus.textContent = 'No orientation events. Tap "Enable Motion Sensors" first.';
    return;
  }
  state.calib.step = 1;
  state.calib.done = false;
  state.qBase = null; // forces nx,ny = 0 until first capture
  state.filt.x = 0; state.filt.y = 0; state.filt.dx = 0; state.filt.dy = 0; state.filt.primed = false;
  playCard.classList.add('hidden');
  calibCard.classList.add('hidden');
  setupCard.classList.add('hidden');
  blankCard.classList.remove('hidden'); // Show blank screen to prevent touches
  
  sendEvent('calib_start');
  renderCalibStep();
}

function renderCalibStep() {
  const idx = state.calib.step - 1;
  const step = CALIB_STEPS[idx];
  if (!step) return;
  sendEvent('calib_state', {
    title: `Step ${state.calib.step} of 5: ${step.title}`,
    sub: step.sub,
  });
}

function captureCalibStep() {
  if (!state.haveOrientation) return;
  const idx = state.calib.step - 1;
  const step = CALIB_STEPS[idx];
  if (!step) return;

  if (step.key === 'center') {
    state.qBase = { ...state.qNow };
    state.filt.x = 0; state.filt.y = 0; state.filt.dx = 0; state.filt.dy = 0; state.filt.primed = false;
  } else {
    const { yaw, pitch } = relativeYawPitch();
    // Store signed values so the mapping auto-corrects for sign conventions.
    if (step.key === 'left')   state.calib.yawLeft   = yaw;
    if (step.key === 'right')  state.calib.yawRight  = yaw;
    if (step.key === 'top')    state.calib.pitchUp   = pitch;
    if (step.key === 'bottom') state.calib.pitchDown = pitch;
  }

  state.calib.step++;
  if (state.calib.step > CALIB_STEPS.length) {
    finishCalibration();
  } else {
    renderCalibStep();
  }
}

function finishCalibration() {
  state.calib.done = true;
  sendEvent('calib_done');
}

// Server-driven "recalibrate" event from the PC restarts the wizard.
function calibrateFromRemote() { startCalibrationWizard(); }

// ---------------- Fire ----------------
async function doShotEffects() {
  const doVibrate = $('vibrateToggle')?.checked;
  const doTorch = $('torchToggle')?.checked;

  if (doVibrate) {
    try { await Haptics.impact({ style: ImpactStyle.Heavy }); } catch(e) {}
  }
  
  if (doTorch) {
    try {
      await CapacitorFlash.switchOn({ intensity: 1.0 });
      setTimeout(async () => {
        try { await CapacitorFlash.switchOff(); } catch(e) {}
      }, 50); // fast flash
    } catch(e) {}
  }
}

let lastFireTime = 0;
function fire() {
  const now = Date.now();
  
  // 1-second cooldown during gameplay (shotgun pump action), 300ms during calibration
  const cooldown = state.calib.done ? 1000 : 300;
  
  if (now - lastFireTime < cooldown) return; 
  lastFireTime = now;

  // Don't gate on socket.connected — if the WebRTC event channel is open
  // we still want to fire even if the relay socket momentarily blipped.
  const canSend = (state.eventDC && state.eventDC.readyState === 'open') || state.socket?.connected;
  if (canSend) {
    if (!state.calib.done) {
      // In calibration mode, firing captures the current step
      captureCalibStep();
      doShotEffects();
      flash();
    } else {
      // Normal gameplay fire — send the trigger FIRST so the network
      // packet goes out before we spend any time on local effects.
      sendEvent('trigger');
      doShotEffects();
      flash();

      // Simulate the "chuck chuck" recharge of the shotgun using haptics
      const doVibrate = $('vibrateToggle')?.checked;
      if (doVibrate) {
        setTimeout(async () => {
          try { await Haptics.impact({ style: ImpactStyle.Light }); } catch(e) {}
        }, 450); // First rack
        setTimeout(async () => {
          try { await Haptics.impact({ style: ImpactStyle.Medium }); } catch(e) {}
        }, 650); // Second rack (ready)
      }
    }
  }
}
function flash() {
  document.body.animate(
    [{ background: '#1a3052' }, { background: '#0b0d12' }],
    { duration: 180, easing: 'ease-out' }
  );
}

// ---------------- Connection ----------------
async function onConnect() {
  state.roomCode = $('roomInput').value.trim().toUpperCase();
  if (!state.roomCode) {
    setupStatus.textContent = 'Room Code required.';
    return;
  }

  // Make sure permissions have been asked at least once (no-op if not iOS gated).
  await requestSensorPermissions();

  setupStatus.textContent = `Connecting to ${state.serverIP}…`;
  
  // Smart protocol detection: use https for Replit, http for local IPs
  const isReplit = state.serverIP.includes('replit.app') || state.serverIP.includes('repl.co');
  const protocol = isReplit ? 'https' : 'http';
  const port = isReplit ? '' : ':3000';
  const finalUrl = `${protocol}://${state.serverIP}${port}`;

  state.socket = io(finalUrl, {
    transports: ['websocket'],
    upgrade: false,
    timeout: 5000,
    // Auto-reconnect settings tuned for mobile: iOS suspends the socket when
    // the user pulls down a notification or backgrounds the app. We want to
    // recover fast and keep trying forever.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,      // start retrying quickly
    reconnectionDelayMax: 3000,  // cap backoff at 3s so we never sit dead for long
    randomizationFactor: 0.3,
  });

  state.socket.on('connect_error', (err) => {
    // Don't overwrite the "reconnecting" UI once we've been connected at least once.
    if (!state.hasEverConnected) {
      setupStatus.textContent = `Connect error: ${err.message}. Check server IP, same Wi-Fi, and that server is running.`;
      connBadge.textContent = 'Error'; connBadge.className = 'badge bad';
    } else {
      connBadge.textContent = 'Reconnecting…'; connBadge.className = 'badge bad';
    }
  });
  state.socket.on('join_error', (msg) => {
    playStatus.textContent = msg;
    connBadge.textContent = 'No Screen';
    connBadge.className = 'badge bad';
  });
  state.socket.on('join_ok', (info) => {
    // info: { roomCode, playerId, slot, screenId }
    if (info && typeof info === 'object') {
      state.playerId = info.playerId;
      state.slot = info.slot;
      state.screenId = info.screenId;
    }
    const slotLabel = state.slot ? ` — Player ${state.slot}` : '';
    playStatus.textContent = state.hasEverConnected
      ? `Reconnected${slotLabel}. Ready to shoot.`
      : `Connected${slotLabel}. Aim where you want the center to be, then tap Calibrate.`;
  });
  // Low-rate relay liveness check — replaces the per-packet ack to cut WAN traffic.
  if (state.relayPingTimer) clearInterval(state.relayPingTimer);
  state.relayPingTimer = setInterval(() => {
    if (!state.socket?.connected) return;
    state.socket.timeout(2000).emit('relay_ping', state.roomCode, (err, res) => {
      if (err || !res) { state.relayMissCount++; return; }
      if (res.recipients > 0) {
        state.relayOkCount++;
      } else {
        state.relayMissCount++;
        playStatus.textContent = `No PC screen in room ${state.roomCode}. Open the game page first.`;
      }
    });
  }, 1000);
  state.socket.on('disconnect', (reason) => {
    state.connected = false;
    connBadge.textContent = 'Reconnecting…'; connBadge.className = 'badge bad';
    playStatus.textContent = `Lost connection (${reason}). Reconnecting…`;
    // If the server closed us deliberately (e.g. `io.disconnect()`), Socket.IO
    // won't auto-reconnect. Force it.
    if (reason === 'io server disconnect') {
      try { state.socket.connect(); } catch(e) {}
    }
  });
  state.socket.on('connect', () => {
    // Always (re)join the room — both on first connect AND on every reconnect.
    state.socket.emit('join_room', state.roomCode);
    state.connected = true;
    connBadge.textContent = state.slot ? `P${state.slot} · ${state.roomCode}` : `Room ${state.roomCode}`;
    connBadge.className = 'badge ok';
    setupCard.classList.add('hidden');

    if (!state.volumeTriggersSetup) {
      setupVolumeTriggers();
      state.volumeTriggersSetup = true;
    }

    if (!state.hasEverConnected) {
      state.hasEverConnected = true;
      // First connect only — drop into calibration wizard.
      setTimeout(startCalibrationWizard, 250);
    } else {
      // Reconnect: DO NOT wipe calibration. Just re-arm sensors in case
      // iOS paused them while the app was backgrounded, and restore the
      // play/calib card that was visible before the drop.
      attachSensorListeners();
      playStatus.textContent = 'Reconnected. Keep shooting.';
    }
  });

  state.socket.on('recalibrate', calibrateFromRemote);
  state.socket.on('calibration_complete', () => {
    state.calib.done = true;
    calibCard.classList.add('hidden');
    blankCard.classList.add('hidden');
    playCard.classList.remove('hidden');
    playStatus.textContent = 'Calibration complete. Ready to shoot.';
  });

  // ---------------- WebRTC peer connection (controller = answerer) ----------------
  // The screen creates the data channels and sends the offer once it sees
  // our 'join_room'. We just answer and wire up the channels.
  state.socket.on('rtc_signal', async (msg) => {
    try {
      // Remember the screen's socket id so we can address replies directly.
      if (msg.from) state.screenId = msg.from;
      if (msg.sdp && msg.sdp.type === 'offer') {
        ensureRTC();
        await state.pc.setRemoteDescription(msg.sdp);
        const answer = await state.pc.createAnswer();
        await state.pc.setLocalDescription(answer);
        state.socket.emit('rtc_signal', {
          roomCode: state.roomCode,
          to: state.screenId,
          sdp: state.pc.localDescription,
        });
      } else if (msg.ice && state.pc) {
        try { await state.pc.addIceCandidate(msg.ice); } catch(e) {}
      }
    } catch (err) {
      console.warn('RTC signal handle failed:', err);
    }
  });
}

function ensureRTC() {
  if (state.pc) {
    try { state.pc.close(); } catch(e) {}
  }
  state.pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ],
    iceCandidatePoolSize: 10,
  });
  state.gyroDC = null;
  state.eventDC = null;

  state.pc.onicecandidate = (e) => {
    if (e.candidate && state.socket?.connected) {
      state.socket.emit('rtc_signal', {
        roomCode: state.roomCode,
        to: state.screenId,
        ice: e.candidate,
      });
    }
  };

  state.pc.ondatachannel = (e) => {
    const dc = e.channel;
    if (dc.label === 'gyro') {
      state.gyroDC = dc;
      dc.onopen = () => {
        playStatus.textContent = 'P2P direct link active — minimal lag.';
        const slotLabel = state.slot ? `P${state.slot}` : 'P2P';
        connBadge.textContent = `${slotLabel} · ${state.roomCode}`;
      };
      dc.onclose = () => {
        connBadge.textContent = state.slot ? `P${state.slot} · ${state.roomCode}` : `Room ${state.roomCode}`;
      };
    } else if (dc.label === 'events') {
      state.eventDC = dc;
      // Screen never sends us anything on this channel today, but wire it
      // up so we can add server->controller events later if needed.
      dc.onmessage = () => {};
    }
  };

  state.pc.onconnectionstatechange = () => {
    if (!state.pc) return;
    if (state.pc.connectionState === 'failed' || state.pc.connectionState === 'disconnected') {
      // Don't kill it — gameplay falls back to socket relay automatically.
      // Next reconnect/re-offer will set up a fresh peer connection.
    }
  };
}

// ---------------- Lifecycle: recover from backgrounding / notifications ----------------
// When the user pulls down a notification, locks the phone, or switches apps,
// iOS freezes the webview. Sensor streams stop and Socket.IO may silently
// disconnect. When we come back, kick the socket so it reconnects immediately
// instead of waiting for the next backoff tick.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // Re-arm sensors (safe to call repeatedly — same listeners are deduped by the browser).
  attachSensorListeners();
  const s = state.socket;
  if (!s) return;
  if (!s.connected) {
    try { s.connect(); } catch(e) {}
  }
});

// --- Local IP Discovery / Custom Server (Hidden Feature) ---
// Triple-tap the header to enter a custom IP (e.g. your Mac's local IP)
let logoTaps = 0;
let lastLogoTap = 0;
document.querySelector('.header').addEventListener('click', () => {
  const now = Date.now();
  if (now - lastLogoTap > 1000) logoTaps = 0;
  logoTaps++;
  lastLogoTap = now;
  if (logoTaps >= 3) {
    logoTaps = 0;
    const ip = prompt('Enter Local Server IP (e.g. 192.168.1.15):', state.serverIP);
    if (ip) {
      state.serverIP = ip;
      localStorage.setItem('custom_ip', ip);
      location.reload();
    }
  }
});
window.addEventListener('pageshow', () => {
  const s = state.socket;
  if (s && !s.connected) {
    try { s.connect(); } catch(e) {}
  }
});

function setupVolumeTriggers() {
  try {
    // The plugin emits 'volumeButtonPressed' with { direction: 'up' | 'down' }.
    CapacitorVolumeButtons.addListener('volumeButtonPressed', () => {
      fire();
    });
  } catch (e) {
    console.warn('Volume button plugin unavailable:', e);
  }
}
