import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from 'lucide-react';
import SimplePeer from 'simple-peer';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
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

  // Keep ref in sync with state
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  const cleanup = useCallback(() => {
    if (peerRef.current) { try { peerRef.current.destroy(); } catch(e) {} peerRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }
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
      incomingSignalRef.current = signal;
      setCallType(type || 'video');
      const partner = contacts.find(c => c.id.toString() === from.toString());
      setCallPartner(partner || { id: from, name: name || 'Bilinmeyen', avatar: '' });
      setCallState('incoming');
    };

    const handleCallAccepted = ({ signal }) => {
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
    if (type === 'video') {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (err) {
        console.warn('Video+Audio failed, trying audio-only:', err.name);
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setCallType('audio');
          return audioStream;
        } catch (err2) {
          console.error('Audio-only fallback also failed:', err2.name, err2.message);
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
        trickle: true,
        stream,
        config: { iceServers: ICE_SERVERS }
      });

      peer.on('signal', (data) => {
        socket.emit('callUser', {
          userToCall: contactId,
          signalData: data,
          from: currentUser.id,
          name: currentUser.name,
          callType: actualType
        });
      });

      peer.on('stream', (remoteStream) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      });

      peer.on('error', (e) => {
        console.error('Peer error:', e);
        // Only cleanup if still in active/calling state
        if (callStateRef.current !== 'idle') cleanup();
      });

      // Only cleanup on close if the call was active (not during signaling)
      peer.on('close', () => {
        if (callStateRef.current === 'active') cleanup();
      });

      peerRef.current = peer;
    } catch (err) {
      console.error('getUserMedia hatası:', err.name, err.message);
      // Send missed call message since we couldn't even start
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
        trickle: true,
        stream,
        config: { iceServers: ICE_SERVERS }
      });

      peer.on('signal', (data) => {
        socket.emit('answerCall', { to: callPartner.id, signal: data });
      });

      peer.on('stream', (remoteStream) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      });

      peer.on('error', (e) => { console.error('Peer error:', e); cleanup(); });
      peer.on('close', () => {
        if (callStateRef.current === 'active') cleanup();
      });

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

  // Incoming Call Modal
  if (callState === 'incoming' && callPartner) {
    return (
      <div className="incoming-call-overlay">
        <div className="incoming-call-card">
          <img src={callPartner.avatar || 'https://via.placeholder.com/80'} alt="" className="caller-avatar" />
          <h3>{callPartner.name}</h3>
          <p>{callType === 'video' ? '📹 Görüntülü Arama' : '📞 Sesli Arama'}</p>
          <div className="call-actions">
            <button className="call-btn reject" onClick={rejectCall} title="Reddet">
              <PhoneOff size={24} />
            </button>
            <button className="call-btn accept" onClick={answerCall} title="Kabul Et">
              <Phone size={24} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active Call / Calling Screen
  if (callState === 'calling' || callState === 'active') {
    return (
      <div className="active-call-overlay">
        <span className="call-caller-name">{callPartner?.name || ''}</span>
        <span className="call-timer">
          {callState === 'calling' ? 'Aranıyor...' : formatDuration(callDuration)}
        </span>

        <div className="call-videos">
          {callType === 'video' ? (
            <video ref={remoteVideoRef} className="remote-video" autoPlay playsInline />
          ) : (
            <div className="audio-call-placeholder">
              <img src={callPartner?.avatar || 'https://via.placeholder.com/120'} alt="" className="caller-avatar-large" />
              <p>{callState === 'calling' ? 'Aranıyor...' : 'Sesli Arama'}</p>
            </div>
          )}

          {callType === 'video' && (
            <div className="local-video-pip">
              <video ref={localVideoRef} autoPlay playsInline muted />
            </div>
          )}
        </div>

        <div className="call-controls">
          {callState === 'active' && (
            <button className="call-control-btn" onClick={toggleMute} title={isMuted ? 'Sesi Aç' : 'Sessize Al'}>
              {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>
          )}
          {callState === 'active' && callType === 'video' && (
            <button className="call-control-btn" onClick={toggleCamera} title={isCamOff ? 'Kamerayı Aç' : 'Kamerayı Kapat'}>
              {isCamOff ? <VideoOff size={22} /> : <Video size={22} />}
            </button>
          )}
          <button className="call-control-btn end-call" onClick={endCall} title={callState === 'calling' ? 'İptal Et' : 'Aramayı Bitir'}>
            <PhoneOff size={24} />
          </button>
        </div>
      </div>
    );
  }

  return null;
});

export default CallManager;
