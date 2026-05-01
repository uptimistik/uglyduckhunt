import './style.css';
import { io } from 'socket.io-client';
import { Capacitor } from '@capacitor/core';
import { CapacitorVolumeButtons } from 'capacitor-volume-buttons';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { CapacitorFlash } from '@capgo/capacitor-flash';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';

// Platform detection: QR scanner only works in native iOS/Android
const isNative = Capacitor.isNativePlatform();

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

const EMIT_HZ = 90;
const DEFAULT_HALF = 25 * Math.PI / 180; // fallback half-FOV until user calibrates
const MIN_HALF = 3 * Math.PI / 180;      // safety floor so divisions never blow up

// Adaptive one-euro-style filter parameters.
// MIN_CUTOFF: baseline smoothing at rest — lower = less jitter but more lag.
// BETA: how fast the cutoff opens up with speed — lower = less overshoot on
//   fast flicks (Android needs this lower than iOS because it delivers rawer
//   sensor data, so spikes are larger and BETA amplifies them into overshoots).
// D_CUTOFF: smoothing on the derivative estimate itself.
const MIN_CUTOFF = 1.2;   // Hz  — baseline smoothing at rest
const BETA       = 0.35;  //     — speed gain (0.15 was too sluggish, 0.4 overshot)
const D_CUTOFF   = 1.0;   // Hz

// Max normalised units the output can move in one 60 Hz frame (~16 ms).
// 0.08 was too slow for fast sweeps. 0.14 lets the crosshair cross the full
// screen in ~0.12 s of sustained motion while still blocking single-frame spikes.
const MAX_DELTA_PER_FRAME = 0.14;

const state = {
  socket: null,
  roomCode: '',
  serverIP: '192.168.10.2',
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
    <div class="top-bar">
      <div class="badge" id="connBadge">Disconnected</div>
    </div>

    <section class="card" id="setupCard">
      <div class="mode-toggle">
        <button id="modeCloud" class="active">Cloud</button>
        <button id="modeLocal">Local</button>
      </div>

      <div id="cloudFields">
        <label>Room Code</label>
        <input id="roomInput" type="text" placeholder="ABCD" maxlength="4" autocapitalize="characters" />
      </div>

      <div id="localFields" class="hidden">
        <div class="row">
          <div>
            <label>PC IP Address</label>
            <input id="ipInput" type="text" placeholder="192.168.1.XX" />
          </div>
          <div style="width: 100px;">
            <label>Room</label>
            <input id="roomInputLocal" type="text" placeholder="ABCD" maxlength="4" autocapitalize="characters" />
          </div>
        </div>
      </div>

      <div style="margin-top: 15px; display: flex; flex-direction: column; gap: 8px;">
        <button id="scanBtn" class="primary" style="background:#ff9d00; color:#000; ${isNative ? '' : 'display:none;'}">SCAN QR CODE</button>
        <button id="connectBtn" class="primary">CONNECT</button>
        <button id="enableSensorsBtn" class="secondary">ENABLE SENSORS</button>
      </div>
      <div id="setupStatus" class="status"></div>
    </section>

    <section class="card hidden" id="calibCard">
      <h2 id="calibTitle" style="margin-top:0; font-size:20px;">Calibration</h2>
      <p id="calibSub" class="hint" style="margin-bottom:10px;"></p>
      <div class="calib-target" id="calibTarget" style="height:150px;">
        <div class="calib-arrow" id="calibArrow">·</div>
      </div>
      <button id="calibCaptureBtn" class="primary">CAPTURE</button>
      <button id="calibRestartBtn" class="secondary">RESTART</button>
      <div id="calibStatus" class="status"></div>
    </section>

    <section class="card hidden" id="blankCard" style="text-align:center; flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center;">
      <h2 style="color:#4caf50; font-size:28px; margin-bottom:5px;">CONNECTED</h2>
      <p style="color:#888; font-size:16px;">Aim at your PC screen.</p>
      
      <div style="margin-top: 30px; display:flex; flex-direction:column; gap:15px; width:100%;">
        <div class="toggle-row">
          <label>Vibrate</label>
          <input type="checkbox" id="vibrateToggle" checked />
        </div>
        <div class="toggle-row">
          <label>Muzzle Flash</label>
          <input type="checkbox" id="torchToggle" checked />
        </div>
        <button id="voiceBtnBlank" class="secondary" style="margin-top:10px; background:#ff9d00; color:#000; font-weight:800;">ENABLE VOICE</button>
        <button id="recalibBtnBlank" class="secondary" style="margin-top:10px;">RECALIBRATE</button>
        <div id="voiceStatusBlank" style="font-size:11px; color:#888; margin-top:5px;"></div>
      </div>
    </section>

    <section class="card hidden" id="playCard" style="text-align:center;">
      <div class="play-status" style="border:none; background:transparent; padding:0;">
        <p style="font-size:18px; color:#fff;"><b>Ready to Play</b></p>
        <p style="color:#888; font-size:14px; margin-bottom:20px;">Use Volume buttons to fire.</p>
      </div>
      <button id="recalibBtn" class="secondary">RECALIBRATE</button>
      <div id="playStatus" class="status" style="font-size:11px; margin-top:20px;"></div>
    </section>
  </div>
`;

const $ = (id) => document.getElementById(id) || { 
  style: {}, 
  classList: { add:()=>{} , remove:()=>{}, contains:()=>false, toggle:()=>{} }, 
  appendChild:()=>{}, 
  remove:()=>{}, 
  addEventListener:()=>{}, 
  get value() {return ""}, 
  set value(v) {}, 
  get textContent() {return ""}, 
  set textContent(v) {},
  animate: () => ({ finished: Promise.resolve() })
};

const setupCard = $('setupCard');
const calibCard = $('calibCard');
const playCard = $('playCard');
const blankCard = $('blankCard');
const playStatus = $('playStatus');
const setupStatus = $('setupStatus');
const calibStatus = $('calibStatus');
const calibTitle = $('calibTitle');
const calibSub = $('calibSub');
const connBadge = $('connBadge');

if (state.serverIP && state.serverIP !== 'cryptoduckhunt.replit.app') {
  $('ipInput').value = state.serverIP;
}

let connectionMode = 'cloud'; // 'cloud' or 'local'

$('modeCloud').addEventListener('click', () => setMode('cloud'));
$('modeLocal').addEventListener('click', () => setMode('local'));
if (isNative) {
  $('scanBtn').addEventListener('click', startScan);
}

async function startScan() {
  try {
    const granted = await requestCameraPermission();
    if (!granted) {
      setupStatus.textContent = 'Camera permission denied.';
      return;
    }

    // Hide the app UI to show the scanner underneath
    document.body.classList.add('scanner-active');
    
    // Add a stop button to the UI
    const stopBtn = document.createElement('button');
    stopBtn.id = 'stopScanBtn';
    stopBtn.textContent = 'CANCEL SCAN';
    stopBtn.className = 'primary';
    stopBtn.style.position = 'fixed';
    stopBtn.style.bottom = '40px';
    stopBtn.style.left = '20px';
    stopBtn.style.right = '20px';
    stopBtn.style.zIndex = '9999';
    document.body.appendChild(stopBtn);
    
    stopBtn.onclick = async () => {
      await BarcodeScanner.stopScan();
      document.body.classList.remove('scanner-active');
      stopBtn.remove();
    };

    const { barcodes } = await BarcodeScanner.scan({
      formats: [BarcodeFormat.QrCode],
    });

    console.log('Scan result barcodes:', barcodes);
    document.body.classList.remove('scanner-active');
    stopBtn.remove();

    if (barcodes.length > 0) {
      const val = barcodes[0].displayValue;
      console.log('Scanned QR:', val);
      parseScannedUrl(val);
    }
  } catch (err) {
    console.error('Scan error:', err);
    setupStatus.textContent = 'Scanner error: ' + err.message;
    document.body.classList.remove('scanner-active');
    const stopBtn = document.getElementById('stopScanBtn');
    if (stopBtn) stopBtn.remove();
  }
}

async function requestCameraPermission() {
  const { camera } = await BarcodeScanner.requestPermissions();
  return camera === 'granted' || camera === 'camera';
}

function parseScannedUrl(urlStr) {
  console.log('Parsing scanned URL:', urlStr);
  try {
    const url = new URL(urlStr);
    const ip = url.hostname;
    const room = url.searchParams.get('r');
    
    console.log('Detected IP:', ip, 'Room:', room);
    
    setMode('local');
    $('ipInput').value = ip;
    if (room) {
      $('roomInputLocal').value = room;
    }
    setupStatus.textContent = `Scanned IP: ${ip}. Connecting...`;
    
    // Auto-connect after scan
    setTimeout(onConnect, 500);
  } catch (e) {
    console.error('Failed to parse URL:', e);
    setupStatus.textContent = 'Invalid QR code URL: ' + urlStr;
  }
}

function setMode(mode) {
  connectionMode = mode;
  if (mode === 'cloud') {
    $('modeCloud').classList.add('active');
    $('modeLocal').classList.remove('active');
    $('cloudFields').classList.remove('hidden');
    $('localFields').classList.add('hidden');
  } else {
    $('modeCloud').classList.remove('active');
    $('modeLocal').classList.add('active');
    $('cloudFields').classList.add('hidden');
    $('localFields').classList.remove('hidden');
  }
}

$('connectBtn').addEventListener('click', onConnect);
$('enableSensorsBtn').addEventListener('click', requestSensorPermissions);
$('calibCaptureBtn').addEventListener('click', captureCalibStep);
$('calibRestartBtn').addEventListener('click', startCalibrationWizard);
$('recalibBtn').addEventListener('click', startCalibrationWizard);
$('recalibBtnBlank').addEventListener('click', startCalibrationWizard);

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
  state.orientationCount = 0;
  state.motionCount = 0;

  // Android fires BOTH 'deviceorientation' and 'deviceorientationabsolute' for
  // the same physical frame. Deduplicate with a timestamp gate so onOrientation
  // is called at most once per frame (~16 ms).
  let lastOrientationTs = 0;
  const handleAnyOrientation = (e) => {
    const now = performance.now();
    if (now - lastOrientationTs < 8) return; // skip duplicate within same frame
    lastOrientationTs = now;
    state.orientationCount++;
    onOrientation(e);
  };

  // Use plain 'deviceorientation' on both platforms. It gives alpha relative to
  // the sensor's own reset frame (not magnetic north), which behaves identically
  // on Android and iOS and avoids the 0/360 wrap-jump that 'absolute' causes
  // when the user pans near north.
  window.addEventListener('deviceorientation', handleAnyOrientation, true);
  window.addEventListener('devicemotion', (e) => { 
    state.motionCount++; 
  }, true);

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

  let alpha = Number.isFinite(alphaRaw) ? alphaRaw : state.lastRaw.alpha;
  const beta  = Number.isFinite(betaRaw)  ? betaRaw  : state.lastRaw.beta;
  const gamma = Number.isFinite(gammaRaw) ? gammaRaw : state.lastRaw.gamma;

  // Correct the 0/360 wraparound: if alpha jumps more than 180 degrees from
  // the last known value, unwrap it so the quaternion doesn't spike.
  if (Number.isFinite(state.lastRaw.alpha)) {
    let diff = alpha - state.lastRaw.alpha;
    if (diff > 180)  alpha -= 360;
    if (diff < -180) alpha += 360;
  }

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

  // Diagnostic update
  if (state.orientationCount % 30 === 0) {
    setupStatus.textContent = `Sensors: Orient#${state.orientationCount}, Motion#${state.motionCount}`;
  }

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
  // If P2P is active, we can go faster. On Socket, we slow down to avoid congestion.
  const targetHz = (state.gyroDC && state.gyroDC.readyState === 'open') ? 60 : 45;
  if (now - state.lastEmitAt < 1000 / targetHz) return;
  state.lastEmitAt = now;

  let nx = 0, ny = 0;
  if (state.qBase) {
    const { yaw, pitch } = relativeYawPitch();
    const rnx = mapToNormalized(yaw,   state.calib.yawLeft,   state.calib.yawRight);
    const rny = mapToNormalized(pitch, state.calib.pitchDown, state.calib.pitchUp);

    // Single One-Euro filter pass on state.filt.
    const tNow = now / 1000;
    const rawNx = oneEuro(state.filt, 'x', 'dx', rnx, tNow);
    const rawNy = oneEuro(state.filt, 'y', 'dy', rny, tNow);
    state.filt.lastT = tNow;
    state.filt.primed = true;

    // Clamp how far the output can jump in one frame to absorb sensor spikes.
    const prevNx = state.filt.lastNx ?? rawNx;
    const prevNy = state.filt.lastNy ?? rawNy;
    nx = clamp(rawNx, prevNx - MAX_DELTA_PER_FRAME, prevNx + MAX_DELTA_PER_FRAME);
    ny = clamp(rawNy, prevNy - MAX_DELTA_PER_FRAME, prevNy + MAX_DELTA_PER_FRAME);
    state.filt.lastNx = nx;
    state.filt.lastNy = ny;
  } else {
    nx = 0; ny = 0;
  }

  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    state.invalidEmitCount++;
    state.filt.x = 0; state.filt.y = 0; state.filt.dx = 0; state.filt.dy = 0;
    state.filt.primed = false;
    playStatus.textContent = `Sensor packet invalid (${state.invalidEmitCount}). Holding last good target.`;
    return;
  }

  // Rolling 16-bit sequence
  state.gyroSeq = ((state.gyroSeq | 0) + 1) & 0xffff;

  // Protocol: Binary Int16Array [nx*10000, ny*10000, seq]
  const buf = new Int16Array(3);
  buf[0] = Math.round(nx * 10000);
  buf[1] = Math.round(ny * 10000);
  buf[2] = state.gyroSeq;

  if (state.gyroDC && state.gyroDC.readyState === 'open') {
    // Direct P2P path
    if (state.gyroDC.bufferedAmount < 16384) {
      try { state.gyroDC.send(buf.buffer); } catch(e) {}
    }
  } else if (state.socket?.connected) {
    // Relay path - use volatile to drop late packets
    state.socket.volatile.emit('g', buf.buffer);
  }
  updateDiag();
}

// Also drive emits at a steady cadence even if orientation events stall (e.g. manual aim, no sensors).
setInterval(emit, 1000 / 45);

// ---------------- Diagnostics ----------------
let lastDiagAt = 0, lastEmitCount = 0, emitCount = 0;
function updateDiag() {
  emitCount++;
  const dOri = $('dOri'); if (dOri) dOri.textContent = state.orientationCount;
  const dMot = $('dMot'); if (dMot) dMot.textContent = state.motionCount;
  const dA = $('dA'); if (dA) dA.textContent = state.lastRaw.alpha.toFixed(1);
  const dB = $('dB'); if (dB) dB.textContent = state.lastRaw.beta.toFixed(1);
  const dG = $('dG'); if (dG) dG.textContent = state.lastRaw.gamma.toFixed(1);
  const dN = $('dN'); if (dN) dN.textContent = `${state.filt.x.toFixed(2)}, ${state.filt.y.toFixed(2)} | bad:${state.invalidEmitCount}`;
  const dROk = $('dROk'); if (dROk) dROk.textContent = String(state.relayOkCount);
  const dRMiss = $('dRMiss'); if (dRMiss) dRMiss.textContent = String(state.relayMissCount);
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
    const dHz = $('dHz');
    if (dHz) dHz.textContent = String(hz);
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
  } else if (type === 'voice_command') {
    state.socket.emit('voice_command', { roomCode: state.roomCode, ...(payload || {}) });
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
  state.filt.x = 0; state.filt.y = 0; state.filt.dx = 0; state.filt.dy = 0;
  state.filt.primed = false; state.filt.lastNx = 0; state.filt.lastNy = 0;
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

// Average N quaternion samples over CALIB_WINDOW_MS to eliminate per-frame
// jitter from a single-snapshot capture.
const CALIB_WINDOW_MS = 400;
const CALIB_SAMPLES   = 20;
let calibCapturing = false; // re-entrancy guard during averaging window

function averagedQNow() {
  return new Promise((resolve) => {
    const samples = [];
    const interval = CALIB_WINDOW_MS / CALIB_SAMPLES;
    let count = 0;
    const id = setInterval(() => {
      samples.push({ ...state.qNow });
      count++;
      if (count >= CALIB_SAMPLES) {
        clearInterval(id);
        // Simple component-wise mean then re-normalise.
        let w = 0, x = 0, y = 0, z = 0;
        // Flip quaternions that are in the opposite hemisphere to samples[0]
        // so the mean doesn't cancel out at the antipode.
        const ref = samples[0];
        for (const q of samples) {
          const dot = ref.w*q.w + ref.x*q.x + ref.y*q.y + ref.z*q.z;
          const s = dot < 0 ? -1 : 1;
          w += s * q.w; x += s * q.x; y += s * q.y; z += s * q.z;
        }
        resolve(normalizeQuat({ w, x, y, z }));
      }
    }, interval);
  });
}

function captureCalibStep() {
  if (!state.haveOrientation) return;
  if (calibCapturing) return; // ignore re-entrant calls (volume btn double-press)
  const idx = state.calib.step - 1;
  const step = CALIB_STEPS[idx];
  if (!step) return;

  calibCapturing = true;
  // Lock button to prevent double-tap during averaging window.
  const btn = $('calibCaptureBtn');
  btn.disabled = true;
  btn.textContent = 'Holding…';

  averagedQNow().then((avgQ) => {
    calibCapturing = false;
    btn.disabled = false;
    btn.textContent = 'Capture';

    if (step.key === 'center') {
      state.qBase = avgQ;
      state.filt.x = 0; state.filt.y = 0; state.filt.dx = 0; state.filt.dy = 0; state.filt.primed = false;
    } else {
      // Temporarily use averaged q as qNow to get a stable yaw/pitch reading.
      const prevQNow = state.qNow;
      state.qNow = avgQ;
      const { yaw, pitch } = relativeYawPitch();
      state.qNow = prevQNow;
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
  });
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
  
  // Longer cooldown during calibration to avoid double-captures.
  const cooldown = state.calib.done ? 300 : 500;
  
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
  if (connectionMode === 'local') {
    state.serverIP = $('ipInput').value.trim();
    state.roomCode = $('roomInputLocal').value.trim().toUpperCase();
    if (state.serverIP) localStorage.setItem('custom_ip', state.serverIP);
  } else {
    state.serverIP = 'cryptoduckhunt.replit.app';
    state.roomCode = $('roomInput').value.trim().toUpperCase();
  }

  if (!state.roomCode) {
    setupStatus.textContent = 'Room Code required.';
    return;
  }
  if (connectionMode === 'local' && !state.serverIP) {
    setupStatus.textContent = 'IP Address required for Local mode.';
    return;
  }

  // Make sure permissions have been asked at least once (no-op if not iOS gated).
  await requestSensorPermissions();

  const isReplit = state.serverIP.includes('replit.app') || state.serverIP.includes('repl.co');
  const protocol = isReplit ? 'https' : 'http';
  const port = isReplit ? '' : ':3000';
  const finalUrl = `${protocol}://${state.serverIP}${port}`;
  
  setupStatus.innerHTML = `Checking connection to <br><b>${finalUrl}</b>...`;
  
  // Preliminary health check
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${finalUrl}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    console.log('Server health check OK');
  } catch (err) {
    console.warn('Health check failed:', err);
    setupStatus.innerHTML = `<span style="color:#ff5252">Cannot reach PC at ${finalUrl}.</span><br><small>Check if Mac IP is correct (${state.serverIP}) and both devices are on same Wi-Fi.</small>`;
    return;
  }

  setupStatus.textContent = `Connecting to ${state.serverIP}…`;
  
  console.log('Connecting to socket URL:', finalUrl);

  if (state.socket?.connected) {
    console.log('Socket already connected, skipping onConnect');
    return;
  }
  
  if (state.socket) {
    console.log('Socket exists but not connected, closing old one first');
    state.socket.disconnect();
  }

  state.socket = io(finalUrl, {
    transports: ['websocket'],
    upgrade: false,
    timeout: 5000,
    // Auto-reconnect settings tuned for mobile: iOS suspends the socket when
    // the user pulls down a notification or backgrounds the app. We want to
    // recover fast and keep trying forever.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,      // start retrying quickly
    reconnectionDelayMax: 5000,   // cap backoff at 5s so we never sit dead for long
    randomizationFactor: 0.3,
  });

  state.socket.on('connect_error', (err) => {
    const msg = `Connect error: ${err.message}. (URL: ${finalUrl})`;
    console.error(msg);
    // Don't overwrite the "reconnecting" UI once we've been connected at least once.
    if (!state.hasEverConnected) {
      setupStatus.textContent = `${msg}. Ensure PC and phone are on the same Wi-Fi.`;
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
// Triple-tap the top bar to reset (now using top-bar)
let logoTaps = 0;
let lastLogoTap = 0;
$('.top-bar').addEventListener('click', () => {
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

// ---------------- Voice Recognition ----------------
// Phone mic captures commands, sends to PC for execution
let isVoiceActive = false;
let voiceRecognition = null;
const SpeechRecognitionCtrl = window.SpeechRecognition || window.webkitSpeechRecognition;

function initVoiceRecognition() {
  if (!SpeechRecognitionCtrl) {
    $('voiceStatusBlank').textContent = 'Voice not supported';
    return false;
  }
  
  voiceRecognition = new SpeechRecognitionCtrl();
  voiceRecognition.continuous = true;
  voiceRecognition.lang = 'en-US';
  voiceRecognition.interimResults = true;
  
  let finalTranscript = '';
  let interimTranscript = '';
  
  voiceRecognition.onresult = (event) => {
    interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript = transcript;
      } else {
        interimTranscript += transcript;
      }
    }
    
    const heard = (finalTranscript || interimTranscript).toLowerCase().trim();
    if (heard) {
      $('voiceStatusBlank').textContent = `Heard: "${heard}"`;
      
      // Parse dog commands
      const dogNames = ['goldie', 'rusty', 'snowy'];
      const commands = ['sit', 'fetch', 'come', 'here', 'stay', 'good boy', 'good girl'];
      
      let targetDog = null;
      let command = null;
      
      for (const name of dogNames) {
        if (heard.includes(name)) {
          targetDog = name;
          break;
        }
      }
      
      for (const cmd of commands) {
        if (heard.includes(cmd)) {
          command = cmd;
          break;
        }
      }
      
      // Special cases
      if (heard.includes('fetch') || heard.includes('get it') || heard.includes('get that')) {
        command = 'fetch';
      } else if (heard.includes('come') || heard.includes('here')) {
        command = 'come';
      } else if (heard.includes('sit') || heard.includes('stay')) {
        command = 'sit';
      } else if (heard.includes('good boy') || heard.includes('good girl') || heard.includes('treat')) {
        command = 'treat';
      }
      
      if (command) {
        // Send to PC via WebRTC/socket
        sendEvent('voice_command', {
          command: command,
          target: targetDog,
          transcript: heard
        });
        $('voiceStatusBlank').style.color = '#4caf50';
        setTimeout(() => { $('voiceStatusBlank').style.color = '#888'; }, 500);
      }
    }
  };
  
  voiceRecognition.onerror = (e) => {
    console.error('Voice error:', e);
    $('voiceStatusBlank').textContent = `Error: ${e.error}`;
    isVoiceActive = false;
    $('voiceBtnBlank').textContent = 'ENABLE VOICE';
    $('voiceBtnBlank').style.background = '#ff9d00';
  };
  
  voiceRecognition.onend = () => {
    if (isVoiceActive) {
      voiceRecognition.start(); // Restart if still active
    }
  };
  
  return true;
}

// Wire up voice button
if (SpeechRecognitionCtrl) {
  initVoiceRecognition();
  $('voiceBtnBlank').addEventListener('click', () => {
    isVoiceActive = !isVoiceActive;
    if (isVoiceActive) {
      voiceRecognition.start();
      $('voiceBtnBlank').textContent = 'VOICE ACTIVE';
      $('voiceBtnBlank').style.background = '#4caf50';
      $('voiceStatusBlank').textContent = 'Listening for dog commands...';
      $('voiceStatusBlank').style.color = '#fff';
    } else {
      voiceRecognition.stop();
      $('voiceBtnBlank').textContent = 'ENABLE VOICE';
      $('voiceBtnBlank').style.background = '#ff9d00';
      $('voiceStatusBlank').textContent = 'Voice paused';
      $('voiceStatusBlank').style.color = '#888';
    }
  });
} else {
  $('voiceBtnBlank').style.display = 'none';
  $('voiceStatusBlank').textContent = 'Voice API not available';
}
