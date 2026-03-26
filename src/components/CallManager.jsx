import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from 'lucide-react';
import { getMediaUrl } from '../config';

// ===== ICE Servers — STUN + Metered TURN (free tier) =====
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  // Metered TURN — replace with your own credentials for production
  { urls: 'turn:a.relay.metered.ca:80', username: 'e8d3c5a0b9f1443d8a0e', credential: 'kP8xQ2wR5mN7vL3j' },
  { urls: 'turn:a.relay.metered.ca:80?transport=tcp', username: 'e8d3c5a0b9f1443d8a0e', credential: 'kP8xQ2wR5mN7vL3j' },
  { urls: 'turn:a.relay.metered.ca:443', username: 'e8d3c5a0b9f1443d8a0e', credential: 'kP8xQ2wR5mN7vL3j' },
  { urls: 'turn:a.relay.metered.ca:443?transport=tcp', username: 'e8d3c5a0b9f1443d8a0e', credential: 'kP8xQ2wR5mN7vL3j' },
];

const CallManager = forwardRef(({ socket, currentUser, contacts }, ref) => {
  const [callState, setCallState] = useState('idle'); // idle | calling | incoming | active
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
  const timerRef = useRef(null);
  const callTimeoutRef = useRef(null);
  const callStateRef = useRef('idle');
  const pendingCandidatesRef = useRef([]);
  const hasRemoteDescRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  // ===== Cleanup =====
  const cleanup = useCallback(() => {
    console.log('[Call] Cleaning up...');
    if (peerConnectionRef.current) {
      try { peerConnectionRef.current.close(); } catch(e) {}
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }
    pendingCandidatesRef.current = [];
    hasRemoteDescRef.current = false;
    setCallState('idle');
    setCallPartner(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsCamOff(false);
  }, []);

  // ===== Send missed call message =====
  const sendMissedCallMessage = useCallback((contactId, type) => {
    if (!socket || !currentUser) return;
    const msg = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      text: type === 'video' ? '📹 Cevapsız görüntülü arama' : '📞 Cevapsız sesli arama',
      senderId: currentUser.id.toString(),
      receiverId: contactId.toString(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMedia: false,
      mediaUrl: null,
      mediaType: null
    };
    socket.emit('send_message', msg);
  }, [socket, currentUser]);

  // ===== Create RTCPeerConnection =====
  const createPeerConnection = useCallback((partnerId) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Send ICE candidates via socket (trickle ICE)
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[ICE] Sending candidate');
        socket.emit('ice-candidate', {
          to: partnerId,
          candidate: event.candidate
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[ICE] Connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        console.warn('[ICE] Connection lost or failed');
        if (callStateRef.current !== 'idle') {
          socket.emit('callEnded', { to: partnerId });
          cleanup();
        }
      }
    };

    pc.ontrack = (event) => {
      console.log('[Call] Got remote track:', event.track.kind);
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }
      remoteStreamRef.current.addTrack(event.track);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }, [socket, cleanup]);

  // ===== Process queued ICE candidates =====
  const processPendingCandidates = useCallback(() => {
    const pc = peerConnectionRef.current;
    if (!pc || !hasRemoteDescRef.current) return;
    while (pendingCandidatesRef.current.length > 0) {
      const candidate = pendingCandidatesRef.current.shift();
      console.log('[ICE] Adding queued candidate');
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {
        console.warn('[ICE] Failed to add candidate:', e);
      });
    }
  }, []);

  // ===== Get media stream with fallback =====
  const getMediaStream = async (type) => {
    if (type === 'video') {
      try {
        console.log('[Media] Requesting video+audio...');
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (err) {
        console.warn('[Media] Video failed, trying audio only...', err.name);
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setCallType('audio');
          return audioStream;
        } catch (err2) {
          console.error('[Media] Audio also failed:', err2.name);
          alert('Kamera veya mikrofon izni alınamadı! Hata: ' + err2.name);
          throw err2;
        }
      }
    } else {
      console.log('[Media] Requesting audio only...');
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  };

  // ===== Socket listeners =====
  useEffect(() => {
    if (!socket) return;

    // Incoming call — receive an offer
    const handleIncomingCall = ({ signal, from, name, callType: type }) => {
      console.log('[Call] Incoming call from', name, 'type:', type);
      if (callStateRef.current !== 'idle') {
        console.warn('[Call] Already in a call, rejecting incoming');
        socket.emit('callEnded', { to: from });
        return;
      }
      // Store the offer for when user answers
      pendingCandidatesRef.current = [];
      hasRemoteDescRef.current = false;
      setCallType(type || 'video');
      const partner = contacts.find(c => c.id.toString() === from.toString());
      setCallPartner(partner || { id: from, name: name || 'Bilinmeyen', avatar: '' });
      // Store the offer SDP in a ref
      peerConnectionRef.current = signal; // temporarily store offer here
      setCallState('incoming');
    };

    // Call accepted — receive an answer
    const handleCallAccepted = async ({ signal }) => {
      console.log('[Call] Call accepted, setting remote description');
      if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }
      const pc = peerConnectionRef.current;
      if (!pc || !(pc instanceof RTCPeerConnection)) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        hasRemoteDescRef.current = true;
        processPendingCandidates();
        setCallState('active');
        timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
      } catch (err) {
        console.error('[Call] Failed to set remote desc:', err);
        cleanup();
      }
    };

    // ICE candidate from remote
    const handleIceCandidate = ({ candidate }) => {
      const pc = peerConnectionRef.current;
      if (!pc || !(pc instanceof RTCPeerConnection)) {
        pendingCandidatesRef.current.push(candidate);
        return;
      }
      if (!hasRemoteDescRef.current) {
        pendingCandidatesRef.current.push(candidate);
        return;
      }
      console.log('[ICE] Adding remote candidate');
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
  }, [socket, contacts, cleanup, processPendingCandidates]);

  // ===== Initiate call (caller creates offer) =====
  const startCall = useCallback(async (contactId, type) => {
    const partner = contacts.find(c => c.id.toString() === contactId.toString());
    if (!partner) return;
    
    console.log('[Call] Starting', type, 'call to', partner.name);
    setCallPartner(partner);
    setCallType(type);
    setCallState('calling');
    pendingCandidatesRef.current = [];
    hasRemoteDescRef.current = false;

    // 45-second timeout
    callTimeoutRef.current = setTimeout(() => {
      if (callStateRef.current === 'calling') {
        console.warn('[Call] Timeout — unanswered');
        sendMissedCallMessage(contactId, type);
        socket.emit('callEnded', { to: contactId });
        cleanup();
      }
    }, 45000);

    try {
      const stream = await getMediaStream(type);
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const actualType = stream.getVideoTracks().length > 0 ? 'video' : 'audio';
      const pc = createPeerConnection(contactId);

      // Add local tracks to peer connection
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('[Call] Offer created, sending to', contactId);

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

  // ===== Answer call (callee creates answer) =====
  const answerCall = useCallback(async () => {
    if (!callPartner) return;
    const offer = peerConnectionRef.current; // stored offer SDP
    if (!offer) { cleanup(); return; }

    try {
      const stream = await getMediaStream(callType);
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = createPeerConnection(callPartner.id);

      // Add local tracks
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Set remote description (the offer)
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      hasRemoteDescRef.current = true;

      // Process any ICE candidates that arrived before we set remote desc
      processPendingCandidates();

      // Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('[Call] Answer created, sending back');

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
  }, [callPartner, callType, socket, cleanup, createPeerConnection, processPendingCandidates]);

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

  // ===== INCOMING CALL SCREEN =====
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

  // ===== CALLING / ACTIVE CALL SCREEN =====
  if (callState === 'calling' || callState === 'active') {
    return (
      <div className="wa-call-screen active">
        {callType === 'video' && callState === 'active' ? (
          <video ref={remoteVideoRef} className="wa-remote-video" autoPlay playsInline />
        ) : (
          <div className="wa-call-bg"></div>
        )}

        <div className="wa-call-topbar">
          <div className="wa-topbar-info">
            <h3>{callPartner?.name || ''}</h3>
            <span className="wa-call-timer-text">
              {callState === 'calling' ? 'Aranıyor' : formatDuration(callDuration)}
              {callState === 'calling' && <span className="wa-dots"><span>.</span><span>.</span><span>.</span></span>}
            </span>
          </div>
        </div>

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

        {callType === 'video' && callState === 'active' && (
          <div className="wa-local-pip">
            <video ref={localVideoRef} autoPlay playsInline muted />
          </div>
        )}

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
