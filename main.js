import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildShip } from './ship.js';
import { buildWorld, buildPirate } from './world.js';
import { HULL_WATERLINE_GLSL } from './ship-layout.js';
import { createPlayerController } from './player-controller.js';
import { updatePirateBody } from './player-body.js';
import { createInteractionTargets } from './interaction-targets.js';
import {createCrewSystem} from './crew.js';
import {createCrewCommandPanel} from './crew-ui.js';
import { ITEMS, equippedItem, selectItem, moveSlot, returnCursor, dropSelected, inventoryTotals, saveVoyage, restoreVoyage, STORAGE_KEY } from './inventory.js';
import { createGame, stepGame, interact, dive, interactions, playerWorld, isDocked, ISLAND, toWorld, recordChartVisit, voyageObjective, deckHeight, walkingHeight, groundHeight, PLAYER_HEIGHT, PLAYER_EYE_HEIGHT } from './game.js';

const container = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, container.clientWidth < 720 ? 1.5 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setSize(container.clientWidth, container.clientHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label', '海盗游戏画面：WASD 移动，左键互动，E 背包，空格跳跃，M 航海图');
renderer.domElement.tabIndex = 0;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#35565b', .004);
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, .04);
scene.environment = environment.texture;
scene.environmentIntensity = .38;
room.dispose();
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(container.clientWidth < container.clientHeight ? 70 : 62, container.clientWidth / container.clientHeight, .04, 900);
const initialPosition = new THREE.Vector3(3.1, 5.2, -.8);
const initialTarget = new THREE.Vector3(-4, 5.0, 2);
camera.position.copy(initialPosition);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(initialTarget);
controls.enableDamping = true;
controls.dampingFactor = .065;
controls.minDistance = 5.5;
controls.maxDistance = 110;
controls.maxPolarAngle = Math.PI * .46;
controls.minPolarAngle = .15;
controls.autoRotateSpeed = .35;
controls.enablePan = false;
controls.update();
controls.saveState();

// First person rides at eye height looking along lookYaw/lookPitch; the rest keeps OrbitControls.
// yaw follows game.js: forward = (sin(yaw), 0, cos(yaw)), matching player.yaw = atan2(dx, dz).
const EYE_HEIGHT = PLAYER_EYE_HEIGHT;
let firstPerson = true;
let lookYaw = -Math.PI / 2, lookPitch = 0;
let dragging = false, dragMoved = 0;
const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const lookForward = new THREE.Vector3();

const hemi=new THREE.HemisphereLight('#bedde3', '#46372d', 1.8);scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffdcad', 3.1);
sun.position.set(8, 20, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(container.clientWidth < 720 ? 1024 : 2048, container.clientWidth < 720 ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 42, bottom: -28, near: 1, far: 130 });
sun.shadow.normalBias = .045;
sun.shadow.bias = -.0002;
scene.add(sun);
const rim = new THREE.DirectionalLight('#87bdcc', 1.5);
rim.position.set(-15, 12, -14);
scene.add(rim);

const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: { top: { value: new THREE.Color('#245066') }, horizon: { value: new THREE.Color('#829995') }, bottom: { value: new THREE.Color('#294c54') } },
  vertexShader: `varying vec3 direction; void main() { direction = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    varying vec3 direction; uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
    void main() {
      vec3 d = normalize(direction);
      vec3 color = mix(horizon, top, pow(clamp(d.y * 2.6, 0., 1.), .6));
      color = mix(color, bottom, 1. - smoothstep(-.5, .02, d.y));
      float glow = pow(max(dot(d, normalize(vec3(-.65, .12, -.6))), 0.), 16.);
      color += vec3(.27, .15, .045) * glow;
      float cloud = sin(d.x * 27. + sin(d.z * 19.) * 2.) * sin(d.z * 32. + d.y * 58.);
      color = mix(color, vec3(.48, .54, .53), smoothstep(.25, .8, cloud) * smoothstep(.04, .17, d.y) * (1. - smoothstep(.25, .55, d.y)) * .18);
      gl_FragColor = vec4(color, 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
}));
sky.renderOrder = -2;
scene.add(sky);

function canvasTexture(size, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}
let randomSeed = 37;
function random() { randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0; return randomSeed / 4294967296; }
const woodTexture = canvasTexture(512, (ctx, size) => {
  ctx.fillStyle = '#ba9f7c'; ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 64) {
    ctx.fillStyle = `rgba(49,28,15,${.07 + random() * .1})`;
    ctx.fillRect(0, y, size, 64);
    ctx.fillStyle = '#4e3c2e'; ctx.fillRect(0, y, size, 2);
    for (let j = 0; j < 35; j++) {
      ctx.strokeStyle = `rgba(77,49,29,${.04 + random() * .1})`;
      ctx.lineWidth = random() * 1.6;
      const grain = y + 3 + random() * 58;
      ctx.beginPath(); ctx.moveTo(0, grain);
      ctx.bezierCurveTo(140, grain - 5, 300, grain + 6, size, grain + random() * 5); ctx.stroke();
    }
    const end = 75 + random() * 365;
    ctx.fillStyle = '#705640'; ctx.fillRect(end, y, 1, 64);
    for (const x of [end - 6, end + 7]) for (const dy of [8, 55]) { ctx.beginPath(); ctx.arc(x, y + dy, 1.5, 0, Math.PI * 2); ctx.fill(); }
  }
});
woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
const clothTexture = canvasTexture(512, (ctx, size) => {
  ctx.fillStyle = '#e9dec2'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 12000; i++) {
    ctx.fillStyle = `rgba(94,71,37,${random() * .08})`;
    ctx.fillRect(random() * size, random() * size, 2, 2);
  }
  for (let x = 0; x < size; x += 64) {
    ctx.fillStyle = '#aa967144'; ctx.fillRect(x, 0, 2, size);
    ctx.fillStyle = '#fff6dc88'; ctx.fillRect(x + 2, 0, 1, size);
    ctx.setLineDash([3, 6]); ctx.strokeStyle = '#94866577'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 5, 0); ctx.lineTo(x + 5, size); ctx.stroke();
  }
  const stain = ctx.createRadialGradient(256, 490, 0, 256, 490, 410);
  stain.addColorStop(0, '#96794a44'); stain.addColorStop(1, '#96794a00');
  ctx.fillStyle = stain; ctx.fillRect(0, 0, size, size);
});
const skullTexture = canvasTexture(256, (ctx) => {
  ctx.fillStyle = '#252a2c'; ctx.strokeStyle = '#252a2c'; ctx.lineWidth = 15; ctx.lineCap = 'round';
  for (const flip of [1, -1]) {
    ctx.beginPath(); ctx.moveTo(58, flip === 1 ? 180 : 232); ctx.lineTo(196, flip === 1 ? 232 : 180); ctx.stroke();
    for (const [x, y] of [[54, flip === 1 ? 176 : 228], [201, flip === 1 ? 236 : 184]]) {
      ctx.beginPath(); ctx.arc(x - 4, y - 4, 10, 0, Math.PI * 2); ctx.arc(x + 5, y + 5, 10, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.beginPath(); ctx.ellipse(128, 91, 68, 64, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(83, 101, 90, 57);
  ctx.beginPath(); ctx.roundRect(99, 142, 58, 32, 8); ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  for (const x of [99, 157]) { ctx.beginPath(); ctx.ellipse(x, 107, 19, 22, x < 128 ? -.18 : .18, 0, Math.PI * 2); ctx.fill(); }
  ctx.beginPath(); ctx.moveTo(128, 123); ctx.lineTo(118, 142); ctx.lineTo(138, 142); ctx.closePath(); ctx.fill();
  for (const x of [113, 127, 141]) ctx.fillRect(x, 152, 4, 22);
});
const flagSkullTexture = canvasTexture(256, (ctx) => {
  ctx.drawImage(skullTexture.image, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#eee7cf'; ctx.fillRect(0, 0, 256, 256);
});
const { ship, sails, flags, wheel, rudder, setAnchorLift, lamps, lampFixtures, hatchLid, cargoGrating, capstanBars, capstanBrake, windlassDrum, telescope, setSailFurl, animateSails } = buildShip({ skull: skullTexture, flagSkull: flagSkullTexture });
scene.add(ship);
const world = buildWorld(scene, ship, woodTexture);
const allLampFixtures=[...lampFixtures,...world.lampFixtures];
world.layout.lamps=allLampFixtures;
const interiorLights=world.lampFixtures.filter(f=>f.light).map(f=>f.light);
lampFixtures.forEach(f=>f.fixedLight=f.light);
for(const f of world.lampFixtures)f.light=null;
const { pirate, legs, arms } = buildPirate();
scene.add(pirate);
const controller = await createPlayerController(world.layout);
const targets = createInteractionTargets({ship,world,pirate,wheel,capstanBrake,capstanBars,hatchLid,cargoGrating,telescope});
let game = createGame();
game.layout=world.layout;game.controller=controller;controller.reset(game);

const loadedVoyage = !new URLSearchParams(location.search).has('qa') && restoreVoyage(game);
controller.reset(game);
const crew=await createCrewSystem({scene,ship,sails,capstanBars,layout:world.layout,game,onChange:()=>save()});
const seaUniforms = {
  time: { value: 0 },
  deepColor: { value: new THREE.Color('#063b46') },
  shallowColor: { value: new THREE.Color('#1b6a72') },
  skyColor: { value: new THREE.Color('#7daba8') },
  lightDirection: { value: sun.position.clone().normalize() },
  shipPosition: { value: new THREE.Vector2() },
  shipHeading: { value: 0 },
  shipSpeed: { value: 0 },
};
const sea = new THREE.Mesh(new THREE.PlaneGeometry(620, 620, 260, 260), new THREE.ShaderMaterial({
  uniforms: seaUniforms,
  transparent: true,
  depthWrite: false,
  vertexShader: `
    uniform float time;
    varying vec3 worldPosition; varying vec3 waveNormal; varying float elevation;
    void main() {
      vec3 p = position;
      float a = p.x * .43 + p.y * .31 + time * .72;
      float b = p.x * -.27 + p.y * .58 - time * .53;
      float c = p.x * 1.05 + p.y * .81 + time * .92;
      p.z = sin(a) * .105 + sin(b) * .068 + sin(c) * .026;
      float dx = cos(a) * .04515 - cos(b) * .01836 + cos(c) * .0273;
      float dy = cos(a) * .03255 + cos(b) * .03944 + cos(c) * .02106;
      waveNormal = normalize(mat3(modelMatrix) * vec3(-dx, -dy, 1.));
      worldPosition = (modelMatrix * vec4(p, 1.)).xyz;
      elevation = p.z;
      gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.);
    }`,
  fragmentShader: `
    uniform float time; uniform vec3 deepColor; uniform vec3 shallowColor; uniform vec3 skyColor; uniform vec3 lightDirection;
    uniform vec2 shipPosition; uniform float shipHeading; uniform float shipSpeed;
    varying vec3 worldPosition; varying vec3 waveNormal; varying float elevation;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
    }
    ${HULL_WATERLINE_GLSL}
    void main() {
      vec3 view = normalize(cameraPosition - worldPosition);
      vec2 p = worldPosition.xz;
      vec2 relative = p - shipPosition;
      float c = cos(shipHeading), s = sin(shipHeading);
      vec2 local = vec2(c * relative.x - s * relative.y, s * relative.x + c * relative.y);
      if(abs(local.y) < shipWaterlineWidth(local.x)-.04)discard;
      float fine = noise(p * 3.5 + time * .1);
      vec3 n = normalize(waveNormal + vec3((fine - .5) * .075, 0., (noise(p * 5. - time * .12) - .5) * .075));
      float fresnel = pow(1. - max(dot(n, view), 0.), 3.);
      vec3 color = mix(deepColor, shallowColor, .25 + elevation * 1.1 + noise(p * .19) * .2);
      color = mix(color, skyColor, fresnel * .65);
      float shore = length((p - vec2(0., -52.)) / vec2(24., 26.));
      float shoal = 1. - smoothstep(1., 1.6, shore);
      color = mix(color, vec3(.055, .36, .34), shoal * .6);
      float surf = (1. - smoothstep(.012, .07, abs(shore - 1.015 - sin(time * .7) * .017))) * (.55 + fine * .45);
      color += vec3(.43, .57, .48) * surf * .42;
      vec3 reflected = reflect(-lightDirection, n);
      float specular = pow(max(dot(reflected, view), 0.), 190.);
      color += vec3(1., .82, .52) * specular * 1.8;
      float crest = smoothstep(.118, .198, elevation) * smoothstep(.55, .78, noise(p * 2.4 + time * .16));
      color += vec3(.3, .51, .47) * crest * .26;
      // A soft contact shadow helps the hull sit in the water.
      float hullShadow = exp(-pow(local.x / 15.5, 4.) - pow(local.y / 4.2, 4.));
      color *= 1. - hullShadow * .38;
      float wakeX = -local.x - 16.5;
      float wakeWidth = 3.8 + max(wakeX, 0.) * .18;
      float wake = smoothstep(0., 1., wakeX) * (1. - smoothstep(1., 42., wakeX)) * (1. - smoothstep(.05, .45, abs(abs(local.y) - wakeWidth)));
      color += vec3(.32, .51, .46) * wake * clamp(shipSpeed / 3., 0., 1.) * (.35 + fine * .65);
      float distanceFade = 1. - exp(-length(cameraPosition - worldPosition) * .006);
      color = mix(color, vec3(.052, .13, .15), distanceFade);
      float edgeFade = 1. - smoothstep(135., 175., length(p));
      gl_FragColor = vec4(color, (.84 - fresnel * .04) * edgeFade);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
}));
sea.rotation.x = -Math.PI / 2;
sea.renderOrder = 3;
scene.add(sea);

// Only the patch immediately under the ship exists below the sea.
const seabed = new THREE.Mesh(new THREE.CircleGeometry(46, 72), new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  vertexShader: `varying vec2 patchUv; void main() { patchUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `
    varying vec2 patchUv;
    void main() {
      float radius = length(patchUv - .5) * 2.;
      gl_FragColor = vec4(.075, .15, .13, 1. - smoothstep(.45, 1., radius));
      #include <colorspace_fragment>
    }`
}));
seabed.rotation.x = -Math.PI / 2;
seabed.position.y = -8.2;
seabed.receiveShadow = true;
scene.add(seabed);
// Small foam traces follow the hull without implying forward travel.
const foamGeometry = new THREE.BufferGeometry();
const foamPositions = [];
for (let i = 0; i < 150; i++) {
  const x = (random() - .5) * 30;
  const z = (random() < .5 ? -1 : 1) * (3.6 + random() * 1.3);
  foamPositions.push(x, .15 + random() * .03, z);
}
foamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(foamPositions, 3));
const foam = new THREE.Points(foamGeometry, new THREE.PointsMaterial({ color: '#c7e2d7', size: .065, transparent: true, opacity: .3, depthWrite: false }));
foam.renderOrder = 4;
scene.add(foam);

// Three shared rings make entering the water readable, then settle into swimming ripples.
const ripples = new THREE.Group(); scene.add(ripples);
const rippleMaterial = new THREE.MeshBasicMaterial({ color: '#d5e8cf', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
for (let i = 0; i < 3; i++) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(.88, 1, 48), rippleMaterial.clone());
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 4; ripples.add(ring);
}
const contactTexture = canvasTexture(64, (ctx) => {
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, '#07141188'); gradient.addColorStop(1, '#07141100');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
});
const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false }));
contact.rotation.x = -Math.PI / 2; scene.add(contact);

let reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let elapsed = 0, lastMode = game.mode, anchorLift = -1, uiTime = 0;
let started = false, testPaused = false, cameraManualTime = 0, cameraHeading = 0, capstanSpin = 0, gait = 0, gaitAmount = 0, smoothYaw = game.player.yaw, splashTime = 0, wasSubmerged = false;
const previousPlayer = new THREE.Vector3(), cameraTarget = new THREE.Vector3(), cameraShift = new THREE.Vector3(), cameraOffset = new THREE.Vector3();
const keys = new Set(), taps = new Map();
let jump = false;
const chart = document.querySelector('#chart');
const help = document.querySelector('#help');
const welcome = document.querySelector('#welcome');
const actionButton = document.querySelector('#action');
const inventory = document.querySelector('#inventory');
const crewDialog=document.querySelector('#crew-panel');
const crosshair = document.querySelector('#crosshair'), targetLabel=document.querySelector('#target-label');
const mouseResume=document.querySelector('#mouse-resume');
let openContainer=null, target=null, primaryDown=false, heldAction=null, awaitingMouse=true, compatControl=false, touchInput=false, lastPointerType='mouse', mouseSensitivity=.0028, placement=false;
let hotbarSignature='';
const droppedMeshes=new Map();
let selectedActionId=null;
const toast = document.querySelector('#toast');
const chartCanvas = document.querySelector('#chart-canvas');
const chartCtx = chartCanvas.getContext('2d');
const locationText = document.querySelector('#location');
const anchorText = document.querySelector('#anchor-state');
const speedText = document.querySelector('#speed');
const headingText = document.querySelector('#heading');
const hintText = document.querySelector('#mode-hint');
const actionName = document.querySelector('#action-name');
const actionHint = document.querySelector('#action-hint');
const jumpButton = document.querySelector('#jump-button');
const voyageTitle = document.querySelector('#voyage-title'), voyageHint = document.querySelector('#voyage-hint');
const voyageCount = document.querySelector('#voyage-count'), voyageProgress = document.querySelector('#voyage-progress');
const anchorProgress = document.querySelector('#anchor-progress'), compassNeedle = document.querySelector('#compass-needle'), rudderValue = document.querySelector('#rudder-value');

function clearInput() { keys.clear(); taps.clear(); jump=false; dragging=false;primaryDown=false;heldAction=null;game.anchorHeld=false; }
const panelOpen=()=>chart.open||help.open||inventory.open||welcome.open||crewDialog.open;
const simulationPaused=()=>!started||panelOpen()||testPaused||awaitingMouse;
function showResume(){document.body.dataset.panel=String(panelOpen()||awaitingMouse);mouseResume.hidden=!started||panelOpen()||!awaitingMouse;}
function save(){const ok=saveVoyage(game);document.querySelector('#save-status').textContent=ok?'航程已保存在本机':'保存暂不可用；当前航程仍可继续。';}
function requestPlay(){
  clearInput();
  if(touchInput||compatControl){awaitingMouse=false;showResume();renderer.domElement.focus({preventScroll:true});return;}
  awaitingMouse=true;showResume();renderer.domElement.focus({preventScroll:true});
  try{const result=renderer.domElement.requestPointerLock();if(result?.catch)result.catch(lockFailure);}catch{lockFailure();}
}
function lockFailure(){awaitingMouse=true;document.querySelector('#mouse-message').textContent='当前窗口没有取得鼠标控制。请点击继续，或使用兼容控制：右键拖动观察，左键操作。';document.querySelector('#compat-button').hidden=false;showResume();}
function openPanel(dialog){clearInput();dialog.showModal();save();if(document.pointerLockElement)document.exitPointerLock();awaitingMouse=!touchInput&&!compatControl;showResume();}
function closePanel(dialog){if(dialog===inventory&&!returnCursor(game)){game.notice='请先把手中的物品放回空格。';game.noticeTime=3;return;}dialog.close();}
document.addEventListener('pointerlockchange',()=>{
  const locked=document.pointerLockElement===renderer.domElement;
  awaitingMouse=!locked&&!touchInput&&!compatControl;clearInput();
  if(!locked&&started&&!panelOpen()&&!testPaused&&!touchInput&&!compatControl)help.showModal();
  showResume();
});
document.addEventListener('pointerlockerror',lockFailure);
window.addEventListener('pointerdown',event=>{lastPointerType=event.pointerType;},{passive:true});
document.body.dataset.started='false';
if(loadedVoyage){document.querySelector('#start-button').textContent='继续上次航程 →';document.querySelector('#newgame-button').hidden=false;}
document.querySelector('#start-button').addEventListener('click',()=>{started=true;touchInput=lastPointerType==='touch';document.body.dataset.started='true';welcome.close();setCameraView();requestPlay();});
document.querySelector('#newgame-button').addEventListener('click',()=>{game=createGame();game.layout=world.layout;game.controller=controller;controller.reset(game);crew.setGame(game);started=true;touchInput=lastPointerType==='touch';document.body.dataset.started='true';welcome.close();save();setCameraView();requestPlay();});
document.querySelector('#mouse-resume-button').addEventListener('click',requestPlay);
document.querySelector('#compat-button').addEventListener('click',()=>{compatControl=true;requestPlay();});
welcome.addEventListener('cancel',event=>event.preventDefault());
function toggleChart(){if(chart.open)closePanel(chart);else{recordChartVisit(game);drawChart();openPanel(chart);}}
function toggleCrew(){if(crewDialog.open)closePanel(crewDialog);else openPanel(crewDialog);}
const crewView=createCrewCommandPanel({ship,sails,crew,getGame:()=>game,onNotice:message=>{game.notice=message;game.noticeTime=5;},onCommand:()=>{closePanel(crewDialog);requestPlay();}});
document.querySelector('#crew-button').addEventListener('click',toggleCrew);
document.querySelector('#crew-close').addEventListener('click',()=>closePanel(crewDialog));
function toggleInventory(containerId=null){
  if(inventory.open){closePanel(inventory);return;}
  openContainer=containerId;renderInventory();openPanel(inventory);
}
function renderInventory(){
  const bag=game.inventory;
  document.querySelector('#inventory-title').textContent=openContainer?'存取物品':'船长背包';
  document.querySelector('#container-panel').hidden=!openContainer;
  document.querySelector('#container-title').textContent=openContainer==='captain'?'船长储物箱':'货舱储物箱';
  const fill=(element,slots,area,start=0)=>{
    element.replaceChildren();slots.forEach((slot,index)=>{const button=document.createElement('button');button.className='bag-slot'+(area==='player'&&index+start===bag.selected?' selected':'');button.dataset.area=area;button.dataset.index=String(index+start);button.setAttribute('aria-label',slot?ITEMS[slot.type].name+'，'+slot.count+' 件':'空物品格');
      const icon=document.createElement('span');icon.textContent=slot?ITEMS[slot.type].icon:'·';const label=document.createElement('small');label.textContent=slot?ITEMS[slot.type].name:'空格';button.append(icon,label);if(slot?.count>1){const count=document.createElement('small');count.textContent='×'+slot.count;button.append(count);}element.append(button);});
  };
  fill(document.querySelector('#bag-slots'),bag.slots.slice(9),'player',9);fill(document.querySelector('#bag-hotbar'),bag.slots.slice(0,9),'player');
  if(openContainer)fill(document.querySelector('#container-slots'),bag.containers[openContainer],openContainer);
  document.querySelector('#cursor-item').textContent=bag.cursor?'手中：'+ITEMS[bag.cursor.type].name+' ×'+bag.cursor.count+' · 点击物品格放下':'左键拿取 / 放下 · 右键分组 · Shift+左键快速转移';
  renderHotbar();
}
function renderHotbar(){
  const bag=game.inventory,signature=JSON.stringify([bag.slots.slice(0,9),bag.selected,bag.stowed]);if(signature===hotbarSignature)return;hotbarSignature=signature;
  const belt=document.querySelector('#hotbar');belt.replaceChildren();
  for(let i=0;i<9;i++){const slot=bag.slots[i],button=document.createElement('button');button.className='belt-slot'+(bag.selected===i&&!bag.stowed?' selected':'');button.dataset.slot=String(i);button.setAttribute('aria-label',(i+1)+'：'+(slot?ITEMS[slot.type].name:'空格'));const key=document.createElement('small');key.textContent=String(i+1);const icon=document.createElement('span');icon.textContent=slot?ITEMS[slot.type].icon:'·';button.append(key,icon);if(slot?.count>1){const count=document.createElement('span');count.className='count';count.textContent=String(slot.count);button.append(count);}belt.append(button);}
  document.querySelector('#equip-label').textContent=bag.stowed?'空手':bag.slots[bag.selected]?ITEMS[bag.slots[bag.selected].type].name+' · 右键辅助操作':'空手';
}
inventory.addEventListener('click',event=>{const slot=event.target.closest('.bag-slot');if(!slot)return;moveSlot(game,slot.dataset.area,Number(slot.dataset.index),{quick:event.shiftKey,container:openContainer});renderInventory();});
inventory.addEventListener('contextmenu',event=>{event.preventDefault();const slot=event.target.closest('.bag-slot');if(slot){moveSlot(game,slot.dataset.area,Number(slot.dataset.index),{right:true});renderInventory();}});
inventory.addEventListener('keydown',event=>{const slot=event.target.closest('.bag-slot');if(!slot)return;const all=[...inventory.querySelectorAll('.bag-slot')],i=all.indexOf(slot),columns=getComputedStyle(slot.parentElement).gridTemplateColumns.split(' ').length,offset={ArrowRight:1,ArrowLeft:-1,ArrowUp:-columns,ArrowDown:columns}[event.code];if(offset){event.preventDefault();all[Math.max(0,Math.min(all.length-1,i+offset))]?.focus();}});
document.querySelector('#hotbar').addEventListener('click',event=>{const slot=event.target.closest('[data-slot]');if(slot){selectItem(game,Number(slot.dataset.slot));renderHotbar();}});
document.querySelector('#inventory-button').addEventListener('click',()=>toggleInventory());
document.querySelector('#inventory-close').addEventListener('click',()=>closePanel(inventory));
document.querySelector('#map-button').addEventListener('click',toggleChart);
document.querySelector('#chart-close').addEventListener('click',()=>closePanel(chart));
document.querySelector('#help-button').addEventListener('click',()=>openPanel(help));
document.querySelector('#help-close').addEventListener('click',()=>{closePanel(help);requestPlay();});
for(const dialog of [chart,help,inventory,crewDialog]){dialog.addEventListener('cancel',event=>{event.preventDefault();closePanel(dialog);});dialog.addEventListener('close',()=>{clearInput();save();showResume();renderer.domElement.focus({preventScroll:true});});}
document.querySelector('#sensitivity').addEventListener('input',event=>{mouseSensitivity=Number(event.target.value);});
document.querySelector('#fov-setting').addEventListener('input',event=>{desiredFov=Number(event.target.value);});
document.querySelector('#motion-setting').checked=!reducedMotion;
document.querySelector('#motion-setting').addEventListener('change',event=>{reducedMotion=!event.target.checked;});
function performAction(){
  if(simulationPaused())return;
  if(placement){dropCurrent();placement=false;return;}
  target=targets.query(game,camera);
  if(target?.choice){
    if(!target.reachable){game.notice=target.reason;game.noticeTime=2;return;}
    const id=interact(game,target.choice.id);if(!id)return;
    if(target.point)game.handAction={id,time:.35,point:target.point.toArray(),hand:target.hand};
    if(id==='anchor')heldAction={id,choice:target.choice,region:target.region,point:target.point,hand:target.hand};
    if(id==='chart')toggleChart();else if(id.startsWith('container-'))toggleInventory(id.slice(10));
    save();
  }else if(equippedItem(game)==='chart')toggleChart();
  renderHotbar();updateHUD();
}
function secondaryAction(){
  if(simulationPaused())return;
  const item=equippedItem(game);
  if(item==='telescope')game.world.scopeRaised=!game.world.scopeRaised;
  else if(item==='lantern'){game.inventory.lanternOn=!game.inventory.lanternOn;game.world.portableLanternOn=game.inventory.lanternOn;}
  else if(item==='rope'){placement=!placement;game.notice=placement?'瞄准脚边表面，左键放置绳卷 · 右键取消':'放置已取消';game.noticeTime=3;}
}
function dropCurrent(){
  if(!game.player.grounded||game.climb||['helm','boat'].includes(game.mode))return;
  const p=playerWorld(game),dir=new THREE.Vector3(Math.sin(lookYaw),0,Math.cos(lookYaw)),onShip=['deck','cabin'].includes(game.mode);
  const candidate=new THREE.Vector3(p.x+dir.x*.65,p.y+.25+(onShip?game.ship.bob||0:0),p.z+dir.z*.65);
  const obstruction=controller.raycast(new THREE.Vector3(p.x,p.y+.7+(onShip?game.ship.bob||0:0),p.z),dir,.8);
  if(obstruction&&obstruction.distance<.75){game.notice='前方被挡住，无法放下物品。';game.noticeTime=2;return;}
  if(onShip)ship.worldToLocal(candidate);
  if(dropSelected(game,candidate.toArray(),onShip?'ship':'world')){save();renderHotbar();}else{game.notice='这件物品不能丢弃。';game.noticeTime=2;}
}
actionButton.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();primaryDown=true;actionButton.setPointerCapture(event.pointerId);performAction();});
actionButton.addEventListener('click',event=>{if(event.detail===0)performAction();});
// The camera is always the captain's own eyes: eye height, looking where he looks.
// Raising the telescope narrows the field of view instead of pulling the camera back.
function applyFirstPerson() {
  const pos = playerWorld(game);
  const rideOnDeck = ['deck', 'helm', 'cabin'].includes(game.mode) || game.climb?.path?.space==='ship';
  const bob = reducedMotion ? 0 : Math.sin(gait * 2) * .045 * gaitAmount;
  // Climbing a rope ladder adds a slow sway, so the height reads as height.
  const sway = 0;
  camera.position.set(
    pos.x + Math.cos(lookYaw) * sway,
    pos.y + (rideOnDeck ? ship.position.y : 0) + (game.mode==='boat'?1.12:game.player.crouched?.95:EYE_HEIGHT) + bob,
    pos.z - Math.sin(lookYaw) * sway
  );
  // A camera looks down its own -Z, so rotate by yaw + π to align with forward = (sin, 0, cos).
  lookEuler.set(lookPitch, lookYaw + Math.PI, 0);
  camera.quaternion.setFromEuler(lookEuler);
}
// Recentre: face the way the captain is walking and level the horizon.
function setCameraView() {
  if (cameraManualTime <= 0) lookYaw = ['helm','boat'].includes(game.mode) ? (game.mode==='helm'?game.ship.heading:game.boat.heading)+Math.PI/2 : game.player.yaw;
  lookPitch = 0;
  controls.enabled = false;
  applyFirstPerson();
}
// V now cycles the field of view instead of swapping to a third-person camera.
const FOV_STEPS = [62, 46, 30];
let fovStep = 0, desiredFov = FOV_STEPS[0];
document.querySelector('#recenter-button').addEventListener('click', () => setCameraView());

// Desktop pointer lock and touch/compatibility look share the same yaw/pitch.
let lastPointerX=0,lastPointerY=0;
const changeLook=(dx,dy)=>{lookYaw-=dx*mouseSensitivity;lookPitch=Math.max(-1.52,Math.min(1.48,lookPitch-dy*mouseSensitivity));cameraManualTime=2.5;};
document.addEventListener('mousemove',event=>{if(document.pointerLockElement===renderer.domElement&&!simulationPaused())changeLook(event.movementX,event.movementY);});
renderer.domElement.addEventListener('contextmenu',event=>event.preventDefault());
renderer.domElement.addEventListener('pointerdown',event=>{
  if(!started||panelOpen()||testPaused)return;
  if(event.pointerType==='touch'||compatControl&&event.button===2){dragging=true;lastPointerX=event.clientX;lastPointerY=event.clientY;renderer.domElement.setPointerCapture(event.pointerId);return;}
  if(awaitingMouse){requestPlay();return;}
  if(event.button===0){primaryDown=true;performAction();}
  else if(event.button===2)secondaryAction();
});
renderer.domElement.addEventListener('pointermove',event=>{if(!dragging||simulationPaused())return;changeLook(event.clientX-lastPointerX,event.clientY-lastPointerY);lastPointerX=event.clientX;lastPointerY=event.clientY;});
for(const type of ['pointerup','pointercancel','lostpointercapture'])renderer.domElement.addEventListener(type,()=>{dragging=false;primaryDown=false;game.anchorHeld=false;heldAction=null;});
for(const type of ['pointerup','pointercancel'])window.addEventListener(type,()=>{primaryDown=false;game.anchorHeld=false;heldAction=null;});
renderer.domElement.addEventListener('wheel',event=>{if(simulationPaused())return;event.preventDefault();selectItem(game,game.inventory.selected+Math.sign(event.deltaY));placement=false;renderHotbar();},{passive:false});
document.querySelector('#restart').addEventListener('click',()=>{
  game=createGame();game.layout=world.layout;game.controller=controller;controller.reset(game);crew.setGame(game);clearInput();lastMode='deck';fovStep=0;camera.fov=desiredFov=62;camera.updateProjectionMatrix();gait=gaitAmount=splashTime=0;wasSubmerged=false;smoothYaw=game.player.yaw;cameraManualTime=0;selectedActionId=null;capstanSpin=0;anchorLift=-1;
  world.cabin.visible=true;ship.children.forEach(object=>{object.visible=true;});closePanel(help);save();setCameraView();requestPlay();
});
window.addEventListener('keydown',event=>{
  if(!started)return;
  if(event.code==='Escape'&&!event.repeat){event.preventDefault();if(placement){placement=false;return;}if(crewDialog.open)closePanel(crewDialog);else if(inventory.open)closePanel(inventory);else if(chart.open)closePanel(chart);else if(help.open)closePanel(help);else openPanel(help);return;}
  if(event.code==='KeyB'&&!event.repeat&&!inventory.open&&!chart.open&&!help.open){event.preventDefault();toggleCrew();return;}
  if(event.code==='KeyE'&&!event.repeat&&!chart.open&&!help.open&&!crewDialog.open){event.preventDefault();toggleInventory();return;}
  if(event.code==='KeyM'&&!event.repeat&&!inventory.open&&!help.open&&!crewDialog.open){event.preventDefault();toggleChart();return;}
  if(simulationPaused())return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','ControlLeft','ShiftLeft'].includes(event.code))event.preventDefault();
  keys.add(event.code);if(event.repeat)return;
  if(/^Digit[1-9]$/.test(event.code)){selectItem(game,Number(event.code.slice(5))-1);placement=false;renderHotbar();}
  if(event.code==='KeyX'){game.inventory.stowed=!game.inventory.stowed;game.world.scopeRaised=false;renderHotbar();}
  if(event.code==='KeyQ')dropCurrent();
  if(event.code==='KeyC'){lookPitch=0;cameraManualTime=0;setCameraView();}
  if(event.code==='Space')jump=true;
});
window.addEventListener('keyup',event=>keys.delete(event.code));
const focusPause=()=>{clearInput();if(started&&!panelOpen()&&!testPaused)openPanel(help);};
window.addEventListener('blur',focusPause);document.addEventListener('visibilitychange',()=>{if(document.hidden)focusPause();});
for(const button of document.querySelectorAll('[data-move]')){
  const key=button.dataset.move;button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);keys.add(key);});for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>keys.delete(key));
}
jumpButton.addEventListener('click',()=>{jump=true;});

function drawChart() {
  const width = Math.round(Math.min(880, Math.max(320, container.clientWidth * .86))), height = Math.round(Math.max(350, width * .67));
  if (chartCanvas.width !== width || chartCanvas.height !== height) { chartCanvas.width = width; chartCanvas.height = height; }
  const ctx = chartCtx, w = chartCanvas.width, h = chartCanvas.height;
  const player = playerWorld(game);
  const span = Math.max(45, Math.abs(game.ship.x) + 18, Math.abs(game.ship.z) + 18, Math.abs(game.boat.x) + 10, Math.abs(game.boat.z) + 10, Math.abs(player.x) + 10, Math.abs(player.z) + 10);
  const scale = (h - 65) / (span * 2), ox = w * .5, oy = h * .53;
  const point = (x, z) => [ox + x * scale, oy + z * scale];
  ctx.fillStyle = '#dac9a5'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#8c805330'; ctx.lineWidth = 1;
  const spacing = 10 * scale;
  for (let x = ox % spacing; x < w; x += spacing) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = oy % spacing; y < h; y += spacing) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.strokeStyle = '#a99a7266'; ctx.lineWidth = 1;
  const [ix, iy] = point(ISLAND.x, ISLAND.z);
  for (const radius of [1.18, 1.36, 1.65]) { ctx.beginPath(); ctx.ellipse(ix, iy, ISLAND.rx * scale * radius, ISLAND.rz * scale * radius, 0, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = '#9aa07a'; ctx.strokeStyle = '#6a7051'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(ix, iy, ISLAND.rx * scale, ISLAND.rz * scale, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#536349'; ctx.font = '16px Microsoft YaHei'; ctx.textAlign = 'center'; ctx.fillText('出生岛', ix, iy + 5);
  ctx.fillStyle = '#6f533a';
  const [dx, dy] = point(-1.5, -16); ctx.fillRect(dx, dy, 3 * scale, 12 * scale);
  const [tx, ty] = point(-7, -5.3); ctx.fillRect(tx, ty, 14 * scale, 1.65 * scale);
  const shipPos = point(game.ship.x, game.ship.z);
  ctx.save(); ctx.translate(...shipPos); ctx.rotate(-game.ship.heading);
  ctx.fillStyle = '#2a4d50'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -6); ctx.lineTo(-5, 0); ctx.lineTo(-8, 6); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.font = '13px Microsoft YaHei'; ctx.textAlign = 'left'; ctx.fillStyle = '#2a4d50'; ctx.fillText('黑潮号', shipPos[0] + 17, shipPos[1] - 10);
  if (game.boat.deployed) { const p = point(game.boat.x, game.boat.z); ctx.fillStyle = '#997437'; ctx.beginPath(); ctx.ellipse(p[0], p[1], 6, 3, -game.boat.heading, 0, Math.PI * 2); ctx.fill(); ctx.fillText('救生艇', p[0] + 9, p[1] + 18); }
  const pp = point(player.x, player.z);
  ctx.fillStyle = '#913c32'; ctx.beginPath(); ctx.arc(pp[0], pp[1], 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#f2e4c9'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.save(); ctx.translate(w - 70, 75); ctx.strokeStyle = '#766843'; ctx.fillStyle = '#766843';
  for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(0, -31); ctx.lineTo(5, 0); ctx.lineTo(0, 9); ctx.lineTo(-5, 0); ctx.closePath(); ctx.stroke(); }
  ctx.font = '14px Georgia'; ctx.textAlign = 'center'; ctx.fillText('N', 0, -42); ctx.restore();
  ctx.fillStyle = '#766843'; ctx.textAlign = 'left'; ctx.font = '12px Microsoft YaHei';
  ctx.fillText('● 你    ◆ 黑潮号    ▰ 救生艇', 24, h - 22);
  ctx.fillText(`海域约 ${Math.round(span * 2)} 米 · 格线 10 米`, 24, 28);
  document.querySelector('#chart-position').textContent = `${player.x.toFixed(1)} E / ${(-player.z).toFixed(1)} N`;
  document.querySelector('#chart-status').textContent = `${game.ship.anchorLift < .99 ? '停泊' : '船锚已收起'} · ${(game.ship.speed * 1.94).toFixed(1)} 节`;
}

const raycaster = new THREE.Raycaster();
const canvasSails = sails.map((sail) => sail.mesh);
for (const sail of canvasSails) { sail.material = sail.material.clone(); sail.material.transparent = true; }
function updateHUD() {
  const labels = { deck: '黑潮号 · 甲板', helm: '黑潮号 · 正在掌舵', cabin: '黑潮号 · 船舱', land: '出生岛 · 木码头与沙滩', swim: '海面 · 游泳中', boat: '救生艇 · 独自划行' };
  if (game.climb) labels[game.mode] = `攀爬中 · ${game.climb.ladder.label}`;
  const hints = {
    deck: 'WASD 移动 · 准星瞄准后左键 · E 背包 · M 海图',
    helm: 'W 加速 / S 倒车 · A / D 转向 · 左键松开舵轮',
    cabin: 'WASD 移动 · 走到门、梯子、牢门前左键',
    land: 'WASD 移动 · 沿跳板可以直接登船',
    swim: 'WASD 游泳 · 抓住梯子左键 爬上船',
    boat: 'W / S 划桨 · A / D 转向 · 左键离艇',
    climb: 'W 往上爬 · S 往下爬 · 到头左键 跨上平台',
  };
  if (game.climb) hints[game.mode] = hints.climb;
  locationText.textContent = labels[game.mode]; hintText.textContent = hints[game.mode];
  const lift = game.ship.anchorLift;
  anchorText.textContent = Math.abs(lift - game.ship.anchorTarget) > .001 ? `${game.ship.anchorTarget ? '收锚' : '抛锚'} ${Math.round((game.ship.anchorTarget ? lift : 1 - lift) * 100)}%` : lift > .99 ? '船锚已收起' : '船锚已放下';
  speedText.textContent = `${((game.mode === 'boat' ? Math.abs(game.boat.speed) : game.ship.speed) * 1.94).toFixed(1)} 节`;
  const bearing = (90 - (game.mode === 'boat' ? game.boat.heading : game.ship.heading) * 180 / Math.PI + 3600) % 360;
  headingText.textContent = `${String(Math.round(bearing)).padStart(3, '0')}°`;
  compassNeedle.style.transform = `rotate(${bearing}deg)`;
  anchorProgress.value = lift;
  rudderValue.textContent = Math.abs(game.ship.rudder) < .05 ? '正舵' : `${game.ship.rudder < 0 ? '右' : '左'}舵 ${Math.round(Math.abs(game.ship.rudder) * 100)}%`;
  const voyage = voyageObjective(game);
  voyageTitle.textContent = voyage.title; voyageHint.textContent = voyage.hint;
  voyageCount.textContent = `${voyage.count} / 5`; voyageProgress.value = voyage.count;
  jumpButton.textContent = game.climb ? '攀爬中' : game.mode === 'boat' ? '下水 ␣' : '跳跃 ␣';
  const choice=target?.choice;
  selectedActionId=choice?.id||null;actionButton.hidden=!choice;actionButton.disabled=!target?.reachable;
  if(choice){actionName.textContent=choice.label;actionHint.textContent=target.reachable?choice.hint:target.reason;}
  crosshair.dataset.state=target?target.reachable?'ready':'far':'idle';
  targetLabel.textContent=placement?'左键放置绳卷 · 右键取消':choice?choice.label+'\n'+(target.reachable?choice.hint:target.reason):'';
  renderHotbar();showResume();
  toast.textContent = game.notice; toast.hidden = game.noticeTime <= 0;
  container.dataset.mode = game.mode;
  container.dataset.playerX = game.player.x.toFixed(2); container.dataset.playerZ = game.player.z.toFixed(2);
  container.dataset.paused = String(simulationPaused());
  if (chart.open) drawChart();
}
function resize() {
  camera.aspect = container.clientWidth / container.clientHeight;
  // The wheel owns FOV while walking, so only reset it when leaving first person.
  if (!firstPerson) camera.fov = camera.aspect < 1 ? 62 : 54;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  renderer.setPixelRatio(Math.min(devicePixelRatio, container.clientWidth < 720 ? 1.5 : 1.75));
  const shadowSize = container.clientWidth < 720 ? 1024 : 2048;
  if (sun.shadow.mapSize.x !== shadowSize) {
    sun.shadow.mapSize.set(shadowSize, shadowSize); sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.needsUpdate = true;
  }
}
window.addEventListener('resize', resize);
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  const notice = document.querySelector('#loading');
  notice.hidden = false;
  notice.classList.add('error');
  notice.textContent = '图形上下文已中断，请刷新页面恢复场景。';
});
const clock = new THREE.Clock();
const forward = new THREE.Vector3(), right = new THREE.Vector3(), movement = new THREE.Vector3();
const worldPlayer = new THREE.Vector3(), viewDirection = new THREE.Vector3();
const clothPosition = new THREE.Vector3();
const loading = document.querySelector('#loading');
let frameTime = 16.7, accumulator=0, physicsTime=0;
setCameraView(); welcome.showModal();
renderer.setAnimationLoop(() => {
  const rawDelta = clock.getDelta(), delta = Math.min(rawDelta, .05);
  frameTime += (Math.min(rawDelta * 1000, 250) - frameTime) * .04;
  const paused = simulationPaused();
  const activeDelta = paused ? 0 : delta;
  elapsed += activeDelta;
  cameraManualTime = Math.max(0, cameraManualTime - activeDelta);
  for (const [key, time] of taps) { if (time <= delta) taps.delete(key); else taps.set(key, time - delta); }
  const held = (...codes) => codes.some((code) => keys.has(code) || taps.has(code));
  const forwardInput = Number(held('KeyW', 'ArrowUp')) - Number(held('KeyS', 'ArrowDown'));
  const sideways = Number(held('KeyD', 'ArrowRight')) - Number(held('KeyA', 'ArrowLeft'));
  if (firstPerson) {
    // Movement follows where the captain looks, flattened onto the deck.
    lookForward.set(Math.sin(lookYaw), 0, Math.cos(lookYaw));
    forward.copy(lookForward);
  } else {
    camera.getWorldDirection(forward);
  }
  forward.y = 0; forward.normalize();
  right.set(-forward.z, 0, forward.x);
  movement.copy(forward).multiplyScalar(forwardInput).addScaledVector(right, sideways);
  if (movement.lengthSq() > 1) movement.normalize();
  previousPlayer.set(game.player.x, game.player.y, game.player.z);
  const previousMode = game.mode;
  const previousHeading=game.mode==='boat'?game.boat.heading:game.ship.heading;
  const backInput = Number(held('KeyS', 'ArrowDown')) - Number(held('KeyW', 'ArrowUp'));
  if(!paused){
    accumulator=Math.min(.1,accumulator+rawDelta);
    while(accumulator>=1/60){physicsTime+=1/60;game.ship.bob=reducedMotion?0:Math.sin(physicsTime*.63)*.045;
      if(heldAction?.id==='anchor'&&heldAction.region){const p=playerWorld(game),reach=targets.contact(game,heldAction.choice,heldAction.region,{position:[p.x,p.y+(game.ship.bob||0),p.z],hand:heldAction.hand});if(reach.reachable)heldAction.point=reach.point;else{heldAction=null;game.handAction=null;game.notice='推杆已离开手边，收锚暂停；靠近后重新抓握。';game.noticeTime=3;}}
      game.anchorHeld=primaryDown&&heldAction?.id==='anchor';
      game.crewAnchorHeld=crew.anchorHeld();
      stepGame(game,{forward:forwardInput,back:backInput,turn:-sideways,moveX:movement.x,moveZ:movement.z,run:held('ControlLeft','ControlRight'),crouch:held('ShiftLeft','ShiftRight'),ascend:held('Space'),descend:held('ShiftLeft','ShiftRight'),lookYaw,jump},1/60);
      crew.update(1/60,false);
      jump=false;accumulator-=1/60;
    }
    if(game.handAction)game.handAction.time=Math.max(0,game.handAction.time-activeDelta);
  }else accumulator=0;
  if(['deck','helm','cabin','boat'].includes(game.mode)&&game.mode===previousMode)lookYaw+=(game.mode==='boat'?game.boat.heading:game.ship.heading)-previousHeading;
  cameraHeading=game.ship.heading;
  seaUniforms.time.value = elapsed;
  seaUniforms.shipPosition.value.set(game.ship.x, game.ship.z); seaUniforms.shipHeading.value = game.ship.heading;
  seaUniforms.shipSpeed.value = Math.abs(game.ship.speed);
  // ponytail: kinematic sailing and analytic waves; add buoyancy physics when sea conditions affect gameplay.
  ship.position.set(game.ship.x, game.ship.bob||0, game.ship.z);
  ship.rotation.y = game.ship.heading;
  wheel.rotation.x = game.ship.rudder * -.7;
  rudder.rotation.y=game.ship.rudder*.48;
  if (anchorLift !== game.ship.anchorLift) { setAnchorLift(game.ship.anchorLift); anchorLift = game.ship.anchorLift; }
  world.gangplank.visible = isDocked(game);
  world.ropes.visible = !game.boat.deployed;
  world.boat.visible = true;
  if (game.boat.deployed) { world.boat.position.set(game.boat.x, -.35 + Math.sin(elapsed) * .025, game.boat.z); world.boat.rotation.y = game.boat.heading; }
  else { const pos = toWorld(game.ship, -11, -4.6); world.boat.position.set(pos.x, 2.4-2.75*game.boat.lowering + ship.position.y, pos.z); world.boat.rotation.y = game.ship.heading; }
  world.setBoatLowering?.(game.boat.lowering);
  world.setOarsDeployed?.(game.boat.deployed);
  world.oars.forEach(oar=>{oar.rotation.y=(oar.userData.restYaw||0)+(game.mode==='boat'&&oar.userData.rowing?Math.sin(elapsed*4)*.4*Math.min(1,Math.abs(game.boat.speed))*oar.userData.side:0);});
  const pos = playerWorld(game);
  pirate.position.set(pos.x, pos.y + (['deck', 'helm', 'cabin'].includes(game.mode) ? ship.position.y : 0), pos.z);
  const targetYaw = game.climb?game.player.yaw:game.mode === 'helm' ? game.ship.heading + Math.PI / 2 : game.mode === 'boat' ? game.boat.heading + Math.PI / 2 : lookYaw;
  smoothYaw += Math.atan2(Math.sin(targetYaw - smoothYaw), Math.cos(targetYaw - smoothYaw)) * (1 - Math.exp(-activeDelta * 16));
  pirate.rotation.y = smoothYaw;
  pirate.visible = true;
  const travel = previousMode === game.mode ? Math.hypot(game.player.x - previousPlayer.x, game.player.z - previousPlayer.z) : 0;
  const walking = travel > .0005 && !paused && !['helm', 'boat', 'swim'].includes(game.mode);
  gait += walking ? travel * 3.4 : 0;
  gaitAmount += ((walking ? Math.min(1, travel / Math.max(delta, .001) / 2.65) : 0) - gaitAmount) * (1 - Math.exp(-activeDelta * 16));
  const airborne = game.player.vy !== 0 && ['deck', 'land'].includes(game.mode);
  const grounded = ['deck', 'helm', 'cabin', 'land'].includes(game.mode);
  const floor = game.mode === 'cabin' ? game.player.y : ['deck', 'helm'].includes(game.mode) ? walkingHeight(game.player.x, game.player.z,game.player.y) : groundHeight(game, pos.x, pos.z);
  contact.visible = grounded; contact.position.set(pos.x, floor + .023 + (game.mode === 'land' ? 0 : ship.position.y), pos.z);
  contact.material.opacity = Math.max(.05, .6 - Math.max(0, pos.y - floor) * .35);
  const submerged = game.mode === 'swim' && game.player.y < -.25;
  if (submerged && !wasSubmerged) splashTime = 1.1;
  wasSubmerged = submerged; splashTime = Math.max(0, splashTime - activeDelta);
  ripples.visible = submerged; ripples.position.set(pos.x, .13, pos.z);
  ripples.children.forEach((ring, i) => {
    const phase = (elapsed * .65 + i / 3) % 1, radius = .25 + phase * (splashTime > 0 ? 2.0 : .9);
    ring.scale.setScalar(radius); ring.material.opacity = reducedMotion ? .15 : (1 - phase) * (splashTime > 0 ? .55 : .22);
  });
  if (lastMode !== game.mode) {
    const inside = game.mode === 'cabin'; world.cabin.visible = true;
    lastMode = game.mode;
  }
  const objective = voyageObjective(game);
  for (const marker of world.markers) {
    const near = Math.hypot(game.player.x - marker.x, game.player.z - marker.z) < 3.2;
    marker.object.visible = game.mode === 'deck' && (near || marker.id === objective.station) && Math.abs(game.player.y - marker.y) < 1.5;
    marker.object.material.color.set(marker.id === objective.station ? '#ffdc89' : '#ffffff');
  }
  animateSails(elapsed,reducedMotion?0:1);
  for (const { mesh, rest } of flags) {
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setZ(i, rest[i * 3 + 2] + (reducedMotion ? 0 : Math.sin(rest[i * 3] * 5 + elapsed * 2.3) * .075 * Math.abs(rest[i * 3])));
    positions.needsUpdate = true;
  }
  foam.material.opacity = .24 + Math.sin(elapsed * .7) * .065;
  foam.position.set(game.ship.x, 0, game.ship.z); foam.rotation.y = game.ship.heading;
  const inside=game.mode==='cabin',roomName=inside?game.world.room:'deck';
  world.cabin.visible=true;world.cargo.visible=true;
  const lightBlend=Math.min(1,delta*2.5);
  hemi.intensity+=((inside?.45:1.8)-hemi.intensity)*lightBlend;rim.intensity+=((inside?.25:1.5)-rim.intensity)*lightBlend;scene.environmentIntensity+=((inside?.16:.38)-scene.environmentIntensity)*lightBlend;
  const candidates=allLampFixtures.filter(f=>!f.fixedLight&&f.room===roomName&&(game.world.lamps[f.id]??f.on)).sort((a,b)=>Math.hypot(a.position[0]-game.player.x,a.position[2]-game.player.z)-Math.hypot(b.position[0]-game.player.x,b.position[2]-game.player.z));
  for(const f of allLampFixtures)f.light=f.fixedLight||null;
  interiorLights.forEach((light,i)=>{const f=candidates[i];light.visible=Boolean(f);if(f){f.group.add(light);light.position.set(0,f.room==='deck'?.10:f.type==='table'?.13:0,0);f.light=light;}});
  for(const f of allLampFixtures){const on=game.world.lamps[f.id]??f.on,flicker=reducedMotion?1:1+Math.sin(elapsed*7.3+f.phase)*.07+Math.sin(elapsed*11.9+f.phase*2)*.04;if(f.flame)f.flame.visible=on;if(f.glowMaterial)f.glowMaterial.emissiveIntensity=on?.24*flicker:0;if(f.light)f.light.intensity=on?(f.room==='deck'?.65:1.25)*flicker:0;}
  // Barred cell doors swing inward once the player forces the rusted padlock.
  world.cellDoors.forEach((door, index) => {
    door.rotation.y=game.world.cellDoorAngles?.[index]||0;
  });
  // --- working the ship: every moving part is driven by what the captain did by hand ---
  const ease = (current, target, rate) => current + (target - current) * Math.min(1, activeDelta * rate);
  // The captain's cabin door swings on its hinges.
  world.cabinDoor.rotation.y = game.world.cabinDoorAngle||0;
  // The hatch lid lies flat when shut and stands up on its stay when thrown back.
  hatchLid.rotation.x = game.world.hatchAngle||0;
  cargoGrating.position.y=2.66+(game.world.cargoOffset||0)/1.9*.34;
  cargoGrating.position.z=game.world.cargoOffset||0;
  // The capstan bars turn only while the anchor is being heaved home.
  if(Math.abs(game.ship.anchorTarget-game.ship.anchorLift)>.001&&(game.ship.anchorTarget<.5||game.anchorHeld||game.crewAnchorHeld))capstanSpin+=activeDelta*(game.ship.anchorTarget>.5?1.15:-.8);
  capstanBars.forEach((bar, index) => { bar.rotation.z = capstanSpin + index * Math.PI / 2; });
  windlassDrum.rotation.z=capstanSpin;
  capstanBrake.rotation.z = ease(capstanBrake.rotation.z, game.world.capstanBraked ? -.55 : .55, 6);
  // The telescope leaves the nest rail once he lifts it, and rides along in his hand.
  if (telescope) {
    telescope.visible = !game.world.hasTelescope;
  }
  // Sails furl to the yard when their halyard is hauled down.
  for (const [index, sail] of sails.entries()) {
    const set = game.world.sailsSet[index] ?? true;
    const target = set ? 1 : .06;
    const factor=ease(sail.group?.scale.y??sail.mesh.scale.y,target,2.6);
    if(setSailFurl)setSailFurl(index,factor);else sail.mesh.scale.y=factor;
  }
  // Raising the telescope narrows the field of view the way a real optic does.
  const scopeFov = game.world.scopeRaised ? 13 : desiredFov;
  if (Math.abs(camera.fov - scopeFov) > .05) { camera.fov = ease(camera.fov, scopeFov, 6); camera.updateProjectionMatrix(); }
  seabed.position.x = game.ship.x; seabed.position.z = game.ship.z;
  // Always the captain's own eyes: eye height, gait bob, and a sway while on a rope ladder.
  ship.updateMatrixWorld(true);world.boat.updateMatrixWorld(true);applyFirstPerson();camera.updateMatrixWorld(true);
  crew.render(activeDelta,paused);crewView.render(delta);
  target=targets.query(game,camera);
  const wall=controller.raycast(camera.position,camera.getWorldDirection(new THREE.Vector3()),.8);
  const actionTarget={point:heldAction?.point||(game.handAction?.point?new THREE.Vector3().fromArray(game.handAction.point):target?.point),hand:heldAction?.hand||game.handAction?.hand||target?.hand,continuous:Boolean(game.anchorHeld&&heldAction),nearWall:wall?.distance??1};
  game.world.portableLanternOn=game.inventory.lanternOn;
  updatePirateBody({game,ship,pirate,lookYaw,lookPitch,gait,gaitAmount,elapsed,delta:activeDelta,paused,equipped:equippedItem(game),actionTarget,wheel,firstPerson});
  updateDrops();
  const obscuring = new Set();
  for (const height of [.25, .9, 1.6]) {
    worldPlayer.copy(pirate.position).y += height;
    viewDirection.copy(worldPlayer).sub(camera.position);
    raycaster.far = viewDirection.length(); raycaster.set(camera.position, viewDirection.normalize());
    raycaster.intersectObjects(canvasSails).forEach((hit) => obscuring.add(hit.object));
  }
  if (controls.getDistance() < 16) for (const sail of canvasSails) {
    sail.getWorldPosition(clothPosition);
    if (Math.hypot(clothPosition.x - pirate.position.x, clothPosition.z - pirate.position.z) < 3.1) obscuring.add(sail);
  }
  canvasSails.forEach((sail) => { const opacity = obscuring.has(sail) ? .12 : 1; sail.material.opacity = testPaused ? opacity : sail.material.opacity + (opacity - sail.material.opacity) * (1 - Math.exp(-delta * 12)); sail.material.depthWrite = sail.material.opacity > .95; });
  sun.position.set(game.ship.x + 8, 20, game.ship.z + 12); sun.target.position.set(game.ship.x, 0, game.ship.z); sun.target.updateMatrixWorld();
  renderer.render(scene, camera);
  uiTime += delta; if (uiTime > .1) { updateHUD(); uiTime = 0; }
  loading.hidden = true;
});

function updateDrops(){
  for(const[id,mesh]of droppedMeshes)if(!game.inventory.drops.some(drop=>drop.id===id)){mesh.parent.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();droppedMeshes.delete(id);}
  for(const drop of game.inventory.drops){let mesh=droppedMeshes.get(drop.id);if(!mesh){mesh=new THREE.Mesh(drop.type==='rope'?new THREE.TorusGeometry(.13,.045,6,12):new THREE.BoxGeometry(.16,.20,.13),new THREE.MeshStandardMaterial({color:drop.type==='rope'?'#b69a65':'#b89b50',roughness:.8}));mesh.name=drop.id;mesh.castShadow=true;(drop.space==='ship'?ship:scene).add(mesh);droppedMeshes.set(drop.id,mesh);}mesh.position.fromArray(drop.position);mesh.rotation.x=drop.type==='rope'?Math.PI/2:0;}
}

// QA hooks are available only in the local verification URL, not in the player view.
if (new URLSearchParams(location.search).has('qa')) {
  window.__THREE_GAME_DIAGNOSTICS__ = {
    renderer: {
      get calls() { return renderer.info.render.calls; },
      get triangles() { return renderer.info.render.triangles; },
      get geometries() { return renderer.info.memory.geometries; },
      get textures() { return renderer.info.memory.textures; },
      get render() { return renderer.info.render; },
      get memory() { return renderer.info.memory; },
    },
    get state() { return { mode: game.mode, player: playerWorld(game), localPlayer:{...game.player},world:{...game.world},boat:{...game.boat},climb:game.climb?{id:game.climb.ladder.id,t:game.climb.t}:null,lookYaw,lookPitch,selectedActionId,choices:interactions(game).map(c=>({id:c.id,label:c.label})),ship: { ...game.ship }, voyage: { ...game.voyage }, frameTimeMs: Math.round(frameTime * 10) / 10, cameraHeading, camera: camera.position.toArray(), controls: controls.target.toArray(), gait, gaitAmount, pirateYaw: pirate.rotation.y, pointerLocked:document.pointerLockElement===renderer.domElement, paused:simulationPaused(), target:target?{id:target.choice?.id,reachable:target.reachable,point:target.point?.toArray()}:null, inventory:structuredClone(game.inventory), totals:inventoryTotals(game), body:pirate.userData.bodyDiagnostics }; },
    get physics(){return {...controller.stats,stepMs:controller.stats.stepMs||0};},
    get crew(){return crew.state;},
    get crewBodies(){return crew.sailors.map(s=>({id:s.id,...s.pirate?.userData.bodyDiagnostics}));},
    get quality() { return { dpr: renderer.getPixelRatio(), postPasses: 0, shadowMap: sun.shadow.mapSize.x, shadowLights: 1 }; },
  };
  window.__THREE_GAME_TEST_HOOKS__ = {
    placePlayer(position,mode='deck') {
      if(!['deck','cabin','land','swim'].includes(mode)||position.length!==3||!position.every(Number.isFinite))throw new Error('Invalid QA position');
      game.mode=mode;game.climb=null;Object.assign(game.player,{x:position[0],y:position[1],z:position[2],vy:0});controller.reset(game);clearInput();applyFirstPerson();
    },
    interactionRegions() {
      return interactions(game).map(choice=>({id:choice.id,regions:targets.regions(choice,game).map(region=>{
        const p=new THREE.Vector3().fromArray(region.position);if(region.parent)region.parent.localToWorld(p);return {point:p.toArray(),radius:region.radius};
      })}));
    },
    async setState(name) {      if (!['welcome','deck','sailing','cabin','captain','hold','chart','body','inventory','climbing','crew'].includes(name)) throw new Error(`Unknown test state: ${name}`);
      if(chart.open)chart.close();if(help.open)help.close();if(inventory.open)inventory.close();if(crewDialog.open)crewDialog.close();awaitingMouse=false;touchInput=true;
      if (welcome.open) welcome.close(); started = name !== 'welcome'; document.body.dataset.started = String(started);
      game = createGame();game.layout=world.layout;game.controller=controller;controller.reset(game);crew.setGame(game); clearInput(); elapsed = 6; lastMode = 'deck'; fovStep = 0; camera.fov = FOV_STEPS[0]; camera.updateProjectionMatrix();
      desiredFov=FOV_STEPS[0];cameraManualTime=0;selectedActionId=null;capstanSpin=0;
      gait = gaitAmount = splashTime = 0; wasSubmerged = false; anchorLift = -1;
      world.cabin.visible = true; ship.children.forEach((object) => { object.visible = true; });
      if (['cabin','captain','hold'].includes(name)) {
        game.mode='cabin';game.world.room=name==='cabin'?'lower':name;game.world.hatchOpen=true;game.world.cargoOpen=true;game.world.cabinDoorOpen=true;
        Object.assign(game.player,name==='captain'?{x:-9.2,z:1.55,y:2.4,yaw:-1.82}:name==='hold'?{x:.2,z:1.3,y:-1.85,yaw:1.78}:{x:-5.45,z:0,y:.15,yaw:-Math.PI/2});
        if(name==='hold')game.world.lamps['cargo-work']=true;
      }
      if (name === 'sailing') {
        game.mode = 'helm'; Object.assign(game.player, { x: -12.6, z: 0, y: 4.55 });
        Object.assign(game.ship, { x: 24, z: 8, heading: -.35, anchorLift: 1, anchorTarget: 1, speed: 2.5, throttle: 2.5 });
        Object.assign(game.voyage, { cabin: true, chart: true, anchor: true, distance: 7 });
      }
      controller.reset(game);
      if(name==='body')lookPitch=-1.3;
      if(name==='inventory')toggleInventory('captain');
      if(name==='crew')toggleCrew();
      if(name==='climbing'){const path=world.layout.climbPaths.find(p=>p.id==='main-shroud');Object.assign(game.player,{x:path.entry[0],y:path.entry[1],z:path.entry[2]});controller.reset(game);controller.startClimb(game,path,false);for(let i=0;i<200;i++)stepGame(game,{forward:1},1/60);lookYaw=game.player.yaw;lookPitch=.4;}
      if (name === 'chart') toggleChart();
      if (name === 'welcome') { welcome.showModal(); }
      smoothYaw = game.mode === 'helm' ? game.ship.heading + Math.PI / 2 : game.player.yaw;
      setCameraView(); updateHUD();
      if(['captain','cabin','hold'].includes(name)){lookPitch=-.13;applyFirstPerson();}
      if(name==='body'){lookPitch=-1.3;applyFirstPerson();}
      return { state: name };
    },
    setPausedForScreenshot(paused) { testPaused = Boolean(paused); clearInput(); },
    setReducedMotion(value) { reducedMotion = Boolean(value); },
    hideDebugUi() {},
    // Reports what the upgraded model actually contains, so a probe can assert on it.
    inspect() {
      const counts = { brigGroups: 0, cellDoors: 0, oilLampLights: 0, pointLights: 0, meshes: 0 };
      ship.traverse((object) => {
        if (object.isMesh) counts.meshes++;
        if (object.name === 'brig') counts.brigGroups++;
        if (typeof object.name === 'string' && object.name.startsWith('cell-door-')) counts.cellDoors++;
        if (object.isPointLight) counts.pointLights++;
      });
      return {
        ...counts,
        oilLampLights: lamps.length,
        lampFixtures:allLampFixtures.length,
        interior:ship.userData.model,
        cabinVisible: world.cabin.visible,
        cellsOpen: [...game.cellsOpen],
        ...game.world,
        climbing: game.climb ? { id: game.climb.ladder.id, t: Number(game.climb.t.toFixed(3)) } : null,
        mode: game.mode,
      };
    },
  };
}
