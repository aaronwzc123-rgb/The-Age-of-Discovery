import { hullWidth, hullHalfWidthAt, mainDeckHeight, MASTS, GUN_X } from './ship-layout.js';
import { createInventory, addItem, ITEMS, pickDrop } from './inventory.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const THREE_lerp = (a, b, t) => a + (b - a) * t;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// First-voyage target: enough to clear the 38 m ship and its mooring.
const SAIL_TARGET = 60;
export const PLAYER_HEIGHT=1.62, PLAYER_EYE_HEIGHT=1.43, PLAYER_RADIUS=.27;
export const ISLAND = { x: 0, z: -52, rx: 24, rz: 26 };
// Four cells line the aft corridor of the lower deck: two to port, two to starboard.
export const CELLS = [
  { name: '左后牢房', x: -8.3, side: -1, door: 0 },
  { name: '右后牢房', x: -8.3, side: 1, door: 1 },
  { name: '左前牢房', x: -6.3, side: -1, door: 2 },
  { name: '右前牢房', x: -6.3, side: 1, door: 3 },
];
// Deck levels, in metres above water: main 2.4, quarter 4.55, forecastle 3.1.
// The cabin chart table sits in the captain's cabin, directly under the helm.
export const CABIN_CHART = { x: -11.4, z: 1.2 };
// Every fitting the captain must physically walk up to and work by hand.
// x/z are ship-local, y the deck it stands on. Nothing here teleports the player.
export const STATIONS = [
  { id: 'helm', x: -12.6, z: 0, y: 4.55, label: '握住舵轮', hint: 'W 加速 · S 倒车 · A / D 转向 · 左键松手' },
  { id: 'anchor', x: 8.3, z: -.4, y: 2.4, label: '转动木绞车收锚', hint: '先压下制动杆，再推动木撬杆' },
  { id: 'capstan-brake', x: 9.3, z: 1.55, y: 2.4, label: '扳下绞车制动杆', hint: '收锚前先卡住棘齿' },
  { id: 'hatch', x: -4, z: 1.15, y: 2.4, label: '掀开下舱口盖', hint: '打开后抓住梯子进入水手舱' },
  { id: 'cargo-hatch', x: 3, z: 1.25, y: 2.4, label: '移开货舱格栅', hint: '格栅下面是货舱与淡水储备' },
  { id: 'boat', x: -11, z: -2.65, y: 4.55, label: '解开救生艇固定索', hint: '两套木吊臂将艇缓缓放入水面' },
  { id: 'cabin-door', x: -7.55, z: 0, y: 2.4, label: '推开船长室门', hint: '主甲板艉部，左右楼梯之间' },
];

// Ladders and rope ladders. Press E at the foot, climb with W / S, press E at the top to
// step off. entryY/exitY are real heights: the companion ladder runs down, the shrouds run up,
// so W climbs only on the shrouds. exitX/exitY/exitZ is where stepping off places the captain.
export const LADDERS = [
  { id: 'hatch', x: -4, z: .25, entryY: 2.4, exitY: .15, exitX: -3.7, exitZ: .25, label: '水手舱梯', kind: 'down', needsHatch: true, room: 'lower' },
  { id: 'cargo', x: 3, z: 0, deckExitX:3, deckExitZ:1.2, entryY: 2.4, exitY: -1.85, exitX: 3.5, exitZ: 0, label: '货舱梯', kind: 'down', needsCargo: true, room: 'hold' },
  { id: 'main-shroud', x: -1, z: 3.98, entryY: 2.4, exitY: 14, exitX: -.7, exitZ: .65, label: '主桅索梯', kind: 'up' },
  { id: 'fore-shroud', x: 7.5, z: 3.4, entryY: 2.4, exitY: 12.8, exitX: 7.7, exitZ: .6, label: '前桅索梯', kind: 'up' },
  { id: 'mizzen-shroud', x: -10, z: 3.45, entryY: 4.55, exitY: 10.5, exitX: -9.7, exitZ: .4, label: '后桅索梯', kind: 'up' },
];

// Mainmast fighting top, 14 m above water, reached by climbing the shrouds.
export const CROW_NEST = { x: -1, y: 14, z: 0 };

export function createGame() {
  return {
    // Facing aft down the deck: the helm, the captain's cabin and the stern gallery are ahead.
    // yaw follows atan2(dx, dz), so -π/2 looks along -x, toward the stern.
    mode: 'deck', player: { x: .6, z: .35, y: mainDeckHeight(.6,.35), vy: 0, yaw: -Math.PI/2 },
    ship: { x: 0, z: 0, heading: 0, speed: 0, throttle: 0, anchorLift: 0, anchorTarget: 0, rudder: 0 },
    boat: { deployed: false, lowering: 0, lowerTarget: false, x: -11, z: -4.6, heading: 0, speed: 0 },
    cellsOpen: [false, false, false, false],
    // Physical world state: nothing is open, loose or deployed until the captain does it.
    world: {
      hatchOpen: false,        // main-deck hatch lid, hinged and heavy
      cargoOpen: false,
      room: 'lower',
      lamps: {},
      cabinDoorOpen: false,    // captain's cabin door under the helm
      boatRopesReleased: false,// davit ropes still made fast to the boat
      capstanBraked: false,    // ratchet pawl engaged, holds the hemp cable
      sailsSet: Array.from({length:11},(_,i)=>i!==0&&i!==3),
      hasTelescope: false,     // lifted out of the crow's nest rail
      scopeRaised: false,      // currently looking through it
    },
    climb: null,               // { ladder, t } while the captain is on a ladder
    inventory: createInventory(),
    handAction: null,
    voyage: { cabin: false, chart: false, anchor: false, sailed: false, moored: false, distance: 0 },
    notice: '你是黑潮号船长。左键操作设施，按 B 给三名水手下令。', noticeTime: 7,
  };
}
export function recordChartVisit(game) { game.voyage.chart = true; }
export function voyageObjective(game) {
  const steps = [
    ['cabin', '检查船舱', '走到后部舱口旁左键 掀盖，再左键 抓梯、S 向下。也可推门进入船长室。'],
    ['chart', '查看海图', '艉部两侧楼梯之间是船长室门。进入后靠近海图桌左键，或按 M。'],
    ['anchor', '收起船锚', '按 B 点选船锚，派水手收锚；也可亲自压下制动杆，再按住木推杆。'],
    ['sailed', '第一次出航', `走左侧楼梯到船尾握住舵轮，W 加速。航行 ${Math.min(SAIL_TARGET, Math.floor(game.voyage.distance))} / ${SAIL_TARGET} 米。`],
    ['moored', '在海上停泊', '在舵轮边左键 松手，再走到木绞车旁抬起制动杆放锚。'],
  ];
  const next = steps.find(([id]) => !game.voyage[id]);
  return { count: steps.filter(([id]) => game.voyage[id]).length, title: next?.[1] || '首航完成 · 自由探索', hint: next?.[2] || '试试左舷艉部救生艇、游泳，或返回出生岛。黑潮号由你作主。', station: next?.[0] === 'sailed' ? 'helm' : next?.[0] };
}
export function toWorld(ship, x, z) {
  const c = Math.cos(ship.heading), s = Math.sin(ship.heading);
  return { x: ship.x + c * x + s * z, z: ship.z - s * x + c * z };
}
export function toLocal(ship, x, z) {
  const c = Math.cos(ship.heading), s = Math.sin(ship.heading);
  const dx = x - ship.x, dz = z - ship.z;
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}
export function playerWorld(game) {
  if (['deck', 'helm', 'cabin'].includes(game.mode)) return { ...toWorld(game.ship, game.player.x, game.player.z), y: game.player.y };
  if (game.mode === 'boat') return { x: game.boat.x, z: game.boat.z, y: -.15 };
  return { x: game.player.x, z: game.player.z, y: game.player.y };
}
export function islandHeight(x, z) {
  const radius = Math.hypot((x - ISLAND.x) / ISLAND.rx, (z - ISLAND.z) / ISLAND.rz);
  if (radius > 1.080001) return -5;
  if (radius > .86) return .55 - (radius - .86) * 4.0;
  return .55 + (1 - radius * radius / (.86 * .86)) * 1.05;
}
// The pier stands off the port side; its deck is 2.5 m above water.
export function dockHeight(x, z) {
  if (Math.abs(x) < 3.6 && z < -8.4 && z > -35.6) return 2.5;
  if (Math.abs(x) < 15 && z > -10.6 && z < -7.7) return 2.5;
  return -5;
}
export function isDocked(game) {
  return Math.hypot(game.ship.x, game.ship.z) < .85 && Math.abs(Math.sin(game.ship.heading)) < .08 && Math.cos(game.ship.heading) > .98;
}
// The gangplank meets the pier at 2.5 m and the ship at 2.4 m.
export function groundHeight(game, x, z) {
  if (isDocked(game) && x > -.9 && x < 2.1 && z > -8.8 && z < -4.2) {
    return 2.5 + clamp((z + 8.8) / 4.6, 0, 1) * -.1;
  }
  return Math.max(islandHeight(x, z), dockHeight(x, z));
}
// Main 2.4 m, quarter 4.55 m aft of -8, forecastle 3.1 m forward of 12.
export function deckHeight(x, z) {
  if (x < -6 && x > -8.22 && Math.abs(z)>.95 && Math.abs(z)<1.88) return 2.4+clamp((-x-6)/2.2,0,1)*2.15;
  if (x < -8) return 4.55;
  if (x > 12) return 3.1;
  if (x > 11 && x < 12.1 && Math.abs(z)>.3 && Math.abs(z)<1.2) return 2.4+clamp((x-11)/1.1,0,1)*.7;
  return mainDeckHeight(x,z);
}
export function walkingHeight(x,z,currentY=0) {
  if(currentY<3.3&&x< -7.78&&x> -8.7&&Math.abs(z)<.25)return 2.4;
  const platform=MASTS.find(m=>currentY>=m.nest-.35&&Math.abs(x-m.x)<1.1&&Math.abs(z)<.95);
  return platform?platform.nest:deckHeight(x,z);
}
function notify(game, text) { game.notice = text; game.noticeTime = 4; }
// Working the capstan is the only way the anchor moves. Hauling it home needs the pawl
// brake set; letting it run needs the brake released, otherwise the drum free-wheels.
export function heaveAnchor(game, dir) {
  const ship = game.ship, w = game.world;
  ship.throttle = 0;
  if (dir > 0) {
    if (!w.capstanBraked) {
      notify(game, '棘齿空着，木绞车会倒转。走到木鼓侧面先压下制动杆。');
      return false;
    }
    if (ship.anchorLift >= .999) { notify(game, '锚已收在猫头梁下面，粗麻缆绷紧了。'); return false; }
    ship.anchorTarget = 1;
    notify(game, '你推动木撬杆，粗麻锚缆缓缓卷上木鼓。');
  } else {
    if (w.capstanBraked) {
      w.capstanBraked = false;
      notify(game, '你抬起制动杆，棘齿让开，粗麻缆沿导缆孔滑入海中。');
    } else {
      notify(game, '制动杆已经抬起，锚缆正在缓放。');
    }
    ship.anchorTarget = 0;
    ship.speed = 0;
  }
  return true;
}
export function interactions(game) {
  const p=game.player,w=game.world;
  if(game.climb){
    const c=game.climb;
    return [{id:'climb-off',label:'松开梯子 / 跨出梯口',hint:'W 上爬 · S 下爬 · 空格跳离',distance:0}];
  }
  if(game.mode==='helm')return[{id:'leave-helm',label:'松开舵轮',hint:'左键松手 · W/S 推进 · A/D 转舵',distance:0}];
  if(game.mode==='boat')return[{id:'leave-boat',label:'离艇下水',hint:'左键离艇 · W/S 划桨 · A/D 转向',distance:0},...ladderOptions(game)];
  const choices=[];
  if(['deck','cabin'].includes(game.mode)){
    for(const point of STATIONS){
      if(game.mode==='cabin'&&point.id!=='cabin-door')continue;
      if(game.mode==='cabin'&&w.room!=='captain')continue;
      if(distance(p,point)>2.3||Math.abs(p.y-point.y)>1.0)continue;
      let label=point.label;
      if(point.id==='anchor')label=w.capstanBraked?'按住推杆收锚':'先压下制动杆';
      if(point.id==='capstan-brake')label=w.capstanBraked?'抬起制动杆放锚':'压下绞车制动杆';
      if(point.id==='hatch')label=w.hatchOpen?'关闭水手舱口盖':'打开水手舱口盖';
      if(point.id==='cargo-hatch')label=w.cargoOpen?'关闭货舱格栅':'移开货舱格栅';
      if(point.id==='cabin-door')label=w.cabinDoorOpen?'关上船长室门':'推开船长室门';
      if(point.id==='boat')label=game.boat.deployed?'沿吊索下到救生艇':game.boat.lowerTarget?'救生艇正在下放':w.boatRopesReleased?'下放救生艇':'解开救生艇固定索';
      choices.push({...point,label,hint:point.id==='anchor'?'按住左键推动 · 松开停止':'瞄准操作部位 · 左键'});
    }
    if(game.mode==='cabin'){
      if(w.room==='lower'&&Math.hypot(p.x+4,p.z-.58)<1.7)choices.push({id:'hatch',label:w.hatchOpen?'拉绳关闭水手舱盖':'拉绳打开水手舱盖',hint:'瞄准下侧拉环 · 左键',distance:0});
      if(w.room==='captain'){
        choices.push({id:'chart',...CABIN_CHART,y:3.2,label:'展开桌上航海图',hint:'左键查看'});
        choices.push({id:'container-captain',x:-13.1,y:2.85,z:1.42,label:'打开船长储物箱',hint:'提灯与备用绳卷'});
      }
      if(w.room==='hold')choices.push({id:'container-hold',x:4.9,y:-1.25,z:1.7,label:'打开货舱储物箱',hint:'备用麻绳'});
      if(w.room==='lower')for(const[index,cell]of CELLS.entries())choices.push({id:'cell-'+index,x:cell.x,y:1.05,z:cell.side*.55,label:(game.cellsOpen[index]?'关闭':'打开')+cell.name,hint:'瞄准门闩 · 左键'});
    }
    choices.push(...lampOptions(game));
    if(game.mode==='deck')choices.push(...highOptions(game));
  }
  choices.push(...ladderOptions(game));
  const world=playerWorld(game);
  for(const drop of game.inventory.drops){const point=drop.space==='ship'?{...toWorld(game.ship,drop.position[0],drop.position[2]),y:drop.position[1]}:{x:drop.position[0],y:drop.position[1],z:drop.position[2]};if(Math.hypot(world.x-point.x,world.z-point.z)<2.2)choices.push({id:drop.id,drop,label:'拾取'+ITEMS[drop.type].name,hint:'左键收入背包',distance:distance(world,point)});}
  if(game.mode==='swim'&&game.boat.deployed&&distance(world,game.boat)<2.4)choices.push({id:'board-boat',label:'抓住艇沿登艇',hint:'左键抓艇沿',distance:distance(world,game.boat)});
  return choices.filter(c=>c.distance===undefined?Math.hypot(p.x-c.x,p.z-c.z)<2.3:true);
}
function lampOptions(game){
  const room=game.mode==='cabin'?game.world.room:'deck',p=game.player;
  return(game.layout?.lamps||[]).filter(l=>l.room===room&&Math.abs(l.position[1]-p.y)<2)
    .map(l=>({id:'lamp-'+l.id,lamp:l,x:l.position[0],y:l.position[1],z:l.position[2],label:(game.world.lamps[l.id]??l.on)?'熄灭这盏灯':'点亮这盏灯',hint:'瞄准灯具 · 左键',distance:Math.hypot(p.x-l.position[0],p.z-l.position[2])})).filter(l=>l.distance<2.2);
}
function ladderOptions(game){
  const paths=game.layout?.climbPaths||[];
  return paths.filter(path=>(!path.needsHatch||game.world.hatchOpen)&&(!path.needsCargo||game.world.cargoOpen)).flatMap(path=>{
    let p=game.player;
    const onboard=['deck','cabin','helm'].includes(game.mode);
    if(path.space==='ship'&&!onboard){const world=playerWorld(game);p={...toLocal(game.ship,world.x,world.z),y:world.y-(game.ship.bob||0)};}
    if(path.space==='world'&&onboard)p=playerWorld(game);
    const upper=path.upperExit,lower=path.lowerExit;
    const near=(point)=>Math.hypot(p.x-point[0],p.z-point[2])<2.0&&Math.abs(p.y-point[1])<1.0;
    const atTop=near(upper),atBottom=near(lower);
    if(!atTop&&!atBottom)return[];
    return[{id:'ladder-'+path.id,ladder:path,atTop,label:(atTop?'沿':'抓住')+path.label+(atTop?'向下':''),hint:'左键抓握 · W 上爬 · S 下爬',distance:0}];
  });
}
function highOptions(game){
  const p=game.player,w=game.world,choices=[];
  if(!w.hasTelescope&&p.y>12.4&&Math.hypot(p.x+.34,p.z+.64)<2)choices.push({id:'take-scope',x:-.34,y:14.51,z:-.64,label:'取下黄铜望远镜',hint:'左键收入背包',distance:0});
  for(const[index,station]of yards().entries())if(Math.abs(p.y-station.y)<1.4&&distance(p,station)<2.2)choices.push({id:'sail-'+index,...station,label:w.sailsSet[index]?'收起第 '+(index+1)+' 面帆':'展开第 '+(index+1)+' 面帆',hint:'瞄准工作绳端 · 左键',distance:0});
  return choices;
}
function yards(){return[{x:7.5,y:12.8,z:.6},{x:7.5,y:12.8,z:.8},{x:7.5,y:12.8,z:1},{x:-1,y:14,z:.6},{x:-1,y:14,z:.8},{x:-1,y:14,z:1},{x:-10,y:10.5,z:.6},{x:-10,y:10.5,z:.8},{x:13.5,y:3.1,z:.7},{x:13.5,y:3.1,z:.9},{x:13.5,y:3.1,z:1.1}];}
function onGangplank(game, x, z) { return isDocked(game) && x > -.9 && x < 2.1 && z < -4.03 && z > -8.9; }
export function dive(game) {
  return game.controller?.dive(game)||false;
}
// Every branch here is a physical action at arm's reach. Nothing teleports the captain
// across the ship: opening the hatch, climbing down, hauling the anchor all take time.
export function interact(game,selectedId) {
  if(!selectedId)return null;
  const choice=interactions(game).find(c=>c.id===selectedId);
  if(!choice)return null;
  const p=game.player,w=game.world;
  if(choice.drop){if(!pickDrop(game,choice.id)){notify(game,'背包已满。');return null;}return choice.id;}
  if(choice.lamp){w.lamps[choice.lamp.id]=!(w.lamps[choice.lamp.id]??choice.lamp.on);return choice.id;}
  if(choice.id.startsWith('container-'))return choice.id;
  if(choice.ladder){return game.controller?.startClimb(game,choice.ladder,choice.atTop)?choice.id:null;}
  if(choice.id.startsWith('sail-')){const i=Number(choice.id.slice(5));w.sailsSet[i]=!w.sailsSet[i];notify(game,w.sailsSet[i]?'帆索松开，帆布展开。':'升降索拉紧，帆布收拢。');return choice.id;}
  switch(choice.id){
    case 'climb-off': return game.controller?.exitClimb(game)?choice.id:null;
    case 'helm':
      if(Math.abs(p.x+12.6)>.55||Math.abs(p.z)>.65){notify(game,'请站到舵轮后方，再握住轮柄。');return null;}
      if(!game.controller?.sweep(game,[-12.46,4.55,0],'ship')){notify(game,'舵轮后方被挡住了，请调整站位。');return null;}
      game.mode='helm';p.vy=0;p.yaw=game.ship.heading+Math.PI/2;notify(game,'已握舵 · W/S 推进 · A/D 转舵 · 左键松手');break;
    case 'leave-helm':game.mode='deck';break;
    case 'anchor':if(!heaveAnchor(game,1))return null;game.anchorHeld=true;break;
    case 'capstan-brake':w.capstanBraked=!w.capstanBraked;if(!w.capstanBraked)heaveAnchor(game,-1);break;
    case 'hatch':
      if(w.hatchOpen&&p.y>1.6&&Math.abs(p.x+4)<.72&&Math.abs(p.z-.25)<.85){notify(game,'梯口有人，先离开舱口。');return null;}w.hatchOpen=!w.hatchOpen;break;
    case 'cargo-hatch':
      if(w.cargoOpen&&Math.abs(p.x-3)<1.25&&Math.abs(p.z)<1.05){notify(game,'梯口有人，先离开舱口。');return null;}w.cargoOpen=!w.cargoOpen;break;
    case 'cabin-door':
      if(w.cabinDoorOpen&&Math.abs(p.x+8)<.55&&Math.abs(p.z)<.8){notify(game,'门边有人，先后退。');return null;}w.cabinDoorOpen=!w.cabinDoorOpen;break;
    case 'chart':return 'chart';
    case 'take-scope':
      if(!addItem(game.inventory.slots,'telescope')){notify(game,'背包已满。');return null;}
      w.hasTelescope=true;{const slot=game.inventory.slots.findIndex(s=>s?.type==='telescope');if(slot<9)game.inventory.selected=slot;}game.inventory.stowed=false;notify(game,'望远镜已收入背包，放入快捷栏后右键举起观察。');break;
    case 'boat':
      if(!w.boatRopesReleased){w.boatRopesReleased=true;notify(game,'固定索已解开，再操作吊索下放小艇。');}
      else if(!game.boat.deployed){game.boat.lowerTarget=true;notify(game,'正在下放救生艇。');}
      else {if(!game.controller?.boardBoat?.(game))return null;}break;
    case 'board-boat':if(!game.controller?.boardBoat?.(game))return null;break;
    case 'leave-boat':dive(game);break;
    default:
      if(choice.id.startsWith('cell-')){const i=Number(choice.id.slice(5));if(game.cellsOpen[i]&&Math.abs(p.z)>.3&&Math.abs(p.z)<.95&&Math.abs(p.x-CELLS[i].x)<.7){notify(game,'门口有人，先后退。');return null;}game.cellsOpen[i]=!game.cellsOpen[i];}
      else return null;
  }
  return choice.id;
}

function collidesShip(game, x, z, heading) {
  const proposed = { x, z, heading };
  // ponytail: a sampled hull footprint covers this one island; use swept polygon collisions for crowded harbors.
  for (const lx of [-15.5, -11, -5, 1, 7, 13, 16]) for (const lz of [-hullWidth(lx), 0, hullWidth(lx)]) {
    const point = toWorld(proposed, lx, lz);
    if (islandHeight(point.x, point.z) > -.25 || dockHeight(point.x, point.z) > 0) return true;
  }
  return Math.hypot(x, z) > 130;
}
export function stepGame(game, input, dt) {
  dt = clamp(dt, 0, .05);
  const ship = game.ship, p = game.player;
  if(game.boat.lowerTarget&&!game.boat.deployed){
    game.boat.lowering=clamp(game.boat.lowering+dt/4.2,0,1);
    if(game.boat.lowering===1){Object.assign(game.boat,{...toWorld(ship,-11,-4.6),heading:ship.heading,deployed:true,speed:0});notify(game,'小艇浮在水面上，吊索已松开。靠近吊臂按E下艇。');}
  }
  game.noticeTime = Math.max(0, game.noticeTime - dt);
  const oldLift = ship.anchorLift;
  if(ship.anchorTarget<ship.anchorLift||game.anchorHeld||game.crewAnchorHeld)ship.anchorLift += clamp(ship.anchorTarget - ship.anchorLift, -dt / 2.6, dt / 2.6);
  if (oldLift !== ship.anchorLift && ship.anchorLift === ship.anchorTarget) notify(game, ship.anchorTarget ? '船锚已收起。黑潮号可以启航了。' : '船锚已落下。黑潮号稳稳停泊。');
  if (ship.anchorLift >= .999) game.voyage.anchor = true;
  if (game.voyage.sailed && ship.anchorLift === 0 && !game.voyage.moored) {
    game.voyage.moored = true;
    notify(game, '海上停泊成功。黑潮号已安稳抛锚，继续探索吧，船长。');
  }
  if (game.mode === 'helm') {
    ship.rudder = input.turn || 0;
    if (ship.anchorLift < .999) {
      ship.speed = ship.throttle = 0;
      if (input.forward) notify(game, '锚还咬着海底。先到船头压下制动杆，再推动木绞车收锚。');
    } else ship.throttle = clamp(ship.throttle + (input.forward || 0) * dt * 1.4, -1.2, 4.2);
  } else ship.rudder *= Math.exp(-dt * 4);
  if (ship.anchorLift < .999) ship.speed = ship.throttle = 0;
  else ship.speed += (ship.throttle - ship.speed) * Math.min(1, dt * .8);
  const heading = ship.heading + (ship.anchorLift >= .999 ? ship.rudder * dt * .36 * Math.max(.3, Math.min(1, Math.abs(ship.speed) / 1.2)) : 0);
  const sx = ship.x + Math.cos(heading) * ship.speed * dt, sz = ship.z - Math.sin(heading) * ship.speed * dt;
  if ((sx !== ship.x || sz !== ship.z || heading !== ship.heading) && collidesShip(game, sx, sz, heading)) {
    ship.speed = ship.throttle = 0; notify(game, '前方是码头、浅滩或海域边界。减速并转向开阔水面。');
  } else {
    game.voyage.distance += Math.hypot(sx - ship.x, sz - ship.z);
    if (game.voyage.distance >= SAIL_TARGET) game.voyage.sailed = true;
    Object.assign(ship, { x: sx, z: sz, heading });
  }
  game.controller?.sync(game,dt);
  if (game.climb||game.transfer) { game.controller?.move(game,input,dt); return; }
  if (game.mode === 'helm') return;
  if (game.mode === 'boat') {
    if(input.jump){game.controller?.dive(game);return;}
    const boat = game.boat;
    boat.speed += (((input.forward || 0) * 2.8) - boat.speed) * Math.min(1, dt * 2.5);
    boat.heading += (input.turn || 0) * dt * .85;
    const x = boat.x + Math.cos(boat.heading) * boat.speed * dt, z = boat.z - Math.sin(boat.heading) * boat.speed * dt;
    const local = toLocal(ship, x, z);
    const insideHull = local.x > -15.5 && local.x < 16.5 && Math.abs(local.z) < hullWidth(local.x) + 1.0;
    if (islandHeight(x, z) < .1 && dockHeight(x, z) < 0 && !insideHull && Math.hypot(x, z) < 135) Object.assign(boat, { x, z });
    else { boat.speed = 0; if (input.forward) notify(game, '靠近岸边了。左键 下水，再游到沙滩或码头梯。'); }
    return;
  }
  game.controller?.move(game,input,dt);
}
