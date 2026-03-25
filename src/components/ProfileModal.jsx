import { useState, useRef } from 'react';
import { API_URL, getMediaUrl } from '../config';
import { X, Camera, User, Lock, Loader } from 'lucide-react';
import './ProfileModal.css';

const ProfileModal = ({ isOpen, onClose, currentUser, onSave }) => {
  const [name, setName] = useState(currentUser?.name || '');
  const [avatar, setAvatar] = useState(currentUser?.avatar || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const formData = new FormData();
    formData.append('isAvatar', 'true');
    formData.append('file', file);
    setLoading(true);
    try {
       const res = await fetch(`${API_URL}/api/upload`, {
         method: 'POST', body: formData
       });
       if (!res.ok) {
         const errText = await res.text();
         throw new Error(errText || `HTTP ${res.status}`);
       }
       const data = await res.json();
       if (data.url) setAvatar(data.url);
    } catch(err) {
       console.error("Upload Error:", err.message);
    } finally {
       setLoading(false);
       e.target.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const token = localStorage.getItem('eemessage_token');
      const res = await fetch(`${API_URL}/api/auth/update_profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          id: currentUser.id, name, avatar, currentPassword, newPassword
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Güncelleme başarısız.");
      
      onSave(data.user?.name || name, data.user?.avatar || avatar); 
      onClose();
    } catch(err) {
       alert(err.message);
    } finally {
       setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content profile-modal glass" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Profili Yönet</h3>
          <button type="button" className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        
        <form onSubmit={handleSubmit} className="profile-form">
          <div className="avatar-preview-section">
            <div className="avatar-wrapper-edit" onClick={() => fileInputRef.current?.click()}>
               <img src={getMediaUrl(avatar) || 'https://via.placeholder.com/150'} alt="Avatar" className="avatar-large" />
               <div className="avatar-overlay"><Camera size={24} color="white" /></div>
            </div>
            <input type="file" style={{display: 'none'}} ref={fileInputRef} onChange={handleAvatarUpload} accept="image/*" />
            <p className="help-text">Tıklayarak yeni bir profil fotoğrafı yükleyin</p>
          </div>

          <div className="input-group profile-input">
            <User className="input-icon" size={20} />
            <input type="text" placeholder="Görünen Adınız" value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <p className="help-text" style={{marginTop: '10px', textAlign: 'left', fontWeight: 'bold'}}>Şifre Güncelleme (Geçerli Doğrulama)</p>
          <div className="input-group profile-input">
            <Lock className="input-icon" size={20} />
            <input type="password" placeholder="Mevcut Şifreniz (Gerekli)" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
          </div>
          <div className="input-group profile-input">
            <Lock className="input-icon" size={20} />
            <input type="password" placeholder="Yeni Şifre (İsteğe Bağlı)" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>

          <button type="submit" className="save-btn" disabled={loading}>
             {loading ? <Loader className="spin" size={18} /> : 'Değişiklikleri Kaydet'}
          </button>
        </form>
      </div>
    </div>
  );
};
export default ProfileModal;
