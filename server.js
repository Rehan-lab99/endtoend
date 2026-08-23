const express = require('express');
const http = require('http');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2 * 1024 * 1024 });
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const privateTokens = new Map();
const uid = () => 'FC-' + crypto.randomBytes(5).toString('hex').toUpperCase();
const rid = () => crypto.randomBytes(6).toString('hex');
const safeName = n => String(n || 'Guest').trim().slice(0, 30) || 'Guest';

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { users: new Map(), messages: [] });
  return rooms.get(id);
}
function emitUsers(roomId) {
  const room = getRoom(roomId);
  io.to(roomId).emit('users', [...room.users.values()].map(u => ({ id: u.id, name: u.name })));
}
function publicHistory(roomId) {
  return getRoom(roomId).messages.filter(m => m.scope === 'public').slice(-200);
}

app.get('/api/qr', async (req, res) => {
  try {
    const text = String(req.query.text || '').slice(0, 4000);
    if (!text) return res.status(400).send('Missing text');
    const png = await QRCode.toBuffer(text, { type: 'png', width: 320, margin: 2, errorCorrectionLevel: 'M' });
    res.type('png').send(png);
  } catch { res.status(500).send('QR generation failed'); }
});

io.on('connection', socket => {
  socket.on('join', ({ roomId, name, userId, privateToken } = {}) => {
    roomId = roomId || rid();
    const room = getRoom(roomId);
    const existingUsers = [...room.users.values()].map(u => ({ id: u.id, name: u.name }));
    const id = userId && /^FC-[A-F0-9]{10}$/.test(userId) ? userId : uid();
    const tokenOk = !!privateToken && privateTokens.get(privateToken)?.roomId === roomId;
    const user = { id, name: safeName(name), socketId: socket.id, privateAccess: tokenOk };

    socket.data = { roomId, userId: id, privateAccess: tokenOk };
    socket.join(roomId);
    room.users.set(id, user);

    socket.emit('ready', {
      roomId,
      userId: id,
      privateAccess: tokenOk,
      public: { messages: publicHistory(roomId) },
      peers: existingUsers
    });
    socket.to(roomId).emit('peer-joined', { id, name: user.name });
    emitUsers(roomId);
  });

  socket.on('name', name => {
    const d = socket.data || {}, room = rooms.get(d.roomId);
    if (!room) return;
    const u = room.users.get(d.userId);
    if (!u) return;
    u.name = safeName(name);
    emitUsers(d.roomId);
  });

  socket.on('publicMessage', ({ text, replyTo } = {}) => {
    const d = socket.data || {}, room = rooms.get(d.roomId);
    if (!room || !String(text || '').trim()) return;
    const u = room.users.get(d.userId);
    if (!u) return;
    const msg = {
      id: crypto.randomUUID(), scope: 'public', userId: d.userId, name: u.name,
      text: String(text).slice(0, 5000), replyTo: replyTo || null, time: Date.now()
    };
    room.messages.push(msg);
    if (room.messages.length > 500) room.messages.shift();
    io.to(d.roomId).emit('message', msg);
  });

  socket.on('privateMessage', ({ token, text, replyTo } = {}) => {
    const d = socket.data || {}, access = privateTokens.get(token);
    if (!access || access.roomId !== d.roomId || !d.privateAccess || !String(text || '').trim()) return;
    const room = rooms.get(d.roomId), u = room?.users.get(d.userId);
    if (!u) return;
    const msg = {
      id: crypto.randomUUID(), scope: 'private', token, userId: d.userId, name: u.name,
      text: String(text).slice(0, 5000), replyTo: replyTo || null, time: Date.now()
    };
    access.messages.push(msg);
    if (access.messages.length > 200) access.messages.shift();
    // Deliberately emit only to users who have joined with this same private token.
    for (const member of room.users.values()) {
      if (member.privateAccess && member.socketId) io.to(member.socketId).emit('privateMessage', msg);
    }
  });

  socket.on('createPrivate', () => {
    const d = socket.data || {};
    if (!d.roomId) return;
    const token = crypto.randomBytes(18).toString('base64url');
    privateTokens.set(token, { roomId: d.roomId, messages: [] });
    socket.emit('privateCreated', { token });
  });

  socket.on('getPrivateHistory', token => {
    const d = socket.data || {}, a = privateTokens.get(token);
    if (!a || a.roomId !== d.roomId || !d.privateAccess) return;
    socket.emit('privateHistory', a.messages.slice(-100));
  });

  // Targeted WebRTC signaling. File bytes never pass through this server.
  socket.on('rtc', payload => {
    const d = socket.data || {}, room = rooms.get(d.roomId);
    if (!room || !payload?.to) return;
    const target = room.users.get(payload.to);
    if (!target?.socketId) return;
    io.to(target.socketId).emit('rtc', { from: d.userId, type: payload.type, data: payload.data });
  });

  socket.on('disconnect', () => {
    const d = socket.data || {}, room = rooms.get(d.roomId);
    if (!room) return;
    room.users.delete(d.userId);
    socket.to(d.roomId).emit('peer-left', { id: d.userId });
    emitUsers(d.roomId);
    if (room.users.size === 0) setTimeout(() => {
      const r = rooms.get(d.roomId);
      if (r && r.users.size === 0) rooms.delete(d.roomId);
    }, 600000);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`FreeChat running on port ${PORT}`));
