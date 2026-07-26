const socket = io('/');

// UI Elements
const loginMenu = document.getElementById('login-menu');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const uiLayer = document.getElementById('ui-layer');
const healthFill = document.getElementById('health-fill');
const myScoreEl = document.getElementById('my-score');
const killFeed = document.getElementById('kill-feed');

// Game State
let myId = null;
let myHealth = 100;
let myScore = 0;
let isPlaying = false;
const playerMeshes = {}; // Kumpulan 3D Object pemain lain
let scene, camera, renderer, controls, raycaster;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

// Inisialisasi Game
joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim() || 'Player';
    socket.emit('join-game', username);
    loginMenu.style.display = 'none';
    uiLayer.style.display = 'block';
    initThreeJS();
    isPlaying = true;
});

function initThreeJS() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510);
    scene.fog = new THREE.Fog(0x050510, 10, 50);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Controls (PointerLock)
    controls = new THREE.PointerLockControls(camera, document.body);
    document.addEventListener('click', () => {
        if (isPlaying) controls.lock();
    });

    // Raycaster (Untuk menembak)
    raycaster = new THREE.Raycaster();

    // Lingkungan (Lantai Grid)
    const gridHelper = new THREE.GridHelper(100, 100, 0x00ffff, 0x003333);
    scene.add(gridHelper);

    // Pencahayaan
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    // Input WASD
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseClick); // Tembak

    // Start Loop
    animate();
}

function onKeyDown(event) {
    switch (event.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyD': moveRight = true; break;
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyD': moveRight = false; break;
    }
}

function onMouseClick(event) {
    if (event.button !== 0 || !controls.isLocked) return; // Hanya klik kiri
    
    // Suara atau efek tembakan (sederhana)
    drawLaser();

    // Deteksi target
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    
    const targets = Object.values(playerMeshes);
    const intersects = raycaster.intersectObjects(targets);

    if (intersects.length > 0) {
        const hitObject = intersects[0].object;
        socket.emit('shoot', hitObject.userData.id);
    }
}

function drawLaser() {
    // Efek tembakan laser sederhana
    const material = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 2 });
    const points = [];
    
    // Dari bawah kamera sedikit
    const start = camera.position.clone();
    start.y -= 0.2;
    
    // Ke depan kamera
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const end = start.clone().add(direction.multiplyScalar(50));
    
    points.push(start);
    points.push(end);
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    
    setTimeout(() => {
        scene.remove(line);
        geometry.dispose();
        material.dispose();
    }, 100);
}

// Membuat Pemain Lain (Bentuk Kubus)
function createPlayerMesh(playerData) {
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const material = new THREE.MeshLambertMaterial({ color: playerData.color });
    const mesh = new THREE.Mesh(geometry, material);
    
    mesh.position.set(playerData.x, playerData.y, playerData.z);
    mesh.userData = { id: playerData.id };
    
    scene.add(mesh);
    return mesh;
}

// JARINGAN SOCKET.IO /////////////////////////////

socket.on('connect', () => {
    myId = socket.id;
});

socket.on('current-players', (serverPlayers) => {
    for (let id in serverPlayers) {
        if (id !== myId && !playerMeshes[id]) {
            playerMeshes[id] = createPlayerMesh(serverPlayers[id]);
        } else if (id === myId) {
            // Set posisi awal kita
            camera.position.set(serverPlayers[id].x, 2, serverPlayers[id].z);
        }
    }
});

socket.on('new-player', (playerData) => {
    if (!playerMeshes[playerData.id]) {
        playerMeshes[playerData.id] = createPlayerMesh(playerData);
    }
});

socket.on('player-disconnected', (id) => {
    if (playerMeshes[id]) {
        scene.remove(playerMeshes[id]);
        delete playerMeshes[id];
    }
});

// Update Posisi 20FPS dari Server
socket.on('state-update', (serverPlayers) => {
    if (!isPlaying) return;
    
    for (let id in serverPlayers) {
        if (id !== myId && playerMeshes[id]) {
            // Interpolasi (gerakan mulus) bisa ditambahkan di sini, sementara langsung set:
            playerMeshes[id].position.x = serverPlayers[id].x;
            playerMeshes[id].position.y = serverPlayers[id].y;
            playerMeshes[id].position.z = serverPlayers[id].z;
            
            // Putar kotak mengikuti arah melihatnya
            playerMeshes[id].rotation.y = serverPlayers[id].rotation;
        } else if (id === myId) {
            // Sinkronisasi Data Kita (Nyawa/Skor)
            myScore = serverPlayers[id].score;
            myScoreEl.innerText = myScore;
        }
    }
});

socket.on('health-update', (data) => {
    if (data.id === myId) {
        myHealth = data.health;
        
        // Ubah warna bar jika sekarat
        healthFill.style.width = Math.max(0, myHealth) + '%';
        if (myHealth <= 30) {
            healthFill.style.background = '#f00';
        } else {
            healthFill.style.background = '#0f0';
        }
    } else if (playerMeshes[data.id]) {
        // Efek kedip merah saat player lain tertembak
        const mat = playerMeshes[data.id].material;
        const oriColor = mat.color.getHex();
        mat.color.setHex(0xff0000);
        setTimeout(() => mat.color.setHex(oriColor), 100);
    }
});

socket.on('player-killed', (data) => {
    // Tampilkan di UI feed
    const el = document.createElement('div');
    el.className = 'kill-msg';
    el.innerText = `${data.killer} membunuh ${data.victim}`;
    killFeed.appendChild(el);
    setTimeout(() => el.remove(), 4000);

    // Jika kita yang mati, teleport kembali
    if (data.victimId === myId) {
        camera.position.set(data.newPos.x, 2, data.newPos.z);
        myHealth = 100;
        healthFill.style.width = '100%';
        healthFill.style.background = '#0f0';
        
        // Efek mati di layar
        uiLayer.style.background = 'rgba(255, 0, 0, 0.5)';
        setTimeout(() => uiLayer.style.background = 'none', 300);
    }
});

// GAME LOOP UTAMA ////////////////////////////////
function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();

    if (controls.isLocked === true) {
        const delta = (time - prevTime) / 1000;

        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize(); // Biar lari serong tidak lebih cepat

        if (moveForward || moveBackward) velocity.z -= direction.z * 100.0 * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * 100.0 * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);
        
        // Jaga agar kamera tetap di ketinggian 2 (tinggi mata)
        camera.position.y = 2;

        // Kirim pergerakan kita ke server
        socket.emit('player-movement', {
            x: camera.position.x,
            y: 1, // Ketinggian body/kubus
            z: camera.position.z,
            rotation: camera.rotation.y
        });
    }

    prevTime = time;
    renderer.render(scene, camera);
}

// Resize Layar
window.addEventListener('resize', () => {
    if(camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});
