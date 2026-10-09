import RAPIER from './node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import { buildCollisionModel } from './collision-model.js';
import { CLIMB_PATHS,sampleClimbPath } from './climb-paths.js';
import { hullHalfWidthAt } from './ship-layout.js';

export const CHARACTER={height:1.62,crouchHeight:1.12,radius:.27,offset:.012,step:.22,gravity:14};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const qIdentity={x:0,y:0,z:0,w:1};
const shipMode=g=>['deck','cabin','helm'].includes(g.mode);
function worldPoint(g,p,space='ship'){
  if(space==='world')return{x:p[0],y:p[1],z:p[2]};
  const c=Math.cos(g.ship.heading),s=Math.sin(g.ship.heading);return{x:g.ship.x+c*p[0]+s*p[2],y:p[1]+(g.ship.bob||0),z:g.ship.z-s*p[0]+c*p[2]};
}
function localPoint(g,p){const c=Math.cos(g.ship.heading),s=Math.sin(g.ship.heading),x=p.x-g.ship.x,z=p.z-g.ship.z;return{x:c*x-s*z,y:p.y-(g.ship.bob||0),z:s*x+c*z};}
function notify(g,t){g.notice=t;g.noticeTime=3;}
function playerPoint(g){if(g.mode==='boat')return{x:g.boat.x,y:-.15,z:g.boat.z};return worldPoint(g,[g.player.x,g.player.y,g.player.z],shipMode(g)?'ship':'world');}
function setPoint(g,pos,space){Object.assign(g.player,space==='ship'?localPoint(g,pos):pos);}

export async function createPlayerController(layout={}){
  await RAPIER.init();
  layout.climbPaths=CLIMB_PATHS;
  const world=new RAPIER.World({x:0,y:-14,z:0});world.timestep=1/60;
  const shipBody=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const model=buildCollisionModel(RAPIER,world,shipBody,layout);
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,4,0));
  const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(CHARACTER.height/2-CHARACTER.radius,CHARACTER.radius).setFriction(0).setTranslation(0,4,0));
  let game=null,height=CHARACTER.height,grounded=false;
  const structure=c=>c.handle!==capsule.handle&&c.isEnabled();
  function supportBelowFeet(c,foot,g){
    const id=model.ids.get(c.handle),localY=foot.y-(g.ship.bob||0);
    if(id==='quarter-deck'||id?.startsWith('quarter-step'))return localY>=4.53;
    if(id==='fore-deck'||id?.startsWith('fore-step-landing'))return localY>=3.08;
    if(id==='main-deck')return localY>=2.38;
    if(id==='lower-floor')return localY>=.13;
    if(id==='hold-floor')return localY>=-1.87;
    if(id==='pier-stem'||id==='pier-head')return foot.y>=2.46;
    if(id==='gangplank')return foot.y>=2.43;
    return false;
  }
  function animateMechanisms(g,dt){
    if(g.mechanismsExternal)dt=0;
    const w=g.world;w.cabinDoorAngle??=0;w.hatchAngle??=0;w.cargoOffset??=0;w.cellDoorAngles??=[0,0,0,0];
    const advance=(current,target,speed)=>current+clamp(target-current,-dt*speed,dt*speed);
    const apply=(collider,center,size,angle,axis,id,closing)=>{
      const wp=worldPoint(g,center),h=g.ship.heading,a=angle/2,ch=Math.cos(h/2),sh=Math.sin(h/2),ca=Math.cos(a),sa=Math.sin(a);
      const q=axis==='x'?{x:ch*sa,y:sh*ca,z:-sh*sa,w:ch*ca}:{x:0,y:Math.sin((h+angle)/2),z:0,w:Math.cos((h+angle)/2)};
      if(closing){
        const shape=new RAPIER.Cuboid(...size.map(v=>v/2));
        const blocked=capsule.intersectsShape(shape,wp,q)||[...model.ids].some(([handle,name])=>/^crew-/.test(name)&&world.getCollider(handle)?.isEnabled()&&world.getCollider(handle).intersectsShape(shape,wp,q));
        if(blocked){w.mechanismBlocked=id;return false;}
      }
      collider.setEnabled(true);collider.setTranslationWrtParent({x:center[0],y:center[1],z:center[2]});collider.setRotationWrtParent(axis==='x'?{x:sa,y:0,z:0,w:ca}:{x:0,y:sa,z:0,w:ca});return true;
    };
    if(dt>0||w.mechanismBlocked===undefined)w.mechanismBlocked=null;
    const doorAngle=advance(w.cabinDoorAngle,w.cabinDoorOpen?-1.35:0,3);
    if(apply(model.dynamic.cabinDoor,[-7.99+Math.sin(doorAngle)*.375,3.25,-.375+Math.cos(doorAngle)*.375],[.075,1.7,.75],doorAngle,'y','船长室门',!w.cabinDoorOpen&&doorAngle!==w.cabinDoorAngle))w.cabinDoorAngle=doorAngle;
    const hatchAngle=advance(w.hatchAngle,w.hatchOpen?-1.42:0,2.5);
    if(apply(model.dynamic.hatch,[-4,2.65-Math.sin(hatchAngle)*.525,-.28+Math.cos(hatchAngle)*.525],[.8,.08,1.05],hatchAngle,'x','舱口盖',!w.hatchOpen&&hatchAngle!==w.hatchAngle))w.hatchAngle=hatchAngle;
    const offset=advance(w.cargoOffset,w.cargoOpen?1.9:0,2.8);
    if(apply(model.dynamic.cargo,[3,2.66+offset/1.9*.34,offset],[2,.08,1.6],0,'y','货舱格栅',!w.cargoOpen&&offset!==w.cargoOffset))w.cargoOffset=offset;
    for(let i=0;i<4;i++){
      const physicalSide=i%2===0?-1:1,x=i<2?-8.3:-6.3,angle=advance(w.cellDoorAngles[i],g.cellsOpen[i]?-physicalSide*1.42:0,2.8);
      if(apply(model.dynamic[`cell-${i}`],[x-.335+Math.cos(angle)*.335,1.01,physicalSide*.55-Math.sin(angle)*.335],[.67,1.72,.09],angle,'y',`牢门 ${i+1}`,!g.cellsOpen[i]&&angle!==w.cellDoorAngles[i]))w.cellDoorAngles[i]=angle;
    }
  }
  function sync(g,dt=0){
    game=g;const h=g.ship.heading;shipBody.setTranslation({x:g.ship.x,y:g.ship.bob||0,z:g.ship.z},true);shipBody.setRotation({x:0,y:Math.sin(h/2),z:0,w:Math.cos(h/2)},true);
    const current=playerPoint(g);capsule.setTranslation({x:current.x,y:current.y+height/2,z:current.z});animateMechanisms(g,dt);
    const docked=Math.hypot(g.ship.x,g.ship.z)<.85&&Math.abs(Math.sin(h))<.08&&Math.cos(h)>.98;model.dynamic.gangplank.setEnabled(docked);
    world.step();const pos=playerPoint(g);capsule.setTranslation({x:pos.x,y:pos.y+height/2,z:pos.z});body.setTranslation({x:pos.x,y:pos.y+height/2,z:pos.z},true);
  }
  function resize(next){if(next!==height){height=next;capsule.setHalfHeight(height/2-CHARACTER.radius);}}
  function castMove(from,delta,predicate=structure){
    const pos={x:from.x,y:from.y+height/2,z:from.z},rest={...delta},total={x:0,y:0,z:0};
    for(let i=0;i<4;i++){
      if(Math.hypot(rest.x,rest.y,rest.z)<.00001)break;
      const hit=world.castShape(pos,qIdentity,rest,capsule.shape,CHARACTER.offset,1,false,undefined,undefined,capsule,body,predicate);
      const t=hit?Math.max(0,hit.time_of_impact-.0001):1;
      for(const key of['x','y','z']){const step=rest[key]*t;pos[key]+=step;total[key]+=step;rest[key]*=1-t;}
      if(!hit)break;
      const n=hit.normal1,dot=rest.x*n.x+rest.y*n.y+rest.z*n.z;
      if(dot<0)for(const key of['x','y','z'])rest[key]-=n[key]*dot;else break;
    }
    return total;
  }
  function canOccupy(position,space='ship',testHeight=CHARACTER.height,g=game){
    const p=Array.isArray(position)?position:[position.x,position.y,position.z],pos=worldPoint(g,p,space);
    // Lift 2 cm so touching the supporting deck doesn't count as penetration.
    let blocked=false;const shape=new RAPIER.Capsule(testHeight/2-CHARACTER.radius-.01,CHARACTER.radius-.01);
    world.intersectionsWithShape({x:pos.x,y:pos.y+testHeight/2+.025,z:pos.z},qIdentity,shape,c=>{blocked=true;return false;},undefined,undefined,capsule,body,structure);
    return !blocked;
  }
  function sweep(g,target,space){
    const from=playerPoint(g),to=worldPoint(g,target,space);world.step();capsule.setTranslation({x:from.x,y:from.y+height/2,z:from.z});body.setTranslation({x:from.x,y:from.y+height/2,z:from.z},true);
    const support=to.y>=from.y-.001?world.castRayAndGetNormal(new RAPIER.Ray({x:from.x,y:from.y+.10,z:from.z},{x:0,y:-1,z:0}),.14,true,undefined,undefined,capsule,body,structure):null;
    const supportHandle=support&&support.normal.y>.64&&support.timeOfImpact>=.085?support.collider.handle:null;
    const m=castMove(from,{x:to.x-from.x,y:to.y-from.y,z:to.z-from.z},c=>structure(c)&&c.handle!==supportHandle&&!(supportHandle!==null&&supportBelowFeet(c,from,g)));
    const result={x:from.x+m.x,y:from.y+m.y,z:from.z+m.z};setPoint(g,result,space);capsule.setTranslation({x:result.x,y:result.y+height/2,z:result.z});body.setTranslation({x:result.x,y:result.y+height/2,z:result.z},true);
    return Math.hypot(to.x-result.x,to.y-result.y,to.z-result.z)<.04;
  }
  function raycast(origin,direction,maxDistance=3){
    const hit=world.castRay(new RAPIER.Ray(origin,direction),maxDistance,true,undefined,undefined,capsule,body,structure);return hit?{distance:hit.timeOfImpact,id:model.ids.get(hit.collider.handle),collider:hit.collider}:null;
  }
  function move(g,input,dt){
    sync(g);const p=g.player;pCooldown(g,dt);
    if(g.transfer){stepTransfer(g,dt);return;}
    if(g.climb){stepClimb(g,input,dt);return;}
    if(!input.crouch&&p.crouched&&!canOccupy([p.x,p.y,p.z],shipMode(g)?'ship':'world'))p.crouched=true;
    else p.crouched=!!input.crouch;
    resize(p.crouched?CHARACTER.crouchHeight:CHARACTER.height);sync(g);
    const speed=g.mode==='swim'?2.3:p.crouched?1.2:input.run?4.3:2.65;
    const dx=(input.moveX||0)*speed*dt,dz=(input.moveZ||0)*speed*dt;
    if(!input.lookYaw&&Math.abs(dx)+Math.abs(dz)>0)p.yaw=Math.atan2(dx,dz);
    if(g.mode==='swim'){
      p.vy=clamp((p.vy||0)+(input.ascend?5:input.descend?-4:-2)*dt,-1.3,1.8);
    }else if(input.jump&&(p.grounded||grounded)){p.vy=5.1;grounded=false;}
    else p.vy=(p.vy||0)-CHARACTER.gravity*dt;
    const from=playerPoint(g);const desired={x:dx,y:p.vy*dt,z:dz};
    const floorRay=(x,y,z,distance=.48)=>world.castRayAndGetNormal(new RAPIER.Ray({x,y:y+.24,z},{x:0,y:-1,z:0}),distance,true,undefined,undefined,capsule,body,c=>structure(c));
    const moveLength=Math.hypot(dx,dz),probe=moveLength?CHARACTER.radius/moveLength:0;
    const floorAhead=grounded&&p.vy<=0?floorRay(from.x+dx*(1+probe),from.y+.30,from.z+dz*(1+probe),.80):null;
    const floorY=floorAhead?from.y+.54-floorAhead.timeOfImpact:null;
    const floorNext=floorAhead?floorRay(from.x+dx,from.y+.30,from.z+dz,.80):null,nextFloorY=floorNext?from.y+.54-floorNext.timeOfImpact:null;
    const onStairExit=shipMode(g)&&g.player.x<-7.4&&g.player.x>-8.6&&Math.abs(Math.abs(g.player.z)-1.4)<.44;
    const maxStep=floorAhead&&(/^(quarter|fore)-step/.test(model.ids.get(floorAhead.collider.handle))||onStairExit)?.40:CHARACTER.step;
    const stepAllowed=floorAhead&&floorAhead.normal.y>.64&&floorY-from.y<=maxStep&&floorY-from.y>=-.18&&floorNext?.normal.y>.64&&nextFloorY-from.y<=CHARACTER.step&&nextFloorY-from.y>=-.18;
    if(stepAllowed)desired.y=0;
    // Crouching at an exposed edge holds the last supported position.
    if(p.crouched&&grounded){const hit=world.castRay(new RAPIER.Ray({x:from.x+dx,y:from.y+.12,z:from.z+dz},{x:0,y:-1,z:0}),.40,true,undefined,undefined,capsule,body,structure);if(!hit){desired.x=0;desired.z=0;}}
    // The supporting surface is handled by its normal/ray, preventing repeated zero-TOI
    // seams on a curved deck; all walls, furniture and headroom remain capsule sweeps.
    const supportHandle=stepAllowed?floorAhead.collider.handle:null,supportNextHandle=stepAllowed?floorNext.collider.handle:null;
    // The radius-ahead probe checks clearance. Only the actual next foot location
    // determines height, so a smooth slope cannot raise the root by a whole radius.
    const lift=stepAllowed?Math.max(0,nextFloorY+CHARACTER.offset-from.y):0,castFrom={...from,y:from.y+lift};
    const m=castMove(castFrom,desired,c=>structure(c)&&c.handle!==supportHandle&&c.handle!==supportNextHandle&&!(stepAllowed&&supportBelowFeet(c,castFrom,g)));grounded=false;p.grounded=false;
    if(p.vy>0&&m.y<desired.y-.001)p.vy=0;
    const next={x:from.x+m.x,y:castFrom.y+m.y,z:from.z+m.z};
    if(p.vy<=0){const support=floorRay(next.x,next.y,next.z);if(support&&support.normal.y>.64){const y=next.y+.24-support.timeOfImpact;if(y-next.y<=.22&&next.y-y<=.18){next.y=y+CHARACTER.offset;grounded=p.grounded=true;p.vy=0;}}}
    if(g.mode==='swim'&&next.y<-.73){next.y=-.73;p.vy=0;}
    setPoint(g,next,shipMode(g)?'ship':'world');
    // Room labels are consequences of position, never motion constraints.
    if(shipMode(g)){
      if(p.y<-.6){g.mode='cabin';g.world.room='hold';}
      else if(p.y<1.25){g.mode='cabin';g.world.room='lower';}
      else if(p.y<3.6&&p.x<-8.05){g.mode='cabin';g.world.room='captain';g.voyage.cabin=true;}
      else g.mode='deck';
      const outside=p.x<-16.4||p.x>16.5||Math.abs(p.z)>hullHalfWidthAt(clamp(p.x,-16,16),2.4)+.6;
      if(outside&&!grounded){g.mode=next.y<-.2?'swim':'land';Object.assign(p,next);}
      const docked=model.dynamic.gangplank.isEnabled();if(docked&&p.z<-4.6&&grounded){g.mode='land';Object.assign(p,next);}
    }else{
      const local=localPoint(g,next),nearShip=local.x>-16&&local.x<16&&Math.abs(local.z)<hullHalfWidthAt(local.x,2.4)-.12&&local.y>1.7;
      if(grounded&&nearShip){g.mode='deck';Object.assign(p,local);}
      else if(grounded){g.mode='land';}
      else if(next.y<-.2){g.mode='swim';}
    }
    capsule.setTranslation({x:next.x,y:next.y+height/2,z:next.z});body.setTranslation({x:next.x,y:next.y+height/2,z:next.z},true);
    p.motion={x:(next.x-from.x)/dt,y:(next.y-from.y)/dt,z:(next.z-from.z)/dt};
  }
  function reset(g){resize(CHARACTER.height);grounded=false;g.player.grounded=false;g.player.crouched=false;sync(g);}
  function startTransfer(g,route,mode,speed=1.7){
    const from=playerPoint(g);resize(CHARACTER.height);g.player.crouched=false;g.player.vy=0;g.player.grounded=false;
    g.transfer={route:[[from.x,from.y,from.z],...route],mode,elapsed:0,speed};g.mode='land';Object.assign(g.player,from);return true;
  }
  function stepTransfer(g,dt){
    const t=g.transfer,p=g.player,from=playerPoint(g);t.elapsed+=dt;
    const progress=clamp(t.elapsed*t.speed/routeLength(t.route),0,1),target=routePoint(t.route,progress);
    if(!sweep(g,target,'world')){g.transfer=null;p.vy=0;notify(g,'前方被挡住了，先调整站位再试。');return;}
    p.motion={x:(p.x-from.x)/dt,y:(p.y-from.y)/dt,z:(p.z-from.z)/dt};
    if(progress===1){g.transfer=null;g.mode=t.mode;p.vy=0;p.grounded=t.mode==='boat';if(t.mode==='boat'){g.boat.speed=0;p.yaw=g.boat.heading+Math.PI/2;}}
  }
  function boardBoat(g){
    if(!g.boat.deployed||g.transfer||g.climb)return false;
    const from=playerPoint(g),b=g.boat;
    if(g.mode==='swim'){
      if(Math.hypot(from.x-b.x,from.z-b.z)>2.4)return false;
      return startTransfer(g,[[from.x,.55,from.z],[b.x,.55,b.z],[b.x,-.15,b.z]],'boat',1.25);
    }
    if(g.mode!=='deck'||Math.hypot(g.player.x+11,g.player.z+2.65)>2.3)return false;
    const x=g.player.x,z=g.player.z,over=worldPoint(g,[x,5.65,z]),outer=worldPoint(g,[x,5.65,-4.6]);
    notify(g,'扶住吊索，沿船侧慢慢下到救生艇。');
    return startTransfer(g,[[over.x,over.y,over.z],[outer.x,outer.y,outer.z],[b.x,.55,b.z],[b.x,-.15,b.z]],'boat',1.65);
  }
  function dive(g){
    if(g.transfer||g.climb)return false;
    if(g.mode==='boat'){
      const b=g.boat,side={x:Math.sin(b.heading),z:Math.cos(b.heading)},outward=(b.x-g.ship.x)*side.x+(b.z-g.ship.z)*side.z>=0?1:-1;side.x*=outward;side.z*=outward;b.speed=0;
      notify(g,'翻过艇沿下水，靠近木梯或艇沿可重新攀上。');
      return startTransfer(g,[[b.x+side.x*.8,.40,b.z+side.z*.8],[b.x+side.x*1.4,-.25,b.z+side.z*1.4]],'swim',1.8);
    }
    if(g.mode!=='deck')return false;
    const p=g.player,side=p.z<0?-1:1,width=hullHalfWidthAt(p.x,2.4);
    if(Math.abs(p.z)<width-1.05){notify(g,'先走到船沿，再翻越栏杆下海。');return false;}
    const over=worldPoint(g,[p.x,p.y+1.12,p.z]),outer=worldPoint(g,[p.x,p.y+1.12,side*(width+.75)]);
    notify(g,'翻过船沿。WASD 游泳，靠近船侧梯、救生艇或码头可攀上。');
    return startTransfer(g,[[over.x,over.y,over.z],[outer.x,outer.y,outer.z]],'land',2.4);
  }
  const controller={move,sync,reset,canOccupy,raycast,sweep,world,body,capsule,model,stats:{engine:'Rapier 0.21.0',solver:'capsule sweep and slide',colliders:model.colliderCount+1,bodies:3,fixedDt:1/60,radius:.27,ccdBodies:0},startClimb,exitClimb,detachClimb,boardBoat,dive};
  return controller;
}

export function startClimb(g,ladder,atTop=false){
  const path=g.layout?.climbPaths?.find(p=>p.id===ladder.id)||CLIMB_PATHS.find(p=>p.id===ladder.id)||ladder;
  if(!path?.points||g.climb||g.player.climbCooldown>0)return false;
  if(path.needsHatch&&!g.world.hatchOpen||path.needsCargo&&!g.world.cargoOpen)return false;
  const current=playerPoint(g),target=worldPoint(g,atTop?path.upperExit:path.lowerExit,path.space);
  // A visible approach is swept against structure; never teleport through a rail.
  if(Math.hypot(current.x-target.x,current.y-target.y,current.z-target.z)>1.7){notify(g,'再靠近梯口，才能伸手抓稳。');return false;}
  const from=path.space==='ship'?localPoint(g,current):current;
  if(path.space==='ship')g.mode=atTop?path.upperMode:path.lowerMode==='swim'?'deck':path.lowerMode;
  const fromPoint=[from.x,from.y,from.z],approach=(atTop?path.upperApproach:path.lowerApproach)||[];
  g.climb={ladder:path,path,t:path.kind==='down'?(atTop?0:1):(atTop?1:0),progress:atTop?1:0,phase:'attach',elapsed:0,from:fromPoint,route:[fromPoint,...[...approach].reverse(),sampleClimbPath(path,atTop?1:0)],contacts:null,gait:0,direction:0};
  Object.assign(g.player,from,{vy:0,grounded:false,crouched:false});g.player.yaw=Math.atan2(path.face[0],path.face[2])+(path.space==='ship'?g.ship.heading:0);
  updateContacts(g);notify(g,'抓稳了。W 上爬 · S 下爬 · 空格松开。');return true;
}

export function updateClimbContacts(g){
  const c=g.climb;if(!c)return;const path=c.path||c.ladder,p=g.player,face=path.face,right=[face[2],0,-face[0]];
  const delta=Math.max(0,c.gait-(c.lastContactGait||0));c.lastContactGait=c.gait;c.contactStates??={};c.contactPhases={};
  const contacts={space:path.space},pair=Math.floor(c.gait/.10)%2,options={};
  for(const name of['leftHand','rightHand','leftFoot','rightFoot']){
    const hand=name.endsWith('Hand'),side=name.startsWith('left')?1:-1,lateral=hand?.2373:.1103;
    const joint=[p.x+right[0]*side*lateral,p.y+(hand?1.17895:.64461),p.z+right[2]*side*lateral],endOffset=hand?.03817:.07634,reach=hand?.55131:.56827;
    const distance=point=>Math.hypot(point[0]-joint[0],point[1]+endOffset-joint[1],point[2]-joint[2]);
    const candidates=[];
    for(const r of(hand?[...path.rungs,...(path.handrails||[])]:path.rungs)){
      const dx=r.b[0]-r.a[0],dz=r.b[2]-r.a[2],len=dx*dx+dz*dz;
      const t=clamp(len?((joint[0]+face[0]*.23-r.a[0])*dx+(joint[2]+face[2]*.23-r.a[2])*dz)/len:.5,.035,.965);
      const rope=path.mast!==undefined,rod=path.id==='dock'?.10:path.id==='board'?.045:path.id==='hatch'?.036:path.id==='cargo'?.035:rope?.008:.02;
      const sag=rope&&!path.handrails?.includes(r)&&r.center[1]<path.points.at(-1)[1]-2?-.025*(1-Math.abs(t*2-1)):0;
      const point=[r.a[0]+dx*t-(hand?face[0]*.02:0),r.a[1]+(r.b[1]-r.a[1])*t+sag+(hand?0:rod),r.a[2]+dz*t-(hand?face[2]*.02:0)];
      const extension=distance(point);
      if(extension<=reach-.012)candidates.push({point,score:Math.abs(point[1]-(p.y+(hand?1.30:.39)))+Math.hypot(point[0]-joint[0],point[2]-joint[2])*.2+Math.max(0,extension-(reach-.07))*4});
    }
    if(!hand&&c.phase==='exit'){for(const endpoint of[path.upperExit,path.lowerExit]){const point=[p.x+right[0]*side*lateral,endpoint[1],p.z+right[2]*side*lateral];if(Math.abs(p.y-endpoint[1])<.1&&distance(point)<=reach+.001)candidates.push({point,score:.05});}}
    candidates.sort((a,b)=>a.score-b.score);options[name]={desired:candidates[0]?.point,distance,reach,hand};
  }
  for(const name of['leftHand','rightHand','leftFoot','rightFoot']){
    const {desired,distance,reach,hand}=options[name],state=c.contactStates[name];
    if(!desired){c.contactPhases[name]='swing';continue;}
    if(!state){c.contactStates[name]={point:[...desired],target:[...desired],phase:'support',lastMove:c.gait};contacts[name]=[...desired];c.contactPhases[name]='support';continue;}
    const active=pair===0?name==='leftHand'||name==='rightFoot':name==='rightHand'||name==='leftFoot';
    const change=Math.hypot(...desired.map((v,i)=>v-state.point[i]));
    const otherName=hand?(name==='leftHand'?'rightHand':'leftHand'):(name==='leftFoot'?'rightFoot':'leftFoot'),other=c.contactStates[otherName];
    if(state.phase==='support'&&(distance(state.point)>reach-.020||(active&&c.gait-state.lastMove>.065&&change>.08))){
      if(other?.phase!=='swing'){state.from=[...state.point];state.target=[...desired];state.phase='swing';state.swingDistance=0;state.lastMove=c.gait;}
      else if(distance(state.point)>reach-.012&&options[otherName].desired){
        // Land the already moving limb on a reachable rung before releasing this one.
        other.point=[...options[otherName].desired];other.target=[...other.point];other.phase='support';other.lastMove=c.gait;
        state.from=[...state.point];state.target=[...desired];state.phase='swing';state.swingDistance=0;state.lastMove=c.gait;
      }
    }
    if(state.phase==='swing'){
      state.swingDistance+=delta;const t=clamp(state.swingDistance/.065,0,1),ease=t*t*(3-2*t),point=state.from.map((v,i)=>v+(state.target[i]-v)*ease);point[1]+=Math.sin(t*Math.PI)*(hand?.035:.06);
      if(distance(point)>reach){state.point=[...desired];state.swingDistance=.065;}else state.point=point;
      // Root movement may make last frame's landing target unreachable.
      if(t===1||state.swingDistance>=.065){state.point=[...desired];state.target=[...desired];state.phase='support';}
    }
  }
  for(const name of['leftHand','rightHand','leftFoot','rightFoot'])if(options[name].desired){const state=c.contactStates[name];contacts[name]=[...state.point];contacts[`${name}Anchored`]=state.phase==='support';c.contactPhases[name]=state.phase;}
  c.contacts=contacts;
}
const updateContacts=updateClimbContacts;

function stepClimb(g,input,dt){
  const c=g.climb,path=c.path||c.ladder;pCooldown(g,dt);
  if(input.jump){detachClimb(g);return;}
  g.player.yaw=Math.atan2(path.face[0],path.face[2])+(path.space==='ship'?g.ship.heading:0);
  if(c.phase==='attach'){
    c.elapsed+=dt;const t=clamp(c.elapsed/Math.max(.45,routeLength(c.route)/2.1),0,1),pos=routePoint(c.route,t);
    const reached=g.controller.sweep(g,pos,path.space);if(!reached){detachClimb(g);notify(g,'梯口被结构挡住，先绕开障碍。');return;}
    if(t===1)c.phase='climb';updateContacts(g);return;
  }
  if(c.phase==='exit'){
    c.elapsed+=dt;const t=clamp(c.elapsed/Math.max(.55,routeLength(c.route)/1.65),0,1),pos=routePoint(c.route,t);
    if(!g.controller.sweep(g,pos,path.space)){c.phase='climb';notify(g,'出口受阻，保持抓稳，可按 S 返回。');return;}
    updateContacts(g);if(t===1){const mode=c.endpoint==='upper'?path.upperMode:path.lowerMode;const posWorld=worldPoint(g,[g.player.x,g.player.y,g.player.z],path.space);g.climb=null;g.mode=mode;if(mode==='swim'||mode==='land')Object.assign(g.player,posWorld);if(mode==='cabin')g.world.room=path.room;g.player.vy=0;g.player.climbCooldown=.3;g.player.grounded=mode!=='swim';if(mode==='cabin')g.voyage.cabin=true;}
    return;
  }
  const dir=(input.forward||0)-(input.back||0),speed=path.mast!==undefined?.75:1.25;
  if(dir){
    const next=clamp(c.progress+dir*speed*dt/path.length,0,1),target=sampleClimbPath(path,next);
    if(g.controller.sweep(g,target,path.space)){c.gait+=Math.abs(next-c.progress)*path.length;c.progress=next;c.t=path.kind==='down'?1-next:next;c.direction=dir;}
    else{notify(g,'上方结构挡住了去路，换方向退回。');}
  }
  updateContacts(g);
  if(dir>0&&c.progress>=.999||dir<0&&c.progress<=.001)exitClimb(g);
}

export function exitClimb(g){
  const c=g.climb;if(!c)return false;const path=c.path||c.ladder;
  if(c.progress>.04&&c.progress<.96)return false;
  const upper=c.progress>.5,to=upper?path.upperExit:path.lowerExit;
  if(!g.controller.canOccupy(to,path.space)){notify(g,'梯口没有站立空间，继续抓稳再返回。');return false;}
  c.phase='exit';c.elapsed=0;c.from=[g.player.x,g.player.y,g.player.z];c.to=[...to];c.route=[c.from,...((upper?path.upperApproach:path.lowerApproach)||[]),c.to];c.endpoint=upper?'upper':'lower';return true;
}

export function detachClimb(g){
  const c=g.climb;if(!c)return false;const path=c.path||c.ladder,world=worldPoint(g,[g.player.x,g.player.y,g.player.z],path.space);
  g.climb=null;g.player.climbCooldown=.3;g.player.vy=1.1;g.player.grounded=false;
  if(path.space==='world'){g.mode=world.y>0?'land':'swim';Object.assign(g.player,world);}
  else{g.mode=g.player.y<1.4?'swim':'deck';if(g.mode==='swim')Object.assign(g.player,world);}
  return true;
}
function pCooldown(g,dt){g.player.climbCooldown=Math.max(0,(g.player.climbCooldown||0)-dt);}
function routeLength(points){return points.slice(1).reduce((sum,b,i)=>sum+Math.hypot(...b.map((v,j)=>v-points[i][j])),0);}
function routePoint(points,t){return sampleClimbPath({points,length:routeLength(points)},t);}
