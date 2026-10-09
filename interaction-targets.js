import * as THREE from 'three';
import { interactions, playerWorld, toLocal } from './game.js';
import {canReachHand} from './player-body.js';

const direction=new THREE.Vector3(),point=new THREE.Vector3(),hit=new THREE.Vector3();
const reachDirection=new THREE.Vector3();
const sphere=new THREE.Sphere(),shoulder=new THREE.Vector3();

// Small authored selection regions survive visual mesh batching and follow hinges.
export function createInteractionTargets({ship,world,pirate,wheel,capstanBrake,capstanBars,hatchLid,cargoGrating,telescope}) {
  const fixed=(p,r=.22)=>[{parent:ship,position:p,radius:r}];
  const attached=(parent,p,r=.20)=>[{parent,position:p,radius:r}];
  function regions(choice,game){
    const id=choice.id;
    if(choice.drop)return[{parent:choice.drop.space==='ship'?ship:null,position:choice.drop.position,radius:.19}];
    if(choice.lamp)return attached(choice.lamp.group,[0,.03,0],.20);
    if(choice.ladder){
      const path=choice.ladder,worldPos=playerWorld(game);
      const p=path.space==='ship'?{...toLocal(game.ship,worldPos.x,worldPos.z),y:worldPos.y}:worldPos;
      const height=p.y+(game.player.crouched?.71:1.17),grips=[...path.rungs,...(path.handrails||[])];
      const rung=grips.reduce((best,r)=>Math.abs(r.center[1]-height)<Math.abs(best.center[1]-height)?r:best,grips[0]);
      // The hit volume covers a rung, not a sphere floating by the guessed entrance.
      return [{parent:path.space==='ship'?ship:null,position:rung.center,radius:.30},
        {parent:path.space==='ship'?ship:null,position:rung.a,radius:.16},
        {parent:path.space==='ship'?ship:null,position:rung.b,radius:.16}];
    }
    if(id==='helm')return [-1,1].flatMap(side=>attached(wheel,[-.02,.47*Math.cos(1.22),side*.47*Math.sin(1.22)],.22));
    if(id==='capstan-brake')return attached(capstanBrake,[0,.47,0],.20);
    if(id==='anchor')return capstanBars.map(parent=>({parent,position:[0,1.04,0],radius:.19}));
    if(id==='hatch')return game.mode==='cabin'?fixed([-4.48,1.30,.78],.16):attached(hatchLid,[0,.07,.86],.20);
    if(id==='cargo-hatch')return attached(cargoGrating,[0,.06,.65],.34);
    if(id==='cabin-door')return attached(world.cabinDoor,[.10,.98,.65],.21);
    if(id==='chart')return fixed([-11.31,3.21,1.23],.40);
    if(id==='container-captain')return fixed([-13.1,2.8,1.42],.29);
    if(id==='container-hold')return fixed([4.9,-1.24,1.7],.35);
    if(id==='take-scope')return attached(telescope,[0,0,0],.20);
    if(id==='boat')return fixed([-11.0,5.28,-2.68],.28);
    if(id==='board-boat')return[{parent:world.boat,position:[0,.45,.47],radius:.50}];
    if(id.startsWith('cell-'))return attached(world.cellDoors[Number(id.slice(5))],[.60,.90,.07],.21);
    if(id.startsWith('sail-'))return fixed([choice.x,choice.y+.87,choice.z],.22);
    return [];
  }
  function blocks(choice,wall,endDistance){
    const own={helm:'helm-wheel',hatch:'hatch-lid','cargo-hatch':'cargo-lid','cabin-door':'captain-door',anchor:'windlass','capstan-brake':'windlass',chart:'captain-desk','container-captain':'treasure-chest','container-hold':'cargo-box'}[choice.id]||(choice.id.startsWith('cell-')?'cell-door-'+choice.id.slice(5):null);
    return wall&&wall.distance+.025<endDistance&&!(own&&wall.id?.startsWith(own)&&endDistance-wall.distance<.18);
  }
  function contact(game,choice,region,pose={}){
    const point=new THREE.Vector3().fromArray(region.position);if(region.parent){region.parent.updateWorldMatrix(true,false);region.parent.localToWorld(point);}
    const reach=canReachHand(pirate,point,pose);
    if(reach.shoulder){shoulder.fromArray(reach.shoulder);const length=shoulder.distanceTo(point);reachDirection.copy(point).sub(shoulder).normalize();if(blocks(choice,game.controller?.raycast(shoulder,reachDirection,length),length))reach.reachable=false;}
    return {...reach,point};
  }
  function query(game,camera){
    const choices=interactions(game);
    if(game.mode==='helm'||game.mode==='boat'||game.climb)return {choice:choices[0],reachable:true,distance:0,point:null};
    camera.getWorldDirection(direction);const origin=camera.position;
    const obstruction=game.controller?.raycast(origin,direction,2.4);
    const p=playerWorld(game),onShip=['deck','cabin'].includes(game.mode);
    shoulder.set(p.x,p.y+(onShip?game.ship.bob||0:0)+(game.player.crouched?.71:1.16),p.z);
    let best=null;
    for(const choice of choices)for(const region of regions(choice,game)){
      point.fromArray(region.position);if(region.parent)region.parent.localToWorld(point);
      sphere.center.copy(point);sphere.radius=region.radius;
      const ray=new THREE.Ray(origin,direction);if(!ray.intersectSphere(sphere,hit))continue;
      const distance=origin.distanceTo(hit);if(distance>2.2||best&&distance>=best.distance)continue;
      if(blocks(choice,obstruction,origin.distanceTo(point)))continue;
      const options=choice.id==='helm'?{position:ship.localToWorld(new THREE.Vector3(-12.46,4.55,0)),yaw:game.ship.heading+Math.PI/2}:{};
      const reach=contact(game,choice,region,options);
      best={choice,region,point:reach.point,distance,hand:reach.hand,reachable:reach.reachable,
        reason:reach.reachable?'左键':!game.player.crouched&&point.y<shoulder.y-.45?'Shift 蹲下，伸手操作':'靠近操作部位'};
    }
    return best;
  }
  return {query,regions,contact};
}
