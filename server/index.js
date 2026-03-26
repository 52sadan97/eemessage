const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = 'eemessage_super_secret_key_123';

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
const MEDIA_DIR = path.join(UPLOADS_DIR, 'media');
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR);
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR);

app.use('/uploads', express.static(UPLOADS_DIR));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 30000,
  pingInterval: 10000,
});

const db = new Database(path.join(DATA_DIR, 'database.sqlite'));
// WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('cache_size = 10000');

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password TEXT,
      name TEXT,
      avatar TEXT,
      lastSeen INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      text TEXT,
      senderId TEXT,
      receiverId TEXT,
      timestamp TEXT,
      isMedia INTEGER DEFAULT 0,
      mediaUrl TEXT,
      mediaType TEXT,
      deleted INTEGER DEFAULT 0,
      createdAt INTEGER
    );
  `);
  // Schema migrations
  try { db.exec('ALTER TABLE messages ADD COLUMN status TEXT DEFAULT "sent"'); } catch(e){}
  try { db.exec('ALTER TABLE messages ADD COLUMN deletedBy TEXT DEFAULT "[]"'); } catch(e){}

  // Performance indexes
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(senderId)'); } catch(e){}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiverId)'); } catch(e){}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(createdAt)'); } catch(e){}
} catch(err) {
  console.error('DB Init Error:', err);
}

// Prepared statements
const insertUser = db.prepare('INSERT INTO users (id, email, password, name, avatar, lastSeen) VALUES (?, ?, ?, ?, ?, ?)');
const getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const updateUserLastSeen = db.prepare('UPDATE users SET lastSeen = ? WHERE id = ?');
const updateUserProfile = db.prepare('UPDATE users SET name = ?, avatar = ?, password = ? WHERE id = ?');
const getAllUsers = db.prepare('SELECT id, email, name, avatar, lastSeen FROM users');

const insertMsg = db.prepare('INSERT INTO messages (id, text, senderId, receiverId, timestamp, isMedia, mediaUrl, mediaType, deleted, createdAt, status, deletedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
// FIX: Only get messages relevant to a specific user (not ALL messages)
const getMessagesForUser = db.prepare('SELECT * FROM messages WHERE senderId = ? OR receiverId = ? ORDER BY createdAt ASC');
const updateMessageDeleted = db.prepare('UPDATE messages SET deleted = 1, text = ?, isMedia = 0, mediaUrl = NULL WHERE id = ?');
const getMessageById = db.prepare('SELECT * FROM messages WHERE id = ?');
const updateMessageStatus = db.prepare('UPDATE messages SET status = ? WHERE id = ?');
const updateDeletedBy = db.prepare('UPDATE messages SET deletedBy = ? WHERE id = ?');
const getMessagesBetween = db.prepare('SELECT id, deletedBy FROM messages WHERE (senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?)');
const markMessagesRead = db.prepare('UPDATE messages SET status = ? WHERE senderId = ? AND receiverId = ? AND status != ?');
const getUnreadMessages = db.prepare('SELECT id FROM messages WHERE senderId = ? AND receiverId = ? AND status != ?');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isAvatar = req.body.isAvatar === 'true';
    cb(null, isAvatar ? AVATARS_DIR : MEDIA_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_') : 'file.bin';
    cb(null, Date.now() + '-' + safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const isAvatar = req.body.isAvatar === 'true';
  const folder = isAvatar ? 'avatars' : 'media';
  const fileUrl = `/uploads/${folder}/${req.file.filename}`;
  let fileType = 'file';
  const mime = req.file.mimetype || '';
  if (mime.startsWith('image')) fileType = 'image';
  else if (mime.startsWith('video')) fileType = 'video';
  else if (mime.startsWith('audio')) fileType = 'audio';
  else if (mime === 'application/pdf') fileType = 'pdf';
  else if (mime.includes('word') || mime.includes('document')) fileType = 'document';
  else if (mime.includes('sheet') || mime.includes('excel')) fileType = 'spreadsheet';
  else if (mime.includes('presentation') || mime.includes('powerpoint')) fileType = 'presentation';
  else if (mime.includes('zip') || mime.includes('rar') || mime.includes('tar') || mime.includes('compressed')) fileType = 'archive';
  res.json({ url: fileUrl, type: fileType, originalName: req.file.originalname, size: req.file.size });
});

// Mark-Read API
app.post('/api/messages/mark-read', (req, res) => {
  try {
    const { senderId, receiverId } = req.body;
    if (!senderId || !receiverId) return res.status(400).json({ error: 'senderId and receiverId are required.' });
    const unreadMsgs = getUnreadMessages.all(senderId, receiverId, 'read');
    const messageIds = unreadMsgs.map(m => m.id);
    if (messageIds.length === 0) return res.json({ updated: 0 });
    markMessagesRead.run('read', senderId, receiverId, 'read');
    const senderSocket = Array.from(activeSockets.values()).find(u => u.id.toString() === senderId.toString());
    if (senderSocket) {
      io.to(senderSocket.socketId).emit('messages_read_bulk', { chatId: receiverId, messageIds });
    }
    res.json({ updated: messageIds.length });
  } catch(err) {
    console.error('Mark-read error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (getUserByEmail.get(email)) return res.status(400).json({ error: 'Email zaten kullanılıyor.' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const avatar = 'https://i.pravatar.cc/150?u=' + email;
    insertUser.run(newId, email, hashedPassword, name, avatar, Date.now());
    res.json({ token: jwt.sign({ id: newId }, JWT_SECRET, { expiresIn: '30d' }), user: { id: newId, name, email, avatar } });
  } catch(err) { res.status(500).json({ error: 'Sunucu hatası.' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = getUserByEmail.get(email);
    if (!user) return res.status(400).json({ error: 'Kullanıcı bulunamadı.' });
    if (!(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Geçersiz şifre.' });
    res.json({ token: jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' }), user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar } });
  } catch(err) { res.status(500).json({ error: 'Sunucu hatası.' }); }
});

app.get('/api/auth/me', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Yetkisiz erişim.' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById.get(decoded.id);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    res.json({ user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar } });
  } catch(err) { res.status(401).json({ error: 'Geçersiz token.' }); }
});

app.post('/api/auth/update_profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Yetkisiz.' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const { id, currentPassword, newPassword, name, avatar } = req.body;
    if (id !== decoded.id) return res.status(403).json({ error: 'Yetkisiz.' });
    const user = getUserById.get(id);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Mevcut şifreniz yanlış.' });
    let passToSave = user.password;
    if (newPassword && newPassword.trim().length > 0) {
      const salt = await bcrypt.genSalt(10);
      passToSave = await bcrypt.hash(newPassword, salt);
    }
    updateUserProfile.run(name, avatar, passToSave, id);
    res.json({ success: true, user: { id, name, avatar, email: user.email } });
  } catch(err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// ===== ADMIN PANEL API =====
const ADMIN_EMAIL = 'admin@eemessage.com';
const ADMIN_PASSWORD = 'admin123';

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Geçersiz admin bilgileri.' });
});

const adminAuth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Yetkisiz.' });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.admin) return res.status(403).json({ error: 'Admin yetkisi gerekli.' });
    next();
  } catch(e) { res.status(401).json({ error: 'Geçersiz token.' }); }
};

app.get('/api/admin/stats', adminAuth, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const totalMedia = db.prepare('SELECT COUNT(*) as count FROM messages WHERE isMedia = 1').get().count;
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayMessages = db.prepare('SELECT COUNT(*) as count FROM messages WHERE createdAt >= ?').get(todayStart.getTime()).count;
  const onlineUsers = activeSockets.size;
  res.json({ totalUsers, totalMessages, totalMedia, todayMessages, onlineUsers });
});

app.get('/api/admin/users', adminAuth, (req, res) => {
  const users = db.prepare('SELECT id, email, name, avatar, lastSeen FROM users').all();
  const activeUserIds = Array.from(activeSockets.values()).map(u => u.id.toString());
  const usersWithStatus = users.map(u => ({
    ...u,
    online: activeUserIds.includes(u.id.toString()),
    messageCount: db.prepare('SELECT COUNT(*) as count FROM messages WHERE senderId = ?').get(u.id).count
  }));
  res.json(usersWithStatus);
});

app.post('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Tüm alanlar gerekli.' });
    if (getUserByEmail.get(email)) return res.status(400).json({ error: 'Bu email zaten var.' });
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);
    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const avatar = 'https://i.pravatar.cc/150?u=' + email;
    insertUser.run(newId, email, hashed, name, avatar, Date.now());
    res.json({ success: true, user: { id: newId, name, email, avatar } });
  } catch(e) { res.status(500).json({ error: 'Sunucu hatası.' }); }
});

app.delete('/api/admin/users/:id', adminAuth, (req, res) => {
  try {
    const user = getUserById.get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(req.params.id, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Sunucu hatası.' }); }
});

app.get('/api/admin/messages', adminAuth, (req, res) => {
  const { userId, limit = 100, offset = 0 } = req.query;
  let query = 'SELECT m.*, su.name as senderName, su.email as senderEmail, ru.name as receiverName, ru.email as receiverEmail FROM messages m LEFT JOIN users su ON m.senderId = su.id LEFT JOIN users ru ON m.receiverId = ru.id';
  const params = [];
  if (userId) { query += ' WHERE m.senderId = ? OR m.receiverId = ?'; params.push(userId, userId); }
  query += ' ORDER BY m.createdAt DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  const messages = db.prepare(query).all(...params);
  const total = userId
    ? db.prepare('SELECT COUNT(*) as count FROM messages WHERE senderId = ? OR receiverId = ?').get(userId, userId).count
    : db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  res.json({ messages, total });
});

app.delete('/api/admin/messages/:id', adminAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Sunucu hatası.' }); }
});

// ===== UTILITY: build users_updated payload =====
const activeSockets = new Map();

function buildUsersPayload() {
  const allDbUsers = getAllUsers.all();
  const activeUserIds = Array.from(activeSockets.values()).map(u => u.id.toString());
  return allDbUsers.map(u => ({
    id: u.id.toString(),
    name: u.name,
    avatar: u.avatar,
    online: activeUserIds.includes(u.id.toString()),
    lastSeen: u.lastSeen,
  }));
}

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('register_user', (userData) => {
    if (!userData || !userData.id) return;
    const userId = userData.id.toString();

    // Remove old socket entry for same user (reconnect case)
    for (const [sid, u] of activeSockets.entries()) {
      if (u.id.toString() === userId && sid !== socket.id) {
        activeSockets.delete(sid);
      }
    }

    try { updateUserLastSeen.run(Date.now(), userId); } catch(e) {}

    activeSockets.set(socket.id, { ...userData, socketId: socket.id, online: true });

    // Broadcast updated user list to ALL
    io.emit('users_updated', buildUsersPayload());

    // Send ONLY this user's message history (privacy + performance fix)
    try {
      const historyRows = getMessagesForUser.all(userId, userId);
      const history = historyRows.map(msg => ({
        ...msg,
        isMedia: msg.isMedia === 1,
        deleted: msg.deleted === 1,
        deletedBy: JSON.parse(msg.deletedBy || '[]')
      }));
      socket.emit('chat_history', history);
    } catch(err) {
      console.error('Fetch history error:', err);
    }
  });

  socket.on('send_message', (msg) => {
    try {
      insertMsg.run(
        msg.id.toString(), msg.text, msg.senderId.toString(), msg.receiverId.toString(),
        msg.timestamp, msg.isMedia ? 1 : 0, msg.mediaUrl || null, msg.mediaType || null,
        0, Date.now(), 'sent', '[]'
      );
    } catch(err) {
      console.error('Insert message error:', err);
      return;
    }

    const outMsg = { ...msg, status: 'sent', deletedBy: [] };

    const receiverSocket = Array.from(activeSockets.values()).find(u => u.id.toString() === msg.receiverId.toString());
    if (receiverSocket && receiverSocket.socketId !== socket.id) {
      outMsg.status = 'delivered';
      updateMessageStatus.run('delivered', msg.id.toString());
      io.to(receiverSocket.socketId).emit('receive_message', { ...outMsg, status: 'delivered' });
    }
    // Echo back to sender with final status
    socket.emit('receive_message', outMsg);
  });

  socket.on('update_message_status', ({ messageId, status, senderId }) => {
    updateMessageStatus.run(status, messageId);
    const senderSocket = Array.from(activeSockets.values()).find(u => u.id.toString() === senderId.toString());
    if (senderSocket) {
      io.to(senderSocket.socketId).emit('message_status_changed', { messageId, status });
    }
  });

  socket.on('clear_chat', (contactId) => {
    const user = activeSockets.get(socket.id);
    if (!user) return;
    const msgs = getMessagesBetween.all(user.id.toString(), contactId.toString(), contactId.toString(), user.id.toString());
    msgs.forEach(m => {
      let dba = JSON.parse(m.deletedBy || '[]');
      if (!dba.includes(user.id.toString())) {
        dba.push(user.id.toString());
        updateDeletedBy.run(JSON.stringify(dba), m.id);
      }
    });
    socket.emit('chat_cleared', contactId.toString());
  });

  socket.on('delete_for_me', ({ messageId, userId }) => {
    const msg = getMessageById.get(messageId);
    if (msg) {
      let dba = JSON.parse(msg.deletedBy || '[]');
      if (!dba.includes(userId.toString())) {
        dba.push(userId.toString());
        updateDeletedBy.run(JSON.stringify(dba), messageId);
      }
      socket.emit('message_deleted_for_me', { messageId, userId: userId.toString() });
    }
  });

  socket.on('delete_message', (messageId) => {
    const msg = getMessageById.get(messageId);
    if (msg) {
      updateMessageDeleted.run('🚫 Bu mesaj silindi.', messageId);
      const updateData = { id: messageId.toString(), deleted: true, text: '🚫 Bu mesaj silindi.' };
      const senderSocket = Array.from(activeSockets.values()).find(u => u.id.toString() === msg.senderId.toString());
      const receiverSocket = Array.from(activeSockets.values()).find(u => u.id.toString() === msg.receiverId.toString());
      if (senderSocket) io.to(senderSocket.socketId).emit('message_deleted', updateData);
      if (receiverSocket) io.to(receiverSocket.socketId).emit('message_deleted', updateData);
    }
  });

  socket.on('update_profile', (data) => {
    const active = activeSockets.get(socket.id);
    if (active) { active.name = data.name; active.avatar = data.avatar; }
    io.emit('users_updated', buildUsersPayload());
  });

  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', socket.id, reason);
    const user = activeSockets.get(socket.id);
    if (user) {
      try { updateUserLastSeen.run(Date.now(), user.id); } catch(e) {}
      activeSockets.delete(socket.id);
      io.emit('users_updated', buildUsersPayload());
    }
  });

  // ===== WebRTC Signaling =====
  socket.on('callUser', ({ userToCall, signalData, from, name, callType }) => {
    const targetSocket = Array.from(activeSockets.values()).find(u => u.id.toString() === userToCall.toString());
    if (targetSocket) {
      io.to(targetSocket.socketId).emit('incomingCall', { signal: signalData, from, name, callType });
    }
  });

  socket.on('answerCall', ({ to, signal }) => {
    const callerSocket = Array.from(activeSockets.values()).find(u => u.id.toString() === to.toString());
    if (callerSocket) {
      io.to(callerSocket.socketId).emit('callAccepted', { signal });
    }
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    const targetSocket = Array.from(activeSockets.values()).find(u => u.id.toString() === to.toString());
    if (targetSocket) {
      io.to(targetSocket.socketId).emit('ice-candidate', { candidate });
    }
  });

  socket.on('callEnded', ({ to }) => {
    const targetSocket = Array.from(activeSockets.values()).find(u => u.id.toString() === to.toString());
    if (targetSocket) {
      io.to(targetSocket.socketId).emit('callEnded');
    }
  });
});

const PORT = 3010;
server.listen(PORT, () => {
  console.log(`EEMessage Server running on port ${PORT}`);
});
