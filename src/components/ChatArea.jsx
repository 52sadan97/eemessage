import { useRef, useEffect, useState } from 'react';
import { API_URL, getMediaUrl } from '../config';
import { 
  Send, Smile, Paperclip, Mic, X, MoreVertical, 
  Search, Phone, Video, ArrowLeft, 
  Reply, Camera, Check, 
  CheckCheck, Square, ChevronLeft, ChevronRight, FileText, Download
} from 'lucide-react';
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
  const [mediaViewerOpen, setMediaViewerOpen] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
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
    const scrollToBottom = () => endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
    scrollToBottom();
    window.addEventListener('resize', scrollToBottom);
    return () => window.removeEventListener('resize', scrollToBottom);
  }, [messages]);

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
    // Emojiyi sectikten sonra kapatmak icin (Opsiyonel ama user tavsiyesi)
    setShowEmojiPicker(false);
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
          return;
        }
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('file', audioBlob, 'ses_mesaji.webm');
        try {
          const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
          if (!res.ok) throw new Error('Sunucu hatası: ' + res.status);
          const data = await res.json();
          if (data.url) onSendMessage({ text: '', receiverId: contact.id, isMedia: true, mediaUrl: data.url, mediaType: 'audio' });
        } catch(err) { 
          console.error('[Upload] Audio failed:', err); 
          alert('Ses mesajı yüklenemedi: ' + err.message);
        }
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
      if (!res.ok) throw new Error('Sunucu hatası: ' + res.status);
      const data = await res.json();
      if (data.url) {
        const fileName = data.originalName || file.name;
        const displayText = ['image', 'video', 'audio'].includes(data.type) ? '' : `📎 ${fileName}`;
        onSendMessage({ text: displayText, receiverId: contact.id, isMedia: true, mediaUrl: data.url, mediaType: data.type });
      }
    } catch(err) {
      console.error('[Upload] File failed:', err);
      alert('Dosya yüklenemedi: ' + err.message);
    } finally {
      e.target.value = ''; 
    }
  };

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
          />
          <div className="contact-status">
            <h3>{contact.name}</h3>
            <span>{contact.online ? "Çevrimiçi" : "Çevrimdışı"}</span>
          </div>
        </div>
        <div className="chat-header-actions">
          <button className="call-header-btn" onClick={() => onStartCall && onStartCall(contact.id, 'audio')}><Phone size={20} /></button>
          <button className="call-header-btn" onClick={() => onStartCall && onStartCall(contact.id, 'video')}><Video size={20} /></button>
          <button className="icon-btn"><Search size={20} /></button>
          <div className="dropdown-container">
            <button className="icon-btn" onClick={(e) => {e.stopPropagation(); setIsDropdownOpen(!isDropdownOpen)}}><MoreVertical size={20} /></button>
            {isDropdownOpen && (
              <div className="dropdown-menu">
                <button onClick={() => { setIsDropdownOpen(false); onClearChat(contact.id); }}>Sohbeti Temizle</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="chat-messages">
        {messages.map((msg) => {
          const isSent = msg.senderId.toString() === currentUser.id.toString();
          return (
            <div key={msg.id} className={`message-row ${isSent ? 'sent' : 'received'}`}>
              <div 
                className={`message-bubble ${isSent ? 'sent-bubble' : 'received-bubble'} ${msg.deleted ? 'deleted-bubble' : ''}`}
                onMouseEnter={() => setActiveMsgOptions(msg.id)}
                onMouseLeave={() => setActiveMsgOptions(null)}
              >
                {msg.isMedia && !msg.deleted ? (
                  <div className="message-media" onClick={() => { setSelectedMedia(msg); setMediaViewerOpen(true); }}>
                    {msg.mediaType === 'video' ? <div className="media-overlay">▶</div> : null}
                    {msg.mediaType === 'image' ? <img src={getMediaUrl(msg.mediaUrl)} alt="medya" />
                    : msg.mediaType === 'video' ? <video src={getMediaUrl(msg.mediaUrl)} />
                    : msg.mediaType === 'audio' ? <audio controls src={getMediaUrl(msg.mediaUrl)} onPlay={() => { if (!isSent && msg.status !== 'read') onAudioPlayed?.(msg.id, msg.senderId); }} />
                    : <a href={getMediaUrl(msg.mediaUrl)} target="_blank" rel="noopener noreferrer" className="file-attachment" download><FileText size={32} /> {msg.text || 'Dosya'}</a>}
                  </div>
                ) : null}
                
                <span className="message-text">{msg.text}</span>
                <span className="message-meta">
                  {msg.timestamp}
                  {isSent && !msg.deleted && <span className="read-ticks">{renderStatusTicks(msg.status)}</span>}
                </span>

                {!msg.deleted && activeMsgOptions === msg.id && (
                  <div className="msg-options-wrapper">
                    <div className="msg-dropdown">
                         {isSent && <button onClick={() => { onDeleteMessage(msg.id); setActiveMsgOptions(null); }}>🗑️ Herkesten Sil</button>}
                         <button onClick={() => { onDeleteForMe(msg.id); setActiveMsgOptions(null); }}>🚫 Benden Sil</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endOfMessagesRef} />
      </div>

      <div className="chat-input-wrapper">
        {!isRecording ? (
          <>
            <form className="chat-input-area-v2" onSubmit={handleSend}>
              <div style={{ position: 'relative' }} ref={emojiPickerRef}>
                <button type="button" className="icon-btn-v2 emoji-btn-mobile" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
                  <Smile size={24} />
                </button>
                {showEmojiPicker && (
                  <div className="emoji-picker-container" style={{ position: 'absolute', bottom: '60px', left: '0', zIndex: 10000 }}>
                    <EmojiPicker onEmojiClick={handleEmojiClick} theme="dark" />
                  </div>
                )}
              </div>
              <input type="text" placeholder="Mesaj" value={inputText} onChange={(e) => setInputText(e.target.value)} />
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} style={{display:'none'}} accept="image/*,video/*,application/*" />
              <button type="button" className="icon-btn-v2" onClick={() => fileInputRef.current?.click()}>
                <Paperclip size={24} />
              </button>
              <button type="button" className="icon-btn-v2" onClick={openCamera}>
                <Camera size={24} />
              </button>
            </form>
            <div className="input-action-btn-wrapper">
               {inputText.trim() ? (
                 <button type="button" className="action-circle-btn send" onClick={handleSend}><Send size={24} /></button>
               ) : (
                 <button type="button" className="action-circle-btn mic" onClick={startRecording}><Mic size={24} /></button>
               )}
            </div>
          </>
        ) : (
          <div className="recording-bar-v2">
            <button type="button" className="rec-cancel-v2" onClick={cancelRecording}>
              <X size={22} />
            </button>
            <div className="rec-content-v2">
              <div className="rec-pulse-v2"></div>
              <span>{Math.floor(recordingTimer / 60).toString().padStart(2, '0')}:{(recordingTimer % 60).toString().padStart(2, '0')}</span>
            </div>
            <button type="button" className="rec-send-v2" onClick={stopRecording}>
              <Send size={22} />
            </button>
          </div>
        )}
      </div>

      {isCameraOpen && (
        <div className="camera-fullscreen">
          <video ref={videoPreviewRef} autoPlay playsInline muted className="camera-preview" />
          <div className="camera-top-bar">
            <button className="camera-btn" onClick={closeCamera}><X size={28} /></button>
            <button className="camera-btn" onClick={switchCamera}>🔄</button>
          </div>
          <div className="camera-bottom-bar">
            <div className="camera-gallery-v2">
              {messages.filter(m => m.isMedia && !m.deleted).slice(-10).reverse().map(m => (
                <div key={m.id} className="gallery-item-v2" onClick={() => { setSelectedMedia(m); setMediaViewerOpen(true); closeCamera(); }}>
                  {m.mediaType === 'image' ? <img src={getMediaUrl(m.mediaUrl)} alt="" /> : <div className="gallery-video-thumb">🎥</div>}
                </div>
              ))}
            </div>
            <button className={`camera-shutter ${isVideoRecording ? 'recording' : ''}`} onClick={!isVideoRecording ? takePhoto : undefined} onTouchStart={!isVideoRecording ? (e) => { e.preventDefault(); const t = setTimeout(startVideoRec, 400); e.currentTarget._holdTimer = t; } : undefined} onTouchEnd={isVideoRecording ? stopVideoRec : (e) => { if (e.currentTarget._holdTimer) clearTimeout(e.currentTarget._holdTimer); }}>
              {isVideoRecording ? <Square size={32} /> : <div className="shutter-inner"></div>}
            </button>
          </div>
        </div>
      )}

      {avatarPreview && (
        <div className="avatar-lightbox" onClick={() => setAvatarPreview(null)}>
          <button className="lightbox-close" onClick={() => setAvatarPreview(null)}><X size={28} /></button>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={avatarPreview.src} alt={avatarPreview.name} className="lightbox-image" />
            <span className="lightbox-name">{avatarPreview.name}</span>
          </div>
        </div>
      )}

      {mediaViewerOpen && selectedMedia && (
        <MediaViewer 
          messages={messages.filter(m => m.isMedia && !m.deleted)}
          initialMedia={selectedMedia}
          onClose={() => setMediaViewerOpen(false)}
          currentUser={currentUser}
          contact={contact}
        />
      )}
    </div>
  );
};

const MediaViewer = ({ messages, initialMedia, onClose, currentUser, contact }) => {
  const [currentIdx, setCurrentIdx] = useState(messages.findIndex(m => m.id === initialMedia.id));
  const current = messages[currentIdx];

  const goPrev = (e) => { e?.stopPropagation(); if (currentIdx > 0) setCurrentIdx(prev => prev - 1); };
  const goNext = (e) => { e?.stopPropagation(); if (currentIdx < messages.length - 1) setCurrentIdx(prev => prev + 1); };

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentIdx]);

  return (
    <div className="wa-media-viewer" onClick={onClose}>
      <div className="wa-media-top">
        <div className="wa-media-user">
          <button className="wa-media-back" onClick={onClose}><ChevronLeft size={24} /></button>
          <img src={getMediaUrl(current.senderId === currentUser.id ? currentUser.avatar : contact.avatar)} alt="" className="wa-media-avatar" />
          <div className="wa-media-info">
            <span className="wa-media-name">{current.senderId === currentUser.id ? 'Siz' : contact.name}</span>
            <span className="wa-media-date">{current.timestamp}</span>
          </div>
        </div>
      </div>

      <div className="wa-media-content" onClick={(e) => e.stopPropagation()}>
        {currentIdx > 0 && <button className="wa-nav-btn prev" onClick={goPrev}><ChevronLeft size={36} /></button>}
        {current.mediaType === 'image' ? <img src={getMediaUrl(current.mediaUrl)} alt="" className="wa-main-media" /> : <video src={getMediaUrl(current.mediaUrl)} controls autoPlay className="wa-main-media" />}
        {currentIdx < messages.length - 1 && <button className="wa-nav-btn next" onClick={goNext}><ChevronRight size={36} /></button>}
      </div>

      <div className="wa-media-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="wa-thumb-strip">
          {messages.map((m, idx) => (
            <div key={m.id} className={`wa-thumb-item ${idx === currentIdx ? 'active' : ''}`} onClick={() => setCurrentIdx(idx)}>
              {m.mediaType === 'image' ? <img src={getMediaUrl(m.mediaUrl)} alt="" /> : <div className="wa-thumb-vid">🎥</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ChatArea;
