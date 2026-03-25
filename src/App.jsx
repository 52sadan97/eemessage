import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from './config';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import Auth from './components/Auth';
import CallManager from './components/CallManager';
import './App.css';

const socket = io(API_URL, { autoConnect: false });
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

  // Keep ref in sync with state
  useEffect(() => {
    selectedContactIdRef.current = selectedContactId;
  }, [selectedContactId]);

  // Helper: call mark-read API for a given contact
  const markChatAsRead = useCallback((contactId) => {
    if (!currentUser || !contactId) return;
    fetch(`${API_URL}/api/messages/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderId: contactId, receiverId: currentUser.id })
    }).catch(err => console.error('Mark-read API error:', err));
  }, [currentUser]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('eemessage_theme', theme);
  }, [theme]);

  useEffect(() => {
    if ("Notification" in window && Notification.permission !== "granted") {
      Notification.requestPermission();
    }
  }, []);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  useEffect(() => {
    const token = localStorage.getItem('eemessage_token');
    if (token) {
      fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        if (data.user) setCurrentUser(data.user);
        else localStorage.removeItem('eemessage_token');
      })
      .catch(() => setIsInitializing(false))
      .finally(() => setIsInitializing(false));
    } else {
      setIsInitializing(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      socket.connect();
      socket.emit('register_user', currentUser);

      socket.on('users_updated', (activeUsers) => {
        setContacts(activeUsers.filter(u => u.id !== currentUser.id));
      });

      socket.on('receive_message', (msg) => {
        setMessagesMap(prev => {
          const newMap = { ...prev };
          const contactId = msg.senderId.toString() === currentUser.id.toString() ? msg.receiverId.toString() : msg.senderId.toString();
          if (!newMap[contactId]) newMap[contactId] = [];
          if(!newMap[contactId].find(m => m.id === msg.id)) {
             newMap[contactId] = [...newMap[contactId], msg];
          } else {
             newMap[contactId] = newMap[contactId].map(m => m.id === msg.id ? msg : m);
          }
          return newMap;
        });

        if (msg.senderId !== currentUser.id) {
           const currentContact = selectedContactIdRef.current;
           const isChatFocused = !document.hidden && currentContact === msg.senderId.toString();
           if (isChatFocused) {
              // Use the mark-read API for persistent + socket-based sync
              markChatAsRead(msg.senderId.toString());
           } else {
              toast.info(`Yeni mesaj: ${msg.text || '📸 Medya'}`, { icon: '💬' });
              if ("Notification" in window && Notification.permission === 'granted') {
                 new Notification("EEMessage", { body: `Yeni mesaj: ${msg.text || '📸 Medya'}`, icon: "/pwa-192x192.svg", tag: msg.id, vibrate: [200, 100, 200] });
              }
              // Mark as delivered
              socket.emit('update_message_status', { messageId: msg.id, status: 'delivered', senderId: msg.senderId });
           }
        }
      });

      // Listen for bulk read acknowledgement from server
      socket.on('messages_read_bulk', ({ chatId, messageIds }) => {
        setMessagesMap(prev => {
          const newMap = { ...prev };
          if (newMap[chatId]) {
            newMap[chatId] = newMap[chatId].map(m => 
              messageIds.includes(m.id) ? { ...m, status: 'read' } : m
            );
          }
          return newMap;
        });
      });

      socket.on('message_status_changed', ({ messageId, status }) => {
         setMessagesMap(prev => {
           let updated = { ...prev };
           for(let cid in updated) {
              updated[cid] = updated[cid].map(m => m.id === messageId ? { ...m, status } : m);
           }
           return updated;
         });
      });

      socket.on('message_deleted', (data) => {
        setMessagesMap(prev => {
          const newMap = { ...prev };
          for (let contactId in newMap) {
            newMap[contactId] = newMap[contactId].map(msg => 
              msg.id === data.id ? { ...msg, deleted: true, text: data.text, isMedia: false, mediaUrl: null } : msg
            );
          }
          return newMap;
        });
      });
      
      socket.on('message_deleted_for_me', ({ messageId, userId }) => {
        setMessagesMap(prev => {
          const newMap = { ...prev };
          for (let contactId in newMap) {
            const arr = newMap[contactId].map(msg => {
               if(msg.id === messageId) {
                  const db = msg.deletedBy || [];
                  if(!db.includes(userId)) db.push(userId);
                  return {...msg, deletedBy: db};
               }
               return msg;
            });
            newMap[contactId] = arr;
          }
          return newMap;
        });
      });

      socket.on('chat_cleared', (clearedContactId) => {
        setMessagesMap(prev => {
          const newMap = { ...prev };
          if(newMap[clearedContactId]) {
            newMap[clearedContactId] = newMap[clearedContactId].map(m => {
               const db = m.deletedBy || [];
               if(!db.includes(currentUser.id.toString())) db.push(currentUser.id.toString());
               return {...m, deletedBy: db};
            });
          }
          // The soft-delete logic will hide these messages below
          return newMap;
        });
      });

      socket.on('chat_history', (history) => {
        setMessagesMap(() => {
          const map = {};
          history.forEach(msg => {
            const contactId = msg.senderId.toString() === currentUser.id.toString() ? msg.receiverId.toString() : msg.senderId.toString();
            if (!map[contactId]) map[contactId] = [];
            map[contactId].push(msg);
          });
          return map;
        });
      });

      return () => {
        socket.off('users_updated');
        socket.off('receive_message');
        socket.off('message_status_changed');
        socket.off('message_deleted');
        socket.off('message_deleted_for_me');
        socket.off('chat_history');
        socket.off('chat_cleared');
        socket.off('messages_read_bulk');
        socket.disconnect();
      };
    }
  }, [currentUser, markChatAsRead]);

  // When a chat is opened (selectedContactId changes), mark all unread messages as read
  useEffect(() => {
    if (selectedContactId && currentUser) {
      markChatAsRead(selectedContactId);
    }
  }, [selectedContactId, currentUser, markChatAsRead]);

  const handleSendMessage = (msgData) => {
    const newMsg = {
      id: Date.now().toString(),
      senderId: currentUser.id,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ...msgData
    };
    socket.emit('send_message', newMsg);
  };

  const handleUpdateProfile = (name, avatar) => {
    socket.emit('update_profile', { id: currentUser.id, name, avatar });
    setCurrentUser(prev => ({ ...prev, name, avatar }));
  };

  const handleLogout = () => {
    localStorage.removeItem('eemessage_token');
    socket.disconnect();
    setCurrentUser(null);
    setSelectedContactId(null);
  };

  if (isInitializing) return <div className="loader-screen">Yükleniyor...</div>;
  if (!currentUser) return <Auth onLogin={setCurrentUser} />;

  const selectedContact = contacts.find(c => c.id === selectedContactId);
  const rawMessages = selectedContactId ? (messagesMap[selectedContactId] || []) : [];
  
  // Filter out soft-deleted messages for current user
  const messages = rawMessages.filter(m => !(m.deletedBy || []).includes(currentUser.id.toString()));

  // Mobile App Container Logic
  return (
    <div className={`app-container ${selectedContactId ? 'chat-active' : 'sidebar-active'}`}>
      <ToastContainer position="top-right" autoClose={3000} theme={theme} />
      
      <div className="sidebar-wrapper">
        <Sidebar 
          contacts={contacts} 
          selectedContactId={selectedContactId}
          onSelectContact={setSelectedContactId}
          theme={theme}
          toggleTheme={toggleTheme}
          currentUser={currentUser}
          onUpdateProfile={handleUpdateProfile}
          onLogout={handleLogout}
        />
      </div>

      <div className="chatarea-wrapper">
        <ChatArea 
          contact={selectedContact} 
          messages={messages} 
          currentUser={currentUser}
          onSendMessage={handleSendMessage}
          onDeleteMessage={(id) => socket.emit('delete_message', id)}
          onDeleteForMe={(id) => socket.emit('delete_for_me', { messageId: id, userId: currentUser.id })}
          onClearChat={(id) => { if(window.confirm('Bu sohbeti temizlemek istediğinize emin misiniz?')) socket.emit('clear_chat', id) }}
          onBack={() => setSelectedContactId(null)}
          onStartCall={(contactId, type) => callManagerRef.current?.startCall(contactId, type)}
          onAudioPlayed={(messageId, senderId) => {
            socket.emit('update_message_status', { messageId, status: 'read', senderId });
          }}
        />
      </div>

      <CallManager ref={callManagerRef} socket={socket} currentUser={currentUser} contacts={contacts} />
    </div>
  );
}

export default App;
