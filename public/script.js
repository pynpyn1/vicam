const socket = io('/');
const videoGrid = document.getElementById('video-grid');
const peers = {};
let localStream;

const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
}).then(stream => {
    localStream = stream;
    addVideoStream(createVideoElement(), stream, 'local');

    socket.on('user-connected', async (userId) => {
        const peerConnection = createPeerConnection(userId);
        peers[userId] = peerConnection;

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', {
            target: userId,
            caller: socket.id,
            sdp: peerConnection.localDescription
        });
    });

    socket.on('offer', async (payload) => {
        const peerConnection = createPeerConnection(payload.caller);
        peers[payload.caller] = peerConnection;

        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('answer', {
            target: payload.caller,
            caller: socket.id,
            sdp: peerConnection.localDescription
        });
    });

    socket.on('answer', async (payload) => {
        const peerConnection = peers[payload.caller];
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }
    });

    socket.on('ice-candidate', async (incomingCandidate, callerId) => {
        const peerConnection = peers[callerId];
        if (peerConnection) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(incomingCandidate));
            } catch (e) {
                console.error(e);
            }
        }
    });

    socket.emit('join-room', 'default-room');

}).catch(err => {
    alert('Kamera atau mikrofon tidak ditemukan atau akses ditolak.');
});

socket.on('user-disconnected', userId => {
    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
    }
    const videoWrapper = document.getElementById(`video-wrapper-${userId}`);
    if (videoWrapper) videoWrapper.remove();
});

function createPeerConnection(userId) {
    const peerConnection = new RTCPeerConnection(iceServers);
    const video = createVideoElement();

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: userId,
                candidate: event.candidate
            });
        }
    };

    peerConnection.ontrack = event => {
        addVideoStream(video, event.streams[0], userId);
    };

    return peerConnection;
}

function createVideoElement() {
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    return video;
}

function addVideoStream(video, stream, userId) {
    if (document.getElementById(`video-wrapper-${userId}`)) return;

    video.srcObject = stream;
    if (userId === 'local') video.muted = true;

    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-container';
    videoWrapper.id = `video-wrapper-${userId}`;
    videoWrapper.append(video);
    
    videoGrid.append(videoWrapper);
}

// UI Controls
const toggleAudioBtn = document.getElementById('toggle-audio');
const toggleVideoBtn = document.getElementById('toggle-video');
const leaveBtn = document.getElementById('leave-btn');

toggleAudioBtn.addEventListener('click', () => {
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    toggleAudioBtn.innerHTML = audioTrack.enabled ? 
        '<i class="fa-solid fa-microphone"></i>' : 
        '<i class="fa-solid fa-microphone-slash"></i>';
    toggleAudioBtn.classList.toggle('muted', !audioTrack.enabled);
});

toggleVideoBtn.addEventListener('click', () => {
    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    toggleVideoBtn.innerHTML = videoTrack.enabled ? 
        '<i class="fa-solid fa-video"></i>' : 
        '<i class="fa-solid fa-video-slash"></i>';
    toggleVideoBtn.classList.toggle('muted', !videoTrack.enabled);
});

const switchCameraBtn = document.getElementById('switch-camera');
const shareScreenBtn = document.getElementById('share-screen');

let currentFacingMode = 'user';
let isScreenSharing = false;
let screenStream = null;

switchCameraBtn.addEventListener('click', async () => {
    if (isScreenSharing) return; // Don't switch camera while sharing screen
    
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    
    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode },
            audio: false // We keep the existing audio track
        });
        
        const oldVideoTrack = localStream.getVideoTracks()[0];
        const newVideoTrack = newStream.getVideoTracks()[0];
        
        // Replace video track in all active peer connections
        for (let userId in peers) {
            const sender = peers[userId].getSenders().find(s => s.track.kind === 'video');
            if (sender) sender.replaceTrack(newVideoTrack);
        }
        
        // Update local stream
        localStream.removeTrack(oldVideoTrack);
        localStream.addTrack(newVideoTrack);
        oldVideoTrack.stop();
        
        // Update UI
        const localVideo = document.querySelector('#video-wrapper-local video');
        if (localVideo) localVideo.srcObject = localStream;
        
        // Ensure UI toggle reflects new track state
        newVideoTrack.enabled = !toggleVideoBtn.classList.contains('muted');
        
    } catch (err) {
        console.error('Failed to switch camera', err);
        alert('Gagal mengganti kamera. Mungkin perangkat Anda hanya memiliki satu kamera.');
    }
});

shareScreenBtn.addEventListener('click', async () => {
    if (!isScreenSharing) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            isScreenSharing = true;
            
            const screenTrack = screenStream.getVideoTracks()[0];
            
            // Listen for native "Stop Sharing" button from browser UI
            screenTrack.onended = () => {
                stopScreenSharing();
            };
            
            // Replace video track in all active peer connections
            for (let userId in peers) {
                const sender = peers[userId].getSenders().find(s => s.track.kind === 'video');
                if (sender) sender.replaceTrack(screenTrack);
            }
            
            // Update UI to show screen locally
            const localVideo = document.querySelector('#video-wrapper-local video');
            if (localVideo) localVideo.srcObject = screenStream;
            
            shareScreenBtn.classList.add('active-share');
            
        } catch (err) {
            console.error('Failed to share screen', err);
        }
    } else {
        stopScreenSharing();
    }
});

function stopScreenSharing() {
    if (!isScreenSharing) return;
    isScreenSharing = false;
    
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    
    const cameraTrack = localStream.getVideoTracks()[0];
    
    // Revert back to camera track in all peer connections
    for (let userId in peers) {
        const sender = peers[userId].getSenders().find(s => s.track.kind === 'video');
        if (sender) sender.replaceTrack(cameraTrack);
    }
    
    // Revert local UI
    const localVideo = document.querySelector('#video-wrapper-local video');
    if (localVideo) localVideo.srcObject = localStream;
    
    shareScreenBtn.classList.remove('active-share');
}

leaveBtn.addEventListener('click', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    socket.disconnect();
    document.body.innerHTML = '<div class="leave-message">Panggilan diakhiri.</div>';
});
