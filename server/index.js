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

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR);
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR);

app.use('/uploads', express.static(UPLOADS_DIR));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const db = new Database('database.sqlite');

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
  // Attempt schema migration
  try { db.exec('ALTER TABLE messages ADD COLUMN status TEXT DEFAULT "sent"'); } catch(e){}
  try { db.exec('ALTER TABLE messages ADD COLUMN deletedBy TEXT DEFAULT "[]"'); } catch(e){}
} catch(err) {
  console.error('DB Init Error:', err);
}

const insertUser = db.prepare('INSERT INTO users (id, email, password, name, avatar, lastSeen) VALUES (?, ?, ?, ?, ?, ?)');
const getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const updateUserLastSeen = db.prepare('UPDATE users SET lastSeen = ? WHERE id = ?');
const updateUserProfile = db.prepare('UPDATE users SET name = ?, avatar = ?, password = ? WHERE id = ?');
const getAllUsers = db.prepare('SELECT id, email, name, avatar, lastSeen FROM users');

const insertMsg = db.prepare('INSERT INTO messages (id, text, senderId, receiverId, timestamp, isMedia, mediaUrl, mediaType, deleted, createdAt, status, deletedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const getMessages = db.prepare('SELECT * FROM messages ORDER BY createdAt ASC');
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
    cb(null, isAvatar ? 'uploads/avatars/' : 'uploads/media/');
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_') : 'file.bin';
    cb(null, Date.now() + '-' + safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB limit

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const isAvatar = req.body.isAvatar === 'true';
  const folder = isAvatar ? 'avatars' : 'media';
  const fileUrl = `/uploads/${folder}/${req.file.filename}`;
  
  // Detect file type from mimetype
  let fileType = 'file'; // default: generic file/document
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

// Mark-Read API: Marks all unread messages from a sender as 'read'
app.post('/api/messages/mark-read', (req, res) => {
  try {
    const { senderId, receiverId } = req.body;
    if (!senderId || !receiverId) return res.status(400).json({ error: 'senderId and receiverId are required.' });

    // Get IDs of messages that will be updated (for socket notification)
    const unreadMsgs = getUnreadMessages.all(senderId, receiverId, 'read');
    const messageIds = unreadMsgs.map(m => m.id);

    if (messageIds.length === 0) return res.json({ updated: 0 });

    // Bulk update in DB
    markMessagesRead.run('read', senderId, receiverId, 'read');

    // Emit socket event to the sender so their UI updates instantly
    const senderSocket = Array.from(activeSockets.values()).find(u => u.id.toString() === senderId.toString());
    if (senderSocket) {
      io.to(senderSocket.socketId).emit('messages_read_bulk', {
        chatId: receiverId,
        messageIds: messageIds
      });
    }

    res.json({ updated: messageIds.length });
  } catch(err) {
    console.error('Mark-read error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (getUserByEmail.get(email)) return res.status(400).json({ error: 'Email zaten kullanılıyor.' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const avatar = 'https://i.pravatar.cc/150?u=' + email;
    insertUser.run(newId, email, hashedPassword, name, avatar, Date.now());
    res.json({ token: jwt.sign({ id: newId }, JWT_SECRET, { expiresIn: '7d' }), user: { id: newId, name, email, avatar } });
  } catch(err) { res.status(500).json({ error: 'Sunucu hatası.' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = getUserByEmail.get(email);
    if (!user) return res.status(400).json({ error: 'Kullanıcı bulunamadı.' });
    if (!(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Geçersiz şifre.' });
    res.json({ token: jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' }), user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar } });
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

const activeSockets = new Map();

io.on('connection', (socket) => {
  socket.on('register_user', (userData) => {
    updateUserLastSeen.run(Date.now(), userData.id);
    activeSockets.set(socket.id, { ...userData, socketId: socket.id, online: true });
    
    const allDbUsers = getAllUsers.all();
    const activeUserIds = Array.from(activeSockets.values()).map(u => u.id.toString());
    
    io.emit('users_updated', allDbUsers.map(u => ({
      id: u.id.toString(), name: u.name, avatar: u.avatar, online: activeUserIds.includes(u.id.toString())
    })));

    const history = getMessages.all().map(msg => ({
       ...msg, isMedia: msg.isMedia === 1, deleted: msg.deleted === 1,
       deletedBy: JSON.parse(msg.deletedBy || '[]')
    }));
    socket.emit('chat_history', history);
  });

  socket.on('send_message', (msg) => {
    insertMsg.run(
      msg.id.toString(), msg.text, msg.senderId.toString(), msg.receiverId.toString(), 
      msg.timestamp, msg.isMedia ? 1 : 0, msg.mediaUrl || null, msg.mediaType || null, 
      0, Date.now(), 'sent', '[]'
    );
    
    // Add default states for newly sent message
    msg.status = 'sent';
    msg.deletedBy = [];

    const receiverSocket = Array.from(activeSockets.values()).find(u => u.id.toString() === msg.receiverId.toString());
    if (receiverSocket && receiverSocket.socketId !== socket.id) {
      msg.status = 'delivered'; // Auto upgrade if online
      updateMessageStatus.run('delivered', msg.id.toString());
      io.to(receiverSocket.socketId).emit('receive_message', msg);
    }
    socket.emit('receive_message', msg);
  });

  // message status updates
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
    
    // Soft delete: add user to deletedBy array of all messages between them
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
    // Delete for everyone
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
    const active = Array.from(activeSockets.values()).find(u => u.id.toString() === data.id.toString());
    if (active) { active.name = data.name; active.avatar = data.avatar; }
    const allDbUsers = getAllUsers.all();
    const activeUserIds = Array.from(activeSockets.values()).map(u => u.id.toString());
    io.emit('users_updated', allDbUsers.map(u => ({
      id: u.id.toString(), name: u.name, avatar: u.avatar, online: activeUserIds.includes(u.id.toString())
    })));
  });

  socket.on('disconnect', () => {
    const user = activeSockets.get(socket.id);
    if (user) {
      updateUserLastSeen.run(Date.now(), user.id);
      activeSockets.delete(socket.id);
      const allDbUsers = getAllUsers.all();
      const activeUserIds = Array.from(activeSockets.values()).map(u => u.id.toString());
      io.emit('users_updated', allDbUsers.map(u => ({
        id: u.id.toString(), name: u.name, avatar: u.avatar, online: activeUserIds.includes(u.id.toString())
      })));
    }
  });

  // ===== WebRTC Signaling Events =====
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
  console.log(`Socket.IO Server running on port ${PORT}`);
});
