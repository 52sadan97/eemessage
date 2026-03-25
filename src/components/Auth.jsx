import { useState } from 'react';
import { API_URL } from '../config';
import { Mail, Lock, User, ArrowRight, Loader } from 'lucide-react';
import './Auth.css';

const Auth = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        if (!formData.email || !formData.password) return alert('Lütfen tüm alanları doldurun.');
        const res = await fetch(`${API_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: formData.email, password: formData.password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Giriş başarısız.');
        
        localStorage.setItem('eemessage_token', data.token);
        onLogin(data.user);
      } else {
        if (!formData.name || !formData.email || !formData.password) return alert('Lütfen tüm alanları doldurun.');
        const res = await fetch(`${API_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Kayıt başarısız.');
        
        localStorage.setItem('eemessage_token', data.token);
        onLogin(data.user);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card glass">
        <div className="auth-header">
          <h2>EEMessage Web</h2>
          <p>{isLogin ? 'Hesabınıza giriş yapın' : 'Yeni bir hesap oluşturun'}</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {!isLogin && (
            <div className="input-group">
              <User className="input-icon" size={20} />
              <input 
                type="text" 
                placeholder="Ad Soyad" 
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
          )}
          <div className="input-group">
            <Mail className="input-icon" size={20} />
            <input 
              type="email" 
              placeholder="E-posta Adresi" 
              value={formData.email}
              onChange={e => setFormData({...formData, email: e.target.value})}
            />
          </div>
          <div className="input-group">
            <Lock className="input-icon" size={20} />
            <input 
              type="password" 
              placeholder="Şifre" 
              value={formData.password}
              onChange={e => setFormData({...formData, password: e.target.value})}
            />
          </div>

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? <Loader className="spin" size={18} /> : (isLogin ? 'Giriş Yap' : 'Kayıt Ol')}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            {isLogin ? "Hesabınız yok mu?" : "Zaten bir hesabınız var mı?"}
            <button className="toggle-auth-btn" type="button" onClick={() => setIsLogin(!isLogin)}>
              {isLogin ? "Kayıt Ol" : "Giriş Yap"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
