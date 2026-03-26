import { useState, useEffect } from 'react';

// Sadece native Capacitor ortamında çalışır
const isNative = () => window?.Capacitor?.isNativePlatform?.() === true;
const STORAGE_KEY = 'eemessage_permissions_asked';

const PERMISSIONS = [
  {
    id: 'camera',
    icon: '📷',
    title: 'Kamera',
    description: 'Görüntülü arama ve fotoğraf çekmek için gereklidir.',
    request: async () => {
      try {
        // Direct getUserMedia for camera — works in both web and WebView
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(t => t.stop());
        return true;
      } catch (err) {
        console.warn('[Permission] Camera denied:', err.name);
        return false;
      }
    },
  },
  {
    id: 'microphone',
    icon: '🎤',
    title: 'Mikrofon',
    description: 'Sesli arama ve ses mesajı göndermek için gereklidir.',
    request: async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        return true;
      } catch (err) {
        console.warn('[Permission] Microphone denied:', err.name);
        return false;
      }
    },
  },
  {
    id: 'notifications',
    icon: '🔔',
    title: 'Bildirimler',
    description: 'Yeni mesaj geldiğinde bildirim almak için gereklidir.',
    request: async () => {
      try {
        if (isNative()) {
          // For Android native — use Capacitor PushNotifications
          const { PushNotifications } = await import('@capacitor/push-notifications');
          const result = await PushNotifications.requestPermissions();
          return result.receive === 'granted';
        } else {
          // Web — browser Notification API
          if ('Notification' in window) {
            const perm = await Notification.requestPermission();
            return perm === 'granted';
          }
          return false;
        }
      } catch (err) {
        console.warn('[Permission] Notification denied:', err);
        return false;
      }
    },
  },
];

export default function PermissionSetup({ onDone }) {
  const [step, setStep] = useState(0);
  const [results, setResults] = useState({});
  const [requesting, setRequesting] = useState(false);

  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const asked = localStorage.getItem(STORAGE_KEY);
    if (asked) { onDone(); return; }
    // Show for both native and web (everyone needs permissions)
    setVisible(true);
  }, [onDone]);

  if (!visible) return null;

  const current = PERMISSIONS[step];

  const handleAllow = async () => {
    setRequesting(true);
    let granted = false;
    try { granted = await current.request(); } catch { granted = false; }
    setResults(prev => ({ ...prev, [current.id]: granted }));
    setRequesting(false);
    if (step + 1 < PERMISSIONS.length) {
      setStep(s => s + 1);
    } else {
      finish();
    }
  };

  const handleSkip = () => {
    setResults(prev => ({ ...prev, [current.id]: false }));
    if (step + 1 < PERMISSIONS.length) {
      setStep(s => s + 1);
    } else {
      finish();
    }
  };

  const finish = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
    onDone();
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* Progress dots */}
        <div style={styles.dots}>
          {PERMISSIONS.map((_, i) => (
            <div key={i} style={{ ...styles.dot, background: i === step ? 'var(--brand-color, #00bfa5)' : i < step ? '#4caf50' : 'rgba(255,255,255,0.2)' }} />
          ))}
        </div>

        <div style={styles.iconWrap}>{current.icon}</div>
        <h2 style={styles.title}>{current.title}</h2>
        <p style={styles.desc}>{current.description}</p>

        <div style={styles.stepInfo}>
          <span style={styles.stepLabel}>{step + 1} / {PERMISSIONS.length}</span>
        </div>

        <button
          style={{ ...styles.btn, ...styles.btnPrimary, opacity: requesting ? 0.7 : 1 }}
          onClick={handleAllow}
          disabled={requesting}
        >
          {requesting ? '⏳ Bekleniyor...' : '✅ İzin Ver'}
        </button>

        <button style={{ ...styles.btn, ...styles.btnSkip }} onClick={handleSkip} disabled={requesting}>
          Şimdilik Atla
        </button>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'var(--bg-primary, #0d1117)',
    zIndex: 99999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  card: {
    background: 'var(--bg-secondary, #161b22)',
    borderRadius: '20px',
    padding: '36px 28px',
    width: '100%',
    maxWidth: '380px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.07)',
  },
  dots: {
    display: 'flex',
    gap: '8px',
    marginBottom: '8px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    transition: 'background 0.3s',
  },
  iconWrap: {
    fontSize: '64px',
    lineHeight: 1,
    marginBottom: '4px',
  },
  title: {
    margin: 0,
    fontSize: '22px',
    fontWeight: 700,
    color: 'var(--text-primary, #fff)',
    textAlign: 'center',
  },
  desc: {
    margin: 0,
    fontSize: '14px',
    color: 'var(--text-secondary, #8b949e)',
    textAlign: 'center',
    lineHeight: 1.6,
  },
  stepInfo: {
    display: 'flex',
    gap: '8px',
  },
  stepLabel: {
    fontSize: '13px',
    color: 'var(--text-secondary, #8b949e)',
  },
  btn: {
    width: '100%',
    padding: '14px',
    borderRadius: '12px',
    border: 'none',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
  btnPrimary: {
    background: 'var(--brand-color, #00bfa5)',
    color: '#fff',
  },
  btnSkip: {
    background: 'transparent',
    color: 'var(--text-secondary, #8b949e)',
    fontSize: '14px',
  },
};
