import * as THREE from 'three';
import { createModelKit } from './ship-interior.js';

// One 4.8 m clinker-built boat. The origin is the outside of its keel, so a hung
// boat uses Y=2.4, and a floating boat uses Y=-0.35 (about 30 cm of freeboard).
export function buildLifeboat(scene, ship, materials = {}, woodTexture = null) {
  const { m, mesh, box, pole, cable, ring, batch, coil } = createModelKit(materials, woodTexture);
  const boat = new THREE.Group();boat.name='lifeboat';scene.add(boat);
  const davits = new THREE.Group();davits.name='timber-boat-davits';ship.add(davits);
  const ropes = new THREE.Group();ropes.name='lifeboat-falls';davits.add(ropes);
  const oars=[];
  const stations=[[-2.4,.25],[-2.0,.54],[-1.3,.75],[0,.825],[1.2,.72],[1.95,.40],[2.4,.012]];
  function breadth(x) {
    for(let i=1;i<stations.length;i++)if(x<=stations[i][0]){const[a,wa]=stations[i-1],[b,wb]=stations[i],t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return THREE.MathUtils.lerp(wa,wb,t*t*(3-2*t))*.942;}
    return stations.at(-1)[1]*.942;
  }
  const shape=(x,t,side,offset=0)=>{const keel=.015+.065*Math.pow(Math.abs(x)/2.4,3),y=keel+.55*t+.015*Math.pow(Math.abs(x)/2.4,2);return[x,y,side*(breadth(x)*(.19+.81*Math.sin(t*Math.PI/2))+offset)];};
  function strip(from,to,side,offset,material) {
    const p=[],uv=[],ix=[],columns=64,rows=3;
    for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++){
      const x=-2.4+i/columns*4.8,t=THREE.MathUtils.lerp(from,to,j/rows);p.push(...shape(x,t,side,offset));uv.push(t*2,x/4);
      if(i<columns&&j<rows){const a=j*(columns+1)+i,b=a+columns+1;side>0?ix.push(a,a+1,b,a+1,b+1,b):ix.push(a,b,a+1,a+1,b,b+1);}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return mesh(boat,g,material);
  }
  const outside=m.wood.clone();outside.name='boat-planking';outside.side=THREE.DoubleSide;
  const inside=m.lightWood.clone();inside.name='boat-inner-planking';inside.side=THREE.DoubleSide;
  for(const side of [-1,1]) {
    for(let j=0;j<7;j++) {
      const from=j/7,to=(j+1)/7;strip(from,to,side,j*.003,outside);
      // Overlapping land is only a few millimetres: its grazing-light edge reads as clinker.
      cable(boat,Array.from({length:45},(_,i)=>shape(-2.4+i/44*4.8,to,side,j*.003+.004)),.004,m.darkWood);
      for(const x of [-1.8,-.8,.3,1.2,1.95]){
        const p=shape(x,(from+to)/2,side,j*.003+.006);mesh(boat,new THREE.SphereGeometry(.006,5,4),m.darkWood,p);
      }
    }
    strip(0,1,side,-.028,inside);
    cable(boat,Array.from({length:49},(_,i)=>shape(-2.4+i/48*4.8,1,side,.007)),.041,m.darkWood);
    cable(boat,Array.from({length:49},(_,i)=>{const p=shape(-2.4+i/48*4.8,1,side,-.033);p[1]-=.036;return p;}),.023,m.lightWood);
  }
  pole(boat,[-2.28,.02,0],[2.31,.12,0],.037,m.darkWood,.025);
  for(let x=-2.0;x<=2.05;x+=.30) {
    const points=[];
    for(let i=0;i<=14;i++){const a=-Math.PI/2+i/14*Math.PI,t=Math.abs(Math.sin(a)),side=a<0?-1:1,p=shape(x,t,side,-.046);points.push(p);}
    cable(boat,points,.019,m.darkWood);
  }
  // Six separate sole boards leave drainage gaps alongside the keel.
  for(const z of [-.38,-.23,-.077,.077,.23,.38])box(boat,[3.05,.035,.142],[0,.15,z],m.lightWood);
  for(const x of [-1.33,0,1.29]) {
    const half=breadth(x)-.045;box(boat,[.25,.05,half*2],[x,.48,0],m.lightWood);
    for(const side of [-1,1])box(boat,[.30,.055,.095],[x,.425,side*(half-.05)],m.darkWood);
    for(const dx of [-.09,.09])for(const side of [-1,1])mesh(boat,new THREE.SphereGeometry(.008,5,4),m.iron,[x+dx,.508,side*(half-.08)]);
  }
  // A small transom gives the stern a flatter termination than the fine stem.
  box(boat,[.045,.29,.48],[-2.39,.48,0],m.wood);pole(boat,[2.38,.12,0],[2.40,.65,0],.030,m.darkWood,.022);
  ring(boat,.046,.014,[2.36,.56,0],m.iron,[0,Math.PI/2,0]);
  cable(boat,[[2.34,.51,0],[1.96,.38,.16],[1.85,.19,.27],[1.54,.17,.18]],.016);
  coil(boat,1.55,.185,.22,.15,4,.011);
  // Two rowing pairs plus one spare. Pivots survive all batching.
  function makeOar(parent, xyz, side, stowed=false) {
    const oar=new THREE.Group();oar.name=stowed?'spare-oar':`working-oar-${side}-${oars.length}`;oar.position.set(...xyz);parent.add(oar);
    pole(oar,[0,0,-side*.66],[0,0,side*1.70],.022,m.lightWood,.017);
    const bladePoints=[[-.018,1.69],[-.105,1.88],[-.115,2.28],[-.05,2.39],[.05,2.39],[.115,2.28],[.105,1.88],[.018,1.69]];
    const p=[],uv=[],ix=[];for(const y of [-.012,.012])for(const[x,z]of bladePoints){p.push(x,y,side*z);uv.push(x/2,z/4);}
    const n=bladePoints.length;for(let i=1;i<n-1;i++)ix.push(0,i+1,i,n,n+i,n+i+1);
    for(let i=0;i<n;i++){const j=(i+1)%n;ix.push(i,j,n+i,j,n+j,n+i);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();mesh(oar,g,m.wood);
    // The hand grip and oarlock bearing are visibly rubbed darker.
    pole(oar,[0,0,-side*.65],[0,0,-side*.47],.024,m.darkWood,.024);pole(oar,[0,0,-side*.03],[0,0,side*.08],.026,m.darkWood,.026);
    batch(oar);return oar;
  }
  for(const x of [-.69,.69])for(const side of [-1,1]) {
    const z=side*(breadth(x)-.05),oar=makeOar(boat,[x,.61,z],side);oar.rotation.x=-side*.15;oar.rotation.y=side*.42;oars.push(oar);
    oar.userData={side,activePosition:[x,.61,z],activePitch:-side*.15,activeYaw:side*.42,stowedPosition:[-1.08+(x>0?.09:0),.27+(x>0?.055:0),side*(x>0?.42:.35)],stowedYaw:side*Math.PI/2,rowable:x<0,restYaw:side*Math.PI/2,rowing:false};
    pole(boat,[x,.56,z],[x,.65,z],.012,m.iron);ring(boat,.035,.008,[x,.64,z],m.iron,[0,Math.PI/2,0]);
  }
  const spare=makeOar(boat,[-1.15,.31,-.43],1,true);spare.rotation.y=Math.PI/2;spare.scale.setScalar(.89);
  for(const x of [-.98,.37])ring(boat,.028,.009,[x,.32,-.43],m.rope,[0,Math.PI/2,0]);
  for(const side of [-1,1])for(const x of [-.65,.65])cable(boat,[[x,.17,side*.50],[x,.365,side*.43],[x,.365,side*.32],[x,.17,side*.27]],.008);
  // Thin removable rudder and pintles are clear of the hanging falls.
  box(boat,[.035,.53,.22],[-2.45,.205,0],m.darkWood);pole(boat,[-2.45,.62,0],[-1.82,.61,0],.022,m.wood,.027);
  for(const y of [.30,.56])ring(boat,.030,.009,[-2.43,y,0],m.iron,[0,0,0]);
  // Bailer, hook and tied stores are stowed under seats.
  box(boat,[.17,.08,.13],[.40,.20,.30],m.wood);box(boat,[.16,.04,.09],[.40,.253,.30],m.seam);pole(boat,[.4,.22,.23],[.73,.26,.23],.013,m.wood);
  pole(boat,[-1.5,.245,.43],[1.52,.25,.43],.018,m.lightWood);cable(boat,[[1.5,.25,.43],[1.63,.25,.43],[1.66,.25,.49],[1.60,.25,.51]],.012,m.iron);
  const bag=mesh(boat,new THREE.SphereGeometry(.18,12,8),m.cloth,[-1.23,.28,.28]);bag.scale.set(1.18,.8,.70);ring(boat,.031,.009,[-1.24,.43,.28],m.rope);
  box(boat,[.21,.045,.17],[-.71,.188,.26],m.darkWood);coil(boat,-.75,.222,.29,.075,3,.008);
  // Two thick timber davits carry the weight through knees into the ship, not metal aerials.
  const cableSockets=[];
  for(const x of [-13.10,-8.90]) {
    box(davits,[.27,1.63,.31],[x,3.12,-2.87],m.darkWood);
    cable(davits,[[x,3.45,-2.87],[x,4.15,-3.20],[x,4.30,-4.34],[x,4.18,-4.60]],.135,m.wood);
    pole(davits,[x,2.45,-2.65],[x,3.97,-3.91],.084,m.darkWood,.072);
    for(const y of [2.53,3.49])box(davits,[.30,.10,.34],[x,y,-2.87],m.iron);
    const block=mesh(davits,new THREE.SphereGeometry(.15,12,8),m.darkWood,[x,4.08,-4.6]);block.scale.set(.78,1.25,.65);
    ring(davits,.080,.018,[x,4.08,-4.70],m.iron,[0,0,0]);pole(davits,[x,4.08,-4.70],[x,4.08,-4.50],.025,m.iron);
    cableSockets.push({x,y:3.98,z:-4.6});
    pole(davits,[x-.17,2.54,-2.64],[x+.17,2.54,-2.64],.040,m.darkWood);
    coil(davits,x+.35,2.43,-2.59,.19,4,.019);
  }
  let lastLowering = -1;
  let oarsDeployed=null;
  function setOarsDeployed(deployed) {
    const active=Boolean(deployed);if(active===oarsDeployed)return;oarsDeployed=active;
    for(const oar of oars){const d=oar.userData,rowing=active&&d.rowable;oar.position.set(...(rowing?d.activePosition:d.stowedPosition));oar.rotation.set(rowing?d.activePitch:0,rowing?d.activeYaw:d.stowedYaw,0);d.restYaw=oar.rotation.y;d.rowing=rowing;}
  }
  function setBoatLowering(factor) {
    const t=THREE.MathUtils.clamp(factor,0,1);if(Math.abs(t-lastLowering)<.004)return;lastLowering=t;
    for(const child of [...ropes.children]){if(child.geometry)child.geometry.dispose();ropes.remove(child);}
    const bottom=THREE.MathUtils.lerp(2.4,-.35,t);
    for(const socket of cableSockets) {
      const attachX=socket.x<-11?-12.9:-9.1;
      cable(ropes,[[socket.x,socket.y,socket.z],[attachX,bottom+.57,-4.6]],.020);
      cable(ropes,[[socket.x+.08,socket.y,socket.z+.08],[attachX+.045,bottom+.59,-4.6]],.016);
      // The hauling tail runs via its block to the ship's belaying horn.
      cable(ropes,[[socket.x+.08,socket.y,socket.z+.08],[socket.x+.07,3.98,-3.23],[socket.x,2.59,-2.66]],.016);
    }
    if(t<.08)for(const x of [-12.1,-9.9])cable(ropes,[[x,2.48,-2.72],[x,3.02,-3.95],[x,2.63,-5.16],[x,2.60,-4.60]],.022);
    batch(ropes);
  }
  setBoatLowering(0);setOarsDeployed(false);batch(boat);batch(davits);
  boat.userData={length:4.8,width:1.65,depth:.65,keelOrigin:true,hung:{x:-11,y:2.4,z:-4.6},waterY:-.35,workingOars:4,spareOars:1};
  boat.position.set(-11,2.4,-4.6);
  return {boat,oars,ropes,davits,setBoatLowering,setOarsDeployed};
}
