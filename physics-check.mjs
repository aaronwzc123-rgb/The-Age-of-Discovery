import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import { createGame,stepGame,interact } from './game.js';
import { createPlayerController,startClimb } from './player-controller.js';
import { CLIMB_PATHS,sampleClimbPath } from './climb-paths.js';
import { GUN_X,hullHalfWidthAt,mainDeckHeight } from './ship-layout.js';
import RAPIER from './node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';

const layout={collisions:[{kind:'captain-desk',room:'captain',x:-11.4,z:1.2,w:1.4,d:.8,minY:2.4,maxY:3.25}]};
const controller=await createPlayerController(layout);
function gameAt(x,y,z,mode='deck'){const g=createGame();g.layout=layout;g.controller=controller;g.mode=mode;Object.assign(g.player,{x,y,z,vy:0});controller.reset(g);return g;}
function steps(g,n,input={}){for(let i=0;i<n;i++)stepGame(g,input,1/60);return g;}
const report={engine:controller.stats,checks:[],ladder:[]};
function check(name,fn){fn();report.checks.push(name);}

check('10炮架扫掠、斜向滑动和反向恢复',()=>{
  for(const x of GUN_X.filter(x=>x!==-7))for(const side of[-1,1]){
    const z=side*(hullHalfWidthAt(x,2.4)-.98),g=gameAt(x,mainDeckHeight(x,side*(Math.abs(z)-1.4)),side*(Math.abs(z)-1.4));
    steps(g,50,{moveZ:side,run:true});assert.ok(Math.abs(g.player.z)<Math.abs(z)-.8,`炮架穿入 ${x}/${side}`);
    const before=g.player.x;steps(g,25,{moveX:1,moveZ:side});assert.ok(g.player.x>before+.3,'贴炮斜行不能滑开');
    const stuck=g.player.z;steps(g,25,{moveZ:-side});assert.ok(Math.abs(g.player.z)<Math.abs(stuck)-.4,'不能退离炮架');
  }
  // The aft gun's inboard side is occupied by the visible stairs, approach on its fore side.
  for(const side of[-1,1]){const z=side*(hullHalfWidthAt(-7,2.4)-.98),g=gameAt(-5.6,2.4,z);steps(g,40,{moveX:-1});assert.ok(g.player.x>-6.14);const before=g.player.z;steps(g,24,{moveX:-1,moveZ:side});assert.ok(Math.abs(g.player.z-before)>.04,'炮架与栏杆之间能作有限侧移');steps(g,30,{moveX:1});assert.ok(g.player.x>-5.8);}
});
check('关门阻挡，打开后自然走入走出船长室',()=>{
  const g=gameAt(-7.1,2.4,0);steps(g,60,{moveX:-1});assert.ok(g.player.x>-7.75);
  g.world.cabinDoorOpen=true;steps(g,75,{moveX:-1});assert.equal(g.mode,'cabin');assert.equal(g.world.room,'captain');assert.ok(g.player.x<-8.3);
  steps(g,90,{moveX:1});assert.equal(g.mode,'deck');assert.ok(g.player.x>-7.7);
});
check('船长室顶梁阻止跳跃而保留可行走净空',()=>{
  const g=gameAt(-9,2.4,0,'cabin');g.world.room='captain';g.world.cabinDoorOpen=true;steps(g,10);const y=g.player.y;let top=y;
  stepGame(g,{jump:true},1/60);for(let i=0;i<50;i++){stepGame(g,{},1/60);top=Math.max(top,g.player.y);}assert.ok(top<2.99);assert.ok(top>y+.05);
});
check('站到真实舵轮后方可握舵，接近路径不被整块舵座误挡',()=>{
  const g=gameAt(-12.56,4.55,0);assert.equal(interact(g,'helm'),'helm');assert.equal(g.mode,'helm');assert.ok(Math.abs(g.player.x+12.46)<.01);assert.ok(Math.abs(g.player.z)<.01);
});
check('两侧真实甲板楼梯可上可下',()=>{
  for(const side of[-1,1]){const g=gameAt(-5.4,2.4,side*1.4);steps(g,125,{moveX:-1});assert.ok(g.player.y>4.4,`楼梯不能上 ${side} y${g.player.y}`);steps(g,140,{moveX:1});assert.ok(g.player.y<2.6);}
  for(const side of[-1,1]){const g=gameAt(10.45,2.4,side*.75);steps(g,60,{moveX:1});assert.ok(g.player.y>3.05,`艏楼梯不能上 ${side}`);steps(g,75,{moveX:-1});assert.ok(g.player.x<11&&g.player.y<2.6,`艏楼梯不能下 ${side}: ${JSON.stringify(g.player)}`);}
  const diagonal=gameAt(12.047872,3.111999953,.764465);steps(diagonal,30,{moveX:.999,moveZ:-.044});assert.ok(diagonal.player.x>12.8,'楼梯坡顶与平甲板连接处不能斜行');
  for(const heading of[0,.7,-.8,Math.PI/2])for(const side of[-1,1]){
    const g=gameAt(-6.547275744763542,3.050659684718025,side*1.3933743220490125);Object.assign(g.ship,{x:15,z:8,heading});const co=Math.cos(heading),si=Math.sin(heading);let maxVerticalStep=0;
    const continuousSteps=(n,dir)=>{for(let i=0;i<n;i++){const before=g.player.y;stepGame(g,{moveX:dir*co,moveZ:-dir*si},1/60);maxVerticalStep=Math.max(maxVerticalStep,Math.abs(g.player.y-before));}};
    continuousSteps(60,-1);assert.ok(g.player.x<-8.65&&g.player.y>4.5,`旋转艉梯坡顶不能跨出 ${heading}/${side}`);continuousSteps(100,1);assert.ok(g.player.x>-7&&g.player.y<3.8,`旋转艉梯坡顶不能下行 ${heading}/${side}`);assert.ok(maxVerticalStep<.08,`平滑坡提前突抬 ${maxVerticalStep}`);
  }
});
check('开放货舱口没有假地板',()=>{
  const g=gameAt(3,2.4,.25);g.world.cargoOpen=true;steps(g,100);assert.equal(g.mode,'cabin');assert.equal(g.world.room,'hold');assert.ok(g.player.y< -1.7);
});
check('船平移与转向不重复变换人物',()=>{
  const g=gameAt(.6,2.4,1.1);steps(g,30);const initial={...g.player};for(let i=0;i<600;i++){g.ship.x=8+i*.015;g.ship.z=10;g.ship.heading=i*.002;g.ship.bob=Math.sin(i*.03)*.03;stepGame(g,{},1/60);}assert.ok(Math.hypot(g.player.x-initial.x,g.player.z-initial.z)<.02);
});
for(const path of CLIMB_PATHS){
  const pos=sampleClimbPath(path,0),g=gameAt(...pos,path.lowerMode);if(path.room)g.world.room=path.room;g.world.hatchOpen=g.world.cargoOpen=true;assert.ok(startClimb(g,path,false));steps(g,90);assert.equal(g.climb?.phase,'climb',`抓入失败 ${path.id} ${g.notice}`);
  const midSteps=Math.ceil(path.length/.75*30);steps(g,midSteps,{forward:1});assert.ok(g.climb&&g.climb.progress>.25,`没有爬到中段 ${path.id}`);const still={...g.player},contacts=structuredClone(g.climb.contacts);steps(g,300);assert.ok(Math.hypot(g.player.x-still.x,g.player.y-still.y,g.player.z-still.z)<.0001);
  assert.deepEqual(g.climb.contacts,contacts,'停止时抓点漂移');
  const maxSteps=Math.ceil(path.length/.75*120)+180;for(let i=0;i<maxSteps&&g.climb;i++)stepGame(g,{forward:1},1/60);steps(g,30);
  report.ladder.push({id:path.id,phase:g.climb?.phase||'finished',progress:g.climb?.progress,player:{x:g.player.x,y:g.player.y,z:g.player.z},notice:g.notice});
  assert.ok(!g.climb,`梯顶不能跨出 ${path.id}: ${JSON.stringify(report.ladder.at(-1))}`);
  assert.equal(g.mode,path.upperMode);assert.ok(Math.hypot(g.player.x-path.upperExit[0],g.player.z-path.upperExit[2])<.1);
  assert.ok(startClimb(g,path,true),`梯顶不能返回 ${path.id}`);for(let i=0;i<maxSteps&&g.climb;i++)stepGame(g,{back:1},1/60);assert.ok(!g.climb,`梯底不能退出 ${path.id}: ${JSON.stringify({p:g.player,notice:g.notice})}`);
  steps(g,120);if(path.lowerMode!=='swim'){assert.ok(g.player.grounded,`梯底退出后悬空 ${path.id}`);const before={...g.player};steps(g,15,{moveZ:path.mast!==undefined?-1:1});assert.ok(Math.hypot(g.player.x-before.x,g.player.z-before.z)>.08,`梯底无法走开 ${path.id}`);}
}
report.checks.push('七条木梯/索梯往返、中段停止、接触锁住和梯底落脚');
check('门扇旋转连续，并防止夹住船长或船员',()=>{
  const g=gameAt(-7.5,2.4,0);g.world.cabinDoorOpen=true;steps(g,90);assert.ok(g.world.cabinDoorAngle<-1.3);
  Object.assign(g.player,{x:-8,y:2.4,z:0});g.world.cabinDoorOpen=false;steps(g,90);assert.ok(g.world.cabinDoorAngle<-.1);assert.equal(g.world.mechanismBlocked,'船长室门');
  Object.assign(g.player,{x:-6.8,y:2.4,z:0});steps(g,90);assert.equal(g.world.cabinDoorAngle,0);
  g.world.cabinDoorOpen=true;steps(g,90);
  const actor=controller.world.createCollider(RAPIER.ColliderDesc.capsule(CHARACTER_HALF(),.27).setTranslation(-8,3.21,0));controller.model.ids.set(actor.handle,'crew-test');
  g.world.cabinDoorOpen=false;steps(g,90);assert.ok(g.world.cabinDoorAngle<-.1);assert.equal(g.world.mechanismBlocked,'船长室门');controller.model.ids.delete(actor.handle);controller.world.removeCollider(actor,true);steps(g,90);assert.equal(g.world.cabinDoorAngle,0);
});
function CHARACTER_HALF(){return 1.62/2-.27;}
check('NPC胶囊阻挡人物，不将船员当作可穿过的装饰',()=>{
  const g=gameAt(.6,2.4,1.1),actor=controller.world.createCollider(RAPIER.ColliderDesc.capsule(CHARACTER_HALF(),.27).setTranslation(1.5,3.21,1.1));controller.model.ids.set(actor.handle,'crew-test');
  steps(g,60,{moveX:1});assert.ok(g.player.x<1.0);controller.model.ids.delete(actor.handle);controller.world.removeCollider(actor,true);steps(g,40,{moveX:1});assert.ok(g.player.x>1.6);
});
function continuous(g,n){let previous={x:g.player.x,y:g.player.y,z:g.player.z},max=0;for(let i=0;i<n;i++){const transferring=!!g.transfer;stepGame(g,{},1/60);const current=g.mode==='boat'?{x:g.boat.x,y:-.15,z:g.boat.z}:g.player,distance=Math.hypot(current.x-previous.x,current.y-previous.y,current.z-previous.z);if(transferring)assert.ok(distance<.06,`受控转移超过匀速单帧距离 ${distance}`);max=Math.max(max,distance);previous={...current};}assert.ok(max<.25,`移动超过5.7m自由落体单帧距离 ${max}`);return max;}
check('救生艇登艇、离艇和船沿入水沿连续扫掠路线进行',()=>{
  const g=gameAt(-11,4.55,-2.4);Object.assign(g.boat,{deployed:true,x:-11,z:-4.6});const start={...g.player};assert.ok(controller.boardBoat(g));assert.equal(g.player.x,start.x);assert.equal(g.player.y,start.y);assert.equal(g.player.z,start.z);continuous(g,600);assert.equal(g.mode,'boat');assert.ok(!g.transfer);
  stepGame(g,{jump:true},1/60);assert.ok(g.transfer,'船上Space开始翻艇沿');continuous(g,300);assert.equal(g.mode,'swim');
  Object.assign(g.player,{x:-11,y:-.73,z:-6.4});assert.ok(controller.boardBoat(g));continuous(g,400);assert.equal(g.mode,'boat');
  const h=gameAt(-11,4.55,-2.4);assert.ok(controller.dive(h));continuous(h,500);assert.equal(h.mode,'swim');assert.ok(h.player.y>=-.73);
});
check('收锚需要持续施力，松手后停住；航行蹲下再起身不混用坐标',()=>{
  const g=gameAt(.6,2.4,1.1);g.ship.anchorTarget=1;steps(g,60);assert.equal(g.ship.anchorLift,0);g.anchorHeld=true;steps(g,60);assert.ok(g.ship.anchorLift>.3);g.anchorHeld=false;const lift=g.ship.anchorLift;steps(g,60);assert.equal(g.ship.anchorLift,lift);
  g.ship.x=20;g.ship.z=30;g.ship.heading=1.2;steps(g,10,{crouch:true});assert.ok(g.player.crouched);steps(g,10);assert.ok(!g.player.crouched);assert.ok(g.player.grounded);
});
mkdirSync('artifacts/interaction-20261008',{recursive:true});writeFileSync('artifacts/interaction-20261008/physics-check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
