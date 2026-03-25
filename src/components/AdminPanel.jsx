import { useState, useEffect, useCallback } from 'react';
import { API_URL, getMediaUrl } from '../config';
import { Users, MessageSquare, BarChart3, Trash2, Plus, LogOut, Search, Image, Shield, ArrowLeft, Eye } from 'lucide-react';
import './AdminPanel.css';

const AdminPanel = ({ onBack }) => {
  const [token, setToken] = useState(localStorage.getItem('admin_token') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState({});
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [selectedUser, setSelectedUser] = useState('');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [newUserForm, setNewUserForm] = useState({ name: '', email: '', password: '' });
  const [showNewUser, setShowNewUser] = useState(false);
  const [loading, setLoading] = useState(false);

  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/stats`, { headers });
      if (res.ok) setStats(await res.json());
    } catch(e) {}
  }, [token]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/users`, { headers });
      if (res.ok) setUsers(await res.json());
    } catch(e) {}
  }, [token]);

  const fetchMessages = useCallback(async (userId = '') => {
    try {
      const url = userId 
        ? `${API_URL}/api/admin/messages?userId=${userId}&limit=50`
        : `${API_URL}/api/admin/messages?limit=50`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages);
        setTotalMessages(data.total);
      }
    } catch(e) {}
  }, [token]);

  useEffect(() => {
    if (token) {
      fetch(`${API_URL}/api/admin/stats`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => { if (r.ok) setIsLoggedIn(true); else { setToken(''); localStorage.removeItem('admin_token'); }})
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      fetchStats();
      fetchUsers();
      fetchMessages();
    }
  }, [isLoggedIn]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      
      if (res.ok && data?.token) {
        setToken(data.token);
        localStorage.setItem('admin_token', data.token);
        setIsLoggedIn(true);
      } else if (data?.error) {
        alert(data.error);
      } else {
        alert(`Sunucu hatası (${res.status}): API endpoint bulunamadı. Sunucu rebuild yapıldığından emin olun.`);
        console.error('Admin login response:', res.status, text.substring(0, 200));
      }
    } catch(e) {
      alert(`Bağlantı hatası: ${e.message}\nAPI URL: ${API_URL}/api/admin/login`);
      console.error('Admin login error:', e);
    }
    setLoading(false);
  };

  const handleLogout = () => {
    setToken('');
    localStorage.removeItem('admin_token');
    setIsLoggedIn(false);
    if (onBack) onBack();
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/admin/users`, {
        method: 'POST', headers, body: JSON.stringify(newUserForm)
      });
      const data = await res.json();
      if (res.ok) {
        setNewUserForm({ name: '', email: '', password: '' });
        setShowNewUser(false);
        fetchUsers();
        fetchStats();
      } else { alert(data.error); }
    } catch(e) { alert('Hata'); }
  };

  const handleDeleteUser = async (id, name) => {
    if (!window.confirm(`"${name}" kullanıcısını ve tüm mesajlarını silmek istediğinize emin misiniz?`)) return;
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${id}`, { method: 'DELETE', headers });
      if (res.ok) { fetchUsers(); fetchStats(); fetchMessages(); }
    } catch(e) { alert('Hata'); }
  };

  const handleDeleteMessage = async (id) => {
    if (!window.confirm('Bu mesajı kalıcı olarak silmek istediğinize emin misiniz?')) return;
    try {
      const res = await fetch(`${API_URL}/api/admin/messages/${id}`, { method: 'DELETE', headers });
      if (res.ok) { fetchMessages(selectedUser); fetchStats(); }
    } catch(e) { alert('Hata'); }
  };

  const formatDate = (ts) => {
    if (!ts) return '-';
    const d = new Date(typeof ts === 'number' ? ts : parseInt(ts));
    return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  };

  // Admin Login Screen
  if (!isLoggedIn) {
    return (
      <div className="admin-login-container">
        <div className="admin-login-card">
          <div className="admin-login-header">
            <Shield size={48} />
            <h2>Admin Paneli</h2>
            <p>EEMessage Yönetim Merkezi</p>
          </div>
          <form onSubmit={handleLogin}>
            <input type="email" placeholder="Admin E-posta" value={loginForm.email} onChange={e => setLoginForm({...loginForm, email: e.target.value})} required />
            <input type="password" placeholder="Şifre" value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})} required />
            <button type="submit" disabled={loading}>{loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}</button>
          </form>
          {onBack && <button className="admin-back-btn" onClick={onBack}><ArrowLeft size={18} /> Uygulamaya Dön</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="admin-container">
      {/* Sidebar */}
      <div className="admin-sidebar">
        <div className="admin-logo">
          <Shield size={28} />
          <span>EEMessage Admin</span>
        </div>
        <nav className="admin-nav">
          <button className={activeTab === 'dashboard' ? 'active' : ''} onClick={() => setActiveTab('dashboard')}>
            <BarChart3 size={20} /> Kontrol Paneli
          </button>
          <button className={activeTab === 'users' ? 'active' : ''} onClick={() => { setActiveTab('users'); fetchUsers(); }}>
            <Users size={20} /> Kullanıcılar
          </button>
          <button className={activeTab === 'messages' ? 'active' : ''} onClick={() => { setActiveTab('messages'); fetchMessages(); setSelectedUser(''); }}>
            <MessageSquare size={20} /> Mesajlar
          </button>
        </nav>
        <button className="admin-logout" onClick={handleLogout}>
          <LogOut size={20} /> Çıkış Yap
        </button>
      </div>

      {/* Content */}
      <div className="admin-content">
        {/* Dashboard */}
        {activeTab === 'dashboard' && (
          <div className="admin-page">
            <h1>📊 Kontrol Paneli</h1>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon users"><Users size={28} /></div>
                <div className="stat-info">
                  <span className="stat-value">{stats.totalUsers || 0}</span>
                  <span className="stat-label">Toplam Kullanıcı</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon messages"><MessageSquare size={28} /></div>
                <div className="stat-info">
                  <span className="stat-value">{stats.totalMessages || 0}</span>
                  <span className="stat-label">Toplam Mesaj</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon media"><Image size={28} /></div>
                <div className="stat-info">
                  <span className="stat-value">{stats.totalMedia || 0}</span>
                  <span className="stat-label">Medya Dosyası</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon online"><div className="online-dot"></div></div>
                <div className="stat-info">
                  <span className="stat-value">{stats.onlineUsers || 0}</span>
                  <span className="stat-label">Çevrimiçi</span>
                </div>
              </div>
            </div>
            <div className="stat-card today-card">
              <span>📅 Bugünkü Mesajlar</span>
              <span className="stat-value">{stats.todayMessages || 0}</span>
            </div>
          </div>
        )}

        {/* Users */}
        {activeTab === 'users' && (
          <div className="admin-page">
            <div className="admin-page-header">
              <h1>👥 Kullanıcılar</h1>
              <button className="admin-primary-btn" onClick={() => setShowNewUser(!showNewUser)}>
                <Plus size={18} /> Yeni Kullanıcı
              </button>
            </div>

            {showNewUser && (
              <form className="new-user-form" onSubmit={handleCreateUser}>
                <input placeholder="Ad Soyad" value={newUserForm.name} onChange={e => setNewUserForm({...newUserForm, name: e.target.value})} required />
                <input type="email" placeholder="E-posta" value={newUserForm.email} onChange={e => setNewUserForm({...newUserForm, email: e.target.value})} required />
                <input type="password" placeholder="Şifre" value={newUserForm.password} onChange={e => setNewUserForm({...newUserForm, password: e.target.value})} required />
                <div className="form-actions">
                  <button type="submit" className="admin-primary-btn">Oluştur</button>
                  <button type="button" className="admin-cancel-btn" onClick={() => setShowNewUser(false)}>İptal</button>
                </div>
              </form>
            )}

            <div className="admin-table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Avatar</th>
                    <th>İsim</th>
                    <th>E-posta</th>
                    <th>Durum</th>
                    <th>Mesaj</th>
                    <th>Son Görülme</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td><img src={getMediaUrl(u.avatar)} alt="" className="admin-avatar" /></td>
                      <td className="user-name">{u.name}</td>
                      <td className="user-email">{u.email}</td>
                      <td><span className={`status-badge ${u.online ? 'online' : 'offline'}`}>{u.online ? 'Çevrimiçi' : 'Çevrimdışı'}</span></td>
                      <td>{u.messageCount}</td>
                      <td>{formatDate(u.lastSeen)}</td>
                      <td className="actions-cell">
                        <button className="icon-action view" onClick={() => { setActiveTab('messages'); setSelectedUser(u.id); fetchMessages(u.id); }} title="Mesajlarını Gör">
                          <Eye size={16} />
                        </button>
                        <button className="icon-action delete" onClick={() => handleDeleteUser(u.id, u.name)} title="Sil">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Messages */}
        {activeTab === 'messages' && (
          <div className="admin-page">
            <div className="admin-page-header">
              <h1>💬 Mesajlar {selectedUser && `(Filtreli)`}</h1>
              <span className="message-count">Toplam: {totalMessages}</span>
            </div>
            {selectedUser && (
              <button className="admin-cancel-btn" style={{marginBottom: 16}} onClick={() => { setSelectedUser(''); fetchMessages(); }}>
                ✕ Filtreyi Kaldır
              </button>
            )}
            <div className="admin-table-container">
              <table className="admin-table messages-table">
                <thead>
                  <tr>
                    <th>Gönderen</th>
                    <th>Alıcı</th>
                    <th>Mesaj</th>
                    <th>Tür</th>
                    <th>Tarih</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map(m => (
                    <tr key={m.id} className={m.deleted ? 'deleted-row' : ''}>
                      <td className="user-name">{m.senderName || m.senderId}</td>
                      <td className="user-name">{m.receiverName || m.receiverId}</td>
                      <td className="msg-cell">
                        {m.isMedia ? (
                          <span className="media-badge">
                            {m.mediaType === 'image' ? '🖼️' : m.mediaType === 'video' ? '🎥' : m.mediaType === 'audio' ? '🎵' : '📎'} {m.mediaType}
                          </span>
                        ) : (
                          <span className="msg-text-preview">{m.deleted ? '🚫 Silindi' : (m.text?.substring(0, 60) || '-')}{m.text?.length > 60 ? '...' : ''}</span>
                        )}
                      </td>
                      <td><span className={`type-badge ${m.isMedia ? 'media' : 'text'}`}>{m.isMedia ? 'Medya' : 'Metin'}</span></td>
                      <td className="date-cell">{m.timestamp}</td>
                      <td>
                        <button className="icon-action delete" onClick={() => handleDeleteMessage(m.id)} title="Sil">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPanel;
