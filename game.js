import * as THREE from 'three';

// --- CONFIGURATION ---
const CONFIG = {
    roadWidth: 14,
    roadLength: 200, // Visual length of road segment
    laneCount: 3,
    startSpeed: 30, // Units per second
    maxSpeed: 80,
    acceleration: 5,
    lateralSpeed: 15,
    cameraOffset: new THREE.Vector3(0, 5, 10),
    cameraLookAt: new THREE.Vector3(0, 0, -5),
    fogDensity: 0.015,
    trafficSpawnRate: 0.8, // Increased traffic density
};

const CAMERA_VIEWS = [
    { name: 'Chase', offset: new THREE.Vector3(0, 5, 10), lookAtOffset: new THREE.Vector3(0, 0, -10) },
    { name: 'Hood', offset: new THREE.Vector3(0, 2, 0), lookAtOffset: new THREE.Vector3(0, 1.8, -20) },
    { name: 'TopDown', offset: new THREE.Vector3(0, 30, 5), lookAtOffset: new THREE.Vector3(0, 0, -5) },
    { name: 'Side', offset: new THREE.Vector3(-15, 3, 5), lookAtOffset: new THREE.Vector3(0, 0, -10) }
];

// --- STATE ---
let state = {
    isPlaying: false,
    speed: 0,
    score: 0,
    timeSinceLastSpawn: 0,
    lanes: [-3.5, 0, 3.5], // x positions for 3 lanes
    keys: { left: false, right: false, up: false, down: false, horn: false },
    gameOver: false,
    distanceTraveled: 0,
    selectedCar: 'ferrari',
    cameraIndex: 0
};

// --- SCENE SETUP ---
const canvas = document.querySelector('#game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a12);
scene.fog = new THREE.FogExp2(0x0a0a12, CONFIG.fogDensity);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);

// --- LIGHTING ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfffaed, 1.2);
dirLight.position.set(20, 50, 20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 100;
dirLight.shadow.camera.left = -20;
dirLight.shadow.camera.right = 20;
dirLight.shadow.camera.top = 20;
dirLight.shadow.camera.bottom = -20;
scene.add(dirLight);

// --- ASSETS GENERATION ---
// Helper to create simple textures procedurally to avoid external dependencies failing
function createRoadTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Asphalt
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, size, size);

    // Noise (asphalt grain)
    for (let i = 0; i < 5000; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#333' : '#222';
        ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }

    // Lane lines
    ctx.fillStyle = '#ffffff';
    // Center dashed lines
    // We want 3 lanes, so dividers at 1/3 and 2/3
    const lineWidth = 10;
    const dashLen = 60;
    const gapLen = 60;

    // Draw dashed lines for lane markers
    // Lane 1-2 divider
    for (let y = 0; y < size; y += (dashLen + gapLen)) {
        ctx.fillRect(size / 3 - lineWidth / 2, y, lineWidth, dashLen);
    }
    // Lane 2-3 divider
    for (let y = 0; y < size; y += (dashLen + gapLen)) {
        ctx.fillRect((size / 3) * 2 - lineWidth / 2, y, lineWidth, dashLen);
    }

    // Side lines (solid)
    ctx.fillStyle = '#ffcc00'; // Yellow left line
    ctx.fillRect(10, 0, lineWidth, size);
    ctx.fillStyle = '#ffffff'; // White right line
    ctx.fillRect(size - 20, 0, lineWidth, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 10); // Repeat texture 10 times along the road length
    texture.rotation = Math.PI; // Fix direction if needed
    texture.anisotropy = 16;
    return texture;
}



function createTruckMesh(color) {
    const truckGroup = new THREE.Group();
    truckGroup.userData.type = 'truck';

    // Cargo content
    const cargoGeom = new THREE.BoxGeometry(2.0, 2.5, 6);
    const cargoMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.3 });
    const cargo = new THREE.Mesh(cargoGeom, cargoMat);
    cargo.position.y = 1.5;
    cargo.castShadow = true;
    truckGroup.add(cargo);

    // Cab
    const cabGeom = new THREE.BoxGeometry(2.0, 1.8, 1.5);
    const cabMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3 });
    const cab = new THREE.Mesh(cabGeom, cabMat);
    cab.position.set(0, 1.15, -2.5); // Front of truck
    cab.castShadow = true;
    truckGroup.add(cab);

    // Wheels (6 wheels for truck)
    const wheelGeom = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const positions = [
        [-1, 0.4, 1.5], [1, 0.4, 1.5],      // Rear
        [-1, 0.4, 0], [1, 0.4, 0],          // Mid
        [-1, 0.4, -2.5], [1, 0.4, -2.5]     // Front
    ];

    truckGroup.userData.wheels = [];
    // Shared Hubcap Geom
    const hubcapGeom = new THREE.BoxGeometry(0.1, 0.25, 0.25);
    const hubcapMat = new THREE.MeshBasicMaterial({ color: 0x888888 });

    positions.forEach(pos => {
        const wheelGroup = new THREE.Group();
        wheelGroup.position.set(...pos);

        const wheel = new THREE.Mesh(wheelGeom, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheelGroup.add(wheel);

        // Hubcap to see rotation
        const cap = new THREE.Mesh(hubcapGeom, hubcapMat);
        // Position slightly out
        const offset = pos[0] > 0 ? 0.2 : -0.2;
        cap.position.x = offset;
        wheelGroup.add(cap);

        truckGroup.add(wheelGroup);
        truckGroup.userData.wheels.push(wheelGroup);
    });

    return truckGroup;
}

// Reuse createCarMesh but add wheel tracking

// Player Car Generator with Styles
function createPlayerCar(type) {
    let color = 0xff0000;

    // Configs
    const config = {
        ferrari: { color: 0xff0000, bodyW: 1.9, bodyH: 0.6, bodyL: 4.2, cabinW: 1.3, cabinH: 0.55 },
        lamborghini: { color: 0xeebb00, bodyW: 2.0, bodyH: 0.5, bodyL: 4.3, cabinW: 1.2, cabinH: 0.5 },
        bugatti: { color: 0x0077ff, bodyW: 2.1, bodyH: 0.7, bodyL: 4.4, cabinW: 1.4, cabinH: 0.6 },
        bmw: { color: 0xdddddd, bodyW: 1.8, bodyH: 0.75, bodyL: 4.0, cabinW: 1.4, cabinH: 0.65 },
        mercedes: { color: 0xaaaaaa, bodyW: 1.8, bodyH: 0.7, bodyL: 4.1, cabinW: 1.4, cabinH: 0.6 },
        toyota: { color: 0xffffff, bodyW: 1.7, bodyH: 0.7, bodyL: 3.8, cabinW: 1.3, cabinH: 0.6 }
    };

    const c = config[type] || config.ferrari;

    const carGroup = new THREE.Group();
    carGroup.userData.type = 'player';

    // Body
    const bodyGeom = new THREE.BoxGeometry(c.bodyW, c.bodyH, c.bodyL);
    const bodyMat = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.2, metalness: 0.6 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.6;
    body.castShadow = true;
    carGroup.add(body);

    // Cabin
    const cabinGeom = new THREE.BoxGeometry(c.cabinW, c.cabinH, 2);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.9 });
    const cabin = new THREE.Mesh(cabinGeom, cabinMat);
    cabin.position.set(0, 0.6 + c.cabinH / 2, -0.2);
    cabin.castShadow = true;
    carGroup.add(cabin);

    // Spoiler for sports cars
    if (type === 'ferrari' || type === 'lamborghini' || type === 'bugatti') {
        const spoilerGeom = new THREE.BoxGeometry(c.bodyW, 0.1, 0.5);
        const spoiler = new THREE.Mesh(spoilerGeom, bodyMat);
        spoiler.position.set(0, 0.6 + c.bodyH / 2 + 0.2, 1.8);
        carGroup.add(spoiler);
    }

    // Wheels
    const wheelGeom = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const positions = [
        [-c.bodyW / 2 + 0.1, 0.35, 1.2], [c.bodyW / 2 - 0.1, 0.35, 1.2],
        [-c.bodyW / 2 + 0.1, 0.35, -1.2], [c.bodyW / 2 - 0.1, 0.35, -1.2]
    ];

    carGroup.userData.wheels = [];
    const hubcapGeom = new THREE.BoxGeometry(0.1, 0.2, 0.2);
    const hubcapMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });

    positions.forEach(pos => {
        const wheelGroup = new THREE.Group();
        wheelGroup.position.set(...pos);

        const wheel = new THREE.Mesh(wheelGeom, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheelGroup.add(wheel);

        const cap = new THREE.Mesh(hubcapGeom, hubcapMat);
        const offset = pos[0] > 0 ? 0.18 : -0.18;
        cap.position.x = offset;
        wheelGroup.add(cap);

        carGroup.add(wheelGroup);
        carGroup.userData.wheels.push(wheelGroup);
    });

    // Lights
    const tailLightGeom = new THREE.BoxGeometry(0.6, 0.2, 0.1);
    const tailLightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const tl1 = new THREE.Mesh(tailLightGeom, tailLightMat);
    tl1.position.set(-0.5, 0.6 + c.bodyH / 2 - 0.2, c.bodyL / 2 + 0.01);
    const tl2 = new THREE.Mesh(tailLightGeom, tailLightMat);
    tl2.position.set(0.5, 0.6 + c.bodyH / 2 - 0.2, c.bodyL / 2 + 0.01);
    carGroup.add(tl1);
    carGroup.add(tl2);

    return carGroup;
}

// --- OBJECTS ---
// Road
const roadGeom = new THREE.PlaneGeometry(CONFIG.roadWidth, CONFIG.roadLength);
const roadMat = new THREE.MeshStandardMaterial({ map: createRoadTexture(), roughness: 0.8 });
const road = new THREE.Mesh(roadGeom, roadMat);
road.rotation.x = -Math.PI / 2;
road.receiveShadow = true;
scene.add(road);

// Environment (Grass/Ground)
const groundGeom = new THREE.PlaneGeometry(200, 200);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x154f30, roughness: 1 });
const ground = new THREE.Mesh(groundGeom, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.1;
ground.receiveShadow = true;
scene.add(ground);

// Environment Objects (Poles)
const envObjects = [];
const poleGeom = new THREE.CylinderGeometry(0.2, 0.2, 8);
const poleMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
const lightGeom = new THREE.BoxGeometry(2, 0.2, 0.5);
const lightMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

function spawnEnvObject(zPos) {
    const poleLeft = new THREE.Mesh(poleGeom, poleMat);
    poleLeft.position.set(-10, 4, zPos);

    const armLeft = new THREE.Mesh(lightGeom, lightMat);
    armLeft.position.set(1, 4, 0); // Relative to pole
    poleLeft.add(armLeft);

    scene.add(poleLeft);
    envObjects.push(poleLeft);

    const poleRight = new THREE.Mesh(poleGeom, poleMat);
    poleRight.position.set(10, 4, zPos);

    const armRight = new THREE.Mesh(lightGeom, lightMat);
    armRight.position.set(-1, 4, 0);
    poleRight.add(armRight);

    scene.add(poleRight);
    envObjects.push(poleRight);

    // Buildings
    if (Math.random() > 0.3) {
        const buildingLeft = createBuilding();
        buildingLeft.position.set(-25 - Math.random() * 20, buildingLeft.userData.height / 2, zPos + Math.random() * 10);
        scene.add(buildingLeft);
        envObjects.push(buildingLeft);
    }

    if (Math.random() > 0.3) {
        const buildingRight = createBuilding();
        buildingRight.position.set(25 + Math.random() * 20, buildingRight.userData.height / 2, zPos + Math.random() * 10);
        scene.add(buildingRight);
        envObjects.push(buildingRight);
    }
}

function createBuilding() {
    const height = 20 + Math.random() * 60;
    const width = 10 + Math.random() * 15;
    const depth = 10 + Math.random() * 15;

    const geom = new THREE.BoxGeometry(width, height, depth);
    // Dark building colors
    const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(Math.random() * 0.1 + 0.6, 0.5, 0.1),
        roughness: 0.2
    });

    const building = new THREE.Mesh(geom, mat);
    building.userData.height = height;

    // Windows (Simple emissive planes)
    const windowsGeom = new THREE.PlaneGeometry(width * 0.8, height * 0.9);
    // Make texture
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 64, 128);
    ctx.fillStyle = '#ffaa00';
    for (let i = 0; i < 30; i++) {
        if (Math.random() > 0.3) {
            const x = Math.floor(Math.random() * 4) * 16 + 4;
            const y = Math.floor(Math.random() * 8) * 16 + 4;
            ctx.fillRect(x, y, 8, 12);
        }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, Math.floor(height / 10));

    const winMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });

    const frontWin = new THREE.Mesh(windowsGeom, winMat);
    frontWin.position.z = depth / 2 + 0.1;
    building.add(frontWin);

    if (Math.random() > 0.5) {
        const sideWin = new THREE.Mesh(windowsGeom, winMat);
        sideWin.rotation.y = Math.PI / 2;
        sideWin.position.x = width / 2 + 0.1;
        sideWin.position.z = 0;
        building.add(sideWin);
    }

    return building;
}

// Side Train
let train = null;
function spawnTrain() {
    if (train) return;

    const trainGroup = new THREE.Group();
    const trainLen = 200;
    const geom = new THREE.BoxGeometry(3.5, 4, trainLen);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 0.8, roughness: 0.2 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = 2;
    trainGroup.add(mesh);

    // Glow strip
    const glowGeom = new THREE.BoxGeometry(3.6, 0.5, trainLen);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.position.y = 2;
    trainGroup.add(glow);

    trainGroup.position.set(-20, 0, -200); // Start far ahead/behind
    scene.add(trainGroup);
    train = { mesh: trainGroup, speed: 120 }; // Very fast
}

// Initial env spawn
for (let i = 0; i < 10; i++) {
    spawnEnvObject(-i * 30);
}

// Particles
const particles = [];
const particleGeom = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const particleMat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.6 });

function spawnParticle(pos) {
    const p = new THREE.Mesh(particleGeom, particleMat);
    p.position.copy(pos);
    p.position.y = 0.5;
    p.position.z += 1.8; // Behind car
    scene.add(p);
    particles.push({ mesh: p, life: 1.0 });
}

// Player Car
let playerCar; // Will be created on start
function spawnPlayer() {
    if (playerCar) scene.remove(playerCar);
    playerCar = createPlayerCar(state.selectedCar);
    playerCar.position.y = 0;
    scene.add(playerCar);
}
spawnPlayer(); // Initial spawn for title screen

// Traffic Manager
const trafficCars = [];
const trafficColors = [0xff0055, 0xffaa00, 0x00ffaa, 0xaaaaaa, 0x5555ff];

function spawnTraffic() {
    const laneIndex = Math.floor(Math.random() * 3);
    const laneX = state.lanes[laneIndex];

    // Make sure we don't spawn on top of another car too close
    // Check relative to spawn point (-100)
    const tooClose = trafficCars.some(car => {
        return Math.abs(car.position.z - (-100)) < 25 && Math.abs(car.position.x - laneX) < 1;
    });

    if (tooClose) return;

    const color = trafficColors[Math.floor(Math.random() * trafficColors.length)];
    const isTruck = Math.random() > 0.4; // 60% chance of car, 40% truck
    const car = isTruck ? createTruckMesh(color) : createPlayerCar('toyota'); // Use toyota mesh for generic traffic cars for now
    // Override color for traffic
    car.children[0].material.color.setHex(color);

    // Spawn at -100
    car.position.set(laneX, 0, -100);

    // Random speed offset
    car.userData.speedOffset = (Math.random() * 5); // 0 to 5 faster ? No, keep original range roughly

    scene.add(car);
    trafficCars.push(car);
    // console.log("Spawned traffic", isTruck ? "Truck" : "Car");
}

// --- INPUT HANDLER ---
window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') state.keys.left = true;
    if (e.key === 'ArrowRight') state.keys.right = true;
    if (e.key === 'ArrowUp') state.keys.up = true;
    if (e.key === 'ArrowDown') state.keys.down = true;
    if (e.key.toLowerCase() === 'c') {
        state.cameraIndex = (state.cameraIndex + 1) % CAMERA_VIEWS.length;
    }
    if (e.key.toLowerCase() === 'h') {
        state.keys.horn = true;
        honkHorn();
    }
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') state.keys.left = false;
    if (e.key === 'ArrowRight') state.keys.right = false;
    if (e.key === 'ArrowUp') state.keys.up = false;
    if (e.key === 'ArrowDown') state.keys.down = false;
    if (e.key.toLowerCase() === 'h') {
        state.keys.horn = false;
    }
});

// --- MOBILE CONTROLS ---
function setupMobileControls() {
    const bindBtn = (id, key) => {
        const btn = document.getElementById(id);
        if (!btn) return;

        const start = (e) => {
            e.preventDefault();
            state.keys[key] = true;
            btn.classList.add('active');
        };
        const end = (e) => {
            e.preventDefault();
            state.keys[key] = false;
            btn.classList.remove('active');
        };

        // Touch
        btn.addEventListener('touchstart', start, { passive: false });
        btn.addEventListener('touchend', end, { passive: false });
        // Mouse (for testing)
        btn.addEventListener('mousedown', start);
        btn.addEventListener('mouseup', end);
        btn.addEventListener('mouseleave', end);
    };

    bindBtn('btn-left', 'left');
    bindBtn('btn-right', 'right');
    bindBtn('btn-gas', 'up');
    bindBtn('btn-brake', 'down');

    // Horn
    const hornBtn = document.getElementById('btn-horn');
    if (hornBtn) {
        const honkStart = (e) => {
            e.preventDefault();
            state.keys.horn = true;
            hornBtn.classList.add('active');
            honkHorn();
        };
        const honkEnd = (e) => {
            e.preventDefault();
            state.keys.horn = false;
            hornBtn.classList.remove('active');
        };
        hornBtn.addEventListener('touchstart', honkStart, { passive: false });
        hornBtn.addEventListener('touchend', honkEnd, { passive: false });
        hornBtn.addEventListener('mousedown', honkStart);
        hornBtn.addEventListener('mouseup', honkEnd);
    }

    // Camera
    const camBtn = document.getElementById('btn-cam');
    if (camBtn) {
        const toggleCam = (e) => {
            e.preventDefault();
            camBtn.classList.add('active');
            state.cameraIndex = (state.cameraIndex + 1) % CAMERA_VIEWS.length;
            setTimeout(() => camBtn.classList.remove('active'), 100);
        };
        camBtn.addEventListener('touchstart', toggleCam, { passive: false });
        camBtn.addEventListener('mousedown', toggleCam);
    }
}
setupMobileControls();

function honkHorn() {
    if (!playerCar) return;

    // Visual Flash
    const body = playerCar.children.find(c => c.isMesh && c.geometry.type === 'BoxGeometry'); // Main body
    if (body) {
        const originalColor = body.material.color.getHex();
        body.material.emissive.setHex(0xffffff);
        setTimeout(() => { body.material.emissive.setHex(0x000000); }, 100);
    }

    // Find car ahead in current lane
    // Player is roughly at x = state.lanes[...]
    // Find closest lane index
    let currentLaneIdx = 1;
    let minDist = 100;
    state.lanes.forEach((lx, i) => {
        if (Math.abs(playerCar.position.x - lx) < minDist) {
            minDist = Math.abs(playerCar.position.x - lx);
            currentLaneIdx = i;
        }
    });

    const playerLaneX = state.lanes[currentLaneIdx];

    // Find closest traffic car in front
    let closestCar = null;
    let closestDist = 60; // Max honk range

    trafficCars.forEach(car => {
        // Car must be somewhat in the same lane
        if (Math.abs(car.position.x - playerLaneX) < 1.5) {
            // Car must be ahead (smaller Z since we move forward? Wait. 
            // Logic: Traffic is at neg Z? No, traffic spawns at -100 and moves +Z towards camera (0,0,10).
            // Wait, earlier logic: car.position.z += relativeSpeed * dt.
            // If relativeSpeed > 0 (player faster), car moves +Z (closer to camera/player).
            // Player is stationary at Z=0? No, checking update loop:
            // envObjects move +Z. Traffic moves +Z.
            // Player stays at Z=0 (mostly).
            // So vehicles ahead of player are at Z < 0.
            // Vehicles behind player are Z > 0 (and removed at Z>20).

            // So we look for cars with Z < playerCar.position.z (approx 0)
            // AND Z > -60 (range).

            if (car.position.z < playerCar.position.z && car.position.z > -60) {
                const d = Math.abs(car.position.z - playerCar.position.z);
                if (d < closestDist) {
                    closestDist = d;
                    closestCar = car;
                }
            }
        }
    });

    if (closestCar && !closestCar.userData.isChangingLane) {
        // Determine target lane
        // Try move right, if valid. Else left.
        // currentLaneIdx is where the car IS (approx)

        let targetIdx = currentLaneIdx + 1; // Try Right
        if (targetIdx > 2) targetIdx = currentLaneIdx - 1; // Try Left

        if (targetIdx >= 0 && targetIdx <= 2) {
            closestCar.userData.isChangingLane = true;
            closestCar.userData.targetLaneX = state.lanes[targetIdx];
            //console.log("Honk! Moving car to lane", targetIdx);
        }
    }
}

// --- UI HANDLERS ---
const startScreen = document.getElementById('start-screen');
const hud = document.getElementById('hud');
const gameOverScreen = document.getElementById('game-over-screen');
const scoreEl = document.getElementById('score-display');
const speedEl = document.getElementById('speed-display');
const finalScoreEl = document.getElementById('final-score');

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', resetGame);

function startGame() {
    state.isPlaying = true;
    state.gameOver = false;
    state.speed = CONFIG.startSpeed;
    state.score = 0;
    state.distanceTraveled = 0; // Reset distance

    startScreen.classList.add('hidden');
    hud.classList.remove('hidden');
    gameOverScreen.classList.add('hidden');

    spawnPlayer();
}

// Car Selector Logic
document.querySelectorAll('.car-option').forEach(opt => {
    opt.addEventListener('click', () => {
        // Remove active class
        document.querySelectorAll('.car-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');

        state.selectedCar = opt.dataset.car;

        // Update preview
        spawnPlayer();
        playerCar.rotation.y = 0.5; // Angled for preview
    });
});

function resetGame() {
    // Clear traffic
    trafficCars.forEach(car => scene.remove(car));
    trafficCars.length = 0;

    playerCar.position.x = 0;

    startGame();
}

function gameOver() {
    state.isPlaying = false;
    state.gameOver = true;
    state.speed = 0;

    finalScoreEl.innerText = Math.floor(state.score);
    hud.classList.add('hidden');
    gameOverScreen.classList.remove('hidden');
}

// --- GAME LOOP ---
const clock = new THREE.Clock();

function update(dt) {
    try {
        if (!state.isPlaying) return;

        // Update Score
        state.score += (state.speed * dt) / 10;
        state.distanceTraveled += (state.speed * dt); // True distance for texture scroll
        scoreEl.innerText = Math.floor(state.score);
        speedEl.innerText = Math.floor(state.speed * 2); // Fake km/h conversion

        // Increase speed over time
        // Manual Speed Control
        const acc = 15;
        const friction = 5;
        const braking = 30;

        if (state.keys.up && state.speed < CONFIG.maxSpeed) {
            state.speed += acc * dt;
        } else if (state.keys.down) {
            state.speed -= braking * dt;
        } else {
            // Coasting
            state.speed -= friction * dt;
        }

        // Clamp speed
        if (state.speed < 0) state.speed = 0;

        // Tail lights effect
        if (playerCar) {
            const tailLights = playerCar.children.filter(c => c.material && c.material.color.getHex() === 0xff0000);
            tailLights.forEach(tl => {
                tl.material.color.setHex(state.keys.down ? 0xff3333 : 0xff0000); // Brighter/Whiter red
                tl.scale.z = state.keys.down ? 1.5 : 1;
            });
        }

        // Road Scrolling (Move texture)
        if (roadMat.map) {
            roadMat.map.offset.y = -(state.distanceTraveled / 20);
        }

        // Player Movement
        // Player Movement
        if (state.keys.left && playerCar.position.x > state.lanes[0] - 1) {
            playerCar.position.x -= CONFIG.lateralSpeed * dt;
        }
        if (state.keys.right && playerCar.position.x < state.lanes[2] + 1) {
            playerCar.position.x += CONFIG.lateralSpeed * dt;
        }

        // Smooth Tilt
        playerCar.rotation.z = THREE.MathUtils.lerp(playerCar.rotation.z, (state.keys.left ? 0.1 : (state.keys.right ? -0.1 : 0)), dt * 5);
        playerCar.rotation.y = THREE.MathUtils.lerp(playerCar.rotation.y, (state.keys.left ? 0.1 : (state.keys.right ? -0.1 : 0)), dt * 5);

        // Traffic Handling
        state.timeSinceLastSpawn += dt;
        // Spawn faster as we go faster
        const spawnRate = CONFIG.trafficSpawnRate / (state.speed / 30);
        if (state.timeSinceLastSpawn > spawnRate) {
            spawnTraffic();
            state.timeSinceLastSpawn = 0;
        }

        // Move Traffic
        for (let i = trafficCars.length - 1; i >= 0; i--) {
            const car = trafficCars[i];
            const carSpeed = 20 + car.userData.speedOffset;
            const relativeSpeed = state.speed - carSpeed;

            car.position.z += relativeSpeed * dt;

            // Remove if passed camera
            if (car.position.z > 20) {
                scene.remove(car);
                trafficCars.splice(i, 1);
            }

            // Simple Collision
            const dx = Math.abs(playerCar.position.x - car.position.x);
            const dz = Math.abs(playerCar.position.z - car.position.z);

            const length = car.userData.type === 'truck' ? 6 : 4;
            const width = 1.8;

            if (dx < width * 0.8 && dz < length * 0.9) {
                console.log("Game Over Collision");
                gameOver();
            }

            // Turn wheels
            if (car.userData.wheels) {
                car.userData.wheels.forEach(w => w.rotation.x += state.speed * dt * 0.1);
            }

            // Handle Honk Lane Change
            if (car.userData.isChangingLane) {
                // Lerp x to target
                const moveSpeed = 10; // Fast lane change (0.2s reactionish)
                const dir = Math.sign(car.userData.targetLaneX - car.position.x);
                car.position.x += dir * moveSpeed * dt;

                // Check if arrived
                if (Math.abs(car.position.x - car.userData.targetLaneX) < 0.1) {
                    car.position.x = car.userData.targetLaneX;
                    car.userData.isChangingLane = false;
                }

                // Rotate slightly
                car.rotation.y = -dir * 0.1;
            } else {
                // Return to straight
                car.rotation.y = THREE.MathUtils.lerp(car.rotation.y, 0, dt * 5);
            }
        }

        // Move Environment
        envObjects.forEach((obj, index) => {
            obj.position.z += state.speed * dt;
            if (obj.position.z > 20) {
                obj.position.z -= 300; // Reset far back
            }
        });

        // Spawn Particles
        if (state.speed > 40 && Math.random() > 0.8) {
            spawnParticle(playerCar.position);
        }

        // Update Particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life -= dt * 2;
            p.mesh.position.z += (state.speed * 0.5) * dt;
            p.mesh.position.y += dt;
            p.mesh.scale.setScalar(2 - p.life);
            p.mesh.material.opacity = p.life;

            if (p.life <= 0) {
                scene.remove(p.mesh);
                particles.splice(i, 1);
            }
        }

        // Animate Player Wheels
        if (playerCar.userData.wheels) {
            playerCar.userData.wheels.forEach(w => w.rotation.x += state.speed * dt * 0.5);
        }

        // FOV effect
        const targetFOV = 60 + (state.speed / CONFIG.maxSpeed) * 30;
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, dt);
        camera.updateProjectionMatrix();

        // Train
        if (!train && Math.random() < 0.005) {
            spawnTrain();
        }
        if (train) {
            train.mesh.position.z += (train.speed + state.speed) * dt; // Move towards camera fast
            if (train.mesh.position.z > 200) {
                scene.remove(train.mesh);
                train = null;
            }
        }

    } catch (err) {
        console.error("Game Loop Error:", err);
    }
}

function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);

function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(clock.getDelta(), 0.1); // Cap dt

    update(dt);

    if (state.isPlaying) {
        // Camera System
        const view = CAMERA_VIEWS[state.cameraIndex];

        // Target position based on car + view offset
        const targetX = playerCar.position.x + view.offset.x;
        const targetY = view.offset.y;
        const targetZ = playerCar.position.z + view.offset.z;

        // Smooth lerp
        camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, dt * 3);
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, dt * 3);
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, dt * 3);

        // Shake logic
        const shake = (state.speed / CONFIG.maxSpeed) * 0.1;
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;

        // Look At
        const lookTarget = new THREE.Vector3(
            playerCar.position.x + view.lookAtOffset.x,
            playerCar.position.y + view.lookAtOffset.y,
            playerCar.position.z + view.lookAtOffset.z
        );
        camera.lookAt(lookTarget);
    } else {
        // Idle camera animation
        camera.position.x = Math.sin(Date.now() * 0.0005) * 20;
        camera.position.y = 15;
        camera.position.z = 25;
        camera.lookAt(0, 0, 0);
    }

    renderer.render(scene, camera);
}

// Initial setup
playerCar.position.y = 0;
// Tilt camera down
camera.position.copy(CONFIG.cameraOffset);
camera.lookAt(CONFIG.cameraLookAt);

animate();
