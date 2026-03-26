import { useState, useEffect, useRef, useCallback } from 'react';
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
import './App.css';

const socket = io(API_URL, {
  autoConnect: false,
  transports: ['websocket'], // APK'da Polling sorun çıkarabilir, WebSocket'e zorluyoruz
  auth: { token: localStorage.getItem('eemessage_token') }
});
export { socket };

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('eemessage_theme') || 'light');
  const [contacts, setContacts] = useState([]);
  const [messagesMap, setMessagesMap] = useState({});
  const selectedContactIdRef = useRef(null);
  const callManagerRef = useRef(null);

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

  // Socket and App Listeners (Run when currentUser is available)
  useEffect(() => {
    if (!currentUser) return;

    if (!socket.connected) {
      socket.connect();
      socket.emit('register_user', currentUser);
    }

    const handleUsersUpdate = (activeUsers) => {
      console.log('Contacts updated:', activeUsers.length);
      setContacts(activeUsers.filter(u => u.id !== currentUser.id));
    };

    const handleReceiveMsg = (msg) => {
      setMessagesMap(prev => {
        const newMap = { ...prev };
        const contactId = msg.senderId.toString() === currentUser.id.toString() ? msg.receiverId.toString() : msg.senderId.toString();
        if (!newMap[contactId]) newMap[contactId] = [];
        if (!newMap[contactId].find(m => m.id === msg.id)) {
          newMap[contactId] = [...newMap[contactId], msg];
        } else {
          newMap[contactId] = newMap[contactId].map(m => m.id === msg.id ? msg : m);
        }
        return newMap;
      });

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
        const contactId = msg.senderId.toString() === currentUser.id.toString() ? msg.receiverId.toString() : msg.senderId.toString();
        if (!newMap[contactId]) newMap[contactId] = [];
        newMap[contactId].push(msg);
      });
      setMessagesMap(newMap);
    };

    socket.on('users_updated', handleUsersUpdate);
    socket.on('receive_message', handleReceiveMsg);
    socket.on('chat_history', handleChatHistory);

    // Capacitor App Event Listeners
    const stateListener = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && !socket.connected) {
        socket.connect();
        socket.emit('register_user', currentUser);
      }
    });

    const backListener = CapApp.addListener('backButton', () => {
      if (window.location.hash === '#/admin') { window.location.hash = ''; return; }
      if (selectedContactIdRef.current) setSelectedContactId(null);
      else CapApp.exitApp();
    });

    return () => {
      socket.off('users_updated', handleUsersUpdate);
      socket.off('receive_message', handleReceiveMsg);
      socket.off('chat_history', handleChatHistory);
      stateListener.remove();
      backListener.remove();
    };
  }, [currentUser]);

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

  const contactsWithMetadata = contacts.map(contact => {
    const contactMessages = messagesMap[contact.id] || [];
    const lastMsg = contactMessages[contactMessages.length - 1];
    const unreadCount = contactMessages.filter(m => m.senderId.toString() === contact.id.toString() && m.status !== 'read').length;
    return {
      ...contact,
      lastMessage: lastMsg ? (lastMsg.isMedia ? (lastMsg.mediaType === 'image' ? '📷 Fotoğraf' : (lastMsg.mediaType === 'video' ? '🎥 Video' : '📁 Dosya')) : lastMsg.text) : '',
      time: lastMsg ? lastMsg.timestamp : '',
      unread: unreadCount,
      lastMessageAt: lastMsg ? lastMsg.createdAt : 0
    };
  }).sort((a, b) => b.lastMessageAt - a.lastMessageAt);

  if (isInitializing) return <div className="loading-screen">EEMessage Başlatılıyor...</div>;
  if (!currentUser) return <Auth onLogin={setCurrentUser} />;
  if (window.location.hash === '#/admin') return <AdminPanel />;

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
            setCurrentUser(null);
            socket.disconnect();
          }}
          onUpdateProfile={handleUpdateProfile}
          messagesMap={messagesMap}
        />
      </div>

      <div className="chatarea-wrapper">
        <ChatArea
          currentUser={currentUser}
          contact={contacts.find(c => c.id.toString() === selectedContactId?.toString())}
          messages={selectedContactId ? (messagesMap[selectedContactId] || []) : []}
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
