import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from 'lucide-react';
import SimplePeer from 'simple-peer';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
];

const CallManager = forwardRef(({ socket, currentUser, contacts }, ref) => {
  const [callState, setCallState] = useState('idle'); // idle | calling | incoming | active
  const [callType, setCallType] = useState('video');
  const [callPartner, setCallPartner] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const incomingSignalRef = useRef(null);
  const timerRef = useRef(null);
  const callTimeoutRef = useRef(null);
  const callStateRef = useRef('idle');
  const signalSentRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  const cleanup = useCallback(() => {
    if (peerRef.current) { try { peerRef.current.destroy(); } catch(e) {} peerRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }
    signalSentRef.current = false;
    setCallState('idle');
    setCallPartner(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsCamOff(false);
  }, []);

  // Send a missed call message via socket
  const sendMissedCallMessage = useCallback((contactId, type) => {
    if (!socket || !currentUser) return;
    const msg = {
      id: Date.now().toString(),
      text: type === 'video' ? '📹 Cevapsız görüntülü arama' : '📞 Cevapsız sesli arama',
      senderId: currentUser.id,
      receiverId: contactId,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMedia: false,
      mediaUrl: null,
      mediaType: null
    };
    socket.emit('send_message', msg);
  }, [socket, currentUser]);

  // Socket listeners
  useEffect(() => {
    if (!socket) return;

    const handleIncomingCall = ({ signal, from, name, callType: type }) => {
      console.log('Incoming call from', name, 'type:', type);
      incomingSignalRef.current = signal;
      setCallType(type || 'video');
      const partner = contacts.find(c => c.id.toString() === from.toString());
      setCallPartner(partner || { id: from, name: name || 'Bilinmeyen', avatar: '' });
      setCallState('incoming');
    };

    const handleCallAccepted = ({ signal }) => {
      console.log('Call accepted, signaling peer');
      if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }
      if (peerRef.current) peerRef.current.signal(signal);
      setCallState('active');
      timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    };

    const handleCallEnded = () => cleanup();

    socket.on('incomingCall', handleIncomingCall);
    socket.on('callAccepted', handleCallAccepted);
    socket.on('callEnded', handleCallEnded);

    return () => {
      socket.off('incomingCall', handleIncomingCall);
      socket.off('callAccepted', handleCallAccepted);
      socket.off('callEnded', handleCallEnded);
    };
  }, [socket, contacts, cleanup]);

  // Helper: get media stream with fallback
  const getMediaStream = async (type) => {
    const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    
    if (type === 'video') {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (err) {
        console.warn('Video+Audio failed:', err.name);
        if (err.name === 'NotAllowedError' && !isSecure) {
          alert('Kamera/mikrofon izni için HTTPS gereklidir. Sadece sesli arama deneniyor...');
        }
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setCallType('audio');
          return audioStream;
        } catch (err2) {
          console.error('Audio fallback also failed:', err2.name);
          if (!isSecure) {
            alert('HTTPS olmadan kamera ve mikrofon erişimi sağlanamıyor. Lütfen HTTPS kullanın.');
          }
          throw err2;
        }
      }
    } else {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  };

  // Initiate call
  const startCall = useCallback(async (contactId, type) => {
    const partner = contacts.find(c => c.id.toString() === contactId.toString());
    if (!partner) return;
    setCallPartner(partner);
    setCallType(type);
    setCallState('calling');
    signalSentRef.current = false;

    // 30-second timeout for unanswered calls
    callTimeoutRef.current = setTimeout(() => {
      console.warn('Arama cevaplanmadı (30s timeout)');
      sendMissedCallMessage(contactId, type);
      socket.emit('callEnded', { to: partner.id });
      cleanup();
    }, 30000);

    try {
      const stream = await getMediaStream(type);
      localStreamRef.current = stream;

      setTimeout(() => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      }, 100);

      const actualType = stream.getVideoTracks().length > 0 ? 'video' : 'audio';

      const peer = new SimplePeer({
        initiator: true,
        trickle: false,
        stream,
        config: { iceServers: ICE_SERVERS }
      });

      peer.on('signal', (data) => {
        if (!signalSentRef.current) {
          signalSentRef.current = true;
          console.log('Sending call signal to', contactId);
          socket.emit('callUser', {
            userToCall: contactId,
            signalData: data,
            from: currentUser.id,
            name: currentUser.name,
            callType: actualType
          });
        }
      });

      peer.on('stream', (remoteStream) => {
        console.log('Got remote stream');
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      });

      peer.on('error', (e) => {
        console.error('Peer error:', e.message);
        if (callStateRef.current !== 'idle') cleanup();
      });

      peer.on('close', () => {
        if (callStateRef.current === 'active') cleanup();
      });

      peerRef.current = peer;
    } catch (err) {
      console.error('getUserMedia hatası:', err.name, err.message);
      sendMissedCallMessage(contactId, type);
      socket.emit('callEnded', { to: partner.id });
      cleanup();
    }
  }, [contacts, currentUser, socket, cleanup, sendMissedCallMessage]);

  // Answer call
  const answerCall = useCallback(async () => {
    try {
      const stream = await getMediaStream(callType);
      localStreamRef.current = stream;

      const peer = new SimplePeer({
        initiator: false,
        trickle: false,
        stream,
        config: { iceServers: ICE_SERVERS }
      });

      peer.on('signal', (data) => {
        console.log('Sending answer signal');
        socket.emit('answerCall', { to: callPartner.id, signal: data });
      });

      peer.on('stream', (remoteStream) => {
        console.log('Got remote stream (answer)');
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      });

      peer.on('error', (e) => { console.error('Peer error:', e.message); cleanup(); });
      peer.on('close', () => {
        if (callStateRef.current === 'active') cleanup();
      });

      // Signal the incoming offer AFTER setting up listeners
      peer.signal(incomingSignalRef.current);
      peerRef.current = peer;
      setCallState('active');
      timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);

      setTimeout(() => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      }, 100);
    } catch (err) {
      console.error('getUserMedia hatası (answer):', err.name, err.message);
      if (callPartner) socket.emit('callEnded', { to: callPartner.id });
      cleanup();
    }
  }, [callType, callPartner, socket, cleanup]);

  const rejectCall = useCallback(() => {
    if (callPartner) socket.emit('callEnded', { to: callPartner.id });
    cleanup();
  }, [callPartner, socket, cleanup]);

  const endCall = useCallback(() => {
    if (callPartner) socket.emit('callEnded', { to: callPartner.id });
    cleanup();
  }, [callPartner, socket, cleanup]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
      setIsMuted(prev => !prev);
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
      setIsCamOff(prev => !prev);
    }
  };

  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Expose startCall to parent via ref
  useImperativeHandle(ref, () => ({ startCall }));

  // Incoming Call — WhatsApp Fullscreen
  if (callState === 'incoming' && callPartner) {
    return (
      <div className="wa-call-screen incoming">
        <div className="wa-call-bg"></div>
        <div className="wa-call-content">
          <div className="wa-call-top">
            <span className="wa-call-label">
              {callType === 'video' ? '📹 Görüntülü Arama' : '📞 Sesli Arama'}
            </span>
          </div>
          
          <div className="wa-call-center">
            <div className="wa-avatar-ring">
              <img src={callPartner.avatar || 'https://via.placeholder.com/120'} alt="" className="wa-avatar" />
            </div>
            <h2 className="wa-caller-name">{callPartner.name}</h2>
            <p className="wa-call-status">Gelen arama...</p>
            <span className="wa-encrypted">🔒 Uçtan uca şifrelenmiş</span>
          </div>

          <div className="wa-incoming-actions">
            <div className="wa-action-item">
              <button className="wa-call-btn reject" onClick={rejectCall}>
                <PhoneOff size={28} />
              </button>
              <span>Reddet</span>
            </div>
            <div className="wa-action-item">
              <button className="wa-call-btn accept" onClick={answerCall}>
                <Phone size={28} />
              </button>
              <span>Kabul Et</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Active Call / Calling Screen — WhatsApp Style
  if (callState === 'calling' || callState === 'active') {
    return (
      <div className="wa-call-screen active">
        {/* Video background or gradient */}
        {callType === 'video' && callState === 'active' ? (
          <video ref={remoteVideoRef} className="wa-remote-video" autoPlay playsInline />
        ) : (
          <div className="wa-call-bg"></div>
        )}

        {/* Top info */}
        <div className="wa-call-topbar">
          <div className="wa-topbar-info">
            <h3>{callPartner?.name || ''}</h3>
            <span className="wa-call-timer-text">
              {callState === 'calling' ? 'Aranıyor' : formatDuration(callDuration)}
              {callState === 'calling' && <span className="wa-dots"><span>.</span><span>.</span><span>.</span></span>}
            </span>
          </div>
        </div>

        {/* Center — avatar for audio calls or calling state */}
        {(callType === 'audio' || callState === 'calling') && (
          <div className="wa-call-center">
            <div className={`wa-avatar-ring ${callState === 'calling' ? 'calling' : ''}`}>
              <img src={callPartner?.avatar || 'https://via.placeholder.com/120'} alt="" className="wa-avatar" />
            </div>
            <h2 className="wa-caller-name">{callPartner?.name}</h2>
            <p className="wa-call-status">
              {callState === 'calling' ? 'Aranıyor...' : 'Sesli Arama'}
            </p>
            <span className="wa-encrypted">🔒 Uçtan uca şifrelenmiş</span>
          </div>
        )}

        {/* Local video PiP */}
        {callType === 'video' && callState === 'active' && (
          <div className="wa-local-pip">
            <video ref={localVideoRef} autoPlay playsInline muted />
          </div>
        )}

        {/* Bottom controls */}
        <div className="wa-call-controls">
          {callState === 'active' && callType === 'video' && (
            <div className="wa-ctrl-item">
              <button className={`wa-ctrl-btn ${isCamOff ? 'active' : ''}`} onClick={toggleCamera}>
                {isCamOff ? <VideoOff size={22} /> : <Video size={22} />}
              </button>
              <span>Kamera</span>
            </div>
          )}
          {callState === 'active' && (
            <div className="wa-ctrl-item">
              <button className={`wa-ctrl-btn ${isMuted ? 'active' : ''}`} onClick={toggleMute}>
                {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
              </button>
              <span>Mikrofon</span>
            </div>
          )}
          <div className="wa-ctrl-item">
            <button className="wa-ctrl-btn end" onClick={endCall}>
              <PhoneOff size={26} />
            </button>
            <span>{callState === 'calling' ? 'İptal' : 'Bitir'}</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
});

export default CallManager;
