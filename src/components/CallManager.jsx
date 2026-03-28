import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { 
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff, 
  Volume2, VolumeX, ChevronDown, MoreVertical, X, 
  ChevronLeft, ChevronRight 
} from 'lucide-react';
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
  const [isSpeaker, setIsSpeaker] = useState(true); // Default to speaker on mobile
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

  // ===== Ref callbacks — attach srcObject when element mounts =====
  const localVideoRefCb = useCallback((node) => {
    localVideoRef.current = node;
    if (node && localStreamRef.current) {
      node.srcObject = localStreamRef.current;
    }
  }, [callState]); // re-run when state changes

  const remoteVideoRefCb = useCallback((node) => {
    remoteVideoRef.current = node;
    if (node && remoteStreamRef.current) {
      node.srcObject = remoteStreamRef.current;
      node.play().catch(e => console.warn('[Video] Play failed:', e));
    }
  }, [callState]);

  // Always keep remote audio element synced
  useEffect(() => {
    if (remoteAudioRef.current && remoteStreamRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
    }
  }, [callState]);

  // Sync native audio mode when call starts
  useEffect(() => {
    if (callState === 'active') {
      if (window.AndroidAudio && typeof window.AndroidAudio.setSpeakerphoneOn === 'function') {
        window.AndroidAudio.setSpeakerphoneOn(isSpeaker);
      }
    }
  }, [callState, isSpeaker]);

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
    setIsSpeaker(true);
  }, [stopRingtone]);

  const sendMissedCallMessage = useCallback((contactId, type) => {
    if (!socket || !currentUser) return;
    socket.emit('send_message', {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      text: type === 'video' ? '📹 Cevapsız görüntülü arama' : '📞 Cevapsız sesli arama',
      senderId: currentUser.id.toString(),
      receiverId: contactId.toString(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMedia: false, mediaUrl: null, mediaType: null,
      createdAt: Date.now()
    });
  }, [socket, currentUser]);

  const toggleSpeaker = useCallback(async () => {
    const newSpeaker = !isSpeaker;
    setIsSpeaker(newSpeaker);
    
    // Call Native Android Audio Bridge
    if (window.AndroidAudio && typeof window.AndroidAudio.setSpeakerphoneOn === 'function') {
      try {
        window.AndroidAudio.setSpeakerphoneOn(newSpeaker);
        console.log('[Audio] Native speaker toggle:', newSpeaker);
      } catch (e) {
        console.error('[Audio] Native toggle error:', e);
      }
    }

    // Fallback/Experimental: try to set sinkId on remote elements
    try {
      const audio = remoteAudioRef.current;
      if (audio && typeof audio.setSinkId === 'function') {
        console.log('[Audio] Web sinkId toggle (ref):', newSpeaker);
      }
    } catch(e) {
      console.warn('[Audio] setSinkId error:', e);
    }
  }, [isSpeaker]);

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
      
      if (event.streams && event.streams[0]) {
        // Use the first stream provided which usually contains all tracks
        remoteStreamRef.current = event.streams[0];
      } else {
        // Fallback: manually manage stream
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream();
        }
        remoteStreamRef.current.addTrack(event.track);
      }

      // Re-bind to elements immediately
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStreamRef.current;
        remoteAudioRef.current.play().catch(e => console.warn('[Audio] Autoplay blocked:', e));
      }
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
      console.log('[Call] 📥 Incoming call event!', { from, name, type });
      
      if (callStateRef.current !== 'idle') {
        console.warn('[Call] Refusing call — busy in state:', callStateRef.current);
        socket.emit('callEnded', { to: from });
        return;
      }

      pendingCandidatesRef.current = [];
      hasRemoteDescRef.current = false;
      incomingOfferRef.current = signal;
      setCallType(type || 'video');

      // Use a robust lookup and fallback
      const contactId = from.toString();
      const partner = contacts.find(c => c.id.toString() === contactId);
      
      if (partner) {
        setCallPartner(partner);
      } else {
        console.warn('[Call] Caller not in contact list, using provided info');
        setCallPartner({ id: contactId, name: name || 'Bilinmeyen', avatar: '' });
      }

      setCallState('incoming');
      playRingtone();
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
        <div className="wa-call-bg pattern-bg"></div>
        <div className="wa-call-content">
          <div className="wa-call-top">
            <h2 className="wa-caller-name">{callPartner.name}</h2>
            <span className="wa-caller-number">+90 554 779 97 52</span>
          </div>
          
          <div className="wa-call-center">
            <div className="wa-avatar-ring">
              <img src={getMediaUrl(callPartner.avatar) || 'https://via.placeholder.com/120'} alt="" className="wa-avatar" />
            </div>
            <p className="wa-call-status">Gelen {callType === 'video' ? 'görüntülü' : 'sesli'} arama</p>
          </div>

          <div className="wa-incoming-footer">
             <div className="wa-swipe-up-hint">
                <div className="chevron-up"></div>
                <span>Kabul etmek için yukarı kaydırın</span>
             </div>
             
             <div className="wa-incoming-actions-v2">
                <div className="wa-action-item">
                  <button className="wa-call-btn reject-v2" onClick={rejectCall}>
                    <PhoneOff size={28} />
                  </button>
                  <span>Reddet</span>
                </div>

                <div className="wa-action-item">
                  <button className="wa-call-btn accept-v2" onClick={answerCall}>
                    <Phone size={28} />
                  </button>
                  <span>Cevapla</span>
                </div>

                <div className="wa-action-item">
                  <button className="wa-call-btn message-v2">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
                  </button>
                  <span>Mesaj gönder</span>
                </div>
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
        {audioElement}

        {callType === 'video' && callState === 'active' ? (
          <video ref={remoteVideoRefCb} className="wa-remote-video" autoPlay playsInline />
        ) : (
          <div className="wa-call-bg pattern-bg"></div>
        )}

        <div className="wa-call-topbar-v2">
          <button className="wa-top-btn"><ChevronDown size={24} /></button>
          <div className="wa-topbar-info">
            <h3 className="wa-timer-name">{callPartner?.name || ''}</h3>
            <span className="wa-timer-val">
              {callState === 'calling' ? 'Aranıyor...' : formatDuration(callDuration)}
            </span>
          </div>
          <button className="wa-top-btn">👤+</button>
        </div>

        {(callType === 'audio' || callState === 'calling') && (
          <div className="wa-call-center">
            <div className={`wa-avatar-large ${callState === 'calling' ? 'calling' : ''}`}>
              <img src={getMediaUrl(callPartner?.avatar) || 'https://via.placeholder.com/120'} alt="" className="wa-avatar" />
            </div>
          </div>
        )}

        {callType === 'video' && (
          <div className="wa-local-pip">
            <video ref={localVideoRefCb} autoPlay playsInline muted />
          </div>
        )}

        <div className="wa-call-controls-v2">
          <div className="wa-ctrl-pills">
            <button className="wa-pill-btn"><MoreVertical size={20} /></button>
            <button className={`wa-pill-btn ${isCamOff ? 'active' : ''}`} onClick={toggleCamera}>
              {isCamOff ? <VideoOff size={20} /> : <Video size={20} />}
            </button>
            <button className={`wa-pill-btn ${!isSpeaker ? 'active' : ''}`} onClick={toggleSpeaker}>
              {isSpeaker ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button className={`wa-pill-btn ${isMuted ? 'active' : ''}`} onClick={toggleMute}>
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <button className="wa-pill-btn end" onClick={endCall}>
              <PhoneOff size={24} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return audioElement;
});

export default CallManager;
