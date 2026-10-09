import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGame, stepGame } from './game.js';
import { createPlayerController } from './player-controller.js';
import { buildShipInterior } from './ship-interior.js';
import { buildShip } from './ship.js';
import { createCrewSystem } from './crew.js';

const {ship,sails,capstanBars}=buildShip(),layout=buildShipInterior(ship).layout,scene=new THREE.Scene();scene.add(ship);
const tailOnly=process.argv.includes('--tail'),anchorOnly=process.argv.includes('--anchor');
const game=createGame();game.layout=layout;game.controller=await createPlayerController(layout);
Object.assign(game.player,{x:-13,y:4.55,z:1.1});game.controller.reset(game);
const events=[],crew=await createCrewSystem({game,layout,sails,capstanBars,scene,ship,onChange:event=>events.push(event)});
ship.updateMatrixWorld(true);crew.render(1/60);
assert(crew.sailors.every(s=>s.pirate.visible&&s.pirate.rig.head.visible&&s.pirate.rig.torso.visible),'Three sailors retain visible third-person bodies');
assert.equal(new Set(crew.sailors.map(s=>s.pirate.rig.materials.coat.color.getHex())).size,3,'Each sailor has an independent uniform');
assert([...game.controller.model.ids.values()].filter(id=>/^crew-/.test(id)).length===3,'Captain collision world contains all sailors');
const dt=1/60;let maxStep=0,maxStepDetail=null;
function tick(n=1){for(let i=0;i<n;i++){const before=crew.state;game.crewAnchorHeld=crew.anchorHeld();stepGame(game,{},dt);crew.update(dt);const after=crew.state;for(let j=0;j<3;j++){const distance=Math.hypot(...after[j].position.map((v,k)=>v-before[j].position[k]));if(distance>maxStep){maxStep=distance;maxStepDetail={before:before[j],after:after[j],route:crew.sailors[j].route[0]};}}}}
function until(predicate,seconds=90){for(let i=0;i<seconds*60;i++){if(predicate())return;tick();}assert.fail(`crew timed out: ${JSON.stringify(crew.state)}`);}
game.mode='cabin';game.world.room='lower';Object.assign(game.player,{x:-3.04,y:.15,z:-.6});game.controller.reset(game);
for(let i=0;i<45;i++){stepGame(game,{moveZ:1},dt);crew.update(dt);}
assert(game.player.z<-.18&&game.player.z>-.5,'Captain is physically blocked by a resting sailor');
game.mode='deck';Object.assign(game.player,{x:-13,y:4.55,z:1.1});game.controller.reset(game);
game.world.hatchOpen=true;game.cellsOpen[0]=true;stepGame(game,{},dt);const mechanismAngles={hatch:game.world.hatchAngle,cells:[...game.world.cellDoorAngles]};crew.update(dt);
assert.equal(game.world.hatchAngle,mechanismAngles.hatch);assert.deepEqual(game.world.cellDoorAngles,mechanismAngles.cells,'Three NPC controllers must not accelerate shared door animations');
assert(crew.sailors.every(s=>s.view.world.cellDoorAngles!==game.world.cellDoorAngles&&s.view.world.sailsSet!==game.world.sailsSet));game.cellsOpen[0]=false;game.world.hatchOpen=false;
console.log('PASS visible sailors, independent uniforms, captain collision and external mechanisms');
const captainRoom=game.world.room;
if(!tailOnly){
assert.equal(crew.state.length,3);assert(crew.state.every(s=>s.status==='rest'));
assert.equal(crew.command({type:'sail',index:11,set:true}).ok,false);
assert.equal(crew.command({type:'guard',mast:-1}).ok,false);
assert.equal(crew.command({type:'anchor',raised:true,crewId:'missing'}).ok,false);
const anchor=crew.command({type:'anchor',raised:true,crewId:'crew-0'});assert(anchor.ok);
assert.equal(crew.command({type:'anchor',raised:true}).crewId,anchor.crewId);
assert.equal(crew.command({type:'anchor',raised:false}).ok,false);
assert.equal(crew.command({type:'guard',mast:1,crewId:anchor.crewId}).ok,false);
const paused=structuredClone(crew.state);crew.update(4,true);assert.deepEqual(crew.state,paused);
until(()=>crew.state[0].status==='working');
let gripSamples=0,retractedSamples=0,maxGripError=0;
const contact=new THREE.Vector3(),from=new THREE.Vector3(),to=new THREE.Vector3(),closest=new THREE.Vector3(),line=new THREE.Line3();
for(const heading of[0,.7,-.8,Math.PI/2]){
  game.ship.heading=heading;tick(1);ship.rotation.y=heading;ship.updateMatrixWorld(true);
  for(let settle=0;settle<24;settle++)crew.render(dt);
  for(let angle=0;angle<Math.PI*2;angle+=.10){
    capstanBars.forEach((bar,i)=>{bar.rotation.z=angle+i*Math.PI/2;});ship.updateMatrixWorld(true);
    crew.render(dt);const sailor=crew.sailors[0],action=sailor.view.handAction;
    assert(!sailor.pirate.userData.bodyDiagnostics.unreachable.some(item=>item.limb.endsWith('Hand')),'A working sailor never lengthens an arm to grab a bar');
    if(!action){retractedSamples++;continue;}
    sailor.pirate.rig.chains[action.hand].contact.getWorldPosition(contact);
    let error=Infinity;
    for(const bar of capstanBars){bar.localToWorld(from.set(0,.34,0));bar.localToWorld(to.set(0,1.28,0));line.set(from,to);line.closestPointToPoint(contact,true,closest);error=Math.min(error,contact.distanceTo(closest));}
    maxGripError=Math.max(maxGripError,error);assert(error<.008,`Sailor hand must touch a real rotating handspike (${error})`);gripSamples++;
  }
}
game.ship.heading=0;tick(1);ship.rotation.y=0;ship.updateMatrixWorld(true);
assert(gripSamples>12,'Reachable bar phases include actual hand contact');
console.log(`PASS windlass grip: ${gripSamples} real contacts, ${retractedSamples} retractions, maximum error ${maxGripError.toFixed(5)}m`);
until(()=>game.ship.anchorLift>=.999);assert(crew.state[0].distanceWalked>14,'Anchor sailor must physically leave lower cabin and walk to windlass');
until(()=>crew.state[0].status==='rest');assert.equal(game.world.room,captainRoom,'Crew labels must not change captain room');
assert(game.world.hatchOpen,'Crew opens the real shared hatch');assert.equal(game.ship.anchorLift,1);
console.log('PASS anchor: actual lower cabin, hatch climb, deck walk, heave and return');

Object.assign(game.player,{x:4,y:2.4,z:1.2});game.controller.reset(game);
assert(crew.command({type:'anchor',raised:false,crewId:'crew-0'}).ok);
until(()=>crew.state[0].status==='blocked');assert.equal(game.ship.anchorLift,1,'An obstructed sailor cannot work remotely');
Object.assign(game.player,{x:-13,y:4.55,z:1.1});game.controller.reset(game);
until(()=>game.ship.anchorLift===0);until(()=>crew.state[0].status==='rest');
assert(crew.command({type:'anchor',raised:true,crewId:'crew-0'}).ok);until(()=>game.ship.anchorLift>.15);
assert(crew.command({type:'rest',crewId:'crew-0'}).ok);const stoppedLift=game.ship.anchorLift;tick(60);assert.equal(game.ship.anchorLift,stoppedLift,'Recall immediately stops further heaving');until(()=>crew.state[0].status==='rest');
console.log('PASS obstruction waits and resumes; anchor recall stops heaving immediately');

if(!anchorOnly){
// All three mast tracks run against the actual interior and collision model.
for(let index=0;index<11;index++){
  const mast=index%3,before=[...game.world.sailsSet],target=!before[index],id=`crew-${mast}`;
  assert(crew.command({type:'sail',index,set:target,crewId:id}).ok);
  until(()=>game.world.sailsSet[index]===target,100);
  assert(crew.state[mast].distanceWalked>14,'Sail task requires actual travel');
  assert.deepEqual(game.world.sailsSet,before.map((value,i)=>i===index?target:value),'Only requested sail changes');
  until(()=>crew.state[mast].status==='rest',100);
  console.log(`PASS sail ${index+1}: ${sails[index].mesh.name}, continuous route and return`);
}
console.log('PASS sail: all eleven actual sails, one changed per command, descent and return');

assert(crew.command({type:'guard',mast:1,crewId:'crew-1'}).ok);until(()=>crew.state[1].status==='guard',100);
const guard=crew.state[1];tick(60);assert.equal(crew.state[1].status,'guard');assert(crew.state[1].position[1]>13.8);
assert.equal(crew.command({type:'guard',mast:1,crewId:'crew-2'}).crewId,'crew-1');
const local=crew.state[1].position;game.ship.x=15;game.ship.z=8;game.ship.heading=.7;game.ship.bob=.03;tick(1);
assert(Math.hypot(...crew.state[1].position.map((v,i)=>v-local[i]))<.03,'Ship transform must not move sailor twice');
assert(Math.abs(crew.state[1].yaw-guard.yaw-.7)<.002,'Guard facing follows ship rotation');
const [x,y,z]=crew.state[1].worldPosition;assert(Math.abs(x-(15+Math.cos(.7)*local[0]+Math.sin(.7)*local[2]))<.03);assert(Math.abs(z-(8-Math.sin(.7)*local[0]+Math.cos(.7)*local[2]))<.03);
assert(crew.command({type:'rest',crewId:'crew-1'}).ok);until(()=>crew.state[1].status==='rest',110);
console.log('PASS guard: persistent station, ship rotation, cancellation and continuous descent');
}
}

if(tailOnly){game.ship.x=15;game.ship.z=8;game.ship.heading=.7;game.ship.bob=.03;tick(1);}
if(!anchorOnly){

for(const mast of[0,2]){
  const id=`crew-${mast}`;assert(crew.command({type:'guard',mast,crewId:id}).ok);until(()=>crew.state[mast].status==='guard',100);
  assert(crew.state[mast].position[1]>(mast===0?12.6:10.3));assert(crew.command({type:'rest',crewId:id}).ok);until(()=>crew.state[mast].status==='rest',100);
  console.log(`PASS guard mast ${mast+1}: real ascent, persistent station and return`);
}

assert(crew.command({type:'sail',index:8,set:!game.world.sailsSet[8],crewId:'crew-2'}).ok);
until(()=>crew.state[2].status==='working');until(()=>crew.state[2].status==='rest');
assert(crew.command({type:'guard',mast:0,crewId:'crew-0'}).ok);until(()=>crew.state[0].climb?.id==='fore-shroud'&&crew.state[0].climb.progress>.3);
assert(crew.command({type:'rest',crewId:'crew-0'}).ok);until(()=>crew.state[0].status==='rest');
console.log('PASS bowsprit work and cancellation midway up a real rope ladder');

assert(crew.command({type:'anchor',raised:true,crewId:'crew-0'}).ok);
assert(crew.command({type:'guard',mast:0,crewId:'crew-1'}).ok);
const sailTarget=!game.world.sailsSet[3];assert(crew.command({type:'sail',index:3,set:sailTarget,crewId:'crew-2'}).ok);
until(()=>crew.state[0].status==='rest'&&crew.state[1].status==='guard'&&crew.state[2].status==='rest'&&game.world.sailsSet[3]===sailTarget,200);
assert(crew.command({type:'rest'}).ok);until(()=>crew.state.every(s=>s.status==='rest'),100);
console.log('PASS three simultaneous orders queue safely, work completes and all sailors return');
}

assert(maxStep<.10,`No task teleports; largest fixed step was ${maxStep}: ${JSON.stringify(maxStepDetail)}`);
const report={engine:'Rapier 0.21.0',sailors:crew.state.map(s=>({id:s.id,distanceWalked:Number(s.distanceWalked.toFixed(2))})),maxStep:Number(maxStep.toFixed(5)),events:events.length};
ship.position.set(game.ship.x,game.ship.bob||0,game.ship.z);ship.rotation.y=game.ship.heading;ship.updateMatrixWorld(true);crew.render(dt);
for(let i=0;i<3;i++){assert.deepEqual(crew.sailors[i].pirate.position.toArray(),crew.state[i].worldPosition);assert(Math.hypot(crew.state[i].position[0]-[-4.86,-3.04,-1.84][i],crew.state[i].position[2]-.35)<.11,'Rest points must not drift after repeated work');}
console.log(JSON.stringify(report,null,2));crew.dispose();assert(![...game.controller.model.ids.values()].some(id=>/^crew-/.test(id)),'Disposing crew removes captain collision proxies');game.controller.world.free();
