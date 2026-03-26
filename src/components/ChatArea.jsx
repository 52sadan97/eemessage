import { useRef, useEffect, useState } from 'react';
import { API_URL, getMediaUrl } from '../config';
import { Search, MoreVertical, Paperclip, Smile, Mic, Square, Send, ChevronDown, Check, CheckCheck, ArrowLeft, Phone, Video, Camera, FileText, Download, X } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import './ChatArea.css';

const ChatArea = ({ contact, messages, currentUser, onSendMessage, onDeleteMessage, onDeleteForMe, onClearChat, onBack, onStartCall, onAudioPlayed }) => {
  const [inputText, setInputText] = useState("");
  const [activeMsgOptions, setActiveMsgOptions] = useState(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [recordingTimer, setRecordingTimer] = useState(0);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [videoTimer, setVideoTimer] = useState(0);
  const [facingMode, setFacingMode] = useState('environment');
  const endOfMessagesRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const emojiPickerRef = useRef(null);
  const videoRecorderRef = useRef(null);
  const videoChunksRef = useRef([]);
  const videoPreviewRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const videoTimerRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const recCancelledRef = useRef(false);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView();
  }, [messages]);

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
    };
    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker]);

  const handleEmojiClick = (emojiData) => {
    setInputText(prev => prev + emojiData.emoji);
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage({ text: inputText, receiverId: contact.id });
    setInputText("");
    setShowEmojiPicker(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        if (recCancelledRef.current) {
          recCancelledRef.current = false;
          return; // İptal edildi, gönderme
        }
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('file', audioBlob, 'ses_mesaji.webm');
        try {
          const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
          const data = await res.json();
          if (data.url) onSendMessage({ text: '', receiverId: contact.id, isMedia: true, mediaUrl: data.url, mediaType: 'audio' });
        } catch(err) { console.error(err); }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTimer(0);
      recCancelledRef.current = false;
      recordingTimerRef.current = setInterval(() => setRecordingTimer(p => p + 1), 1000);
    } catch(err) {
      alert("Mikrofon izni alınamadı!");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      setIsRecording(false);
      setRecordingTimer(0);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    }
  };

  const cancelRecording = () => {
    recCancelledRef.current = true;
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    setIsRecording(false);
    setRecordingTimer(0);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) {
        const fileName = data.originalName || file.name;
        const displayText = ['image', 'video', 'audio'].includes(data.type) ? '' : `📎 ${fileName}`;
        onSendMessage({ text: displayText, receiverId: contact.id, isMedia: true, mediaUrl: data.url, mediaType: data.type });
      }
    } catch(err) {
      alert('Dosya yüklenemedi');
    } finally {
      e.target.value = ''; 
    }
  };

  // ===== WhatsApp-style Camera =====
  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode }, 
        audio: true 
      });
      cameraStreamRef.current = stream;
      setIsCameraOpen(true);
      setTimeout(() => {
        if (videoPreviewRef.current) videoPreviewRef.current.srcObject = stream;
      }, 50);
    } catch(err) {
      console.error('Kamera hatası:', err);
      alert('Kamera izni alınamadı!');
    }
  };

  const closeCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null; }
    setIsCameraOpen(false);
    setIsVideoRecording(false);
    setVideoTimer(0);
  };

  const switchCamera = async () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: newMode }, audio: true });
      cameraStreamRef.current = stream;
      if (videoPreviewRef.current) videoPreviewRef.current.srcObject = stream;
    } catch(err) {
      console.error('Kamera değiştirme hatası:', err);
    }
  };

  const takePhoto = () => {
    if (!videoPreviewRef.current) return;
    const canvas = document.createElement('canvas');
    const video = videoPreviewRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
      const formData = new FormData();
      formData.append('file', blob, 'kamera_foto.jpg');
      try {
        const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.url) onSendMessage({ text: '', receiverId: contact.id, isMedia: true, mediaUrl: data.url, mediaType: 'image' });
      } catch(err) { console.error(err); }
      closeCamera();
    }, 'image/jpeg', 0.9);
  };

  const startVideoRec = () => {
    if (!cameraStreamRef.current) return;
    const recorder = new MediaRecorder(cameraStreamRef.current);
    videoRecorderRef.current = recorder;
    videoChunksRef.current = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      const blob = new Blob(videoChunksRef.current, { type: 'video/webm' });
      const formData = new FormData();
      formData.append('file', blob, 'kamera_video.webm');
      try {
        const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.url) onSendMessage({ text: '', receiverId: contact.id, isMedia: true, mediaUrl: data.url, mediaType: 'video' });
      } catch(err) { console.error(err); }
      closeCamera();
    };
    recorder.start();
    setIsVideoRecording(true);
    setVideoTimer(0);
    videoTimerRef.current = setInterval(() => setVideoTimer(p => p + 1), 1000);
  };

  const stopVideoRec = () => {
    if (videoRecorderRef.current && isVideoRecording) {
      videoRecorderRef.current.stop();
      if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null; }
      setIsVideoRecording(false);
      setVideoTimer(0);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Handle audio play event — mark as "read" for the sender
  const handleAudioPlay = (msg) => {
    if (!msg.deleted && msg.senderId !== currentUser.id && msg.status !== 'read') {
      if (onAudioPlayed) onAudioPlayed(msg.id, msg.senderId);
    }
  };

  if (!contact) {
    return (
      <div className="chat-empty-state">
        <div className="empty-state-content glass">
          <h2>EEMessage Web'e Hoş Geldiniz</h2>
          <p>Mesaj gönderip almak için sol taraftan veya "Sohbet Ekle" menüsünden bir kişi seçin.</p>
          <div className="encryption-notice">🔒 Uçtan uca şifrelenmiştir</div>
        </div>
      </div>
    );
  }

  const renderStatusTicks = (status) => {
    if(status === 'read') return <CheckCheck size={14} color="#53bdeb" strokeWidth={3} />;
    if(status === 'delivered') return <CheckCheck size={14} color="var(--text-secondary)" strokeWidth={3} />;
    return <Check size={14} color="var(--text-secondary)" strokeWidth={3} />; 
  };

  return (
    <div className="chat-area" onClick={() => { setActiveMsgOptions(null); setShowEmojiPicker(false); }}>
      <div className="chat-header">
        <div className="chat-header-info">
          <button className="icon-btn back-btn mobile-only" onClick={onBack}>
            <ArrowLeft size={24} />
          </button>
          <img 
            src={getMediaUrl(contact.avatar)} 
            alt={contact.name} 
            className="avatar clickable-avatar" 
            onClick={() => setAvatarPreview({ src: getMediaUrl(contact.avatar), name: contact.name })}
            title="Profil fotoğrafını büyüt"
          />
          <div className="contact-status">
            <h3>{contact.name}</h3>
            <span>{contact.online ? "Çevrimiçi" : "Çevrimdışı"}</span>
          </div>
        </div>
        <div className="chat-header-actions">
          <button className="call-header-btn" onClick={() => onStartCall && onStartCall(contact.id, 'audio')} title="Sesli Arama">
            <Phone size={20} />
          </button>
          <button className="call-header-btn" onClick={() => onStartCall && onStartCall(contact.id, 'video')} title="Görüntülü Arama">
            <Video size={20} />
          </button>
          <button className="icon-btn"><Search size={20} /></button>
          <div className="dropdown-container">
            <button className="icon-btn" onClick={(e) => {e.stopPropagation(); setIsDropdownOpen(!isDropdownOpen)}} title="Menü">
              <MoreVertical size={20} />
            </button>
            {isDropdownOpen && (
              <div className="dropdown-menu">
                <button onClick={() => { setIsDropdownOpen(false); onClearChat(contact.id); }}>Sohbeti Temizle</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="chat-messages" onTouchStart={() => {}} >
        {messages.map((msg) => {
          const isSent = msg.senderId.toString() === currentUser.id.toString();
          return (
            <div key={msg.id} className={`message-row ${isSent ? 'sent' : 'received'}`}>
              <div 
                className={`message-bubble ${isSent ? 'sent-bubble' : 'received-bubble'} ${msg.deleted ? 'deleted-bubble' : ''}`}
                onMouseEnter={() => setActiveMsgOptions(msg.id)}
                onMouseLeave={() => setActiveMsgOptions(null)}
                onTouchStart={(e) => {
                  const timer = setTimeout(() => {
                    setActiveMsgOptions(msg.id);
                    if (navigator.vibrate) navigator.vibrate(30);
                  }, 500);
                  e.currentTarget._longPressTimer = timer;
                }}
                onTouchEnd={(e) => {
                  if (e.currentTarget._longPressTimer) clearTimeout(e.currentTarget._longPressTimer);
                }}
                onTouchMove={(e) => {
                  if (e.currentTarget._longPressTimer) clearTimeout(e.currentTarget._longPressTimer);
                }}
              >
                {msg.isMedia && !msg.deleted ? (
                  msg.mediaType === 'video' ? <video className="message-media" controls src={getMediaUrl(msg.mediaUrl)} />
                  : msg.mediaType === 'audio' ? (
                    <audio 
                      className="message-audio" 
                      controls 
                      src={getMediaUrl(msg.mediaUrl)} 
                      onPlay={() => {
                        if (!isSent && msg.status !== 'read') onAudioPlayed?.(msg.id, msg.senderId);
                      }}
                    />
                  )
                  : msg.mediaType === 'image' ? <img className="message-media" src={getMediaUrl(msg.mediaUrl)} alt="medya" />
                  : (
                    /* PDF, document, archive, etc. */
                    <a href={getMediaUrl(msg.mediaUrl)} target="_blank" rel="noopener noreferrer" className="file-attachment" download>
                      <FileText size={32} />
                      <div className="file-info">
                        <span className="file-name">{msg.text || 'Dosya'}</span>
                        <span className="file-action"><Download size={14} /> İndir</span>
                      </div>
                    </a>
                  )
                ) : null}
                
                <span className="message-text" style={{ fontStyle: msg.deleted ? 'italic' : 'normal', color: msg.deleted ? 'var(--text-secondary)' : 'inherit' }}>
                  {msg.text}
                  {isSent && <span style={{display: 'inline-block', width: '60px', height: '10px'}}></span>}
                </span>

                <span className="message-meta">
                  {msg.timestamp}
                  {isSent && !msg.deleted && <span className="read-ticks">{renderStatusTicks(msg.status)}</span>}
                </span>

                {/* Msg Options — long press on mobile, hover on desktop */}
                {!msg.deleted && activeMsgOptions === msg.id && (
                  <>
                    <div className="msg-options-backdrop" onClick={() => setActiveMsgOptions(null)} onTouchEnd={() => setActiveMsgOptions(null)}></div>
                    <div className="msg-options-wrapper" onClick={(e) => e.stopPropagation()}>
                      <div className="msg-dropdown">
                         {isSent && <button onClick={() => { onDeleteMessage(msg.id); setActiveMsgOptions(null); }}>🗑️ Herkesten Sil</button>}
                         <button onClick={() => { onDeleteForMe(msg.id); setActiveMsgOptions(null); }}>🚫 Benden Sil</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endOfMessagesRef} />
      </div>

      <form className="chat-input-area" onSubmit={handleSend} onClick={(e) => e.stopPropagation()}>

        {/* Emoji Picker */}
        <div style={{ position: 'relative' }} ref={emojiPickerRef}>
          <button type="button" className="icon-btn" onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(prev => !prev); }}>
            <Smile size={24} />
          </button>
          {showEmojiPicker && (
            <div className="emoji-picker-container" onClick={(e) => e.stopPropagation()}>
              <EmojiPicker 
                onEmojiClick={handleEmojiClick} 
                width={320} 
                height={400}
                searchDisabled={false}
                skinTonesDisabled
                previewConfig={{ showPreview: false }}
              />
            </div>
          )}
        </div>

        <input type="file" style={{display: 'none'}} ref={fileInputRef} onChange={handleFileUpload} accept="*" />
        <button type="button" className="icon-btn" onClick={() => fileInputRef.current?.click()} title="Dosya Gönder">
          <Paperclip size={24} />
        </button>
        <button type="button" className="icon-btn" onClick={openCamera} title="Kamera">
          <Camera size={24} />
        </button>
        
        {isRecording ? (
          <div className="recording-bar">
            <button type="button" className="rec-cancel" onClick={cancelRecording} title="İptal">
              <X size={20} />
            </button>
            <div className="rec-pulse"></div>
            <span className="rec-timer">{Math.floor(recordingTimer / 60).toString().padStart(2, '0')}:{(recordingTimer % 60).toString().padStart(2, '0')}</span>
            <div className="rec-wave">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
            <button type="button" className="rec-send" onClick={stopRecording} title="Gönder">
              <Send size={20} />
            </button>
          </div>
        ) : (
          <>
            <input type="text" placeholder="Bir mesaj yazın" value={inputText} onChange={(e) => setInputText(e.target.value)} />
            {inputText.trim() ? (
              <button type="submit" className="icon-btn send-btn"><Send size={24} /></button>
            ) : (
              <button type="button" className="icon-btn mic-btn" onClick={startRecording} title="Ses Kaydet">
                <Mic size={24} />
              </button>
            )}
          </>
        )}
      </form>

      {/* WhatsApp-style Fullscreen Camera */}
      {isCameraOpen && (
        <div className="camera-fullscreen">
          <video ref={videoPreviewRef} autoPlay playsInline muted className="camera-preview" />
          
          {/* Top bar */}
          <div className="camera-top-bar">
            <button className="camera-btn" onClick={closeCamera}><X size={28} /></button>
            {isVideoRecording && (
              <div className="camera-rec-badge">
                <div className="rec-pulse"></div>
                <span>{Math.floor(videoTimer / 60).toString().padStart(2, '0')}:{(videoTimer % 60).toString().padStart(2, '0')}</span>
              </div>
            )}
            <button className="camera-btn" onClick={switchCamera}>🔄</button>
          </div>

          {/* Bottom controls */}
          <div className="camera-bottom-bar">
            <span className="camera-hint">{isVideoRecording ? 'Bırakarak gönder' : 'Fotoğraf çek · Basılı tut = Video'}</span>
            <div className="camera-shutter-wrapper">
              <button 
                className={`camera-shutter ${isVideoRecording ? 'recording' : ''}`}
                onClick={!isVideoRecording ? takePhoto : undefined}
                onTouchStart={!isVideoRecording ? (e) => { e.preventDefault(); const t = setTimeout(startVideoRec, 400); e.currentTarget._holdTimer = t; } : undefined}
                onTouchEnd={isVideoRecording ? stopVideoRec : (e) => { if (e.currentTarget._holdTimer) clearTimeout(e.currentTarget._holdTimer); }}
                onMouseDown={!isVideoRecording ? () => { const t = setTimeout(startVideoRec, 400); document._holdTimer = t; } : undefined}
                onMouseUp={isVideoRecording ? stopVideoRec : () => { if (document._holdTimer) clearTimeout(document._holdTimer); }}
              >
                {isVideoRecording ? <Square size={32} style={{color: '#fff'}} /> : <div className="shutter-inner"></div>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Avatar Lightbox */}
      {avatarPreview && (
        <div className="avatar-lightbox" onClick={() => setAvatarPreview(null)}>
          <button className="lightbox-close" onClick={() => setAvatarPreview(null)}>
            <X size={28} />
          </button>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={avatarPreview.src} alt={avatarPreview.name} className="lightbox-image" />
            <span className="lightbox-name">{avatarPreview.name}</span>
          </div>
        </div>
      )}
    </div>
  );
};
export default ChatArea;
