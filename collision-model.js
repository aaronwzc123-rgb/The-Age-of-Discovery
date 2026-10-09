import { hullWidth,hullHalfWidthAt,mainDeckHeight,MASTS,GUN_X } from './ship-layout.js';
import { SHROUD_GEOMETRY } from './climb-paths.js';

// Low resolution, authored collision geometry. No rendered ship mesh enters physics.
export function buildCollisionModel(R,world,shipBody,layout){
  const ids=new Map(),dynamic={};
  function add(desc,id,body=shipBody){const c=world.createCollider(desc.setFriction(0).setRestitution(0),body);ids.set(c.handle,id);return c;}
  const box=(id,x,y,z,w,h,d,body=shipBody)=>add(R.ColliderDesc.cuboid(w/2,h/2,d/2).setTranslation(x,y,z),id,body);
  function surface(id,xs,zs,height,valid,body=shipBody){
    const v=[],ix=[];
    for(let i=1;i<xs.length;i++)for(let j=1;j<zs.length;j++){
      const xa=xs[i-1],xb=xs[i],za=zs[j-1],zb=zs[j];if(!valid((xa+xb)/2,(za+zb)/2))continue;
      const n=v.length/3;v.push(xa,height(xa,za),za,xb,height(xb,za),za,xa,height(xa,zb),zb,xb,height(xb,zb),zb);ix.push(n,n+2,n+1,n+1,n+2,n+3);
    }
    return add(R.ColliderDesc.trimesh(new Float32Array(v),new Uint32Array(ix),R.TriMeshFlags.MERGE_DUPLICATE_VERTICES|R.TriMeshFlags.FIX_INTERNAL_EDGES),id,body);
  }
  const range=(a,b,step)=>Array.from({length:Math.ceil((b-a)/step)+1},(_,i)=>Math.min(b,a+i*step));
  const xs=[...new Set([...range(-16,16,.5),-8,12,12.2,-4.4,-3.6,2,4])].sort((a,b)=>a-b),zs=[...new Set([...range(-4.3,4.3,.25),-.8,.8,-.25,.75,-1.2,-.3,.3,1.2])].sort((a,b)=>a-b);
  const footprint=(x,z)=>Math.abs(z)<hullHalfWidthAt(x,2.4)-.06;
  surface('main-deck',xs,zs,mainDeckHeight,(x,z)=>footprint(x,z)&&!(x>-4.4&&x<-3.6&&z>-.25&&z<.75)&&!(x>2&&x<4&&Math.abs(z)<.8));
  surface('quarter-deck',xs.filter(x=>x<=-8),zs,()=>4.55,(x,z)=>footprint(x,z)&&!(x>-8.38&&Math.abs(Math.abs(z)-1.4)<.52));
  surface('fore-deck',xs.filter(x=>x>=12),zs,()=>3.1,(x,z)=>footprint(x,z)&&!(x<12.2&&Math.abs(z)>.3&&Math.abs(z)<1.2));
  surface('lower-floor',xs.filter(x=>x>=-14.1&&x<=12.6),zs,()=>.15,(x,z)=>Math.abs(z)<hullHalfWidthAt(x,.15)-.14&&!(x>2&&x<4&&Math.abs(z)<.8));
  surface('hold-floor',xs.filter(x=>x>=-13.4&&x<=12),zs,()=>-1.85,(x,z)=>Math.abs(z)<hullHalfWidthAt(x,-1.85)-.14);
  dynamic.hatch=box('hatch-lid',-4,2.405,.25,.8,.08,1);
  dynamic.cargo=box('cargo-lid',3,2.405,0,2,.08,1.6);
  // Closed hull prevents both swimming through the hull and walking through lining.
  // Small convex wall strips have no ambiguous inside/outside on an open shell mesh.
  for(const side of[-1,1])for(let i=0;i<32;i++)for(let j=0;j<4;j++){
    const a=-16+i,b=a+1,ya=-2.3+j*1.175,yb=ya+1.175,verts=[];
    for(const[x,y]of[[a,ya],[b,ya],[a,yb],[b,yb]])for(const dz of[-.06,.06])verts.push(x,y,side*(hullHalfWidthAt(x,y)-.10)+dz);
    const desc=R.ColliderDesc.convexHull(new Float32Array(verts));if(desc)add(desc,`hull-shell-${side}-${i}-${j}`);
  }
  box('stern-wall',-15.9,3.35,0,.15,2.1,4.2);
  box('lower-aft-bulkhead',-14.05,1.15,0,.15,2,3.8);
  box('hold-aft-bulkhead',-13.5,-.85,0,.15,2,3);
  box('lower-forward-bulkhead',12.4,1.15,0,.15,2,3.6);
  box('hold-forward-bulkhead',12,-.85,0,.15,2,2.4);
  // Main bulkhead aperture is 0.69 m after its actual door jambs.
  for(const side of[-1,1]){
    box(`captain-front-${side}`,-8,3.31,side*1.94,.16,1.82,3.18);
    box(`captain-jamb-${side}`,-7.985,3.32,side*.405,.17,1.84,.12);
    box(`captain-wall-${side}`,-12,3.37,side*(hullHalfWidthAt(-12,2.4)-.12),8,1.94,.15);
  }
  box('captain-lintel',-8,4.30,0,.17,.26,.85);
  dynamic.cabinDoor=box('captain-door',-7.99,3.25,0,.075,1.7,.75);
  // Real steps are less than the 0.22 m controller autostep height.
  for(const side of[-1,1]){
    box(`fore-step-landing-${side}`,12.125,3.06,side*.75,.20,.08,.80);
    box(`quarter-step-landing-${side}`,-8.325,4.51,side*1.4,.40,.08,.86);
    // Continuous walking proxy follows tread tops; thin decorative treads don't snag a capsule.
    for(const[id,a,b,ya,yb,z,w]of[[`quarter-step-${side}`,-5.87,-8.15,2.4,4.55,side*1.4,.86],[`fore-step-${side}`,10.97,12.05,2.4,3.1,side*.75,.8]]){
      const verts=[];for(const[x,y]of[[a,ya-.08],[a,ya],[b,ya-.08],[b,yb]])for(const dz of[-w/2,w/2])verts.push(x,y,z+dz);add(R.ColliderDesc.convexHull(new Float32Array(verts)),id);
    }
  }
  // Rails have their real heights, gaps and gunport sills. Jumping above them is possible.
  for(const side of[-1,1])for(let x=-15.75;x<15.5;x+=.25){
    if(side===-1&&x>-.15&&x<1.35)continue;
    if(side===1&&SHROUD_GEOMETRY.some(g=>Math.abs(x-g.path.entry[0])<.58))continue;
    const y=x<-8?4.55:x>12?3.1:mainDeckHeight(x),gun=x>=-8&&x<12&&GUN_X.some(g=>Math.abs(x-g)<.425),h=gun?.35:1;
    box(`rail-${side}-${x.toFixed(2)}`,x,y+h/2,side*(hullHalfWidthAt(x,2.4)-.045),.26,h,.14);
  }
  for(const[mIndex,m]of MASTS.entries()){
    add(R.ColliderDesc.cylinder((m.nest+2.1)/2,m.radius).setTranslation(m.x,(m.nest-2.1)/2,0),`mast-${mIndex}`);
    const size=mIndex===1?1:.84,accessZ=[.82,.87,.62][mIndex];
    surface(`mast-platform-${mIndex}`,range(m.x-1.05*size,m.x+1.23*size,.12),range(-1.05*size,1.05*size,.12),()=>m.nest,(x,z)=>{
      const dx=x-m.x;return Math.hypot(dx/(1.25*size),z/(1.05*size))<=1&&Math.hypot(dx,z)>m.radius+.02&&!(z>accessZ&&dx>-.07*size&&dx<.74*size);
    });
  }
  for(const x of GUN_X)for(const side of[-1,1]){
    const z=side*(hullHalfWidthAt(x,2.4)-.98),y=mainDeckHeight(x,z);
    box(`gun-carriage-${x}-${side}`,x,y+.38,z,1.18,.76,1.35);
    box(`gun-barrel-${x}-${side}`,x,y+.91,z+side*.33,.38,.34,1.92);
  }
  add(R.ColliderDesc.cylinder(1.2,.265).setTranslation(9,3.11,0).setRotation({x:Math.SQRT1_2,y:0,z:0,w:Math.SQRT1_2}),'windlass-drum');
  for(const side of[-1,1]){
    const vertices=[];for(const[x,y]of[[-.36,0],[.36,0],[.25,.94],[-.25,.94]])for(const dz of[-.105,.105])vertices.push(9+x,2.4+y,side*1.14+dz);
    add(R.ColliderDesc.convexHull(new Float32Array(vertices)),`windlass-frame-${side}`);
    box(`windlass-foot-${side}`,9,2.44,side*1.14,.94,.12,.50);
  }
  for(const x of[-12.09,-11.70])box(`helm-post-${x}`,x,5.01,0,.16,.91,.17);
  box('helm-wheel',-12,5.65,0,.28,1.28,1.28);
  for(const b of layout.collisions||[])box(`${b.kind}-${b.x}-${b.z}`,b.x,(b.minY+b.maxY)/2,b.z,b.w,b.maxY-b.minY,b.d);
  for(let x=-13.4;x<12;x+=1.65){
    if(Math.abs(x-3)>1.25)box(`hold-beam-${x}`,x,-.03,0,.18,.17,hullHalfWidthAt(x,-.08)*2-.3);
    if(Math.abs(x+4)>.65&&Math.abs(x-3)>1.25)box(`lower-beam-${x}`,x,2.11,0,.18,.19,hullHalfWidthAt(x,2.1)*2-.3);
  }
  for(const side of[-1,1])for(const[x,index]of[[-8.3,side<0?0:1],[-6.3,side<0?2:3]]){
    for(const dx of[-.68,.68])box(`cell-front-${index}-${dx}`,x+dx,1.07,side*.55,.62,1.84,.12);
    dynamic[`cell-${index}`]=box(`cell-door-${index}`,x,1.01,side*.55,.67,1.72,.09);
  }
  // Dock and terrain are world-fixed, independent of the moving ship.
  const fixed=world.createRigidBody(R.RigidBodyDesc.fixed());
  box('pier-stem',0,2.31,-22,6.8,.34,26.8,fixed);box('pier-head',0,2.31,-9.1,30,.34,3.5,fixed);
  for(const x of[-14.6,-7.4,7.4,14.6])add(R.ColliderDesc.cylinder(2.7,.35).setTranslation(x,1.4,-9.1),`dock-post-${x}`,fixed);
  for(const[x,z]of[[-2.2,-22],[2.2,-30.8],[8.4,-9]])box(`dock-crate-${x}`,x,3.33,z,1.54,1.44,1.44,fixed);
  const islandHeight=(x,z)=>{const r=Math.hypot(x/24,(z+52)/26);return r>.86?.55-(r-.86)*4:.55+(1-r*r/(.86*.86))*1.05;};
  surface('island',range(-26,26,1),range(-80,-24,1),islandHeight,(x,z)=>Math.hypot(x/24,(z+52)/26)<=1.08,fixed);
  // Simple beach rock proxies at their authored locations.
  for(const[x,z,r]of[[-17,-40,2.4],[17,-46,3.1],[-11,-74,3.3],[9,-74,1.8],[18,-64,2.2]])add(R.ColliderDesc.ball(r*.75).setTranslation(x,islandHeight(x,z)+r*.35,z),`island-rock-${x}`,fixed);
  dynamic.gangplank=box('gangplank',.6,2.375,-6.65,3,.15,5.1,fixed);
  return{ids,dynamic,fixed,colliderCount:ids.size};
}
