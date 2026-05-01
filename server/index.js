const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());

// Serve static files from the client/dist directory if it exists
const path = require('path');
const fs = require('fs');

function setupStaticServing(clientPath) {
  const clientDistPath = clientPath || path.join(__dirname, '../client/dist');
  if (fs.existsSync(clientDistPath)) {
    console.log(`Serving static files from: ${clientDistPath}`);
    app.use(express.static(clientDistPath));
  } else {
    console.warn(`Static files directory not found: ${clientDistPath}`);
  }
}

// Health check endpoint — visit http://<mac-ip>:3000/health from the phone
// browser to verify the device can reach the server before launching the app.
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Returns the primary LAN IP of this machine so the browser client can build
// a QR code pointing at the correct address (not localhost).
app.get('/lan-ip', (req, res) => {
  const nets = os.networkInterfaces();
  let ip = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ip = addr.address;
        break;
      }
    }
    if (ip !== 'localhost') break;
  }
  res.json({ ip, port: PORT });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = 2;
const roomScreens = new Map(); // roomCode -> screen socket id
const roomPlayers = new Map(); // roomCode -> [{ id, slot }] (controllers only)

function getOrCreatePlayers(roomCode) {
  if (!roomPlayers.has(roomCode)) roomPlayers.set(roomCode, []);
  return roomPlayers.get(roomCode);
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // When a screen creates a room
  socket.on('create_room', (roomCode) => {
    socket.join(roomCode);
    roomScreens.set(roomCode, socket.id);
    console.log(`Screen ${socket.id} created and joined room ${roomCode}`);
  });

  // When a controller joins a room
  socket.on('join_room', (roomCode) => {
    const screenSocketId = roomScreens.get(roomCode);
    if (!screenSocketId) {
      socket.emit('join_error', `Room ${roomCode} has no active screen.`);
      return;
    }

    const players = getOrCreatePlayers(roomCode);
    // Reconnect path: if this socket id is already in the list, just
    // re-announce. Otherwise, allocate a new slot.
    let player = players.find(p => p.id === socket.id);
    if (!player) {
      if (players.length >= MAX_PLAYERS_PER_ROOM) {
        socket.emit('join_error', `Room ${roomCode} is full (${MAX_PLAYERS_PER_ROOM} players max).`);
        return;
      }
      // Pick the lowest available slot (1 or 2) so reconnects keep colours.
      const usedSlots = new Set(players.map(p => p.slot));
      let slot = 1;
      while (usedSlots.has(slot)) slot++;
      player = { id: socket.id, slot };
      players.push(player);
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.slot = player.slot;
    console.log(`Controller ${socket.id} joined room ${roomCode} as P${player.slot}`);
    // Notify the screen that a controller connected (with player identity).
    io.to(screenSocketId).emit('controller_connected', { playerId: socket.id, slot: player.slot });
    socket.emit('join_ok', { roomCode, playerId: socket.id, slot: player.slot, screenId: screenSocketId });
  });

  // Relay gyro data (forward everything except the roomCode).
  // Hot path: keep this as small as possible. We deliberately skip the
  // per-packet ack — over WAN it doubles round-trips and creates lag.
  // Use `volatile` so if the screen is overloaded, packets are dropped
  // instead of queued (queuing causes rubber-banding).
  // RELAY: High-frequency binary gyro data.
  // We use a dedicated short name 'g' and volatile emit to minimize overhead.
  
  // WebRTC Signaling Relay
  socket.on('signal', (payload) => {
    // payload: { to: socketId, signal: data }
    io.to(payload.to).emit('signal', { from: socket.id, signal: payload.signal });
  });

  socket.on('g', (buf) => {
    const rc = socket.data?.roomCode;
    if (!rc) return;
    const sid = roomScreens.get(rc);
    if (!sid) return;
    // Relay the raw buffer. The receiver uses the 'from' property to identify the player.
    io.to(sid).volatile.emit('g', { f: socket.id, b: buf });
  });

  socket.on('gyro_data', (data) => {
    if (!data || !data.roomCode) return;
    const { roomCode, ...payload } = data;
    // Stamp the playerId so the screen knows which player this aim belongs to.
    payload.playerId = socket.id;
    const screenSocketId = roomScreens.get(roomCode);
    if (!screenSocketId) return;
    io.to(screenSocketId).volatile.emit('gyro_data', payload);
  });

  // ---------------- WebRTC signaling relay ----------------
  // Once a controller and a screen are in the same room, they negotiate a
  // direct peer-to-peer connection (RTCDataChannel). After that, gyro_data
  // and trigger events flow phone <-> PC directly, skipping this server
  // entirely. We just shuttle SDP and ICE candidates here.
  socket.on('rtc_signal', (data) => {
    if (!data || !data.roomCode) return;
    const { roomCode, to, ...payload } = data;
    // Stamp sender so the receiver can address replies back. With 2 players
    // in a room (3 sockets total: 1 screen + 2 controllers), broadcasting
    // signaling would cross-talk between players, so we route by `to`.
    payload.from = socket.id;
    if (to) {
      io.to(to).emit('rtc_signal', payload);
    } else {
      // Back-compat fallback — used to be the only path.
      socket.to(roomCode).emit('rtc_signal', payload);
    }
  });

  // Lightweight liveness probe (optional). Controller can call this
  // periodically (e.g. once per second) to update its "relay ok/miss"
  // diagnostic without paying ack cost on every gyro packet.
  socket.on('relay_ping', (roomCode, cb) => {
    const roomSize = io.sockets.adapter.rooms.get(roomCode)?.size || 0;
    const recipients = Math.max(0, roomSize - 1);
    if (typeof cb === 'function') cb({ recipients });
  });

  // Relay trigger event (Volume Down pressed) — browser decides if it's calibration or shoot
  socket.on('trigger', (roomCode) => {
    const screenSocketId = roomScreens.get(roomCode);
    if (!screenSocketId) return;
    io.to(screenSocketId).emit('trigger', { playerId: socket.id });
    console.log(`Trigger from ${socket.id} (P${socket.data?.slot}) in room ${roomCode}`);
  });

  socket.on('recalibrate', (roomCode) => {
    // Tell everyone in the room to recalibrate (Global reset)
    socket.to(roomCode).emit('recalibrate');
    console.log(`Recalibrate request from ${socket.id} in room ${roomCode}`);
  });

  socket.on('calib_start', (roomCode) => {
    // Screen tells a specific controller to start calibration
    // In this flow, we usually emit from screen to a specific playerId
    socket.to(roomCode).emit('calib_start');
  });

  socket.on('calib_state', (data) => {
    const { roomCode, to, ...payload } = data;
    // Target the specific device (Screen -> Controller or vice versa)
    if (to) {
      io.to(to).emit('calib_state', payload);
    } else {
      socket.to(roomCode).emit('calib_state', payload);
    }
  });

  socket.on('calib_done', (roomCode) => {
    socket.to(roomCode).emit('calib_done', { playerId: socket.id });
  });

  // Relay voice commands from controller to screen (fallback when WebRTC unavailable)
  socket.on('voice_command', (data) => {
    const { roomCode, command, target, transcript } = data;
    const screenSocketId = roomScreens.get(roomCode);
    if (!screenSocketId) return;
    io.to(screenSocketId).emit('voice_command', {
      playerId: socket.id,
      command,
      target,
      transcript
    });
    console.log(`Voice command from ${socket.id}: ${command} (${transcript})`);
  });

  // Relay calibration_complete from screen back to controller
  socket.on('calibration_complete', (data) => {
    const { roomCode, to } = data;
    if (to) {
      io.to(to).emit('calibration_complete');
    } else {
      socket.to(roomCode).emit('calibration_complete');
    }
  });

  socket.on('disconnect', () => {
    // If this was a screen, clear its room.
    for (const [roomCode, screenSocketId] of roomScreens.entries()) {
      if (screenSocketId === socket.id) {
        roomScreens.delete(roomCode);
        roomPlayers.delete(roomCode);
      }
    }
    // If this was a controller, drop them from their room's player list and
    // tell the screen to remove their crosshair.
    const roomCode = socket.data?.roomCode;
    if (roomCode) {
      const players = roomPlayers.get(roomCode);
      if (players) {
        const idx = players.findIndex(p => p.id === socket.id);
        if (idx >= 0) players.splice(idx, 1);
      }
      const screenSocketId = roomScreens.get(roomCode);
      if (screenSocketId) {
        io.to(screenSocketId).emit('controller_disconnected', { playerId: socket.id });
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

function startServer(requestedPort = 3000, clientPath = null) {
  setupStaticServing(clientPath);
  
  return new Promise((resolve, reject) => {
    let port = requestedPort;
    const serverInstance = server.listen(port, '0.0.0.0');

    serverInstance.on('listening', () => {
      console.log(`\nServer listening on port ${port}`);
      console.log('Reachable LAN addresses for the phone:');
      const nets = os.networkInterfaces();
      const allIps = [];
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          if (net.family === 'IPv4' && !net.internal) {
            allIps.push({ address: net.address, name });
          }
        }
      }
      
      // Sort: prioritize 192.168.*, then 10.*, then others. 
      // Also prioritize en0/en1 (mac wifi/ethernet) over bridge/vbox/vpn.
      allIps.sort((a, b) => {
        const score = (addr, name) => {
          let s = 0;
          if (addr.startsWith('192.168.')) s += 10;
          if (addr.startsWith('10.')) s += 5;
          if (name.startsWith('en')) s += 20; // Mac primary interfaces
          if (name.startsWith('eth') || name.startsWith('wlan')) s += 20; // Linux primary
          if (name.includes('bridge') || name.includes('vbox') || name.includes('vpn')) s -= 50;
          return s;
        };
        return score(b.address, b.name) - score(a.address, a.name);
      });

      const ips = allIps.map(ip => {
        console.log(`  http://${ip.address}:${port}     (interface: ${ip.name})`);
        return ip.address;
      });
      console.log('\nTest from phone browser: open one of the URLs above plus /health\n');
      resolve({ server: serverInstance, io, port, ips });
    });

    serverInstance.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} is busy, trying ${port + 1}...`);
        port++;
        serverInstance.listen(port, '0.0.0.0');
      } else {
        reject(err);
      }
    });
  });
}

if (require.main === module) {
  startServer(PORT);
}

module.exports = { startServer };
