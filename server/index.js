const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());

// Health check endpoint — visit http://<mac-ip>:3000/health from the phone
// browser to verify the device can reach the server before launching the app.
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const roomScreens = new Map(); // roomCode -> screen socket id

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

    socket.join(roomCode);
    console.log(`Controller ${socket.id} joined room ${roomCode}`);
    // Notify the screen that a controller connected
    socket.to(roomCode).emit('controller_connected');
    socket.emit('join_ok', roomCode);
  });

  // Relay gyro data (forward everything except the roomCode)
  socket.on('gyro_data', (data) => {
    if (!data || !data.roomCode) return;
    const { roomCode, ...payload } = data;

    const roomSize = io.sockets.adapter.rooms.get(roomCode)?.size || 0;
    const recipients = Math.max(0, roomSize - 1); // minus sender
    if (recipients === 0) {
      socket.emit('gyro_server_ack', { roomCode, relayed: false, recipients: 0 });
      return;
    }

    socket.to(roomCode).emit('gyro_data', payload);
    socket.emit('gyro_server_ack', { roomCode, relayed: true, recipients });
  });

  // Relay trigger event (Volume Down pressed) — browser decides if it's calibration or shoot
  socket.on('trigger', (roomCode) => {
    socket.to(roomCode).emit('trigger');
    console.log(`Trigger from ${socket.id} in room ${roomCode}`);
  });

  socket.on('recalibrate', (roomCode) => {
    socket.to(roomCode).emit('recalibrate');
    console.log(`Recalibrate request from ${socket.id} in room ${roomCode}`);
  });

  socket.on('calib_start', (roomCode) => {
    socket.to(roomCode).emit('calib_start');
  });

  socket.on('calib_state', (data) => {
    const { roomCode, ...payload } = data;
    socket.to(roomCode).emit('calib_state', payload);
  });

  socket.on('calib_done', (roomCode) => {
    socket.to(roomCode).emit('calib_done');
  });

  // Relay calibration_complete from screen back to controller
  socket.on('calibration_complete', (roomCode) => {
    socket.to(roomCode).emit('calibration_complete');
  });

  socket.on('disconnect', () => {
    for (const [roomCode, screenSocketId] of roomScreens.entries()) {
      if (screenSocketId === socket.id) roomScreens.delete(roomCode);
    }
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nServer listening on port ${PORT}`);
  console.log('Reachable LAN addresses for the phone:');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  http://${net.address}:${PORT}     (interface: ${name})`);
      }
    }
  }
  console.log('\nTest from phone browser: open one of the URLs above plus /health\n');
});
