// =====================================================================
// Ugly Duck Hunt — Realistic Expansive Wetlands (Smooth 3D)
// =====================================================================
import './style.css';
import * as THREE from 'three';
import { io } from 'socket.io-client';

const socket = io('https://cryptoduckhunt.replit.app', {
  transports: ['websocket'],
  upgrade: false,
  timeout: 5000,
});

// --------------------------- HUD -------------------------------------
document.querySelector('#app').innerHTML = `
  <div id="hud">
    <div class="row top">
      <div class="panel">
        <div class="title">ROOM</div>
        <div class="big" id="room-code">----</div>
      </div>
      <div class="panel center">
        <div id="status">Waiting for controller…</div>
        <div id="timer" style="display:none; font-size:24px; margin-left:20px; color:#fff;">01:30</div>
      </div>
      <div class="panel">
        <div class="title">TOTAL SCORE</div>
        <div class="big" id="score">0</div>
      </div>
    </div>
    
    <!-- Dog Stats & Voice Control Panel -->
    <div id="dog-panel" class="panel">
      <div class="title">DOG COMMANDS</div>
      <div id="dogs-container">
        <!-- Dog stats will be injected here -->
      </div>
      <div class="dog-stat-line" style="margin: 5px 8px;"><span>POUCH</span><b id="dog-pouch">🍪🍪🍪</b></div>
      <div id="voice-btn">ENABLE VOICE MIC</div>
      <div id="voice-status">Mic Offline</div>
    </div>

    <!-- Badges Panel -->
    <div id="achievements-panel" class="panel">
      <div class="title">BADGES & RANK</div>
      <div id="achievements-list">
        <!-- Time Badges -->
        <div class="badge locked" id="badge-time-1">⏱️ <span class="badge-label">1m Played</span></div>
        <div class="badge locked" id="badge-time-10">⏱️ <span class="badge-label">10m Played</span></div>
        <div class="badge locked" id="badge-time-30">⏱️ <span class="badge-label">30m Played</span></div>
        <!-- Kill Badges -->
        <div class="badge locked" id="badge-kill-10">🦆 <span class="badge-label">10 Kills</span></div>
        <div class="badge locked" id="badge-kill-50">🦆 <span class="badge-label">50 Kills</span></div>
        <div class="badge locked" id="badge-kill-100">🦆 <span class="badge-label">100 Kills</span></div>
      </div>
    </div>

    <div id="notification">Achievement Unlocked!</div>

    <div class="row bottom">
      <div class="panel small">
        <span>SHOTS <b id="shots">0</b></span>
        <span>HITS <b id="hits">0</b></span>
        <span>LONG <b id="longest-shot">0m</b></span>
        <span>WAVE <b id="wave">1</b></span>
        <span>PKTS <b id="pkts">0</b></span>
      </div>
      <div id="player-scores" class="panel small">
        <!-- Per-player scores injected at runtime -->
      </div>
    </div>
    <div id="player-crosshairs"></div>
    <div id="kill-banner"></div>
    <div id="debug-info" style="position:fixed; bottom:80px; right:30px; font-size:10px; color:#444; pointer-events:none; text-align:right;"></div>
  </div>
  </div>
  <div id="calib-overlay" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:100; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding: 40px; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <h1 id="calib-overlay-title" style="font-size:48px; margin-bottom:30px; color:#ff9d00;">Calibration</h1>
    <p id="calib-overlay-sub" style="font-size:24px; max-width:800px; line-height:1.5; color:#eee;">Please follow the instructions on your phone.</p>
    <div id="calib-player-indicator" style="margin-top:20px; font-size:18px; color:#888;"></div>
  </div>

  <div id="menu-overlay" style="position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:200; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
    <h1 style="font-size:64px; color:#ff9d00; margin-bottom:10px; letter-spacing:4px;">UGLY DUCK HUNT</h1>
    <p style="color:#aaa; margin-bottom:40px;">WETLANDS ECOSYSTEM — MULTIPLAYER EDITION</p>
    <div style="display:flex; gap:20px;">
      <button id="btn-relax" class="menu-btn">RELAX MODE<br><small>Infinite Time · Practice</small></button>
      <button id="btn-pvp" class="menu-btn">PvP BATTLE<br><small>2 Players · 1:30 Limit</small></button>
    </div>
    <div id="menu-conn-status" style="margin-top:40px; font-size:14px; color:#666;">Waiting for controllers...</div>
  </div>

  <div id="game-over-overlay" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:300; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
    <h1 id="go-title" style="font-size:72px; color:#ff9d00;">TIME'S UP!</h1>
    <div id="go-results" style="margin:40px 0; display:flex; gap:60px;"></div>
    <button id="btn-restart" class="menu-btn">BACK TO MENU</button>
  </div>
`;

const css = document.createElement('style');
css.textContent = `
  html, body, #app { margin:0; padding:0; height:100%; overflow:hidden; background:#111; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; color:#eee; }
  canvas { display:block; }
  #hud { position:fixed; inset:0; pointer-events:none; z-index:250; }
  #hud .row { position:absolute; left:0; right:0; display:flex; justify-content:space-between; padding:20px 30px; gap:15px; }
  #hud .row.top { top:0; }
  #hud .row.bottom { bottom:0; }
  #hud .panel { background:rgba(15, 18, 20, 0.6); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:12px 20px; box-shadow:0 8px 32px rgba(0,0,0,0.3); }
  #hud .panel.center { flex:1; text-align:center; color:#ff9d00; font-size:14px; font-weight:600; letter-spacing:1px; text-transform:uppercase; display:flex; align-items:center; justify-content:center; }
  #hud .panel.small { display:flex; gap:30px; font-size:13px; color:#aaa; font-weight:500; letter-spacing:1px; }
  #hud .panel.small b { color:#fff; font-weight:700; margin-left:6px; font-size:15px; }
  #hud .title { font-size:11px; color:#888; margin-bottom:4px; font-weight:600; letter-spacing:2px; }
  #hud .big   { font-size:28px; font-weight:300; color:#fff; }
  
  #dog-panel { position:absolute; left:30px; top:130px; width:220px; pointer-events:auto; display:flex; flex-direction:column; gap:8px; }
  #dogs-container { display:flex; flex-direction:column; gap:6px; margin-bottom:6px; }
  .dog-stat-row { background:rgba(0,0,0,0.3); padding:6px 10px; border-radius:6px; border-left:4px solid transparent; font-size:12px; }
  .dog-stat-line { display:flex; justify-content:space-between; font-size:10px; color:#aaa; margin-top:2px; }
  .dog-stat-line b { color:#fff; }
  
  #achievements-panel { position:absolute; right:30px; top:130px; width:220px; text-align:right; max-height:400px; overflow-y:auto; }
  #achievements-list { display:flex; flex-wrap:wrap; gap:10px; margin-top:8px; justify-content:flex-end; }
  .badge { width:60px; height:60px; border-radius:12px; background:rgba(255,255,255,0.03); display:flex; flex-direction:column; align-items:center; justify-content:center; font-size:22px; border:1px solid rgba(255,255,255,0.1); transition:0.4s; padding: 4px; }
  .badge.locked { opacity:0.15; filter:grayscale(1); }
  .badge.unlocked { background:rgba(255, 157, 0, 0.15); border-color:#ff9d00; box-shadow:0 0 20px rgba(255,157,0,0.3); opacity:1; filter:none; }
  .badge-label { display: block; font-size: 8px; color: #aaa; margin-top: 5px; font-weight: 700; text-transform: uppercase; text-align: center; line-height: 1.1; }
  .badge.unlocked .badge-label { color: #fff; }
  .badge .tooltip { display: none; }
  
  #notification { position:fixed; top:20px; left:50%; transform:translateX(-50%) translateY(-100px); background:#ff9d00; color:#000; padding:15px 30px; border-radius:30px; font-weight:800; z-index:100; transition:0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
  #notification.show { transform:translateX(-50%) translateY(0); }

  .dog-stats { display:flex; flex-direction:column; gap:4px; font-size:12px; color:#aaa; margin-bottom:10px; }
  .dog-stats b { color:#ff9d00; float:right; }
  #voice-btn { background:#ff9d00; color:#000; padding:8px; border-radius:4px; text-align:center; font-size:11px; font-weight:800; cursor:pointer; transition:0.2s; }
  #voice-btn:hover { background:#ffb74d; transform:scale(1.05); }
  #voice-btn.active { background:#4caf50; color:#fff; }
  #voice-status { font-size:10px; text-align:center; color:#888; font-style:italic; }

  /* Multi-player score panel */
  #player-scores { display:flex; gap:30px; }
  .pscore { display:flex; flex-direction:column; align-items:flex-end; }
  .pscore .label { font-size:10px; letter-spacing:2px; font-weight:700; }
  .pscore .val { font-size:22px; font-weight:300; color:#fff; line-height:1.1; }
  .pscore.p1 .label { color:#ff5252; }
  .pscore.p2 .label { color:#42a5f5; }

  /* Menu Buttons */
  .menu-btn { background:rgba(255,255,255,0.05); border:2px solid rgba(255,255,255,0.1); color:#fff; padding:20px 40px; border-radius:12px; font-size:18px; font-weight:800; cursor:pointer; transition:0.3s; pointer-events:auto; text-transform:uppercase; line-height:1.2; }
  .menu-btn:hover { background:rgba(255,157,0,0.2); border-color:#ff9d00; transform:scale(1.05); }
  .menu-btn small { font-size:11px; font-weight:400; color:#aaa; display:block; margin-top:5px; }

  /* Crosshairs */
  .ch { position:fixed; width:40px; height:40px; border:2px solid; border-radius:50%; pointer-events:none; transform:translate(-50%, -50%); display:flex; align-items:center; justify-content:center; z-index:260; transition: transform 0.05s linear; }
  .ch::after { content:''; width:4px; height:4px; background:#fff; border-radius:50%; }
  .ch.p1 { border-color:#ff5252; box-shadow:0 0 15px rgba(255,82,82,0.5); }
  .ch.p2 { border-color:#42a5f5; box-shadow:0 0 15px rgba(66,165,245,0.5); }
  .ch.fire { transform:translate(-50%, -50%) scale(1.5); opacity:0.5; }

  /* Kill banner */
  #kill-banner { position:fixed; top:90px; left:50%; transform:translateX(-50%) translateY(-40px); padding:10px 24px; border-radius:24px; font-weight:800; font-size:14px; letter-spacing:1px; opacity:0; transition:0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); pointer-events:none; z-index:50; }
  #kill-banner.show { transform:translateX(-50%) translateY(0); opacity:1; }
  #kill-banner.p1 { background:rgba(255,82,82,0.95); color:#fff; box-shadow:0 0 24px rgba(255,82,82,0.6); }
  #kill-banner.p2 { background:rgba(66,165,245,0.95); color:#fff; box-shadow:0 0 24px rgba(66,165,245,0.6); }

  #go-results .result-card { background:rgba(255,255,255,0.03); padding:30px; border-radius:16px; border:1px solid rgba(255,255,255,0.1); min-width:200px; }
  #go-results .result-card.winner { border-color:#ff9d00; background:rgba(255,157,0,0.1); box-shadow:0 0 40px rgba(255,157,0,0.2); }
  #go-results .res-slot { font-size:14px; color:#aaa; margin-bottom:10px; }
  #go-results .res-score { font-size:48px; font-weight:800; }
  #go-results .res-label { font-size:12px; color:#888; text-transform:uppercase; margin-top:5px; }
`;
document.head.appendChild(css);

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
let score = 0, shots = 0, hits = 0, wave = 1, pktCount = 0;
let commandsUsed = 0, ducksFetched = 0;
let totalPlayTime = 0, longestShot = 0;
let lastTimeAchievement = 0;
let unlockedBadges = new Set();
let treatsInPouch = 3, refillTimer = 0;
const MAX_TREATS = 3, REFILL_COOLDOWN = 15;
let dogs = [];

let gameState = 'MENU'; // MENU, PLAYING, GAMEOVER
let gameMode = 'RELAX'; // RELAX, PVP
let gameTimer = 90;
let timerInterval = null;

const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
$('room-code').textContent = roomCode;

// Always (re-)create the room on every connect AND reconnect — otherwise
// when the screen briefly drops, the server forgets this roomCode has a
// screen and new controllers get "Room has no active screen".
socket.on('connect', () => socket.emit('create_room', roomCode));
socket.on('disconnect', () => {
  statusEl.textContent = 'Screen disconnected. Reconnecting…';
  statusEl.style.color = '#ff9d00';
});
// Kick reconnect fast when the tab becomes visible again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !socket.connected) {
    try { socket.connect(); } catch(e) {}
  }
});
// ============================================================================
// MULTI-PLAYER STATE
// Each connected controller becomes a Player with its own aim, score, laser,
// crosshair, and WebRTC peer connection. The screen is the WebRTC offerer
// for *each* peer (one PC per controller).
// ============================================================================
const PLAYER_COLORS = {
  1: { laser: 0xff3030, halo: 0x330000, beam: 0xff4040, hex: '#ff5252', label: 'P1' },
  2: { laser: 0x3080ff, halo: 0x000033, beam: 0x40a0ff, hex: '#42a5f5', label: 'P2' },
};

const players = new Map(); // playerId -> Player


function makePlayer(id, slot) {
  const colors = PLAYER_COLORS[slot] || PLAYER_COLORS[1];
  
  // Create DOM crosshair
  const ch = document.createElement('div');
  ch.className = `ch p${slot}`;
  ch.id = `ch-${id}`;
  $('player-crosshairs').appendChild(ch);

  // Initial aim: P1 left (-0.5), P2 right (+0.5)
  const initX = slot === 1 ? -0.5 : 0.5;

  return {
    id, slot, colors, ch,
    aim: { nx: initX, ny: 0, sx: initX, sy: 0 },
    lastSeq: -1,
    score: 0, shots: 0, hits: 0,
    pc: null, gyroDC: null, eventDC: null, rtcReady: false,
  };
}

function destroyPlayer(p) {
  p.ch.remove();
  try { p.gyroDC?.close(); } catch(e) {}
  try { p.eventDC?.close(); } catch(e) {}
  try { p.pc?.close(); } catch(e) {}
}

function renderPlayerScores() {
  const host = $('player-scores');
  if (!host) return;
  // Sort by slot so P1 is always on the left.
  const list = Array.from(players.values()).sort((a, b) => a.slot - b.slot);
  host.innerHTML = list.map(p => `
    <div class="pscore p${p.slot}">
      <span class="label">PLAYER ${p.slot}</span>
      <span class="val" style="color:${p.colors.hex}">${p.score}</span>
    </div>
  `).join('');
}

function showKillBanner(slot) {
  const el = $('kill-banner');
  if (!el) return;
  el.className = `p${slot}`;
  el.textContent = `PLAYER ${slot} — DUCK DOWN!`;
  // Restart animation
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1100);
}

function getOrCreatePlayer(playerId, slot = 1) {
  let p = players.get(playerId);
  if (!p) {
    p = makePlayer(playerId, slot);
    players.set(playerId, p);
    renderPlayerScores();
  }
  return p;
}

function setRtcStatusForPlayer(p, active) {
  p.rtcReady = !!active;
  // If any player's P2P is up, advertise it in the status bar.
  const anyP2P = Array.from(players.values()).some(x => x.rtcReady);
  if (active) {
    statusEl.textContent = anyP2P ? 'P2P Connected — Point & Shoot' : 'Controller Connected - Point & Shoot';
    statusEl.style.color = '#4caf50';
  }
}

socket.on('controller_connected', (info) => {
  // Back-compat: old controllers send no payload, new ones send { playerId, slot }.
  const playerId = info?.playerId || `legacy-${Date.now()}`;
  const slot = info?.slot || 1;
  getOrCreatePlayer(playerId, slot);
  statusEl.textContent = `Player ${slot} connected — Point & Shoot`;
  statusEl.style.color = '#4caf50';
  // Start WebRTC negotiation with this specific controller.
  setupRTCFor(playerId);
});

socket.on('controller_disconnected', (info) => {
  const playerId = info?.playerId;
  if (!playerId) return;
  const p = players.get(playerId);
  if (!p) return;
  destroyPlayer(p);
  players.delete(playerId);
  renderPlayerScores();
  updateMenuConnStatus();
  if (players.size === 0) {
    statusEl.textContent = 'Waiting for controller…';
    statusEl.style.color = '';
  }
});

function updateMenuConnStatus() {
  const count = players.size;
  const el = $('menu-conn-status');
  if (count === 0) el.textContent = 'Waiting for controllers...';
  else if (count === 1) el.textContent = 'Player 1 Connected. Waiting for Player 2 for PvP...';
  else el.textContent = '2 Players Connected. Ready for PvP Battle!';
}

// ---------------- WebRTC peer connection (screen = offerer, one per peer) ----------------
function setupRTCFor(playerId) {
  const p = players.get(playerId);
  if (!p) return;
  // Tear down any previous PC for this player (e.g. on reconnect).
  try { p.gyroDC?.close(); } catch(e) {}
  try { p.eventDC?.close(); } catch(e) {}
  try { p.pc?.close(); } catch(e) {}

  p.pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });

  p.gyroDC = p.pc.createDataChannel('gyro', { ordered: false, maxRetransmits: 0 });
  p.eventDC = p.pc.createDataChannel('events', { ordered: true });

  p.gyroDC.onopen = () => setRtcStatusForPlayer(p, true);
  p.gyroDC.onclose = () => setRtcStatusForPlayer(p, false);
  p.gyroDC.onmessage = (e) => {
    // Stamp the playerId before applying so stale-rejection works per-player.
    const data = JSON.parse(e.data);
    data.playerId = playerId;
    applyGyro(data);
  };

  p.eventDC.onmessage = (e) => {
    const d = JSON.parse(e.data);
    switch (d.type) {
      case 'trigger': fireShot(playerId); break;
      case 'calib_start':
        $('calib-overlay').style.display = 'flex';
        break;
      case 'calib_state':
        $('calib-overlay').style.display = 'flex';
        $('calib-overlay-title').textContent = `${PLAYER_COLORS[p.slot].label}: ${d.title}`;
        $('calib-overlay-sub').textContent = d.sub;
        break;
      case 'calib_done':
        $('calib-overlay').style.display = 'none';
        break;
    }
  };

  p.pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('rtc_signal', { roomCode, to: playerId, ice: e.candidate });
  };

  p.pc.onconnectionstatechange = () => {
    if (!p.pc) return;
    if (p.pc.connectionState === 'failed' || p.pc.connectionState === 'disconnected') {
      setRtcStatusForPlayer(p, false);
    }
  };

  p.pc.createOffer()
    .then(offer => p.pc.setLocalDescription(offer))
    .then(() => socket.emit('rtc_signal', { roomCode, to: playerId, sdp: p.pc.localDescription }))
    .catch(err => console.warn('RTC offer failed:', err));
}

socket.on('rtc_signal', async (msg) => {
  // Route incoming signaling to the correct peer's PC by `from` (sender id).
  const fromId = msg.from;
  if (!fromId) return;
  const p = players.get(fromId);
  if (!p?.pc) return;
  try {
    if (msg.sdp && msg.sdp.type === 'answer') {
      await p.pc.setRemoteDescription(msg.sdp);
    } else if (msg.ice) {
      await p.pc.addIceCandidate(msg.ice);
    }
  } catch (err) {
    console.warn('RTC signal handle failed:', err);
  }
});

// Server-relayed fallbacks. These still work if WebRTC negotiation fails
// (e.g. symmetric NAT with no reachable STUN), so the game never breaks.
socket.on('calib_start', (data) => {
  // If data has a playerId, we can show which player is calibrating
  const p = data?.playerId ? players.get(data.playerId) : null;
  const label = p ? `Player ${p.slot}` : '';
  $('calib-overlay').style.display = 'flex';
  $('calib-player-indicator').textContent = label;
});

socket.on('calib_state', (data) => {
  // data: { title, sub, playerId? }
  $('calib-overlay').style.display = 'flex';
  $('calib-overlay-title').textContent = data.title;
  $('calib-overlay-sub').textContent = data.sub;
  if (data.playerId) {
    const p = players.get(data.playerId);
    if (p) $('calib-player-indicator').textContent = `Player ${p.slot}`;
  }
});

socket.on('calib_done', (data) => {
  $('calib-overlay').style.display = 'none';
  // IMPORTANT: Tell THIS specific controller that calibration is complete
  // so it exits its local calibration wizard and enters play mode.
  if (data?.playerId) {
    socket.emit('calibration_complete', { roomCode, to: data.playerId });
  }
});

// --------------------------- Voice Recognition -----------------------
let isVoiceEnabled = false;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.lang = 'en-US';
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const last = event.results.length - 1;
    const transcript = event.results[last][0].transcript.toLowerCase();
    $('voice-status').textContent = `Heard: "${transcript}"`;
    
    const dogNames = ['goldie', 'rusty', 'snowy'];
    let targetDog = null;
    dogNames.forEach(name => {
      if (transcript.includes(name)) targetDog = name;
    });

    if (transcript.includes('sit')) handleDogCommand('sit', targetDog);
    else if (transcript.includes('fetch')) handleDogCommand('fetch', targetDog);
    else if (transcript.includes('good boy') || transcript.includes('goodboy')) handleDogCommand('good boy', targetDog);
  };

  recognition.onerror = (e) => {
    console.error('Speech recognition error', e);
    isVoiceEnabled = false;
    $('voice-btn').classList.remove('active');
    $('voice-btn').textContent = 'ENABLE VOICE MIC';
    $('voice-status').textContent = 'Mic Error';
  };

  recognition.onend = () => {
    if (isVoiceEnabled) recognition.start();
  };

  $('voice-btn').addEventListener('click', () => {
    isVoiceEnabled = !isVoiceEnabled;
    if (isVoiceEnabled) {
      recognition.start();
      $('voice-btn').classList.add('active');
      $('voice-btn').textContent = 'VOICE ACTIVE';
      $('voice-status').textContent = 'Listening for: sit, fetch, good boy...';
    } else {
      recognition.stop();
      $('voice-btn').classList.remove('active');
      $('voice-btn').textContent = 'ENABLE VOICE MIC';
      $('voice-status').textContent = 'Mic Offline';
    }
  });
} else {
  $('voice-btn').style.display = 'none';
  $('voice-status').textContent = 'Voice API not supported in this browser';
}

function handleDogCommand(cmd, targetName) {
  const status = $('voice-status');
  status.style.color = '#fff';
  status.style.fontWeight = 'bold';
  setTimeout(() => {
    status.style.color = '';
    status.style.fontWeight = '';
  }, 1000);

  const targetDogs = targetName ? dogs.filter(d => d.name.toLowerCase() === targetName) : dogs;
  const nameLabel = targetName ? targetName.toUpperCase() : 'All dogs';

  if (cmd === 'sit') {
    targetDogs.forEach(dog => { if (dog.state === 0) dog.state = 4; });
    status.textContent = `Acknowledged: ${nameLabel} SIT!`;
  } else if (cmd === 'fetch') {
    targetDogs.forEach(dog => { if (dog.state === 4) dog.state = 0; });
    status.textContent = `Acknowledged: ${nameLabel} FETCH!`;
  } else if (cmd === 'good boy') {
    if (treatsInPouch <= 0) {
      status.textContent = 'Pouch empty! Wait for more treats...';
      return;
    }
    
    treatsInPouch--;
    commandsUsed++;
    checkAchievements();
    
    targetDogs.forEach(dog => {
      dog.happiness = Math.min(100, dog.happiness + 15);
      dog.baseSpeed += 1.2;
    });
    
    triggerTreatEffect();
    status.textContent = `Acknowledged: GOOD BOY ${nameLabel}! ❤️`;
  }
}

// --------------------------- Game Flow -----------------------------
function startGame(mode) {
  gameState = 'PLAYING';
  gameMode = mode;
  score = 0; hits = 0; shots = 0; wave = 1;
  players.forEach(p => { p.score = 0; p.hits = 0; p.shots = 0; });
  
  $('score').textContent = '0';
  $('hits').textContent = '0';
  $('shots').textContent = '0';
  $('wave').textContent = '1';
  renderPlayerScores();

  $('menu-overlay').style.display = 'none';
  $('game-over-overlay').style.display = 'none';

  if (mode === 'PVP') {
    gameTimer = 90;
    $('timer').style.display = 'block';
    updateTimerUI();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(tickTimer, 1000);
  } else {
    $('timer').style.display = 'none';
  }
}

function tickTimer() {
  gameTimer--;
  updateTimerUI();
  if (gameTimer <= 0) {
    endGame();
  }
}

function updateTimerUI() {
  const m = Math.floor(gameTimer / 60);
  const s = gameTimer % 60;
  $('timer').textContent = `${m}:${s.toString().padStart(2, '0')}`;
  if (gameTimer <= 10) $('timer').style.color = '#ff5252';
  else $('timer').style.color = '#fff';
}

function endGame() {
  gameState = 'GAMEOVER';
  if (timerInterval) clearInterval(timerInterval);
  
  // Clear any remaining ducks
  ducks.forEach(d => scene.remove(d));
  ducks.length = 0;

  $('game-over-overlay').style.display = 'flex';
  
  const results = $('go-results');
  results.innerHTML = '';
  
  const playerList = Array.from(players.values()).sort((a, b) => a.slot - b.slot);
  let maxScore = -1;
  let winner = null;
  
  playerList.forEach(p => {
    if (p.score > maxScore) {
      maxScore = p.score;
      winner = p;
    } else if (p.score === maxScore) {
      winner = null; // Tie
    }
  });

  playerList.forEach(p => {
    const card = document.createElement('div');
    card.className = `result-card ${winner === p ? 'winner' : ''}`;
    card.innerHTML = `
      <div class="res-slot" style="color:${p.colors.hex}">PLAYER ${p.slot}</div>
      <div class="res-score">${p.score}</div>
      <div class="res-label">${winner === p ? 'WINNER' : 'SCORE'}</div>
    `;
    results.appendChild(card);
  });

  if (gameMode === 'PVP') {
    $('go-title').textContent = winner ? `PLAYER ${winner.slot} WINS!` : "IT'S A TIE!";
  } else {
    $('go-title').textContent = 'SESSION ENDED';
  }
}

$('btn-relax').addEventListener('click', () => startGame('RELAX'));
$('btn-pvp').addEventListener('click', () => {
  if (players.size < 2) {
    alert('PvP Mode requires 2 players! Please connect another phone.');
    return;
  }
  startGame('PVP');
});
$('btn-restart').addEventListener('click', () => {
  $('game-over-overlay').style.display = 'none';
  $('menu-overlay').style.display = 'flex';
  gameState = 'MENU';
});

// Simulated console commands for testing
window.dogCmd = handleDogCommand;

function unlockBadge(id, icon, label) {
  if (unlockedBadges.has(id)) return;
  unlockedBadges.add(id);
  
  // Try to find an existing locked placeholder first
  const placeholder = $(`badge-${id}`);
  if (placeholder) {
    placeholder.classList.remove('locked');
    placeholder.classList.add('unlocked');
  } else {
    // Create new badge if no placeholder exists
    const list = $('achievements-list');
    const badge = document.createElement('div');
    badge.className = 'badge unlocked';
    badge.innerHTML = `${icon} <span class="badge-label">${label}</span>`;
    list.prepend(badge);
  }
  
  const notif = $('notification');
  notif.textContent = `Badge Earned: ${label}`;
  notif.classList.add('show');
  setTimeout(() => notif.classList.remove('show'), 4000);
  playMechSound(1000, 0.2);
}

function checkAchievements() {
  const mins = Math.floor(totalPlayTime / 60);
  
  // Time Milestones
  const timeMilestones = [1, 3, 10, 20, 30, 50];
  timeMilestones.forEach(m => {
    if (mins >= m) unlockBadge(`time-${m}`, '⏱️', `${m} Minute Explorer`);
  });
  
  // 30m intervals after 50m
  if (mins > 50) {
    const extra = Math.floor((mins - 50) / 30);
    for(let i=1; i<=extra; i++) {
      const target = 50 + i * 30;
      unlockBadge(`time-${target}`, '⌛', `${target} Minute Veteran`);
    }
  }

  // Duck Kill Milestones
  const killMilestones = [10, 50, 100, 250, 500, 1000];
  killMilestones.forEach(m => {
    if (hits >= m) unlockBadge(`kill-${m}`, '🦆', `${m} Ducks Down`);
  });
}

// --------------------------- Three.js Setup --------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4; // Boosted exposure for brighter scene
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sharedUniforms = { uTime: { value: 0 } };
const FOG_COLOR = new THREE.Color(0xe0c8b0); // Brighter hazy sunset
scene.fog = new THREE.Fog(FOG_COLOR, 30, 450); // Linear fog to keep foreground bright and crisp

const CAMERA_HOME = new THREE.Vector3(0, 14, 45);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 800);
camera.position.copy(CAMERA_HOME);
camera.lookAt(0, 5, -50);

// Simple particle system for muzzle flash
const flashParticles = [];
const smokeParticles = [];
const treatParticles = [];
const particleGeometry = new THREE.PlaneGeometry(0.5, 0.5);

// Create treat particles (brown/tan kibble)
function createTreatParticles() {
  const treatMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b4513, // SaddleBrown
    roughness: 0.9
  });
  
  for (let i = 0; i < 30; i++) {
    const particle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.2), treatMaterial);
    particle.userData = {
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 10 + 5,
        (Math.random() - 0.5) * 8
      ),
      life: 3.0,
      maxLife: 3.0,
      rot: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(0.2)
    };
    particle.visible = false;
    scene.add(particle);
    treatParticles.push(particle);
  }
}


// Create muzzle flash particles
function createMuzzleFlashParticles() {
  const flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff88,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  
  for (let i = 0; i < 20; i++) {
    const particle = new THREE.Mesh(particleGeometry, flashMaterial.clone());
    particle.userData = {
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20,
        Math.random() * 10 + 5
      ),
      life: 0.15,
      maxLife: 0.15,
      startSize: Math.random() * 2 + 1
    };
    particle.visible = false;
    scene.add(particle);
    flashParticles.push(particle);
  }
}

// Create smoke particles
function createSmokeParticles() {
  const smokeMaterial = new THREE.MeshBasicMaterial({
    color: 0x888888,
    transparent: true,
    opacity: 0.6,
    depthWrite: false
  });
  
  for (let i = 0; i < 15; i++) {
    const particle = new THREE.Mesh(particleGeometry, smokeMaterial.clone());
    particle.userData = {
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 3 + 1,
        Math.random() * 3 + 1
      ),
      life: 2.0,
      maxLife: 2.0,
      startSize: Math.random() * 1.5 + 0.5
    };
    particle.visible = false;
    scene.add(particle);
    smokeParticles.push(particle);
  }
}

// Update particles
function updateParticles(dt) {
  // Update flash particles
  flashParticles.forEach(particle => {
    if (!particle.visible) return;
    
    particle.userData.life -= dt;
    if (particle.userData.life <= 0) {
      particle.visible = false;
      return;
    }
    
    particle.position.addScaledVector(particle.userData.velocity, dt);
    particle.userData.velocity.multiplyScalar(0.95); // Damping
    
    const lifeRatio = particle.userData.life / particle.userData.maxLife;
    (particle.material).opacity = lifeRatio * 0.8;
    const scale = particle.userData.startSize * lifeRatio;
    particle.scale.set(scale, scale, scale);
  });
  
  // Update smoke particles
  smokeParticles.forEach(particle => {
    if (!particle.visible) return;
    
    particle.userData.life -= dt;
    if (particle.userData.life <= 0) {
      particle.visible = false;
      return;
    }
    
    particle.position.addScaledVector(particle.userData.velocity, dt);
    particle.userData.velocity.y += dt * 2; // Rise
    
    const lifeRatio = particle.userData.life / particle.userData.maxLife;
    (particle.material).opacity = lifeRatio * 0.4;
    const scale = particle.userData.startSize * (2 - lifeRatio); // Expand as it rises
    particle.scale.set(scale, scale, scale);
  });

  // Update treat particles
  treatParticles.forEach(particle => {
    if (!particle.visible) return;
    
    particle.userData.life -= dt;
    if (particle.userData.life <= 0) {
      particle.visible = false;
      return;
    }
    
    // Attract to the NEAREST dog's mouth
    let closestDog = null;
    let minDist = Infinity;
    const mouthPos = new THREE.Vector3();
    const tempPos = new THREE.Vector3();

    dogs.forEach(dog => {
      dog.mouthAnchor.getWorldPosition(tempPos);
      const d = particle.position.distanceTo(tempPos);
      if (d < minDist) {
        minDist = d;
        closestDog = dog;
        mouthPos.copy(tempPos);
      }
    });

    if (closestDog && minDist < 6.0) {
       const dir = mouthPos.clone().sub(particle.position).normalize();
       particle.userData.velocity.lerp(dir.multiplyScalar(22), dt * 10);
       
       if (minDist < 0.8) {
         // EATEN!
         particle.visible = false;
         closestDog.headGroup.scale.setScalar(1.25);
         setTimeout(() => closestDog.headGroup.scale.setScalar(1.0), 100);
         return;
       }
    }

    particle.userData.velocity.y -= dt * 25; // Gravity
    particle.position.addScaledVector(particle.userData.velocity, dt);
    
    particle.rotation.x += particle.userData.rot.x;
    particle.rotation.y += particle.userData.rot.y;
    particle.rotation.z += particle.userData.rot.z;

    const floorY = Math.max(getTerrainY(particle.position.x, particle.position.z), 0);
    if (particle.position.y < floorY) {
      particle.position.y = floorY;
      particle.userData.velocity.set(0,0,0);
    }
  });
}

// Trigger muzzle flash and smoke
function triggerMuzzleFlash() {
  // Use the same barrel position as the laser beam
  const barrel = camera.localToWorld(new THREE.Vector3(1, -1, -2));
  
  // Activate flash particles
  flashParticles.forEach(particle => {
    particle.position.copy(barrel);
    particle.userData.life = particle.userData.maxLife;
    particle.visible = true;
  });
  
  // Activate smoke particles
  smokeParticles.forEach(particle => {
    particle.position.copy(barrel);
    particle.userData.life = particle.userData.maxLife;
    particle.visible = true;
  });
}

function triggerTreatEffect() {
  // Spawn treats near the center dog
  const spawnPos = dogs[1].group.position.clone().add(new THREE.Vector3(0, 5, -3));
  treatParticles.forEach(particle => {
    particle.position.copy(spawnPos);
    particle.userData.life = particle.userData.maxLife;
    particle.userData.velocity.set(
      (Math.random() - 0.5) * 12,
      Math.random() * 8 + 4,
      (Math.random() - 0.5) * 12 - 5 
    );
    particle.visible = true;
  });
}

// --------------------------- Lighting & Sky --------------------------
// Strong Hemisphere light for bright, natural ambient fill
const hemiLight = new THREE.HemisphereLight(0xfff0e0, 0x4a5a6a, 1.2);
scene.add(hemiLight);

// Front fill light to clearly illuminate fronts of ducks/dog
const fillLight = new THREE.DirectionalLight(0xaaccff, 0.7);
fillLight.position.set(-20, 40, 100);
scene.add(fillLight);

// Golden hour sunset light
const sun = new THREE.DirectionalLight(0xffbbaa, 2.5);
sun.position.set(100, 30, -150);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far  = 400;
sun.shadow.camera.left = -150; sun.shadow.camera.right = 150;
sun.shadow.camera.top  =  150; sun.shadow.camera.bottom = -150;
sun.shadow.bias = -0.001;
scene.add(sun);

// Sunset Sky Sphere
const skyGeo = new THREE.SphereGeometry(600, 32, 16);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    horizon: { value: new THREE.Color(0xffd3a6) },
    zenith:  { value: new THREE.Color(0x7eb0d9) },
    sunPos:  { value: sun.position.clone().normalize() },
    uTime:   sharedUniforms.uTime
  },
  vertexShader: `
    varying vec3 vWorld;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    uniform vec3 horizon, zenith, sunPos;
    uniform float uTime;
    varying vec3 vWorld;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
    }

    void main() {
      vec3 dir = normalize(vWorld);
      float h = max(0.0, dir.y);
      vec3 col = mix(horizon, zenith, pow(h, 0.6));
      
      // Moving Clouds
      vec2 cloudUV = dir.xz / (dir.y + 0.01) * 0.5 + uTime * 0.01;
      float c = noise(cloudUV) * noise(cloudUV * 2.1 + uTime * 0.005);
      col = mix(col, vec3(1.0), smoothstep(0.5, 0.8, c) * h * 0.6);

      float sunGlow = max(0.0, dot(dir, sunPos));
      col += vec3(1.0, 0.8, 0.5) * pow(sunGlow, 16.0) * 0.8; 
      col += vec3(1.0, 0.9, 0.8) * pow(sunGlow, 256.0) * 2.0; 
      
      gl_FragColor = vec4(col, 1.0);
    }
  `
});
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);

// --------------------------- Terrain Math ----------------------------
// Simple seeded hash & value noise for rolling smooth terrain
function fract(x) { return x - Math.floor(x); }
function hash(n) { return fract(Math.sin(n) * 43758.5453123); }
function noise(x, z) {
  const p = Math.floor(x), q = Math.floor(z);
  const f_x = x - p, f_z = z - q;
  const u = f_x * f_x * (3.0 - 2.0 * f_x), v = f_z * f_z * (3.0 - 2.0 * f_z);
  const n = p + q * 57.0;
  return (hash(n)*(1-u) + hash(n+1)*u)*(1-v) + (hash(n+57)*(1-u) + hash(n+58)*u)*v;
}
function fbm(x, z) {
  let y = 0, amp = 1, freq = 1, sum = 0;
  for(let i=0; i<4; i++) {
    y += noise(x * freq, z * freq) * amp;
    sum += amp; amp *= 0.5; freq *= 2.0;
  }
  return y / sum;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Global height sampling for dog and procedural placement
function getTerrainY(x, z) {
  // Base rolling islands and marshes
  let y = (fbm(x * 0.015, z * 0.015) - 0.45) * 20;
  
  // Add micro bumps
  y += (noise(x * 0.1, z * 0.1) - 0.5) * 1.5;
  
  // Distant Majestic Mountains
  if (z < -180) {
    const dist = Math.abs(z + 180);
    y += (fbm(x * 0.008, z * 0.008) - 0.35) * dist * 1.5; // Taller and more epic
  }

  // SELECTIVE FOREGROUND: Flatten a central basin for the dogs
  const distFromCenter = Math.abs(x);
  const marshBoundary = -32 + noise(x * 0.1, x * 0.05) * 10;
  
  if (z > marshBoundary) {
    if (distFromCenter < 25) {
      y = -1.5; // Clear dog basin
    } else {
      y += (z + 40) * 0.08; // Hilly sides for foliage
    }
  } else {
    // MARSH & PUDDLES: Sparse, isolated rounded puddles
    const puddleNoise = fbm(x * 0.12, z * 0.12);
    // Sharper threshold for fewer, smaller puddles
    const depth = smoothstep(0.3, 0.15, puddleNoise) * 7.0;
    y -= depth;
  }
  
  // Flatten out deeply submerged areas to keep lakes wide
  if (y < -2) y = -2 + (y + 2) * 0.3;
  
  return y;
}

// --------------------------- Terrain Generation ----------------------
const WORLD_SIZE = 400;
const SEGMENTS = 200;
const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
terrainGeo.rotateX(-Math.PI / 2);

const pos = terrainGeo.attributes.position;
const uvs = terrainGeo.attributes.uv;
const colors = [];

for (let i = 0; i < pos.count; i++) {
  const vx = pos.getX(i);
  const vz = pos.getZ(i);
  const vy = getTerrainY(vx, vz);
  pos.setY(i, vy);

  // Vertex coloring based on height (sandy shores -> dry golden grass -> green patches)
  const c = new THREE.Color();
  if (vy < 0.2) {
    c.setHex(0x3a5c28).lerp(new THREE.Color(0x4d7a36), Math.random()); // Lush green marsh edge
  } else if (vy < 3) {
    c.setHex(0x4a7c29).lerp(new THREE.Color(0x6a9e38), Math.random()); // Green marsh grass
  } else {
    // Add noise to grassy areas
    const gn = noise(vx*0.2, vz*0.2);
    c.setHex(0x52822a).lerp(new THREE.Color(0x76a33f), gn); // Solid greens everywhere (no desert)
  }
  colors.push(c.r, c.g, c.b);
}
terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
terrainGeo.computeVertexNormals();

const detailCanvas = document.createElement('canvas');
detailCanvas.width = 128;
detailCanvas.height = 128;
const dctx = detailCanvas.getContext('2d');
const detailImg = dctx.createImageData(128, 128);
for (let i = 0; i < detailImg.data.length; i += 4) {
  const px = (i / 4) % 128;
  const py = Math.floor((i / 4) / 128);
  const n = Math.floor((noise(px * 0.17, py * 0.17) * 0.5 + noise(px * 0.41, py * 0.41) * 0.5) * 255);
  detailImg.data[i] = 110 + (n % 80);
  detailImg.data[i + 1] = 90 + (n % 70);
  detailImg.data[i + 2] = 60 + (n % 55);
  detailImg.data[i + 3] = 255;
}
dctx.putImageData(detailImg, 0, 0);
const detailTex = new THREE.CanvasTexture(detailCanvas);
detailTex.wrapS = THREE.RepeatWrapping;
detailTex.wrapT = THREE.RepeatWrapping;
detailTex.repeat.set(40, 40);
detailTex.colorSpace = THREE.SRGBColorSpace;

const terrainMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  map: detailTex,
  roughness: 0.85,
  metalness: 0.05,
  flatShading: false
});
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.receiveShadow = true;
scene.add(terrain);

// --------------------------- Water -----------------------------------
const WATER_WIDTH = 260;
const WATER_DEPTH = 140;
const waterGeo = new THREE.PlaneGeometry(WATER_WIDTH, WATER_DEPTH, 220, 140);
waterGeo.rotateX(-Math.PI / 2);

const waterMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uTime: sharedUniforms.uTime,
    uSunDir: { value: sun.position.clone().normalize() },
    uShallow: { value: new THREE.Color(0x2a4d5e) }, // Darker muddy teal
    uDeep: { value: new THREE.Color(0x1a2e3a) },    // Deep murky blue-black
    uSky: { value: new THREE.Color(0xa8c8df) },
  },
  vertexShader: `
    uniform float uTime;
    varying vec3 vWorld;
    varying float vWave;
    void main() {
      vec3 p = position;
      // Gentle surface ripples for shallow water
      float w1 = sin(p.x * 0.1 + uTime * 0.25) * 0.15;
      float w2 = cos(p.z * 0.12 + uTime * 0.22) * 0.12;
      p.y += w1 + w2;
      vWave = w1 + w2;
      vec4 wp = modelMatrix * vec4(p, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    uniform vec3 uSunDir;
    uniform vec3 uShallow;
    uniform vec3 uDeep;
    uniform vec3 uSky;
    varying vec3 vWorld;
    varying float vWave;
    void main() {
      float dX = cos(vWorld.x * 0.07) * 0.031 + sin((vWorld.x + vWorld.z) * 0.04) * 0.010;
      float dZ = -sin(vWorld.z * 0.09) * 0.031 + sin((vWorld.x + vWorld.z) * 0.04) * 0.010;
      vec3 n = normalize(vec3(-dX, 1.0, -dZ));

      vec3 viewDir = normalize(cameraPosition - vWorld);
      float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 1.8);

      float depthMix = smoothstep(-40.0, -150.0, vWorld.z);
      vec3 baseCol = mix(uShallow * 0.9, uDeep * 0.8, depthMix);

      vec3 r = reflect(-uSunDir, n);
      float spec = pow(max(dot(r, viewDir), 0.0), 120.0) * 1.5;

      vec3 col = baseCol;
      // Optimized reflection math
      col = mix(col, uSky * 1.3, fresnel * 0.85); 
      col += vec3(1.0, 0.98, 0.9) * spec;

      gl_FragColor = vec4(col, 0.7 + fresnel * 0.3);
    }
  `,
});

const water = new THREE.Mesh(waterGeo, waterMat);
water.position.set(0, -0.6, -90); // Water brought much closer
scene.add(water);

// --------------------------- Flora (Trees, Bushes, Reeds) ------------
const instReeds = [];
const instTrees = [];
const instBushes = [];

// Populate based on terrain
for (let i = 0; i < 15000; i++) {
  const x = (Math.random() - 0.5) * WORLD_SIZE;
  const z = (Math.random() - 0.5) * WORLD_SIZE;
  // Don't spawn right behind the camera
  if (z > 50) continue;

  const y = getTerrainY(x, z);

  // Reeds (thick green marsh reeds)
  if (y > -0.5 && y < 3.0 && Math.random() > 0.05) {
    instReeds.push({ x, y, z, s: 0.6 + Math.random() * 1.5 });
  }
  
  // Everywhere bushes (extremely dense coverage with thicker patches)
  if (y > 0.1 && z > -130 && z < 60) {
    // Keep a small central shooting corridor open
    if (Math.abs(x) < 12 && z > -4) continue;
    
    // Create thicker patches - higher probability in clusters
    const patchChance = Math.random();
    if (patchChance > 0.02) { // Much denser - was 0.05
      // Create multiple bushes in the same area for thicker patches
      const bushCount = patchChance > 0.5 ? (Math.random() > 0.7 ? 3 : 2) : 1;
      for (let b = 0; b < bushCount; b++) {
        const offsetX = (Math.random() - 0.5) * 2;
        const offsetZ = (Math.random() - 0.5) * 2;
        const offsetY = getTerrainY(x + offsetX, z + offsetZ);
        instBushes.push({ 
          x: x + offsetX, 
          y: offsetY, 
          z: z + offsetZ, 
          s: 0.6 + Math.random() * 2.0 // Taller bushes
        });
      }
    }
  }

  // Trees on left/right edges - 25% more trees with variety
  if (Math.abs(x) > 35 && y > 0.5 && z < 25 && z > -160) {
    const treeChance = Math.random();
    if (treeChance > 0.93) { // Increased from 0.95 to 0.93 for ~25% more trees
      const treeType = Math.random();
      instTrees.push({ 
        x, y, z, 
        s: 1.5 + Math.random() * 3.5,
        type: treeType > 0.7 ? 'pine' : 'deciduous' // 30% pine trees
      });
    }
  }
}

// We will use the instBushes positions for our reeds to create a dense marsh feel
// Bushes/Reeds - natural clumpy multi-lobe geometry is removed because it looked like alien eggs.
// Reeds InstancedMesh (Thin smooth cylinders)
const reedGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 4);
reedGeo.translate(0, 0.5, 0); // pivot at base
const reedMat = new THREE.MeshStandardMaterial({ color: 0x5c8a3f, roughness: 0.9 }); // Green lush reeds
reedMat.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = sharedUniforms.uTime;
  shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
    vec3 transformed = vec3(position);
    vec4 wPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float sway = sin(wPos.x * 0.5 + uTime) * 0.2 * position.y;
    transformed.x += sway; transformed.z += sway;
  `);
};

// Reeds InstancedMesh (Thin smooth cylinders) (For the actual instReeds array)
const reedGeoSmall = new THREE.CylinderGeometry(0.05, 0.05, 1, 4);
reedGeoSmall.translate(0, 0.5, 0); // pivot at base
const reedMeshSmall = new THREE.InstancedMesh(reedGeoSmall, reedMat, instReeds.length);
reedMeshSmall.castShadow = true;
const dummy = new THREE.Object3D();
for (let i = 0; i < instReeds.length; i++) {
  const r = instReeds[i];
  dummy.position.set(r.x, r.y, r.z);
  dummy.scale.set(1, r.s * 2.5, 1);
  dummy.rotation.y = Math.random() * Math.PI;
  dummy.rotation.x = (Math.random() - 0.5) * 0.2;
  dummy.rotation.z = (Math.random() - 0.5) * 0.2;
  dummy.updateMatrix();
  reedMeshSmall.setMatrixAt(i, dummy.matrix);
}
scene.add(reedMeshSmall);

const reedMesh = new THREE.InstancedMesh(reedGeo, reedMat, instBushes.length);
reedMesh.castShadow = true;
for (let i = 0; i < instBushes.length; i++) {
  const r = instBushes[i];
  dummy.position.set(r.x, r.y, r.z);
  dummy.scale.set(1, r.s * 4.5, 1);
  dummy.rotation.y = Math.random() * Math.PI;
  dummy.rotation.x = (Math.random() - 0.5) * 0.2;
  dummy.rotation.z = (Math.random() - 0.5) * 0.2;
  dummy.updateMatrix();
  reedMesh.setMatrixAt(i, dummy.matrix);
}
scene.add(reedMesh);

// Trees with variety - deciduous and pine
const createDeciduousTree = () => {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4, 6), new THREE.MeshStandardMaterial({color: 0x5a4a3b, roughness: 0.9}));
  trunk.position.y = 2; trunk.castShadow = true; tree.add(trunk);
  
  // Vary green tones for deciduous trees
  const greenVariation = Math.random();
  let canopyColor;
  if (greenVariation < 0.33) {
    canopyColor = 0x4a7c29; // Standard green
  } else if (greenVariation < 0.66) {
    canopyColor = 0x5a8c39; // Lighter green
  } else {
    canopyColor = 0x3a6c19; // Darker green
  }
  
  const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(3.5, 2), new THREE.MeshStandardMaterial({color: canopyColor, roughness: 0.8, flatShading: false}));
  canopy.position.y = 5.5; canopy.castShadow = true; tree.add(canopy);
  return tree;
};

const createPineTree = () => {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 6, 6), new THREE.MeshStandardMaterial({color: 0x4a3a2b, roughness: 0.9}));
  trunk.position.y = 3; trunk.castShadow = true; tree.add(trunk);
  
  // Pine trees have darker green
  const pineGreenVariation = Math.random();
  let pineColor;
  if (pineGreenVariation < 0.5) {
    pineColor = 0x2d5a2d; // Dark pine green
  } else {
    pineColor = 0x1a4a1a; // Very dark pine green
  }
  
  // Create pine cone shape with multiple layers
  for (let i = 0; i < 4; i++) {
    const layer = new THREE.Mesh(
      new THREE.ConeGeometry(3 - i * 0.5, 2, 6), 
      new THREE.MeshStandardMaterial({color: pineColor, roughness: 0.8})
    );
    layer.position.y = 6 + i * 1.5;
    layer.castShadow = true;
    tree.add(layer);
  }
  return tree;
};

for (const t of instTrees) {
  const mesh = t.type === 'pine' ? createPineTree() : createDeciduousTree();
  mesh.position.set(t.x, t.y, t.z);
  mesh.scale.setScalar(t.s);
  mesh.rotation.y = Math.random() * Math.PI;
  scene.add(mesh);
}

const duckSpawnBushes = instBushes.filter(
  (b) => b.z > -110 && b.z < 40 && Math.abs(b.x) > 4
);


// --------------------------- Dog Helpers ------------------------------
function dogBox(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function dogSphere(r, mat) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 14), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function makeLeg(x, z, upperColor) {
  const g = new THREE.Group();
  g.position.set(x, 1.0, z);
  const upper = dogBox(0.28, 0.65, 0.3, upperColor); upper.position.y = -0.3; g.add(upper);
  // We use the base matDog color for the lower leg/paw which we'll find via the caller or just use a default
  const lower = dogBox(0.24, 0.6, 0.26, upperColor); lower.position.y = -0.88; g.add(lower);
  const paw = dogBox(0.3, 0.18, 0.38, upperColor); paw.position.y = -1.22; paw.position.z = 0.04; g.add(paw);
  return g;
}
const matDark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
const matPink = new THREE.MeshStandardMaterial({ color: 0xd37e66, roughness: 0.7 });

// --------------------------- Dog Class ------------------------------
class Dog {
  constructor(id, name, color, speedBonus) {
    this.id = id;
    this.name = name;
    this.baseSpeed = 20 + speedBonus;
    this.happiness = 100;
    this.state = 0; // 0: IDLE, 1: RUN_TO, 2: RUN_BACK, 3: SHOW, 4: SIT
    this.targetPos = new THREE.Vector3();
    this.currentDuckMesh = null;
    this.timer = 0;
    this.sprintBurst = 0;
    this.sprintTimer = Math.random() * 5;
    this.walkDir = Math.random() > 0.5 ? 1 : -1;
    this.walkPhase = Math.random() * Math.PI * 2;

    this.group = new THREE.Group();
    this.inner = new THREE.Group();
    this.inner.rotation.y = Math.PI; 
    this.group.add(this.inner);

    const matDog = new THREE.MeshStandardMaterial({ color: color, roughness: 0.85 });
    const matDogDark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), roughness: 0.9 });

    const body = dogBox(1.1, 0.95, 2.2, matDog);
    body.position.y = 1.1; this.inner.add(body);
    const chest = dogSphere(0.62, matDog); chest.position.set(0, 1.05, -0.9); chest.scale.set(1, 0.9, 1.1); this.inner.add(chest);
    const rump = dogSphere(0.6, matDogDark); rump.position.set(0, 1.1, 1.0); rump.scale.set(1, 0.95, 1); this.inner.add(rump);

    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 1.55, -1.25);
    const neck = dogBox(0.55, 0.55, 0.55, matDog); neck.position.set(0, -0.05, 0.35); this.headGroup.add(neck);
    const head = dogSphere(0.45, matDog); head.position.set(0, 0.15, 0.0); this.headGroup.add(head);
    const snout = dogBox(0.42, 0.35, 0.55, matDog); snout.position.set(0, 0.0, -0.45); this.headGroup.add(snout);
    const nose = dogSphere(0.1, matDark); nose.position.set(0, 0.05, -0.78); this.headGroup.add(nose);
    const tongue = dogBox(0.12, 0.06, 0.18, matPink); tongue.position.set(0, -0.18, -0.58); this.headGroup.add(tongue);

    const matPureBlack = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1 });
    const lEye = dogSphere(0.08, matPureBlack); lEye.position.set( 0.22, 0.25, -0.4); this.headGroup.add(lEye);
    const rEye = dogSphere(0.08, matPureBlack); rEye.position.set(-0.22, 0.25, -0.4); this.headGroup.add(rEye);
    
    const earGeo = new THREE.BoxGeometry(0.12, 0.55, 0.32);
    const lEar = new THREE.Mesh(earGeo, matDogDark); lEar.position.set(0.36, -0.02, -0.02); lEar.rotation.z = -0.22; lEar.castShadow = true;
    const rEar = new THREE.Mesh(earGeo, matDogDark); rEar.position.set(-0.36, -0.02, -0.02); rEar.rotation.z = 0.22; rEar.castShadow = true;
    this.headGroup.add(lEar); this.headGroup.add(rEar);
    
    this.mouthAnchor = new THREE.Group();
    this.mouthAnchor.position.set(0, -0.05, -0.65);
    this.headGroup.add(this.mouthAnchor);
    this.inner.add(this.headGroup);

    this.tailGroup = new THREE.Group();
    this.tailGroup.position.set(0, 1.45, 1.3);
    this.tailGroup.rotation.x = -0.6;
    const tail = dogBox(0.22, 0.22, 0.9, matDog); tail.position.z = 0.45; this.tailGroup.add(tail);
    this.inner.add(this.tailGroup);

    this.legs = [];
    const flLeg = makeLeg( 0.45, -0.8, matDog);      this.inner.add(flLeg); this.legs.push(flLeg);
    const frLeg = makeLeg(-0.45, -0.8, matDog);      this.inner.add(frLeg); this.legs.push(frLeg);
    const blLeg = makeLeg( 0.45,  0.85, matDogDark); this.inner.add(blLeg); this.legs.push(blLeg);
    const brLeg = makeLeg(-0.45,  0.85, matDogDark); this.inner.add(brLeg); this.legs.push(brLeg);

    this.homePos = DOG_HOME.clone().add(new THREE.Vector3((id-1)*4, 0, 0));
    this.homePos.y = Math.max(0, getTerrainY(this.homePos.x, this.homePos.z));
    this.group.position.copy(this.homePos);
    scene.add(this.group);

    // Inject HUD element
    const row = document.createElement('div');
    row.className = 'dog-stat-row';
    row.id = `dog-stat-${id}`;
    row.style.borderLeftColor = `#${color.toString(16).padStart(6, '0')}`;
    row.innerHTML = `
      <div class="dog-stat-line"><span>${name}</span><b class="d-happy">100%</b></div>
      <div class="dog-stat-line"><span>FETCH SPEED</span><b class="d-speed">20</b></div>
    `;
    $('dogs-container').appendChild(row);
  }


  update(dt, t) {
    if (gameState !== 'PLAYING') return;
    if (this.state === 0 || this.state === 4) {
      // IDLE or SIT
      let target = this.homePos.clone();
      
      if (this.state === 0) {
        // Organic distorted circling behavior
        const timeScale = t * 0.7 * this.walkDir;
        const phase = this.walkPhase + timeScale;
        
        // Distort the circle with secondary waves
        const radiusX = (3.5 + this.id * 1.5) + Math.sin(t * 0.5 + this.id) * 2.0;
        const radiusZ = (3.5 + this.id * 1.5) + Math.cos(t * 0.4 + this.id * 1.5) * 2.0;
        
        target.x += Math.cos(phase) * radiusX;
        target.z += Math.sin(phase) * radiusZ;
        
        // Look ahead in the path
        const lookAhead = phase + 0.1 * this.walkDir;
        const lookX = this.homePos.x + Math.cos(lookAhead) * radiusX;
        const lookZ = this.homePos.z + Math.sin(lookAhead) * radiusZ;
        this.group.lookAt(lookX, target.y, lookZ);
        
        // Slight trot animation
        const trot = t * 15;
        this.legs[0].rotation.x = Math.sin(trot) * 0.3;
        this.legs[3].rotation.x = Math.sin(trot) * 0.3;
        this.legs[1].rotation.x = -Math.sin(trot) * 0.3;
        this.legs[2].rotation.x = -Math.sin(trot) * 0.3;
      } else {
        // SIT
        this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, -Math.PI / 6, dt * 5);
        this.headGroup.rotation.x = THREE.MathUtils.lerp(this.headGroup.rotation.x, Math.PI / 6, dt * 5);
        this.legs[0].rotation.x = -Math.PI / 3; this.legs[1].rotation.x = -Math.PI / 3;
        this.legs[2].rotation.x = Math.PI / 4; this.legs[3].rotation.x = Math.PI / 4;
      }

      this.group.position.lerp(target, dt * 2.5);
      
      this.happiness = Math.max(0, this.happiness - dt * 0.08);
      const wagSpeed = 4 + (this.happiness / 100) * 8;
      this.headGroup.rotation.y = Math.sin(t * 1.5 + this.id) * 0.2;
      this.tailGroup.rotation.x = Math.PI/4 + Math.sin(t * wagSpeed) * 0.2;

      if (this.state === 0) {
        this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, 0, dt * 5);
        
        // Smart Race Check
        if (fetchQueue.length > 0) {
          // If multiple ducks are available, try to find one no one else is targeting
          let targetDuck = null;
          
          if (fetchQueue.length > 1) {
            targetDuck = fetchQueue.find(duck => !duck.userData.claimedBy && !dogs.some(d => d.currentDuckMesh === duck));
          }
          
          // If no unique target found or only 1 duck, everyone races for the first available one
          if (!targetDuck) {
            targetDuck = fetchQueue.find(duck => !duck.userData.claimedBy);
          }

          if (targetDuck) {
             this.currentDuckMesh = targetDuck;
             this.targetPos.copy(targetDuck.position);
             this.state = 1;
          }
        }
      }
    }
    else if (this.state === 1 || this.state === 2) {
      // RUN TO or RUN BACK
      if (this.state === 1 && this.currentDuckMesh.userData.claimedBy && this.currentDuckMesh.userData.claimedBy !== this) {
         // Someone else got it!
         this.state = 0;
         this.currentDuckMesh = null;
         return;
      }

      const dir = this.targetPos.clone().sub(this.group.position);
      dir.y = 0;
      
      if (dir.length() < 2.0) {
        if (this.state === 1) {
          if (!this.currentDuckMesh.userData.claimedBy) {
            this.currentDuckMesh.userData.claimedBy = this;
            this.currentDuckMesh.position.set(0, 0, 0); 
            this.currentDuckMesh.rotation.set(Math.PI/2, 0, 0); 
            this.mouthAnchor.add(this.currentDuckMesh);
            this.targetPos.copy(this.homePos);
            this.state = 2;
            ducksFetched++;
            checkAchievements();
          } else {
            this.state = 0;
            this.currentDuckMesh = null;
          }
        } else {
          this.state = 3;
          this.timer = 0;
          this.group.rotation.set(0, 0, 0); 
        }
      } else {
        dir.normalize();
        
        // Sprint Logic
        this.sprintTimer -= dt;
        if (this.sprintTimer <= 0) {
          if (this.sprintBurst > 0) {
             this.sprintBurst = 0;
             this.sprintTimer = 2 + Math.random() * 5;
          } else {
             this.sprintBurst = 10 + Math.random() * 15;
             this.sprintTimer = 1 + Math.random() * 2;
          }
        }
        
        const speed = this.baseSpeed + this.sprintBurst;
        this.group.position.x += dir.x * speed * dt;
        this.group.position.z += dir.z * speed * dt;
        
        const terrainY = getTerrainY(this.group.position.x, this.group.position.z);
        const floorY = Math.max(terrainY, 0);
        this.group.lookAt(this.group.position.x + dir.x, floorY, this.group.position.z + dir.z);
        
        const runCycle = t * 25;
        this.group.position.y = floorY + Math.abs(Math.sin(runCycle)) * 0.8;
        this.legs[0].rotation.x = Math.sin(runCycle) * 0.8; this.legs[3].rotation.x = Math.sin(runCycle) * 0.8;
        this.legs[1].rotation.x = -Math.sin(runCycle) * 0.8; this.legs[2].rotation.x = -Math.sin(runCycle) * 0.8;
        this.tailGroup.rotation.x = Math.PI/4;
      }
    }
    else if (this.state === 3) {
      this.timer += dt;
      const terrainY = getTerrainY(this.group.position.x, this.group.position.z);
      this.group.position.y = terrainY + 1.5;
      this.group.rotation.x = -Math.PI / 6;
      this.headGroup.rotation.set(Math.PI / 6, 0, 0);
      this.legs.forEach(l => l.rotation.x = 0);

      if (this.timer > 3.0) {
        if (this.currentDuckMesh) {
          const idx = fetchQueue.indexOf(this.currentDuckMesh);
          if (idx >= 0) fetchQueue.splice(idx, 1);
          this.mouthAnchor.remove(this.currentDuckMesh);
          scene.remove(this.currentDuckMesh);
          this.currentDuckMesh = null;
        }
        this.group.rotation.x = 0;
        this.state = 0; 
      }
    }

    
    // Update HUD
    const row = $(`dog-stat-${this.id}`);
    row.querySelector('.d-happy').textContent = `${Math.floor(this.happiness)}%`;
    row.querySelector('.d-speed').textContent = (this.baseSpeed + this.sprintBurst).toFixed(1);
  }
}

// Initialize 3 Dogs
const DOG_HOME = new THREE.Vector3(0, 0, 18);
dogs = [
  new Dog(1, 'Goldie', 0xe0a458, 0),
  new Dog(2, 'Rusty',  0x8b4513, 2),
  new Dog(3, 'Snowy',  0xf5f5f5, -1)
];

// Dog State Machine (legacy vars removed)
const fetchQueue = []; 
const deadDucks = [];  


// --------------------------- Smooth Realistic Ducks ------------------
const MAX_DUCKS_ON_SCREEN = 150;
let spawnTimer = 0;
let nextSpawnDelay = 3.0;
let frenzyCount = 0;
let frenzyTimer = 0;

const ducks = [];
const duckMatBody = new THREE.MeshStandardMaterial({ color: 0x8c6245, roughness: 0.9 }); // Brighter Brown
const duckMatHead = new THREE.MeshStandardMaterial({ color: 0x3c7a3c, roughness: 0.5 }); // Brighter Mallard Green
const duckMatBeak = new THREE.MeshStandardMaterial({ color: 0xffbc33, roughness: 0.7 }); // Bright Yellow/Orange

function buildDuck() {
  // Local convention: duck faces -Z (matches Object3D.lookAt forward).
  const g = new THREE.Group();
  g.scale.setScalar(0.9);
  g.userData = { type: 'duck', alive: true };

  // Body along Z axis (thinner)
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.85, 6, 12), duckMatBody);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  g.add(body);

  // Head forward (+Z). Raised so it's visible from behind.
  const headGrp = new THREE.Group();
  headGrp.position.set(0, 0.5, 0.65);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 14), duckMatHead); head.castShadow = true;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.45, 10), duckMatHead);
  neck.position.set(0, -0.35, -0.2); neck.rotation.x = -0.5; neck.castShadow = true;
  
  // Box beak so it never looks backwards like a cone might
  const beak = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.35), duckMatBeak);
  beak.position.set(0, -0.05, 0.3); beak.castShadow = true;
  
  const lEyeD = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), matDark);
  const rEyeD = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), matDark);
  lEyeD.position.set( 0.16, 0.08, 0.12);
  rEyeD.position.set(-0.16, 0.08, 0.12);
  headGrp.add(head); headGrp.add(neck); headGrp.add(beak); headGrp.add(lEyeD); headGrp.add(rEyeD);
  g.add(headGrp);

  // Tail back (-Z). Flat box so it NEVER looks like a beak!
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.45), duckMatBody);
  tail.position.set(0, 0.15, -0.65); tail.castShadow = true;
  g.add(tail);

  // Wings mounted on the sides and flap up/down via rotation.z of the pivot.
  const wingGeo = new THREE.PlaneGeometry(1.2, 0.55);
  wingGeo.rotateX(-Math.PI / 2); // Make the wing lie flat on XZ plane instead of being a vertical wall
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x7a523a, roughness: 0.9, side: THREE.DoubleSide });

  const lWingPivot = new THREE.Group(); lWingPivot.position.set( 0.35, 0.18, 0);
  const lWing = new THREE.Mesh(wingGeo, wingMat); lWing.position.set(0.55, 0, 0); lWing.castShadow = true;
  lWingPivot.add(lWing); g.add(lWingPivot);

  const rWingPivot = new THREE.Group(); rWingPivot.position.set(-0.35, 0.18, 0);
  const rWing = new THREE.Mesh(wingGeo, wingMat); rWing.position.set(-0.55, 0, 0); rWing.castShadow = true;
  rWingPivot.add(rWing); g.add(rWingPivot);

  g.userData.lWing = lWingPivot;
  g.userData.rWing = rWingPivot;

  g.traverse(o => { if (o.isMesh) o.userData.duck = g; });
  return g;
}

function spawnDeadDuck(pos) {
  const g = new THREE.Group();
  g.scale.setScalar(0.9);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.85, 6, 12), duckMatBody);
  body.rotation.x = Math.PI / 2; g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 14), duckMatHead);
  head.position.set(0, -0.45, 0.65); g.add(head); // head hangs limply forward-down

  const wingGeo = new THREE.PlaneGeometry(1.2, 0.55);
  wingGeo.rotateX(-Math.PI / 2);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x7a523a, side: THREE.DoubleSide });
  const lWing = new THREE.Mesh(wingGeo, wingMat); lWing.position.set(0.55, -0.1, 0); g.add(lWing);
  const rWing = new THREE.Mesh(wingGeo, wingMat); rWing.position.set(-0.55, -0.1, 0); g.add(rWing);

  g.position.copy(pos);
  scene.add(g);
  return g;
}

function spawnDuckWave() {
  if (ducks.length > MAX_DUCKS_ON_SCREEN) return;

  // Much more varied spawning patterns
  const waveType = Math.random();
  let count, spawnPattern;
  
  // As the wave number increases, we slightly shift probabilities towards harder/larger waves
  const waveBonus = Math.min(wave * 0.005, 0.1); 

  if (waveType > 0.95 - waveBonus) { // Rare massive swarm (Armageddon)
    count = 40 + Math.floor(Math.random() * 40); // 40-80 ducks
    spawnPattern = 'armageddon';
  } else if (waveType > 0.82 - waveBonus) { // 13% large swarm
    count = 18 + Math.floor(Math.random() * 12); // 18-30 ducks
    spawnPattern = 'swarm';
  } else if (waveType > 0.65) { // 17% group
    count = 8 + Math.floor(Math.random() * 7); // 8-15 ducks
    spawnPattern = 'group';
  } else if (waveType > 0.35) { // 30% normal
    count = 3 + Math.floor(Math.random() * 5); // 3-8 ducks
    spawnPattern = 'normal';
  } else if (waveType > 0.12) { // 23% easy close
    count = 2 + Math.floor(Math.random() * 4); // 2-6 ducks
    spawnPattern = 'close';
  } else { // 12% single expert
    count = 1;
    spawnPattern = 'expert';
  }
  
  for (let i = 0; i < count; i++) {
    const d = buildDuck();
    
    let spawnX, spawnZ, spawnY, bush;
    
    if (spawnPattern === 'close') {
      // Spawn much closer for beginners to practice
      const angle = Math.random() * Math.PI * 2;
      const distance = 15 + Math.random() * 20; // 15-35 units from camera
      spawnX = Math.sin(angle) * distance;
      spawnZ = 10 + Math.random() * 30; // In front of camera
      spawnY = Math.max(0, getTerrainY(spawnX, spawnZ)) + 2;
    } else if (spawnPattern === 'expert') {
      // Spawn far away for expert challenge
      spawnX = (Math.random() - 0.5) * 120;
      spawnZ = -80 - Math.random() * 60;
      spawnY = 15 + Math.random() * 10;
    } else {
      // Normal spawning from bushes
      bush = duckSpawnBushes.length
        ? duckSpawnBushes[Math.floor(Math.random() * duckSpawnBushes.length)]
        : { x: (Math.random() - 0.5) * 90, z: -15 + Math.random() * 28, y: 1.0, s: 1.2 };
      spawnX = bush.x + (Math.random() - 0.5) * 1.8;
      spawnZ = bush.z + (Math.random() - 0.5) * 1.8;
      spawnY = Math.max(0, getTerrainY(spawnX, spawnZ)) + bush.s * 0.32;
    }
    
    d.position.set(spawnX, Math.max(0, spawnY) + 1, spawnZ);
    
    // Vary flight patterns based on spawn type
    let vel, targetVel;
    
    if (spawnPattern === 'close') {
      // Slower, easier to track for beginners
      vel = new THREE.Vector3((Math.random() - 0.5) * 2, 4 + Math.random() * 2, -4 - Math.random() * 2);
      const tx = (Math.random() - 0.5) * 60;
      const ty = 6 + Math.random() * 3;
      const tz = -60 - Math.random() * 40;
      targetVel = new THREE.Vector3(tx - spawnX, ty - spawnY, tz - spawnZ).normalize().multiplyScalar(6 + Math.random() * 3);
    } else if (spawnPattern === 'expert') {
      // Fast, erratic flight for experts
      vel = new THREE.Vector3((Math.random() - 0.5) * 5, 10 + Math.random() * 4, -12 - Math.random() * 5);
      const tx = (Math.random() - 0.5) * 180;
      const ty = 15 + Math.random() * 8;
      const tz = -180 - Math.random() * 100;
      targetVel = new THREE.Vector3(tx - spawnX, ty - spawnY, tz - spawnZ).normalize().multiplyScalar(15 + Math.random() * 6);
    } else if (spawnPattern === 'armageddon') {
      // Wide spread, varying speeds to fill the entire field of view
      vel = new THREE.Vector3((Math.random() - 0.5) * 8, 8 + Math.random() * 8, -6 - Math.random() * 10);
      const tx = (Math.random() - 0.5) * 250;
      const ty = 10 + Math.random() * 25;
      const tz = -150 - Math.random() * 150;
      targetVel = new THREE.Vector3(tx - spawnX, ty - spawnY, tz - spawnZ).normalize().multiplyScalar(8 + Math.random() * 12);
    } else {
      // Natural flight patterns
      vel = new THREE.Vector3((Math.random() - 0.5) * 3.2, 7.5 + Math.random() * 2.5, -8.5 - Math.random() * 3.5);
      const tx = (Math.random() - 0.5) * 140;
      const ty = 9 + Math.random() * 5;
      const tz = -130 - Math.random() * 80;
      targetVel = new THREE.Vector3(tx - spawnX, ty - spawnY, tz - spawnZ).normalize().multiplyScalar(11 + Math.random() * 4);
    }
    
    d.userData.vel = vel;
    d.userData.targetVel = targetVel;
    d.userData.burstDuration = 0.18 + Math.random() * 0.16;
    d.userData.phase = 'flush';
    
    d.userData.flap = Math.random() * Math.PI * 2;
    d.userData.timer = 0;
    
    d.lookAt(d.position.clone().add(d.userData.vel));
    scene.add(d);
    ducks.push(d);
  }
  wave++;
  $('wave').textContent = String(wave);
}

// Initial spawn is handled by the animate loop

// --------------------------- Laser Sight & Firing (multi-player) ----
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

// Sequence tracking. The gyro data channel is unreliable + unordered
// (UDP-like) so out-of-order packets are normal. We accept a packet only
// if its seq is newer than the last one we applied — this prevents the
// crosshair from "jumping back" to a stale position.
const SEQ_MOD = 1 << 16; // 16-bit rolling counter from the phone
function isNewerSeq(incoming, previous) {
  const diff = ((incoming - previous) + SEQ_MOD) % SEQ_MOD;
  return diff !== 0 && diff < SEQ_MOD / 2;
}

function applyGyro(data) {
  if (!Number.isFinite(data?.nx) || !Number.isFinite(data?.ny)) return;
  // Resolve player. Prefer explicit playerId; fall back to single-player.
  const id = data.playerId || (players.size === 1 ? Array.from(players.keys())[0] : null);
  if (!id) return;
  const p = players.get(id);
  // If the player isn't registered yet (controller_connected hasn't fired),
  // drop the packet — the next one will arrive fast enough on a 60 Hz feed.
  if (!p) return;
  if (Number.isFinite(data.seq)) {
    if (p.lastSeq >= 0 && !isNewerSeq(data.seq, p.lastSeq)) return; // stale, drop
    p.lastSeq = data.seq;
  }
  p.aim.nx = data.nx; p.aim.ny = data.ny;
  pktCount++;
}

// Server relay path (when WebRTC isn't established yet or has dropped).
socket.on('gyro_data', applyGyro);

// Trigger via server relay. New format includes playerId; old format is just `()`.
socket.on('trigger', (info) => {
  const id = info?.playerId || (players.size === 1 ? Array.from(players.keys())[0] : null);
  fireShot(id);
});

function updateLaser() {
  // Update each player's crosshair. Smooth via lerp toward latest aim.
  for (const p of players.values()) {
    p.aim.sx = THREE.MathUtils.lerp(p.aim.sx, p.aim.nx, 0.75);
    p.aim.sy = THREE.MathUtils.lerp(p.aim.sy, p.aim.ny, 0.75);

    // Map NDC (-1..1) to screen pixels
    const px = (0.5 + p.aim.sx * 0.5) * window.innerWidth;
    const py = (0.5 - p.aim.sy * 0.5) * window.innerHeight;

    p.ch.style.left = `${px}px`;
    p.ch.style.top = `${py}px`;
  }
}

const feathers = [];

function explodeDuck(duck) {
  // Realistic feather explosion
  const fGeo = new THREE.PlaneGeometry(0.3, 0.6);
  const fMat = new THREE.MeshStandardMaterial({ color: 0x8c6245, side: THREE.DoubleSide });
  for (let i = 0; i < 25; i++) {
    const m = new THREE.Mesh(fGeo, fMat);
    m.position.copy(duck.position);
    scene.add(m);
    feathers.push({ m, 
      vel: new THREE.Vector3((Math.random()-0.5)*10, 5+Math.random()*8, (Math.random()-0.5)*10), 
      rot: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(0.2),
      life: 2.5 
    });
  }
  
  const dd = spawnDeadDuck(duck.position);
  deadDucks.push({ mesh: dd, velY: 0 });

  scene.remove(duck);
  duck.userData.alive = false;
  const idx = ducks.indexOf(duck);
  if (idx >= 0) ducks.splice(idx, 1);
}

// ----------------------------------------------------------------------------------------------------------------------------------------------------
// Synthetic Audio for Shotgun
let audioCtx;

// Ensure audio context is unlocked by any user interaction
document.addEventListener('click', () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}, { once: false });

function playShotgunSound() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime;
  
  // BAM (Kick)
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  
  osc.type = 'square';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(0.01, t + 0.3);
  
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1000, t);
  filter.frequency.exponentialRampToValueAtTime(50, t + 0.4);
  
  gain.gain.setValueAtTime(1.5, t);
  gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
  
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start(t);
  osc.stop(t + 0.4);
  
  // Crunch (Noise)
  const noiseSize = audioCtx.sampleRate * 0.4;
  const buffer = audioCtx.createBuffer(1, noiseSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < noiseSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  const noiseFilter = audioCtx.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.value = 2000;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(1, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noise.start(t);
  
  // "Chuck 1"
  setTimeout(() => playMechSound(400, 0.05), 450);
  // "Chuck 2"
  setTimeout(() => playMechSound(800, 0.08), 650);
}

function playMechSound(freq, dur) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.2, t + dur);
  gain.gain.setValueAtTime(0.3, t);
  gain.gain.exponentialRampToValueAtTime(0.01, t + dur);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
  
  const noiseSize = audioCtx.sampleRate * dur;
  const buffer = audioCtx.createBuffer(1, noiseSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < noiseSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.2, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.01, t + dur);
  noise.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noise.start(t);
}
// ----------------------------------------------------------------------------------------------------------------------------------------------------

let recoilPhase = 0;

function fireShot(playerId) {
  console.log(`[Fire] Player ${playerId} attempt. State: ${gameState}`);
  if (gameState !== 'PLAYING') return;

  // Resolve which player is firing. Fallback to slot 1 if unknown.
  const p = (playerId && players.get(playerId))
    || (players.size === 1 ? Array.from(players.values())[0] : null);
  if (!p) return; // no players connected, nothing to shoot

  // Aggregate counters (kept for badges/HUD compatibility).
  shots++; $('shots').textContent = String(shots);
  // Per-player counter
  p.shots++;

  playShotgunSound();
  recoilPhase = 1.0;
  triggerMuzzleFlash();

  // Crosshair punch effect
  p.ch.classList.add('fire');
  setTimeout(() => p.ch.classList.remove('fire'), 150);

  // Screen flash overlay
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:rgba(255,240,200,0.4);pointer-events:none;z-index:8;transition: background 0.2s ease-out; mix-blend-mode: hard-light;';
  document.body.appendChild(flash);
  requestAnimationFrame(() => { flash.style.background = 'rgba(0,0,0,0)'; });
  setTimeout(() => flash.remove(), 250);

  // Use THIS player's aim, not a global.
  ndc.set(THREE.MathUtils.clamp(p.aim.sx, -1, 1), THREE.MathUtils.clamp(p.aim.sy, -1, 1));
  raycaster.setFromCamera(ndc, camera);

  let hitDuck = null;
  let minHitDist = Infinity;

  // 1. Exact mesh intersection first
  const duckMeshes = [];
  ducks.forEach(d => { if (d.userData.alive) d.traverse(o => { if (o.isMesh) duckMeshes.push(o); }); });
  const exactHits = raycaster.intersectObjects(duckMeshes, false);

  if (exactHits.length > 0) {
    hitDuck = exactHits[0].object.userData.duck;
  } else {
    // 2. Aim-assist thick radius (forgiving hitbox)
    for (const d of ducks) {
      if (!d.userData.alive) continue;
      const dist = Math.sqrt(raycaster.ray.distanceSqToPoint(d.position));
      if (dist < 3.5 && dist < minHitDist) {
        minHitDist = dist;
        hitDuck = d;
      }
    }
  }

  if (hitDuck) {
    // First shot to land wins (shared duck pool, race for kills).
    if (!hitDuck.userData.alive) return;

    hits++; $('hits').textContent = String(hits);
    
    // Distance bonus
    const distToDuck = hitDuck.position.distanceTo(camera.position);
    const bonus = Math.floor(distToDuck * 5);
    const points = 500 + bonus;
    
    score += points; $('score').textContent = String(score);

    p.hits++;
    p.score += points;
    renderPlayerScores();
    showKillBanner(p.slot);

    if (distToDuck > longestShot) {
      longestShot = Math.floor(distToDuck);
      $('longest-shot').textContent = `${longestShot}m`;
    }

    explodeDuck(hitDuck);
  }
}

// --------------------------- Animation Loop --------------------------
const clock = new THREE.Clock();

function animate() {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  sharedUniforms.uTime.value = t;

  // --- Dynamic Spawning System ---
  if (gameState === 'PLAYING') {
    spawnTimer -= dt;
    if (frenzyCount > 0) {
      frenzyTimer -= dt;
      if (frenzyTimer <= 0) {
        spawnDuckWave();
        frenzyCount--;
        frenzyTimer = 0.5 + Math.random() * 1.5;
      }
    } else if (spawnTimer <= 0) {
    const duckCount = ducks.length;
    const shouldSpawn = duckCount < 5 || (duckCount < 20 && Math.random() > 0.7) || spawnTimer < -15;
    if (shouldSpawn) {
      spawnDuckWave();
      const rand = Math.random();
      if (rand > 0.92) {
        frenzyCount = 2 + Math.floor(Math.random() * 4);
        frenzyTimer = 1.0;
        nextSpawnDelay = 10 + Math.random() * 10;
      } else if (rand > 0.7) {
        nextSpawnDelay = 1.5 + Math.random() * 2.5;
      } else if (rand > 0.2) {
        nextSpawnDelay = 4.0 + Math.random() * 4.0;
      } else {
        nextSpawnDelay = 10.0 + Math.random() * 8.0;
      }
      spawnTimer = nextSpawnDelay;
    }
  }
}

  // Duck Physics
  const shouldUpdatePhysics = gameState === 'PLAYING';
  for (let i = ducks.length - 1; i >= 0; i--) {
    const d = ducks[i];
    if (shouldUpdatePhysics) d.userData.timer += dt;
    
    // --- Duck Phase Logic (Swimming, Landing, Takeoff) ---
    if (d.userData.phase === 'swim') {
       // Bobbing and gliding on water
       d.userData.vel.x = Math.sin(t * 0.3 + i) * 1.2;
       d.userData.vel.z = Math.cos(t * 0.3 + i) * 1.2;
       d.userData.vel.y = 0;
       d.position.y = -0.5 + Math.sin(t * 2 + i) * 0.1;
       d.userData.swimTimer -= dt;
       if (d.userData.swimTimer <= 0) {
         d.userData.phase = 'takeoff';
       }
    } else if (d.userData.phase === 'land') {
       // Glide down to water surface
       const landTarget = new THREE.Vector3(d.position.x, -0.5, d.position.z - 20);
       const landDir = landTarget.sub(d.position).normalize().multiplyScalar(7);
       d.userData.vel.lerp(landDir, dt * 1.5);
       if (d.position.y < -0.4) {
         d.userData.phase = 'swim';
         d.userData.swimTimer = 10 + Math.random() * 20;
       }
    } else if (d.userData.phase === 'takeoff') {
       // Heavy flapping to gain height
       d.userData.vel.y += 15 * dt;
       d.userData.vel.z -= 8 * dt;
       if (d.position.y > 8) {
         d.userData.phase = 'cruise';
       }
    } else if (d.userData.phase === 'flush') {
      d.userData.vel.y -= 22 * dt;
      d.userData.vel.x *= 0.988;
      if (d.userData.timer > d.userData.burstDuration) d.userData.phase = 'climb';
    } else if (d.userData.phase === 'climb') {
      const climbVel = d.userData.targetVel.clone();
      climbVel.y += 3.2;
      d.userData.vel.lerp(climbVel, dt * 2.1);
      if (d.userData.timer > d.userData.burstDuration + 0.7) d.userData.phase = 'cruise';
    } else {
      // Standard Cruise/Flight
      d.userData.vel.lerp(d.userData.targetVel, dt * 1.35);
      d.userData.vel.y += Math.sin(d.userData.flap * 0.6) * 0.45 * dt;
      
      // Randomly decide to land if over open water (z < -60)
      if (d.position.z < -60 && Math.random() < 0.001) {
        d.userData.phase = 'land';
      }
    }

    if (shouldUpdatePhysics) d.position.addScaledVector(d.userData.vel, dt);
    
    // --- Specialized Animation per Phase ---
    const flapBoost = (d.userData.phase === 'flush' || d.userData.phase === 'takeoff') ? 1.8 : (d.userData.phase === 'climb' ? 1.15 : 0.95);
    d.userData.flap += dt * (12 + d.userData.vel.length() * 0.28) * flapBoost;
    
    let f = Math.sin(d.userData.flap) * 0.9;
    if (d.userData.phase === 'swim') f = 0.1; // Tucked wings while swimming
    if (d.userData.phase === 'land') f = 0.3; // Fixed glide angle for landing

    d.userData.lWing.rotation.z = f;
    d.userData.rWing.rotation.z = -f;
    
    // Rotation logic
    if (d.userData.phase === 'swim') {
       d.lookAt(d.position.x + d.userData.vel.x, d.position.y, d.position.z + d.userData.vel.z);
    } else {
       d.lookAt(d.position.clone().add(d.userData.vel));
    }

    // Boundary check
    if (d.position.z < -300 || d.position.z > 80 || Math.abs(d.position.x) > 250) {
      scene.remove(d); ducks.splice(i, 1);
    }
  }

  // Feathers
  for (let i = feathers.length - 1; i >= 0; i--) {
    const b = feathers[i];
    b.vel.y -= 15 * dt;
    b.vel.x += Math.sin(t * 5 + i) * 20 * dt;
    b.vel.z += Math.cos(t * 5 + i) * 20 * dt;
    b.vel.multiplyScalar(0.92);
    b.m.position.addScaledVector(b.vel, dt);
    b.m.rotation.x += b.rot.x; b.m.rotation.y += b.rot.y; b.m.rotation.z += b.rot.z;
    b.life -= dt;
    if (b.life <= 0 || b.m.position.y < 0) { scene.remove(b.m); feathers.splice(i, 1); }
  }

  // Falling Dead Ducks
  for (let i = deadDucks.length - 1; i >= 0; i--) {
    const d = deadDucks[i];
    d.velY -= 40 * dt; 
    d.mesh.position.y += d.velY * dt;
    d.mesh.rotation.x += dt * 8; d.mesh.rotation.z += dt * 5;
    const floorY = Math.max(getTerrainY(d.mesh.position.x, d.mesh.position.z), 0);
    if (d.mesh.position.y <= floorY) { 
      d.mesh.position.y = floorY;
      d.mesh.rotation.set(0, 0, Math.PI/2); 
      fetchQueue.push(d.mesh);
      deadDucks.splice(i, 1);
    }
  }

  // Update total play time
  totalPlayTime += dt;
  if (Math.floor(totalPlayTime) % 10 === 0) checkAchievements();

  // Update treats refill
  if (treatsInPouch < MAX_TREATS) {
    refillTimer += dt;
    if (refillTimer >= REFILL_COOLDOWN) {
      treatsInPouch++;
      refillTimer = 0;
    }
  }
  $('dog-pouch').textContent = '🍪'.repeat(treatsInPouch) || 'Empty';

  // Update all dogs
  dogs.forEach(dog => dog.update(dt, t));
  updateLaser();
  
  // Update particle systems
  updateParticles(dt);
  
  // Recoil & Screen Shake Camera Physics
  if (recoilPhase > 0) {
    recoilPhase -= dt * 3.5;
    if (recoilPhase < 0) recoilPhase = 0;
    const kick = Math.sin(Math.pow(recoilPhase, 0.5) * Math.PI); 
    const pushBack = kick * 4.0;
    const shakeX = (Math.random() - 0.5) * kick * 0.8;
    const shakeY = (Math.random() - 0.5) * kick * 0.8;
    camera.position.set(CAMERA_HOME.x + shakeX, CAMERA_HOME.y + shakeY, CAMERA_HOME.z + pushBack);
  } else {
    camera.position.copy(CAMERA_HOME);
  }

  camera.lookAt(0, 5, -50);

  if (Math.floor(t * 2) % 2 === 0) {
    const debug = $('debug-info');
    if (debug) debug.textContent = `STATE: ${gameState} | MODE: ${gameMode} | PLAYERS: ${players.size} | PKTS: ${pktCount}`;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// Initialize particle systems
createMuzzleFlashParticles();
createSmokeParticles();
createTreatParticles();

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
