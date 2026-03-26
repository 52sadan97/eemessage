import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from 'lucide-react';
import { getMediaUrl } from '../config';

// ===== ICE Servers — STUN + Own TURN Server =====
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  // Own coturn TURN server on VPS
  { urls: 'turn:5.199.136.52:3478', username: 'eemessage', credential: 'EEm3ssag3Turn2026!' },
  { urls: 'turn:5.199.136.52:3478?transport=tcp', username: 'eemessage', credential: 'EEm3ssag3Turn2026!' },
];

const CallManager = forwardRef(({ socket, currentUser, contacts }, ref) => {
  const [callState, setCallState] = useState('idle');
  const [callType, setCallType] = useState('video');
  const [callPartner, setCallPartner] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null); // For audio-only calls
  const ringtoneRef = useRef(null); // Ringtone audio
  const timerRef = useRef(null);
  const callTimeoutRef = useRef(null);
  const callStateRef = useRef('idle');
  const pendingCandidatesRef = useRef([]);
  const hasRemoteDescRef = useRef(false);
  const incomingOfferRef = useRef(null); // Store incoming offer separately

  // ===== Ringtone helpers =====
  const playRingtone = useCallback(() => {
    try {
      if (!ringtoneRef.current) {
        ringtoneRef.current = new Audio('/ringtone.mp3');
        ringtoneRef.current.loop = true;
        ringtoneRef.current.volume = 1.0;
      }
      ringtoneRef.current.currentTime = 0;
      ringtoneRef.current.play().catch(e => console.warn('[Ring] Autoplay blocked:', e));
    } catch(e) { console.warn('[Ring] Error:', e); }
  }, []);

  const stopRingtone = useCallback(() => {
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }
  }, []);

  useEffect(() => { callStateRef.current = callState; }, [callState]);

  // ===== Sync streams to video/audio elements when refs or state change =====
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [callState, callType]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
    // Always keep remote audio element playing
    if (remoteAudioRef.current && remoteStreamRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
    }
  }, [callState, callType]);

  // ===== Cleanup =====
  const cleanup = useCallback(() => {
    console.log('[Call] Cleaning up...');
    stopRingtone();
    if (peerConnectionRef.current) {
      try { peerConnectionRef.current.close(); } catch(e) {}
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    incomingOfferRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }
    pendingCandidatesRef.current = [];
    hasRemoteDescRef.current = false;
    setCallState('idle');
    setCallPartner(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsCamOff(false);
  }, [stopRingtone]);

  const sendMissedCallMessage = useCallback((contactId, type) => {
    if (!socket || !currentUser) return;
    socket.emit('send_message', {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      text: type === 'video' ? '📹 Cevapsız görüntülü arama' : '📞 Cevapsız sesli arama',
      senderId: currentUser.id.toString(),
      receiverId: contactId.toString(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMedia: false, mediaUrl: null, mediaType: null
    });
  }, [socket, currentUser]);

  // ===== Create RTCPeerConnection =====
  const createPeerConnection = useCallback((partnerId) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[ICE] Sending candidate:', event.candidate.type);
        socket.emit('ice-candidate', { to: partnerId, candidate: event.candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[ICE] State:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        console.log('[ICE] ✅ Connected!');
      }
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        console.warn('[ICE] Connection lost or failed');
        if (callStateRef.current !== 'idle') {
          socket.emit('callEnded', { to: partnerId });
          cleanup();
        }
      }
    };

    // THIS IS THE KEY — handle remote tracks
    pc.ontrack = (event) => {
      console.log('[Call] *** Got remote track:', event.track.kind, 'readyState:', event.track.readyState);
      
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }
      remoteStreamRef.current.addTrack(event.track);
      
      // Immediately attach to audio element (always available)
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStreamRef.current;
        remoteAudioRef.current.play().catch(e => console.warn('[Audio] Autoplay blocked:', e));
      }
      // Attach to video element if available
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }, [socket, cleanup]);

  const processPendingCandidates = useCallback(() => {
    const pc = peerConnectionRef.current;
    if (!pc || !hasRemoteDescRef.current) return;
    while (pendingCandidatesRef.current.length > 0) {
      const candidate = pendingCandidatesRef.current.shift();
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {
        console.warn('[ICE] Failed to add candidate:', e);
      });
    }
  }, []);

  // ===== Get media stream =====
  const getMediaStream = async (type) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Bu cihaz kamera/mikrofon desteklemiyor!');
      throw new Error('getUserMedia not supported');
    }

    if (type === 'video') {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: { echoCancellation: true, noiseSuppression: true }
        });
      } catch (err) {
        console.warn('[Media] Video+audio failed:', err.name);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setCallType('audio');
          return stream;
        } catch (err2) {
          alert('Kamera/mikrofon izni alınamadı!\nHata: ' + err2.name);
          throw err2;
        }
      }
    } else {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
      } catch (err) {
        alert('Mikrofon izni alınamadı!\nHata: ' + err.name);
        throw err;
      }
    }
  };

  // ===== Socket listeners =====
  useEffect(() => {
    if (!socket) return;

    const handleIncomingCall = ({ signal, from, name, callType: type }) => {
      console.log('[Call] Incoming call from', name, 'type:', type);
      if (callStateRef.current !== 'idle') {
        socket.emit('callEnded', { to: from });
        return;
      }
      pendingCandidatesRef.current = [];
      hasRemoteDescRef.current = false;
      incomingOfferRef.current = signal; // Store offer in dedicated ref
      setCallType(type || 'video');
      const partner = contacts.find(c => c.id.toString() === from.toString());
      setCallPartner(partner || { id: from, name: name || 'Bilinmeyen', avatar: '' });
      setCallState('incoming');
      playRingtone(); // 🔔 Play ringtone
    };

    const handleCallAccepted = async ({ signal }) => {
      console.log('[Call] Call accepted! Setting remote description...');
      if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }
      const pc = peerConnectionRef.current;
      if (!pc || !(pc instanceof RTCPeerConnection)) {
        console.error('[Call] No valid peer connection');
        return;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        hasRemoteDescRef.current = true;
        processPendingCandidates();
        console.log('[Call] Remote description set, call is active!');
        setCallState('active');
        timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
      } catch (err) {
        console.error('[Call] Failed to set remote desc:', err);
        cleanup();
      }
    };

    const handleIceCandidate = ({ candidate }) => {
      const pc = peerConnectionRef.current;
      if (!pc || !(pc instanceof RTCPeerConnection) || !hasRemoteDescRef.current) {
        pendingCandidatesRef.current.push(candidate);
        return;
      }
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {
        console.warn('[ICE] Failed to add remote candidate:', e);
      });
    };

    const handleCallEnded = () => {
      console.log('[Call] Remote ended call');
      cleanup();
    };

    socket.on('incomingCall', handleIncomingCall);
    socket.on('callAccepted', handleCallAccepted);
    socket.on('callEnded', handleCallEnded);
    socket.on('ice-candidate', handleIceCandidate);

    return () => {
      socket.off('incomingCall', handleIncomingCall);
      socket.off('callAccepted', handleCallAccepted);
      socket.off('callEnded', handleCallEnded);
      socket.off('ice-candidate', handleIceCandidate);
    };
  }, [socket, contacts, cleanup, processPendingCandidates, playRingtone]);

  // ===== Start call (caller) =====
  const startCall = useCallback(async (contactId, type) => {
    const partner = contacts.find(c => c.id.toString() === contactId.toString());
    if (!partner) return;
    
    console.log('[Call] Starting', type, 'call to', partner.name);
    setCallPartner(partner);
    setCallType(type);
    setCallState('calling');
    pendingCandidatesRef.current = [];
    hasRemoteDescRef.current = false;
    remoteStreamRef.current = null;

    callTimeoutRef.current = setTimeout(() => {
      if (callStateRef.current === 'calling') {
        sendMissedCallMessage(contactId, type);
        socket.emit('callEnded', { to: contactId });
        cleanup();
      }
    }, 45000);

    try {
      const stream = await getMediaStream(type);
      localStreamRef.current = stream;

      const actualType = stream.getVideoTracks().length > 0 ? 'video' : 'audio';
      const pc = createPeerConnection(contactId);

      // Add ALL tracks to peer connection
      stream.getTracks().forEach(track => {
        console.log('[Call] Adding local track:', track.kind);
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('[Call] Offer created, sending...');

      socket.emit('callUser', {
        userToCall: contactId,
        signalData: pc.localDescription,
        from: currentUser.id,
        name: currentUser.name,
        callType: actualType
      });
    } catch (err) {
      console.error('[Call] Start failure:', err);
      cleanup();
    }
  }, [contacts, currentUser, socket, cleanup, sendMissedCallMessage, createPeerConnection]);

  // ===== Answer call (callee) =====
  const answerCall = useCallback(async () => {
    if (!callPartner) return;
    stopRingtone(); // 🔕 Stop ringtone on answer
    const offer = incomingOfferRef.current;
    if (!offer) { console.error('[Call] No offer found!'); cleanup(); return; }

    try {
      const stream = await getMediaStream(callType);
      localStreamRef.current = stream;

      remoteStreamRef.current = null;
      const pc = createPeerConnection(callPartner.id);

      // Add ALL tracks
      stream.getTracks().forEach(track => {
        console.log('[Call] Adding local track:', track.kind);
        pc.addTrack(track, stream);
      });

      // Set remote description (the offer)
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      hasRemoteDescRef.current = true;
      processPendingCandidates();

      // Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('[Call] Answer created, sending...');

      socket.emit('answerCall', {
        signal: pc.localDescription,
        to: callPartner.id
      });

      setCallState('active');
      timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    } catch (err) {
      console.error('[Call] Answer failure:', err);
      cleanup();
    }
  }, [callPartner, callType, socket, cleanup, createPeerConnection, processPendingCandidates, stopRingtone]);

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

  useImperativeHandle(ref, () => ({ startCall }));

  // ===== HIDDEN AUDIO ELEMENT — always present for remote audio playback =====
  const audioElement = (
    <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />
  );

  // ===== INCOMING CALL =====
  if (callState === 'incoming' && callPartner) {
    return (
      <div className="wa-call-screen incoming">
        {audioElement}
        <div className="wa-call-bg"></div>
        <div className="wa-call-content">
          <div className="wa-call-top">
            <span className="wa-call-label">
              {callType === 'video' ? '📹 Görüntülü Arama' : '📞 Sesli Arama'}
            </span>
          </div>
          <div className="wa-call-center">
            <div className="wa-avatar-ring">
              <img src={getMediaUrl(callPartner.avatar) || 'https://via.placeholder.com/120'} alt="" className="wa-avatar" />
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

  // ===== CALLING / ACTIVE =====
  if (callState === 'calling' || callState === 'active') {
    return (
      <div className="wa-call-screen active">
        {/* ALWAYS render hidden audio for remote sound */}
        {audioElement}

        {/* Remote video — full screen background */}
        {callType === 'video' && callState === 'active' ? (
          <video ref={remoteVideoRef} className="wa-remote-video" autoPlay playsInline />
        ) : (
          <div className="wa-call-bg"></div>
        )}

        {/* Top bar */}
        <div className="wa-call-topbar">
          <div className="wa-topbar-info">
            <h3>{callPartner?.name || ''}</h3>
            <span className="wa-call-timer-text">
              {callState === 'calling' ? 'Aranıyor' : formatDuration(callDuration)}
              {callState === 'calling' && <span className="wa-dots"><span>.</span><span>.</span><span>.</span></span>}
            </span>
          </div>
        </div>

        {/* Avatar center (audio calls or calling state) */}
        {(callType === 'audio' || callState === 'calling') && (
          <div className="wa-call-center">
            <div className={`wa-avatar-ring ${callState === 'calling' ? 'calling' : ''}`}>
              <img src={getMediaUrl(callPartner?.avatar) || 'https://via.placeholder.com/120'} alt="" className="wa-avatar" />
            </div>
            <h2 className="wa-caller-name">{callPartner?.name}</h2>
            <p className="wa-call-status">
              {callState === 'calling' ? 'Aranıyor...' : 'Sesli Arama'}
            </p>
            <span className="wa-encrypted">🔒 Uçtan uca şifrelenmiş</span>
          </div>
        )}

        {/* Local video PiP */}
        {callType === 'video' && (
          <div className="wa-local-pip">
            <video ref={localVideoRef} autoPlay playsInline muted />
          </div>
        )}

        {/* Controls */}
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

  // Even when idle, render hidden audio element so remote audio is always ready
  return audioElement;
});

export default CallManager;
