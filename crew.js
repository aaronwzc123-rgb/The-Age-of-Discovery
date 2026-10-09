import * as THREE from 'three';
import RAPIER from './node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import { createGame, heaveAnchor } from './game.js';
import { createPlayerController, CHARACTER } from './player-controller.js';
import { CLIMB_PATHS } from './climb-paths.js';
import { buildPirate } from './world.js';
import { updatePirateBody, canReachHand } from './player-body.js';
import { mainDeckHeight } from './ship-layout.js';

const REST = [[-4.86,.15,.35],[-3.04,.15,.35],[-1.84,.15,.35]];
const NAMES = ['林恩','阿洛','米娅'], COLORS = ['#466a76','#766244','#607357'];
const STATUS = {rest:'舱内休息',walking:'前往工作位',climbing:'攀爬',working:'执行船务',guard:'瞭望站岗',returning:'返回水手舱',blocked:'等待通道畅通'};
const point = p => [p.x,p.y,p.z];
const pathById = id => CLIMB_PATHS.find(p=>p.id===id);
const walk = (p,tolerance=.10) => ({kind:'walk',point:[...p],tolerance});
const climb = (id,up) => ({kind:'climb',id,up});
const facility = task => task.type==='sail'?`sail-${task.index}`:task.type==='guard'?`mast-${task.mast}`:'anchor';
const taskLabel = t => !t?'休息':t.type==='anchor'?(t.raised?'收起船锚':'放下船锚'):t.type==='sail'?`${t.set?'展开':'收起'}第 ${t.index+1} 面帆`:`第 ${t.mast+1} 桅盘站岗`;
function worldPosition(g,p){const c=Math.cos(g.ship.heading),s=Math.sin(g.ship.heading);return [g.ship.x+c*p[0]+s*p[2],p[1]+(g.ship.bob||0),g.ship.z-s*p[0]+c*p[2]];}
function sailMast(index,sails){
  const sail=sails[index],name=sail?.mesh?.name||'';
  if(name==='mizzen-lateen')return 2;
  if(name==='bowsprit-spritsail'||sail?.kind==='triangle')return null;
  if(sail)return sail.pinX===-10?2:sail.pinX===-1?1:0;
  return index<3?0:index<6?1:index<8?2:null;
}

// ponytail: one ship uses authored corridors; add navigation meshes only when crew can work on other ships/islands.
function taskRoute(task,start,sails){
  const route=[walk([start[0],.15,-.35]),walk(pathById('hatch').lowerExit),climb('hatch',true),walk([-3.25,2.4,1.20])];
  if(task.type==='anchor')return [...route,walk([6.2,mainDeckHeight(6.2,1.2),1.2]),walk([7.95,mainDeckHeight(7.95,1.2),1.20],.015),walk([7.95,mainDeckHeight(7.95,-.68),-.68],.015),walk([8.42,mainDeckHeight(8.42,-.68),-.68],.015)];
  const mast=task.type==='guard'?task.mast:sailMast(task.index,sails);
  if(mast!==null){
    const path=CLIMB_PATHS.find(p=>p.mast===mast);
    if(mast===2)route.push(walk([-5.45,2.4,1.4]),walk([-8.65,4.55,1.4]),walk([path.lowerExit[0],4.55,1.4]));
    else route.push(walk([path.lowerExit[0],2.4,1.20]));
    route.push(walk(path.lowerExit),climb(path.id,true));
  }else if(task.index===8)route.push(walk([7.95,2.4,1.65]),walk([10.6,2.4,1.65]),walk([10.6,2.4,.75]),walk([12.38,3.1,.75]),walk([13.08,3.1,.47]));
  else route.push(walk([7.96,mainDeckHeight(7.96,1.13),1.13]));
  return route;
}

export async function createCrewSystem({scene=null,ship=null,layout={},game,sails=[],capstanBars=[],onChange=()=>{},visuals=true}){
  let currentGame=game, elapsed=0, disposed=false, captainController=null, captainActors=[],travelling=null;
  const sailors=[],ladderReservations=new Map();
  for(let i=0;i<3;i++){
    const controller=await createPlayerController(layout), view=createGame();
    view.layout=layout;view.controller=controller;view.mechanismsExternal=true;
    const pirate=visuals?buildPirate().pirate:null;
    if(pirate){
      pirate.name=`crew-${i}`;scene?.add(pirate);
      pirate.rig.materials.coat.color.set(COLORS[i]);
    }
    const actors=Array.from({length:3},()=>controller.world.createCollider(RAPIER.ColliderDesc.capsule(CHARACTER.height/2-CHARACTER.radius,CHARACTER.radius).setTranslation(0,-100,0)));
    sailors.push({id:`crew-${i}`,name:NAMES[i],controller,view,pirate,actors,status:'rest',task:null,route:[],history:[],returning:false,gait:0,speed:0,distanceWalked:0,workTime:0,stallTime:0,blockedReason:'',workingAnchor:false});
  }
  function emit(s,message){onChange({crewId:s.id,status:s.status,task:s.task?{...s.task}:null,message});}
  function clearCaptainActors(){
    if(!captainController)return;
    for(const collider of captainActors){captainController.model.ids.delete(collider.handle);captainController.world.removeCollider(collider,true);}
    captainController.stats.colliders-=captainActors.length;captainActors=[];captainController=null;
  }
  function setGame(g){
    currentGame=g;g.crewAnchorHeld=false;ladderReservations.clear();travelling=null;
    if(captainController!==g.controller){
      clearCaptainActors();captainController=g.controller||null;
      if(captainController)captainActors=sailors.map(s=>{const collider=captainController.world.createCollider(RAPIER.ColliderDesc.capsule(CHARACTER.height/2-CHARACTER.radius,CHARACTER.radius).setTranslation(0,-100,0));captainController.model.ids.set(collider.handle,s.id);return collider;});
      if(captainController)captainController.stats.colliders+=captainActors.length;
    }
    for(let i=0;i<sailors.length;i++){
      const s=sailors[i],v=s.view;
      v.ship=g.ship;v.boat=g.boat;v.cellsOpen=g.cellsOpen;v.world={...g.world,cellDoorAngles:g.world.cellDoorAngles?.slice(),sailsSet:g.world.sailsSet.slice(),room:'lower'};v.voyage={...g.voyage};v.mode='cabin';v.climb=null;
      Object.assign(v.player,{x:REST[i][0],y:REST[i][1],z:REST[i][2],vy:0,yaw:g.ship.heading});
      Object.assign(s,{status:'rest',task:null,route:[],history:[],returning:false,gait:0,speed:0,distanceWalked:0,workTime:0,stallTime:0,blockedReason:'',workingAnchor:false,lastHeading:g.ship.heading});
      if(s.pirate?.rig)delete s.pirate.rig.state;s.controller.reset(v);
    }
    syncCaptainActors();
  }
  function syncCaptainActors(){for(let i=0;i<captainActors.length;i++){const p=worldPosition(currentGame,point(sailors[i].view.player));captainActors[i].setTranslation({x:p[0],y:p[1]+CHARACTER.height/2,z:p[2]});captainActors[i].setEnabled(true);}}
  setGame(game);
  function recall(s){
    if(s.task?.type==='anchor'&&s.workingAnchor)currentGame.ship.anchorTarget=currentGame.ship.anchorLift;
    s.task=null;s.workingAnchor=false;s.workTime=0;s.returning=true;s.blockedReason='';s.stallTime=0;
    currentGame.crewAnchorHeld=anchorHeld();
    for(const[id,owner]of ladderReservations)if(owner===s.id&&s.view.climb?.path.id!==id)ladderReservations.delete(id);
    s.route=s.history.slice().reverse().map(step=>({...step,point:step.point?[...step.point]:undefined,started:false}));s.history=[];
    s.route.push(walk(REST[sailors.indexOf(s)]));
    s.status='returning';emit(s,`${s.name}：收到，回舱休息。`);
  }
  function command(spec){
    if(disposed||!spec||!['anchor','sail','guard','rest'].includes(spec.type))return {ok:false,message:'无法识别这条船务命令。'};
    const requested=spec.crewId?sailors.find(s=>s.id===spec.crewId):null;
    if(spec.crewId&&!requested)return {ok:false,message:'这名水手不在船上。'};
    if(spec.type==='rest'){
      const targets=requested?[requested]:sailors.filter(s=>s.task||s.status!=='rest');
      if(!targets.length)return {ok:true,message:'水手正在舱内休息。'};
      for(const s of targets)if(!s.returning)recall(s);
      return {ok:true,message:requested?`${requested.name}正在返回水手舱。`:'水手正在返回水手舱。',crewId:requested?.id};
    }
    if(spec.type==='sail'&&(!Number.isInteger(spec.index)||spec.index<0||spec.index>=11||typeof spec.set!=='boolean')||spec.type==='guard'&&(!Number.isInteger(spec.mast)||spec.mast<0||spec.mast>2)||spec.type==='anchor'&&typeof spec.raised!=='boolean')return {ok:false,message:'命令目标无效。'};
    const task=spec.type==='anchor'?{type:'anchor',raised:spec.raised}:spec.type==='sail'?{type:'sail',index:spec.index,set:spec.set}:{type:'guard',mast:spec.mast};
    const duplicate=sailors.find(s=>s.task&&facility(s.task)===facility(task));
    if(duplicate){const same=JSON.stringify(duplicate.task)===JSON.stringify(task);return {ok:same,message:same?`${duplicate.name}已在执行${taskLabel(task)}。`:'这处设施已有水手执行命令，请先取消原任务。',crewId:duplicate.id};}
    if(task.type==='guard'&&sailors.some(s=>s.task?.type==='sail'&&sailMast(s.task.index,sails)===task.mast))return {ok:false,message:'该桅盘有人整理帆索，请等通道空出。'};
    if(task.type==='sail'&&sailors.some(s=>s.task?.type==='guard'&&s.task.mast===sailMast(task.index,sails)))return {ok:false,message:'该桅盘正在站岗，请先撤回站岗水手。'};
    if(task.type==='sail'&&sailMast(task.index,sails)!==null&&sailors.some(s=>s.task?.type==='sail'&&sailMast(s.task.index,sails)===sailMast(task.index,sails)))return {ok:false,message:'该桅盘已有水手整理另一面帆，请等待他回舱。'};
    if(task.type==='anchor'&&Math.abs(currentGame.ship.anchorLift-(task.raised?1:0))<.001||task.type==='sail'&&currentGame.world.sailsSet[task.index]===task.set)return {ok:true,message:task.type==='anchor'?(task.raised?'船锚已经收起。':'船锚已经放下。'):`第 ${task.index+1} 面帆已${task.set?'展开':'收起'}。`};
    const s=requested||sailors.find(s=>s.status==='rest'&&!s.task);
    if(!s||s.status!=='rest'||s.task)return {ok:false,message:requested?`${requested.name}正在忙，先命令他回舱休息。`:'三名水手都在忙，请等待或取消一个任务。'};
    Object.assign(s,{task,route:taskRoute(task,point(s.view.player),sails),history:[],returning:false,status:'walking',workTime:0,stallTime:0,blockedReason:'',workingAnchor:false});
    emit(s,`${s.name}：遵命，${taskLabel(task)}！`);return {ok:true,message:`${s.name}正在前往${taskLabel(task)}的工作位。`,crewId:s.id};
  }
  function copyShared(s){const room=s.view.world.room;if(!s.view.climb)s.view.player.yaw+=currentGame.ship.heading-s.lastHeading;s.lastHeading=currentGame.ship.heading;s.view.ship=currentGame.ship;s.view.boat=currentGame.boat;s.view.cellsOpen=currentGame.cellsOpen;Object.assign(s.view.world,currentGame.world,{cellDoorAngles:currentGame.world.cellDoorAngles?.slice(),sailsSet:currentGame.world.sailsSet.slice(),room});}
  function syncActors(s){
    const other=sailors.filter(o=>o!==s).map(o=>worldPosition(currentGame,point(o.view.player)));
    const p=currentGame.player,shipSpace=['deck','cabin','helm'].includes(currentGame.mode);
    other.push(shipSpace?worldPosition(currentGame,point(p)):[p.x,p.y,p.z]);
    for(let i=0;i<s.actors.length;i++){const a=other[i];s.actors[i].setTranslation({x:a[0],y:a[1]+CHARACTER.height/2,z:a[2]});s.actors[i].setEnabled(true);}
  }
  function waiting(s,dt,reason){s.stallTime+=dt;if(s.stallTime>1.6&&s.status!=='blocked'){s.status='blocked';s.blockedReason=reason;emit(s,`${s.name}：${reason}，我在原地等待。`);}}
  function tickRoute(s,dt){
    const v=s.view,step=s.route[0],p=v.player;
    if(!step)return false;
    const nextClimb=step.kind==='climb'?step:s.route[1]?.kind==='climb'?s.route[1]:null;
    if(nextClimb){
      const owner=ladderReservations.get(nextClimb.id);
      if(owner&&owner!==s.id){waiting(s,dt,'梯道有人');s.controller.move(v,{},dt);return true;}
      ladderReservations.set(nextClimb.id,s.id);
    }
    if(!step.started){
      step.started=true;
      if(!s.returning)s.history.push(step.kind==='walk'?walk(point(p)):climb(step.id,!step.up));
    }
    if(step.kind==='walk'){
      const dx=step.point[0]-p.x,dz=step.point[2]-p.z,distance=Math.hypot(dx,dz);
      if(distance<(step.tolerance??.10)&&Math.abs(p.y-step.point[1])<.55){s.route.shift();s.stallTime=0;s.blockedReason='';return true;}
      const c=Math.cos(v.ship.heading),sn=Math.sin(v.ship.heading),scale=distance?Math.min(1,distance/(2.65*dt))/distance:0;
      const before=point(p);p.yaw=Math.atan2(c*dx+sn*dz,-sn*dx+c*dz);s.controller.move(v,{moveX:(c*dx+sn*dz)*scale,moveZ:(-sn*dx+c*dz)*scale,lookYaw:p.yaw||.00001},dt);
      const moved=Math.hypot(p.x-before[0],p.y-before[1],p.z-before[2]);
      if(moved<.004)waiting(s,dt,'通道有障碍');else{s.stallTime=0;s.blockedReason='';s.status=s.returning?'returning':'walking';}
    }else{
      const path=pathById(step.id);
      if(path.needsHatch){currentGame.world.hatchOpen=true;v.world.hatchOpen=true;if((currentGame.world.hatchAngle||0)>-1.25){waiting(s,dt,'等待舱盖打开');return true;}}
      // Narrow ladders are reserved while someone else uses them; callers still sweep every step.
      const reserved=sailors.some(o=>o!==s&&o.view.climb?.path.id===path.id)||currentGame.climb?.path?.id===path.id;
      if(reserved&&!v.climb){waiting(s,dt,'梯道有人');return true;}
      if(!v.climb){if((p.climbCooldown||0)>0){s.controller.move(v,{},dt);return true;}if(!s.controller.startClimb(v,path,!step.up)){waiting(s,dt,'梯口受阻');return true;}s.stallTime=0;s.blockedReason='';}
      const before=point(p);s.controller.move(v,step.up?{forward:1}:{back:1},dt);
      if(!v.climb){const endpoint=step.up?path.upperExit:path.lowerExit;if(Math.hypot(p.x-endpoint[0],p.y-endpoint[1],p.z-endpoint[2])<.2){s.route.shift();ladderReservations.delete(path.id);s.stallTime=0;s.blockedReason='';}else waiting(s,dt,'梯口出口受阻');}
      else if(Math.hypot(p.x-before[0],p.y-before[1],p.z-before[2])<.0001&&v.climb.phase==='climb')waiting(s,dt,'梯道出口受阻');
      else{s.stallTime=0;s.blockedReason='';s.status=s.returning?'returning':'climbing';}
    }
    return true;
  }
  function finish(s,message){emit(s,message);recall(s);}
  function update(dt,paused=false){
    if(disposed||paused||!(dt>0))return;
    dt=Math.min(dt,.05);elapsed+=dt;
    // ponytail: the ship's narrow shared aisle admits one traveller; add yielding bays for a larger crew.
    if(!sailors.find(s=>s.id===travelling)?.route.length)travelling=(sailors.find(s=>s.returning&&s.route.length)||sailors.find(s=>s.route.length))?.id||null;
    for(const s of sailors){
      copyShared(s);syncActors(s);const before=point(s.view.player);s.workingAnchor=false;
      if(s.route.length&&s.id!==travelling){waiting(s,dt,'等待同伴通过通道');s.controller.move(s.view,{},dt);}
      else if(s.route.length)tickRoute(s,dt);
      else if(s.returning){s.returning=false;s.status='rest';s.blockedReason='';s.controller.move(s.view,{},dt);emit(s,`${s.name}已回到水手舱。`);}
      else if(s.task?.type==='guard'){s.status='guard';s.controller.move(s.view,{},dt);}
      else if(s.task){
        s.status='working';s.controller.move(s.view,{},dt);s.workTime+=dt;
        if(s.task.type==='anchor'){
          const target=s.task.raised?1:0;
          if(Math.abs(currentGame.ship.anchorLift-target)<.001){currentGame.ship.anchorLift=target;finish(s,`${s.name}：船锚已${s.task.raised?'收起':'放下'}，船长！`);}
          else{if(s.task.raised)currentGame.world.capstanBraked=true;if(currentGame.ship.anchorTarget!==target&&heaveAnchor(currentGame,s.task.raised?1:-1)){currentGame.notice=`${s.name}正在绞车旁${s.task.raised?'收起':'放下'}船锚。`;currentGame.noticeTime=3;}s.workingAnchor=s.task.raised;}
        }else if(s.workTime>=3.2){currentGame.world.sailsSet[s.task.index]=s.task.set;finish(s,`${s.name}：第 ${s.task.index+1} 面帆已${s.task.set?'展开':'收起'}！`);}
      }else{s.status='rest';s.controller.move(s.view,{},dt);}
      const after=point(s.view.player),distance=Math.hypot(after[0]-before[0],after[1]-before[1],after[2]-before[2]);s.distanceWalked+=distance;s.gait+=Math.hypot(after[0]-before[0],after[2]-before[2])*4;s.speed=Math.min(1,distance/dt/2.65);
      if(s.task?.type==='anchor'&&s.status==='working')s.view.player.yaw=Math.PI/2+currentGame.ship.heading;
      if(s.task?.type==='sail'&&s.task.index>=9&&s.status==='working')s.view.player.yaw=Math.atan2(7.96-s.view.player.x,.78-s.view.player.z)+currentGame.ship.heading;
    }
    currentGame.crewAnchorHeld=anchorHeld();
    syncCaptainActors();
  }
  function anchorHeld(){return !disposed&&sailors.some(s=>s.workingAnchor&&s.task?.type==='anchor');}
  const actionPoint=new THREE.Vector3();
  const barStart=new THREE.Vector3(),barEnd=new THREE.Vector3(),handAim=new THREE.Vector3(),barPoint=new THREE.Vector3(),barLine=new THREE.Line3();
  function nearestBarGrip(s){
    let best=null;s.pirate.updateWorldMatrix(true,true);
    const turning=Math.abs(Math.atan2(Math.sin(s.view.player.yaw-s.pirate.rotation.y),Math.cos(s.view.player.yaw-s.pirate.rotation.y)))>.68,margin=turning?.09:.025;
    for(const[index,bar]of capstanBars.entries()){
      bar.updateWorldMatrix(true,false);bar.localToWorld(barStart.set(0,.34,0));bar.localToWorld(barEnd.set(0,1.28,0));barLine.set(barStart,barEnd);
      for(const hand of['rightHand','leftHand']){
        const chain=s.pirate.rig.chains[hand];handAim.copy(chain.upper.position).add(chain.contact.position);s.pirate.rig.body.localToWorld(handAim);barLine.closestPointToPoint(handAim,true,barPoint);
        const reach=canReachHand(s.pirate,barPoint,{hand});
        if(reach.reachable&&reach.distance<reach.maximumDistance-margin&&(!best||reach.distance<best.distance))best={point:barPoint.clone(),hand,continuous:true,bar:index,distance:reach.distance};
      }
    }
    return best;
  }
  function render(delta=0,paused=false){
    if(!ship)return;
    for(const s of sailors){
      if(!s.pirate)continue;
      const p=s.view.player;s.pirate.position.fromArray(worldPosition(currentGame,point(p)));
      let actionTarget=null;
      if(s.status==='working'){
        if(s.task?.type==='anchor')actionTarget=nearestBarGrip(s);
        else{const local=s.task?.index>=9?[7.96,3.25,.78]:[p.x,p.y+1.22,p.z-.24];actionPoint.fromArray(worldPosition(currentGame,local));actionTarget={point:actionPoint,continuous:s.task?.index>=9};}
        s.view.handAction=actionTarget?{time:.3,hand:actionTarget.hand||'rightHand'}:null;
      }else s.view.handAction=null;
      updatePirateBody({game:s.view,ship,pirate:s.pirate,lookYaw:p.yaw,lookPitch:0,gait:s.gait,gaitAmount:s.speed,elapsed,delta,paused,firstPerson:false,equipped:null,actionTarget});
    }
  }
  function dispose(){disposed=true;currentGame.crewAnchorHeld=false;clearCaptainActors();for(const s of sailors){s.pirate?.removeFromParent();s.controller.world.free();}}
  return {command,update,render,setGame,anchorHeld,dispose,sailors,get state(){return sailors.map(s=>({id:s.id,name:s.name,status:s.status,label:STATUS[s.status],task:s.task?{...s.task}:null,position:point(s.view.player),worldPosition:worldPosition(currentGame,point(s.view.player)),yaw:s.view.player.yaw,climb:s.view.climb?{id:s.view.climb.path.id,progress:s.view.climb.progress,phase:s.view.climb.phase}:null,distanceWalked:s.distanceWalked,blockedReason:s.blockedReason}));}};
}
