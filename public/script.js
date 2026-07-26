const socket = io('/');
const videoGrid = document.getElementById('video-grid');
const peers = {}; // Camera peers
const screenPeers = {}; // Screen peers (outgoing)
let localStream;

const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};

navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
}).then(stream => {
    localStream = stream;
    addVideoStream(createVideoElement(), stream, 'local');

    socket.on('user-connected', async (userId) => {
        // Create connection for camera
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

        // If we are sharing our screen, also send a screen offer to this new user
        if (isScreenSharing && screenStream) {
            connectScreenToUser(userId);
        }
    });

    socket.on('offer', async (payload) => {
        const peerConnection = createPeerConnection(payload.caller);
        
        // Receiver just stores it in `peers` regardless if it's a camera or screen
        peers[payload.caller] = peerConnection;

        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));

        // Only send back our camera track if this is a standard camera call
        if (!payload.caller.endsWith('-screen')) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // Send answer back to the actual socket id, but tell them it's for their specific caller context
        const actualTarget = payload.caller.replace('-screen', '');
        socket.emit('answer', {
            target: actualTarget,
            caller: socket.id,
            sdp: peerConnection.localDescription,
            answerFor: payload.caller
        });
    });

    socket.on('answer', async (payload) => {
        let peerConnection;
        if (payload.answerFor && payload.answerFor.endsWith('-screen')) {
             peerConnection = screenPeers[payload.caller]; 
        } else {
             peerConnection = peers[payload.caller];
        }
        
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }
    });

    socket.on('ice-candidate', async (incomingCandidate, callerId) => {
        const peerConnection = peers[callerId] || screenPeers[callerId];
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
    // Remove camera peer if exists
    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
    }
    const videoWrapper = document.getElementById(`video-wrapper-${userId}`);
    if (videoWrapper) videoWrapper.remove();
});

function createPeerConnection(userId, isScreenOutbound = false) {
    const peerConnection = new RTCPeerConnection(iceServers);
    const video = createVideoElement();

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: userId,
                candidate: event.candidate,
                caller: socket.id + (isScreenOutbound ? '-screen' : '')
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
    // Tambahkan atribut HTML secara eksplisit (Dibutuhkan oleh iOS Safari)
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    return video;
}

function addVideoStream(video, stream, userId) {
    if (document.getElementById(`video-wrapper-${userId}`)) return;

    video.srcObject = stream;
    
    // Paksa video untuk memutar (Penting untuk HP / iOS Safari)
    video.addEventListener('loadedmetadata', () => {
        video.play().catch(e => console.error("Auto-play prevented:", e));
    });

    // Mute video lokal, DAN mute layar presentasi masuk. 
    // Browser HP sering memblokir video yang tidak di-mute (meskipun screen share tidak ada suaranya)
    if (userId === 'local' || userId === 'local-screen' || userId.endsWith('-screen')) {
        video.muted = true;
        video.setAttribute('muted', '');
    }

    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-container';
    videoWrapper.id = `video-wrapper-${userId}`;
    
    // Style differently if it's a screen share
    if (userId.endsWith('-screen')) {
        videoWrapper.classList.add('screen-share-view');
    }
    
    videoWrapper.append(video);
    videoGrid.append(videoWrapper);
}

// UI Controls
const toggleAudioBtn = document.getElementById('toggle-audio');
const toggleVideoBtn = document.getElementById('toggle-video');
const switchCameraBtn = document.getElementById('switch-camera');
const shareScreenBtn = document.getElementById('share-screen');
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

let currentFacingMode = 'user';
let isScreenSharing = false;
let screenStream = null;

switchCameraBtn.addEventListener('click', async () => {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    
    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode },
            audio: false 
        });
        
        const oldVideoTrack = localStream.getVideoTracks()[0];
        const newVideoTrack = newStream.getVideoTracks()[0];
        
        // Replace video track in all active camera peer connections
        for (let userId in peers) {
            // Only replace in actual camera peers, not screen peers
            if (!userId.endsWith('-screen')) {
                const sender = peers[userId].getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(newVideoTrack);
            }
        }
        
        // Update local stream
        localStream.removeTrack(oldVideoTrack);
        localStream.addTrack(newVideoTrack);
        oldVideoTrack.stop();
        
        // Update UI
        const localVideo = document.querySelector('#video-wrapper-local video');
        if (localVideo) localVideo.srcObject = localStream;
        
        newVideoTrack.enabled = !toggleVideoBtn.classList.contains('muted');
        
    } catch (err) {
        console.error('Failed to switch camera', err);
        alert('Gagal mengganti kamera. Pastikan browser mengizinkan kamera dan Anda menggunakan perangkat dengan lebih dari 1 kamera.');
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
            
            // Show screen locally
            addVideoStream(createVideoElement(), screenStream, 'local-screen');
            
            // Create new peer connections just for the screen to all existing users
            for (let userId in peers) {
                if (!userId.endsWith('-screen')) {
                    connectScreenToUser(userId);
                }
            }
            
            shareScreenBtn.classList.add('active-share');
            
        } catch (err) {
            console.error('Failed to share screen', err);
            alert('Gagal berbagi layar. Pastikan Anda menggunakan laptop/PC dan URL memiliki gembok hijau (HTTPS).');
        }
    } else {
        stopScreenSharing();
    }
});

async function connectScreenToUser(userId) {
    const screenPeer = createPeerConnection(userId, true); // true = isScreenOutbound
    screenPeers[userId] = screenPeer;
    
    screenStream.getTracks().forEach(track => {
        screenPeer.addTrack(track, screenStream);
    });
    
    const offer = await screenPeer.createOffer();
    await screenPeer.setLocalDescription(offer);
    
    socket.emit('offer', {
        target: userId,
        caller: socket.id + '-screen',
        sdp: screenPeer.localDescription
    });
}

function stopScreenSharing() {
    if (!isScreenSharing) return;
    isScreenSharing = false;
    
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    
    // Close all screen peer connections
    for (let userId in screenPeers) {
        screenPeers[userId].close();
        delete screenPeers[userId];
    }
    
    // Remove local screen UI
    const localScreenWrapper = document.getElementById('video-wrapper-local-screen');
    if (localScreenWrapper) localScreenWrapper.remove();
    
    // Tell server we stopped screen sharing so others can remove our screen video
    socket.emit('stop-screen-share', socket.id + '-screen');
    
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
