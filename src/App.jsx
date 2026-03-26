import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import { App as CapApp } from '@capacitor/app';
import { API_URL } from './config';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import Auth from './components/Auth';
import CallManager from './components/CallManager';
import AdminPanel from './components/AdminPanel';
import PermissionSetup from './components/PermissionSetup';
import usePushNotifications from './hooks/usePushNotifications';
import './App.css';

const socket = io(API_URL, {
  autoConnect: false,
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});
export { socket };

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('eemessage_theme') || 'light');
  const [contacts, setContacts] = useState([]);
  const [messagesMap, setMessagesMap] = useState({});
  const selectedContactIdRef = useRef(null);
  const callManagerRef = useRef(null);

  // Firebase push notifications (native Android only)
  usePushNotifications(currentUser);

  useEffect(() => {
    selectedContactIdRef.current = selectedContactId;
  }, [selectedContactId]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('eemessage_theme', theme);
  }, [theme]);

  // Initial Auth Check (Run only once)
  useEffect(() => {
    const token = localStorage.getItem('eemessage_token');
    if (token) {
      fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (data.user) setCurrentUser(data.user);
          else localStorage.removeItem('eemessage_token');
        })
        .finally(() => setIsInitializing(false));
    } else {
      setIsInitializing(false);
    }
  }, []);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  // Request browser notification permission when user logs in
  useEffect(() => {
    if (!currentUser) return;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [currentUser]);

  // Helper: show browser notification for incoming message
  const showNotification = useCallback((msg, senderName, senderAvatar) => {
    // Don't notify if currently viewing this chat
    const isViewingChat = document.visibilityState === 'visible' &&
      selectedContactIdRef.current === msg.senderId;
    if (isViewingChat) return;

    // 🔊 Play notification sound
    try {
      const notifSound = new Audio('/notification.mp3');
      notifSound.volume = 0.7;
      notifSound.play().catch(() => {});
    } catch(e) {}

    // Browser notification (when tab not focused)
    if (document.visibilityState !== 'visible') {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const text = msg.isMedia
        ? (msg.mediaType === 'image' ? '📷 Fotoğraf' : msg.mediaType === 'video' ? '🎥 Video' : msg.mediaType === 'audio' ? '🎤 Ses mesajı' : '📁 Dosya')
        : (msg.text || '');
      const notif = new Notification(senderName || 'EEMessage', {
        body: text,
        icon: senderAvatar || '/app-icon.jpg',
        badge: '/app-icon.jpg',
        tag: `msg-${msg.senderId}`,
        renotify: true,
      });
      notif.onclick = () => { window.focus(); notif.close(); };
    }
  }, []);

  // Socket and App Listeners (Run when currentUser is available)
  useEffect(() => {
    if (!currentUser) {
      // User logged out — clean up socket and state
      if (socket.connected) socket.disconnect();
      return;
    }

    // Update auth token before connecting
    socket.auth = { token: localStorage.getItem('eemessage_token') };

    if (!socket.connected) {
      socket.connect();
    }

    const onConnect = () => {
      socket.emit('register_user', currentUser);
    };

    // If already connected, register immediately
    if (socket.connected) {
      socket.emit('register_user', currentUser);
    }

    const handleUsersUpdate = (activeUsers) => {
      setContacts(activeUsers.filter(u => u.id !== currentUser.id));
    };

    const handleReceiveMsg = (msg) => {
      setMessagesMap(prev => {
        const newMap = { ...prev };
        const contactId = msg.senderId.toString() === currentUser.id.toString()
          ? msg.receiverId.toString()
          : msg.senderId.toString();
        if (!newMap[contactId]) newMap[contactId] = [];
        if (!newMap[contactId].find(m => m.id === msg.id)) {
          newMap[contactId] = [...newMap[contactId], msg];
        } else {
          newMap[contactId] = newMap[contactId].map(m => m.id === msg.id ? msg : m);
        }
        return newMap;
      });

      // Show browser notification for incoming messages
      if (msg.senderId.toString() !== currentUser.id.toString()) {
        setContacts(prev => {
          const sender = prev.find(c => c.id.toString() === msg.senderId.toString());
          if (sender) showNotification(msg, sender.name, sender.avatar);
          return prev;
        });
      }

      // Auto-read if chat is focused
      if (msg.senderId !== currentUser.id && selectedContactIdRef.current === msg.senderId.toString()) {
        fetch(`${API_URL}/api/messages/mark-read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ senderId: msg.senderId, receiverId: currentUser.id })
        }).catch(e => console.error(e));
      }
    };

    const handleChatHistory = (history) => {
      const newMap = {};
      history.forEach(msg => {
        const contactId = msg.senderId.toString() === currentUser.id.toString()
          ? msg.receiverId.toString()
          : msg.senderId.toString();
        if (!newMap[contactId]) newMap[contactId] = [];
        newMap[contactId].push(msg);
      });
      setMessagesMap(newMap);
    };

    // Bulk read receipts — update status for all messages in a chat
    const handleMessagesReadBulk = ({ chatId, messageIds }) => {
      setMessagesMap(prev => {
        const chatKey = chatId.toString();
        if (!prev[chatKey]) return prev;
        return {
          ...prev,
          [chatKey]: prev[chatKey].map(m =>
            messageIds.includes(m.id) ? { ...m, status: 'read' } : m
          )
        };
      });
    };

    // Single message status change (delivered, read...)
    const handleStatusChanged = ({ messageId, status }) => {
      setMessagesMap(prev => {
        const updated = { ...prev };
        for (const key of Object.keys(updated)) {
          const idx = updated[key].findIndex(m => m.id === messageId);
          if (idx !== -1) {
            updated[key] = [...updated[key]];
            updated[key][idx] = { ...updated[key][idx], status };
            break;
          }
        }
        return updated;
      });
    };

    // Delete for everyone
    const handleMessageDeleted = ({ id, deleted, text }) => {
      setMessagesMap(prev => {
        const updated = { ...prev };
        for (const key of Object.keys(updated)) {
          const idx = updated[key].findIndex(m => m.id === id);
          if (idx !== -1) {
            updated[key] = [...updated[key]];
            updated[key][idx] = { ...updated[key][idx], deleted: true, text };
            break;
          }
        }
        return updated;
      });
    };

    // Delete for me
    const handleDeletedForMe = ({ messageId, userId }) => {
      setMessagesMap(prev => {
        const updated = { ...prev };
        for (const key of Object.keys(updated)) {
          const idx = updated[key].findIndex(m => m.id === messageId);
          if (idx !== -1) {
            updated[key] = [...updated[key]];
            const existing = updated[key][idx];
            const deletedBy = Array.isArray(existing.deletedBy) ? existing.deletedBy : [];
            if (!deletedBy.includes(userId)) {
              updated[key][idx] = { ...existing, deletedBy: [...deletedBy, userId] };
            }
            break;
          }
        }
        return updated;
      });
    };

    // Clear chat (soft-delete all messages in a chat)
    const handleChatCleared = (contactId) => {
      setMessagesMap(prev => {
        const key = contactId.toString();
        if (!prev[key]) return prev;
        return {
          ...prev,
          [key]: prev[key].map(m => ({
            ...m,
            deletedBy: Array.isArray(m.deletedBy)
              ? (m.deletedBy.includes(currentUser.id.toString()) ? m.deletedBy : [...m.deletedBy, currentUser.id.toString()])
              : [currentUser.id.toString()]
          }))
        };
      });
    };

    socket.on('connect', onConnect);
    socket.on('users_updated', handleUsersUpdate);
    socket.on('receive_message', handleReceiveMsg);
    socket.on('chat_history', handleChatHistory);
    socket.on('messages_read_bulk', handleMessagesReadBulk);
    socket.on('message_status_changed', handleStatusChanged);
    socket.on('message_deleted', handleMessageDeleted);
    socket.on('message_deleted_for_me', handleDeletedForMe);
    socket.on('chat_cleared', handleChatCleared);

    // Capacitor App State Listener
    const stateListener = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && !socket.connected) {
        socket.connect();
      }
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('users_updated', handleUsersUpdate);
      socket.off('receive_message', handleReceiveMsg);
      socket.off('chat_history', handleChatHistory);
      socket.off('messages_read_bulk', handleMessagesReadBulk);
      socket.off('message_status_changed', handleStatusChanged);
      socket.off('message_deleted', handleMessageDeleted);
      socket.off('message_deleted_for_me', handleDeletedForMe);
      socket.off('chat_cleared', handleChatCleared);
      stateListener.remove();
    };
  }, [currentUser, showNotification]);

  // ===== BACK BUTTON — always active, independent of socket/user =====
  useEffect(() => {
    const backListener = CapApp.addListener('backButton', () => {
      if (window.location.hash === '#/admin') {
        window.location.hash = '';
        return;
      }
      if (selectedContactIdRef.current) {
        setSelectedContactId(null);
      } else {
        CapApp.exitApp();
      }
    });
    return () => { backListener.remove(); };
  }, []);

  const handleSendMessage = useCallback((msgData) => {
    if (!currentUser) return;
    const newMsg = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      senderId: currentUser.id.toString(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ...msgData,
      status: 'sending'
    };
    socket.emit('send_message', newMsg);
  }, [currentUser]);

  const handleUpdateProfile = useCallback((name, avatar) => {
    if (!currentUser) return;
    socket.emit('update_profile', { id: currentUser.id, name, avatar });
    setCurrentUser(prev => ({ ...prev, name, avatar }));
  }, [currentUser]);

  const contactsWithMetadata = useMemo(() => contacts.map(contact => {
    const allContactMessages = messagesMap[contact.id] || [];
    // Filter out messages deleted for current user
    const contactMessages = allContactMessages.filter(m => {
      const deletedBy = Array.isArray(m.deletedBy) ? m.deletedBy : [];
      return !deletedBy.includes(currentUser?.id?.toString());
    });
    const lastMsg = contactMessages[contactMessages.length - 1];
    const unreadCount = contactMessages.filter(m => m.senderId.toString() === contact.id.toString() && m.status !== 'read').length;
    return {
      ...contact,
      lastMessage: lastMsg
        ? (lastMsg.isMedia
          ? (lastMsg.mediaType === 'image' ? '📷 Fotoğraf'
            : lastMsg.mediaType === 'video' ? '🎥 Video'
            : lastMsg.mediaType === 'audio' ? '🎤 Ses'
            : '📁 Dosya')
          : lastMsg.text)
        : '',
      time: lastMsg ? lastMsg.timestamp : '',
      unread: unreadCount,
      lastMessageAt: lastMsg ? lastMsg.createdAt : 0
    };
  }).sort((a, b) => b.lastMessageAt - a.lastMessageAt), [contacts, messagesMap, currentUser?.id]);

  if (isInitializing) return <div className="loading-screen">EEMessage Başlatılıyor...</div>;
  if (!currentUser) return <Auth onLogin={setCurrentUser} />;
  if (window.location.hash === '#/admin') return <AdminPanel />;
  // Show permission setup screen on native APK (only once after first install)
  if (!permissionsReady) return <PermissionSetup onDone={() => setPermissionsReady(true)} />;

  return (
    <div className={`app-container ${selectedContactId ? 'chat-active' : 'sidebar-active'}`}>
      <div className="sidebar-wrapper">
        <Sidebar
          currentUser={currentUser}
          contacts={contactsWithMetadata}
          onSelectContact={setSelectedContactId}
          selectedContactId={selectedContactId}
          toggleTheme={toggleTheme}
          theme={theme}
          onLogout={() => {
            localStorage.removeItem('eemessage_token');
            socket.disconnect();
            setContacts([]);
            setMessagesMap({});
            setSelectedContactId(null);
            setCurrentUser(null);
          }}
          onUpdateProfile={handleUpdateProfile}
          messagesMap={messagesMap}
        />
      </div>

      <div className="chatarea-wrapper">
        <ChatArea
          currentUser={currentUser}
          contact={contacts.find(c => c.id.toString() === selectedContactId?.toString())}
          messages={selectedContactId
            ? (messagesMap[selectedContactId] || []).filter(m => {
                const deletedBy = Array.isArray(m.deletedBy) ? m.deletedBy : [];
                return !deletedBy.includes(currentUser.id.toString());
              })
            : []}
          socket={socket}
          onSendMessage={handleSendMessage}
          onDeleteMessage={(id) => socket.emit('delete_message', id)}
          onDeleteForMe={(id) => socket.emit('delete_for_me', { messageId: id, userId: currentUser.id })}
          onClearChat={(id) => { if(window.confirm('Bu sohbeti temizlemek istediğinize emin misiniz?')) socket.emit('clear_chat', id) }}
          onBack={() => setSelectedContactId(null)}
          onStartCall={(type) => callManagerRef.current?.startCall(selectedContactId, type)}
          onAudioPlayed={(messageId, senderId) => {
            socket.emit('update_message_status', { messageId, status: 'read', senderId });
          }}
        />
      </div>

      <CallManager
        ref={callManagerRef}
        socket={socket}
        currentUser={currentUser}
        contacts={contacts}
      />

      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
}

export default App;
