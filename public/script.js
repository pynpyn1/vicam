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
const playerMeshes = {}; 
const obstacles = [];
const lasers = [];
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
    // 1. Scene & Environment
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510);
    scene.fog = new THREE.FogExp2(0x050510, 0.015);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // 4. Controls (PointerLock Khusus PC)
    controls = new THREE.PointerLockControls(camera, document.body);
    document.addEventListener('click', () => {
        if (isPlaying) controls.lock();
    });

    raycaster = new THREE.Raycaster();

    // 5. Lantai Arena
    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0a1a, roughness: 0.8, metalness: 0.2 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const gridHelper = new THREE.GridHelper(200, 100, 0x00ffff, 0x002244);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // 6. Langit Bintang
    const starGeo = new THREE.BufferGeometry();
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 });
    const starVertices = [];
    for(let i=0; i<1500; i++) {
        starVertices.push((Math.random() - 0.5) * 400, Math.random() * 200 + 10, (Math.random() - 0.5) * 400);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // 7. Pencahayaan
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 500;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    scene.add(dirLight);

    // 8. Tambahkan Pilar Rintangan Neon
    createArenaObstacles();

    // Input WASD
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseClick); // Tembak

    // Mulai Render
    animate();
}

function createArenaObstacles() {
    const geo = new THREE.BoxGeometry(4, 15, 4);
    for(let i=0; i<40; i++) {
        const isBlue = Math.random() > 0.5;
        const mat = new THREE.MeshStandardMaterial({ 
            color: 0x222222, 
            emissive: isBlue ? 0x0044ff : 0xff0044,
            emissiveIntensity: 0.2,
            roughness: 0.1,
            metalness: 0.8
        });
        const mesh = new THREE.Mesh(geo, mat);
        
        mesh.position.set((Math.random() - 0.5) * 180, 7.5, (Math.random() - 0.5) * 180);
        
        if (mesh.position.length() < 20) continue; 
        
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        obstacles.push(mesh);
    }
    
    const wallGeo = new THREE.BoxGeometry(200, 20, 2);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x00ffff, emissiveIntensity: 0.1 });
    
    const wall1 = new THREE.Mesh(wallGeo, wallMat); wall1.position.set(0, 10, -100); scene.add(wall1);
    const wall2 = new THREE.Mesh(wallGeo, wallMat); wall2.position.set(0, 10, 100); scene.add(wall2);
    const wall3 = new THREE.Mesh(wallGeo, wallMat); wall3.position.set(-100, 10, 0); wall3.rotation.y = Math.PI/2; scene.add(wall3);
    const wall4 = new THREE.Mesh(wallGeo, wallMat); wall4.position.set(100, 10, 0); wall4.rotation.y = Math.PI/2; scene.add(wall4);
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
    if (event.button !== 0 || !controls.isLocked) return; 
    
    drawLaser();

    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    
    const targets = [];
    for(let id in playerMeshes) targets.push(playerMeshes[id]);

    const intersects = raycaster.intersectObjects(targets, true);

    if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        while(hitObj.parent && !hitObj.userData.id && hitObj.parent.type !== 'Scene') {
            hitObj = hitObj.parent;
        }
        
        if (hitObj.userData.id) {
            socket.emit('shoot', hitObj.userData.id);
        }
    }
}

function drawLaser() {
    const geometry = new THREE.CylinderGeometry(0.05, 0.05, 15, 8);
    geometry.rotateX(Math.PI / 2); 
    const material = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const laser = new THREE.Mesh(geometry, material);
    
    laser.position.copy(camera.position);
    laser.position.y -= 0.3; 
    laser.position.x += 0.3; 
    
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    
    laser.position.add(direction.clone().multiplyScalar(7.5)); 
    laser.quaternion.copy(camera.quaternion);
    
    scene.add(laser);
    lasers.push({ mesh: laser, dir: direction, life: 1.0 });
}

function createPlayerMesh(playerData) {
    const group = new THREE.Group();
    
    const geoBody = new THREE.CylinderGeometry(0.7, 0.7, 2, 16);
    const matBody = new THREE.MeshStandardMaterial({ 
        color: playerData.color,
        emissive: playerData.color,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.8
    });
    const body = new THREE.Mesh(geoBody, matBody);
    body.position.y = 1;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    
    const geoRing = new THREE.TorusGeometry(1.2, 0.05, 16, 32);
    const matRing = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ring = new THREE.Mesh(geoRing, matRing);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.5;
    group.add(ring);
    
    group.position.set(playerData.x, 0, playerData.z);
    group.userData = { id: playerData.id };
    
    scene.add(group);
    return group;
}

function checkCollision(newPos) {
    if (newPos.x > 98 || newPos.x < -98 || newPos.z > 98 || newPos.z < -98) return true;
    
    for(let obs of obstacles) {
        if (Math.abs(newPos.x - obs.position.x) < 2.5 && Math.abs(newPos.z - obs.position.z) < 2.5) {
            return true;
        }
    }
    return false;
}

// JARINGAN SOCKET.IO
socket.on('connect', () => { myId = socket.id; });
socket.on('current-players', (serverPlayers) => {
    for (let id in serverPlayers) {
        if (id !== myId && !playerMeshes[id]) {
            playerMeshes[id] = createPlayerMesh(serverPlayers[id]);
        } else if (id === myId) {
            camera.position.set(serverPlayers[id].x, 2, serverPlayers[id].z);
        }
    }
});
socket.on('new-player', (playerData) => {
    if (!playerMeshes[playerData.id]) playerMeshes[playerData.id] = createPlayerMesh(playerData);
});
socket.on('player-disconnected', (id) => {
    if (playerMeshes[id]) { scene.remove(playerMeshes[id]); delete playerMeshes[id]; }
});
socket.on('state-update', (serverPlayers) => {
    if (!isPlaying) return;
    
    for (let id in serverPlayers) {
        if (id !== myId && playerMeshes[id]) {
            playerMeshes[id].position.x += (serverPlayers[id].x - playerMeshes[id].position.x) * 0.2;
            playerMeshes[id].position.z += (serverPlayers[id].z - playerMeshes[id].position.z) * 0.2;
            playerMeshes[id].children[1].rotation.z += 0.05;
            playerMeshes[id].rotation.y = serverPlayers[id].rotation;
        } else if (id === myId) {
            myScore = serverPlayers[id].score;
            myScoreEl.innerText = myScore;
        }
    }
});
socket.on('health-update', (data) => {
    if (data.id === myId) {
        myHealth = data.health;
        healthFill.style.width = Math.max(0, myHealth) + '%';
        if (myHealth <= 30) {
            healthFill.style.background = '#f00';
            uiLayer.style.background = 'rgba(255, 0, 0, 0.2)';
            setTimeout(() => uiLayer.style.background = 'none', 100);
        } else {
            healthFill.style.background = '#0f0';
        }
    } else if (playerMeshes[data.id]) {
        const body = playerMeshes[data.id].children[0];
        const oriColor = body.material.color.getHex();
        body.material.color.setHex(0xffffff);
        setTimeout(() => body.material.color.setHex(oriColor), 100);
    }
});
socket.on('player-killed', (data) => {
    const el = document.createElement('div');
    el.className = 'kill-msg';
    el.innerHTML = `<span style="color:#0ff">${data.killer}</span> meledakkan <span style="color:#f00">${data.victim}</span>`;
    killFeed.appendChild(el);
    setTimeout(() => el.remove(), 4000);

    if (data.victimId === myId) {
        camera.position.set(data.newPos.x, 2, data.newPos.z);
        myHealth = 100;
        healthFill.style.width = '100%';
        healthFill.style.background = '#0f0';
        uiLayer.style.background = 'rgba(255, 0, 0, 0.8)';
        setTimeout(() => uiLayer.style.background = 'none', 500);
    }
});

// GAME LOOP UTAMA
function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();

    for(let i = lasers.length - 1; i >= 0; i--) {
        const l = lasers[i];
        l.mesh.position.add(l.dir.clone().multiplyScalar(2)); 
        l.life -= 0.05;
        if (l.life <= 0) { scene.remove(l.mesh); lasers.splice(i, 1); }
    }

    if (controls.isLocked === true) {
        const delta = (time - prevTime) / 1000;

        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize(); 

        if (moveForward || moveBackward) velocity.z -= direction.z * 100.0 * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * 100.0 * delta;

        const currentPos = camera.position.clone();

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);
        
        if (checkCollision(camera.position)) {
            camera.position.copy(currentPos);
        }

        camera.position.y = 2; // Kunci ketinggian mata

        socket.emit('player-movement', {
            x: camera.position.x,
            y: 0, 
            z: camera.position.z,
            rotation: camera.rotation.y
        });
    }

    prevTime = time;
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    if(camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});
