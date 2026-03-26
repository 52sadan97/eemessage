import { useState } from 'react';
import { API_URL, getMediaUrl } from '../config';
import { X, Camera, User, Lock, Loader } from 'lucide-react';
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import './ProfileModal.css';

// Capacitor ortamında mı çalışıyoruz?
const isNative = () => {
  return window?.Capacitor?.isNativePlatform?.() === true;
};

const ProfileModal = ({ isOpen, onClose, currentUser, onSave }) => {
  const [name, setName] = useState(currentUser?.name || '');
  const [avatar, setAvatar] = useState(currentUser?.avatar || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  // ====== APK: Capacitor Camera API ======
  const handleAvatarNative = async (source) => {
    try {
      const photo = await CapCamera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source,
        width: 512,
        height: 512,
        correctOrientation: true,
      });

      if (!photo.dataUrl) return;

      // dataUrl → Blob → FormData → upload
      const res = await fetch(photo.dataUrl);
      const blob = await res.blob();
      const formData = new FormData();
      formData.append('isAvatar', 'true');
      formData.append('file', blob, 'profil.jpg');

      setLoading(true);
      const uploadRes = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!uploadRes.ok) throw new Error(`HTTP ${uploadRes.status}`);
      const data = await uploadRes.json();
      if (data.url) setAvatar(data.url);
    } catch (err) {
      if (err?.message !== 'User cancelled photos app') {
        console.error('Avatar upload error:', err);
        alert('Fotoğraf yüklenemedi: ' + (err?.message || err));
      }
    } finally {
      setLoading(false);
    }
  };

  // ====== Web: Klasik file input ======
  const handleAvatarWeb = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('isAvatar', 'true');
    formData.append('file', file);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.url) setAvatar(data.url);
    } catch (err) {
      console.error('Upload Error:', err.message);
      alert('Fotoğraf yüklenemedi.');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  // Avatar tıklandığında: APK'da seçim menüsü, web'de file picker
  const handleAvatarClick = () => {
    if (isNative()) {
      // APK: Kamera mı Galeri mi seç
      const sheet = document.createElement('div');
      sheet.style.cssText = `
        position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);
        display:flex;align-items:flex-end;
      `;
      sheet.innerHTML = `
        <div style="background:var(--bg-secondary,#1e2a38);border-radius:16px 16px 0 0;width:100%;padding:20px;display:flex;flex-direction:column;gap:12px;">
          <p style="margin:0 0 8px;font-weight:600;color:var(--text-primary,#fff);font-size:16px;">Profil Fotoğrafı</p>
          <button id="cap-camera" style="padding:14px;border:none;border-radius:10px;background:var(--brand-color,#00bfa5);color:#fff;font-size:15px;cursor:pointer;">📷 Kamera ile Çek</button>
          <button id="cap-gallery" style="padding:14px;border:none;border-radius:10px;background:var(--input-bg,#2a3a4a);color:var(--text-primary,#fff);font-size:15px;cursor:pointer;">🖼️ Galeriden Seç</button>
          <button id="cap-cancel" style="padding:14px;border:none;border-radius:10px;background:transparent;color:var(--text-secondary,#aaa);font-size:15px;cursor:pointer;">İptal</button>
        </div>
      `;
      document.body.appendChild(sheet);

      sheet.querySelector('#cap-camera').onclick = () => {
        document.body.removeChild(sheet);
        handleAvatarNative(CameraSource.Camera);
      };
      sheet.querySelector('#cap-gallery').onclick = () => {
        document.body.removeChild(sheet);
        handleAvatarNative(CameraSource.Photos);
      };
      sheet.querySelector('#cap-cancel').onclick = () => document.body.removeChild(sheet);
      sheet.onclick = (e) => { if (e.target === sheet) document.body.removeChild(sheet); };
    } else {
      // Web: klasik file input
      document.getElementById('avatar-file-web')?.click();
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
        body: JSON.stringify({ id: currentUser.id, name, avatar, currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Güncelleme başarısız.');
      onSave(data.user?.name || name, data.user?.avatar || avatar);
      onClose();
    } catch (err) {
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
            <div className="avatar-wrapper-edit" onClick={handleAvatarClick} style={{ cursor: 'pointer' }}>
              {loading ? (
                <div className="avatar-large" style={{ display:'flex', alignItems:'center', justifyContent:'center', background:'var(--input-bg)' }}>
                  <Loader className="spin" size={32} />
                </div>
              ) : (
                <img src={getMediaUrl(avatar) || 'https://via.placeholder.com/150'} alt="Avatar" className="avatar-large" />
              )}
              <div className="avatar-overlay"><Camera size={24} color="white" /></div>
            </div>
            {/* Web için gizli file input */}
            <input
              id="avatar-file-web"
              type="file"
              style={{ display: 'none' }}
              onChange={handleAvatarWeb}
              accept="image/*"
            />
            <p className="help-text">Tıklayarak yeni bir profil fotoğrafı yükleyin</p>
          </div>

          <div className="input-group profile-input">
            <User className="input-icon" size={20} />
            <input type="text" placeholder="Görünen Adınız" value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <p className="help-text" style={{ marginTop: '10px', textAlign: 'left', fontWeight: 'bold' }}>Şifre Güncelleme (Geçerli Doğrulama)</p>
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
