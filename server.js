import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { randomUUID } from 'crypto';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: false } });
const PORT = process.env.PORT || 5000;
const rooms = new Map();

app.use(express.static('public'));

app.get('/api/room', async (req, res) => {
  const id = randomUUID().replaceAll('-', '').slice(0, 10);
  rooms.set(id, { created: Date.now(), users: 0 });
  const base = `${req.protocol}://${req.get('host')}`;
  const url = `${base}/?room=${id}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });
  res.json({ id, url, qr });
});

io.on('connection', socket => {
  socket.on('join', room => {
    if (typeof room !== 'string' || !/^[a-zA-Z0-9_-]{4,40}$/.test(room)) return;
    if (!rooms.has(room)) rooms.set(room, { created: Date.now(), users: 0 });
    const members = [...(io.sockets.adapter.rooms.get(room) || [])];
    socket.join(room);
    socket.data.room = room;
    socket.data.peerId = socket.id;
    socket.emit('room-info', { peerId: socket.id, existingPeers: members });
    socket.to(room).emit('peer-joined', { peerId: socket.id });
    rooms.get(room).users = (io.sockets.adapter.rooms.get(room)?.size || 0);
    io.to(room).emit('presence', rooms.get(room).users);
  });

  // WebRTC signaling. The server never sees the file payload.
  socket.on('signal', ({ to, data }) => {
    if (!to || !data || !socket.data.room) return;
    const target = io.sockets.sockets.get(to);
    if (!target || target.data.room !== socket.data.room) return;
    target.emit('signal', { from: socket.id, data });
  });

  socket.on('message', msg => {
    if (socket.data.room) socket.to(socket.data.room).emit('message', msg);
  });

  socket.on('clear', () => {
    if (socket.data.room) io.to(socket.data.room).emit('clear');
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit('peer-left', { peerId: socket.id });
    const r = rooms.get(room);
    if (r) {
      r.users = Math.max(0, (io.sockets.adapter.rooms.get(room)?.size || 0));
      io.to(room).emit('presence', r.users);
      if (r.users === 0 && Date.now() - r.created > 6 * 60 * 60 * 1000) rooms.delete(room);
    }
  });
});

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, r] of rooms) if (r.users === 0 && r.created < cutoff) rooms.delete(id);
}, 10 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => console.log(`ShareClone WebRTC running on port ${PORT}`));
