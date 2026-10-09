import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createShipMaterials } from './ship-materials.js';
import { buildRigging } from './ship-rigging.js';
import { hullWidth, hullHalfWidthAt, keelHeight, sheerHeight, mainDeckHeight, GUN_X } from './ship-layout.js';
import { SHROUD_GEOMETRY } from './climb-paths.js';
export { hullWidth, hullHalfWidthAt } from './ship-layout.js';

// One metre per unit. The brief's (-Z,Y,X) maps into the game's forward +X, starboard +Z.
export function buildShip(textures={}) {
  const ship=new THREE.Group();ship.name='black-tide';
  const m=createShipMaterials(textures);ship.userData.materials=m;
  const staticParts=new THREE.Group();ship.add(staticParts);
  const V=p=>new THREE.Vector3(...p), lamps=[], lampFixtures=[], gunPorts=[], capstanBars=[];
  function mesh(g,mat,pos=[0,0,0],parent=staticParts,name='') {
    const o=new THREE.Mesh(g,mat);o.position.set(...pos);o.castShadow=o.receiveShadow=true;o.name=name;parent.add(o);return o;
  }
  function box(size,pos,mat=m.wood,parent=staticParts,name=''){
    const g=new THREE.BoxGeometry(...size);
    if(mat.map&&[m.wood,m.weathered,m.deckWood,m.darkWood,m.red,m.underwater].includes(mat)){
      const p=g.attributes.position,uv=g.attributes.uv,n=g.attributes.normal,along=size.indexOf(Math.max(...size));
      for(let i=0;i<p.count;i++){
        const c=[p.getX(i),p.getY(i),p.getZ(i)],nn=[n.getX(i),n.getY(i),n.getZ(i)],face=nn.findIndex(v=>Math.abs(v)>.9);
        const a=face===along?(along+1)%3:along,cross=[0,1,2].find(v=>v!==a&&v!==face)??(a+1)%3;
        uv.setXY(i,c[cross]/2,c[a]/4);
      }
    }
    return mesh(g,mat,pos,parent,name);
  }
  function pole(a,b,r,mat=m.wood,rt=r,parent=staticParts,n=12) {
    const from=V(a),to=V(b),length=from.distanceTo(to),geometry=new THREE.CylinderGeometry(rt,r,length,n),uv=geometry.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*r*Math.PI,uv.getY(i)*length/([m.rope,m.tarRope].includes(mat)?.22:4));
    const o=mesh(geometry,mat,from.clone().add(to).multiplyScalar(.5).toArray(),parent);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),to.sub(from).normalize());return o;
  }
  function rope(points,r=.018,mat=m.rope,parent=staticParts,n) {
    return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(V)),n||Math.max(8,points.length*4),r,5,false),mat,[0,0,0],parent);
  }
  function ring(pos,r,t=.022,mat=m.iron,parent=staticParts,axis='x') {
    const o=mesh(new THREE.TorusGeometry(r,t,6,16),mat,pos,parent);if(axis==='x')o.rotation.y=Math.PI/2;if(axis==='y')o.rotation.x=Math.PI/2;return o;
  }
  function slab(points,depth,mat,pos=[0,0,0],parent=staticParts,bevel=.01) {
    return mesh(new THREE.ExtrudeGeometry(new THREE.Shape(points.map(p=>new THREE.Vector2(...p))),{depth,bevelEnabled:bevel>0,bevelSegments:1,steps:1,bevelSize:bevel,bevelThickness:bevel}),mat,pos,parent);
  }
  function coil(pos,r=.2,loops=5,parent=staticParts) {
    const p=[];for(let i=0;i<=loops*24;i++){const t=i/(loops*24),a=t*loops*Math.PI*2,rad=r*(.35+.65*t);p.push([pos[0]+Math.cos(a)*rad,pos[1]+.015*t,pos[2]+Math.sin(a)*rad]);}
    rope(p,.017,m.rope,parent,loops*24);
  }
  function block(pos,size=.2,parent=staticParts) {
    const o=mesh(new THREE.SphereGeometry(1,10,6),m.darkWood,pos,parent);o.scale.set(size*.42,size*.66,size*.28);
    ring(pos,size*.23,size*.065,m.iron,parent,'x');return o;
  }
  function pinRack(x,z,y=2.4) {
    box([1.65,.11,.22],[x,y+.62,z],m.weathered);
    for(const dx of [-.72,.72]){box([.14,.68,.14],[x+dx,y+.31,z],m.darkWood);box([.3,.06,.3],[x+dx,y+.03,z],m.darkWood);}
    for(let i=0;i<6;i++){
      const px=x-.6+i*.24;pole([px,y+.4,z],[px,y+.82,z],.019,m.deckWood,.027);
      mesh(new THREE.SphereGeometry(.027,7,5),m.deckWood,[px,y+.82,z]);
      if(i%2===0)rope([[px,y+.61,z+.05],[px-.08,y+.3,z+.09],[px,y+.16,z+.09],[px+.07,y+.31,z+.09],[px,y+.61,z+.05]],.012);
    }
  }
  // Cross-sections have a round bilge and tumblehome; plank bands follow those same curves.
  function skin(side,t0,t1,x0=-16,x1=16,offset=0,n=96,limits=[-Infinity,Infinity]) {
    const p=[],uv=[],ix=[];
    for(let i=0;i<=n;i++){
      const x=x0+(x1-x0)*i/n,k=keelHeight(x),top=2.4+sheerHeight(x);
      for(const t of [t0,t1]){const y=Math.max(limits[0],Math.min(limits[1],k+(top-k)*t));p.push(x,y,side*Math.max(.006,hullHalfWidthAt(x,y)+offset));uv.push(y/2,x/4);}
      if(i<n){const a=i*2;ix.push(...(side>0?[a,a+2,a+1,a+2,a+3,a+1]:[a,a+1,a+2,a+2,a+1,a+3]));}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;
  }
  const shellParts=[-1,1].flatMap(s=>Array.from({length:23},(_,i)=>skin(s,i/23,(i+1)/23)));
  const hull=mesh(mergeGeometries(shellParts),m.darkWood,[0,0,0],ship,'hull');shellParts.forEach(g=>g.dispose());
  const innerParts=[-1,1].flatMap(s=>Array.from({length:23},(_,i)=>{const g=skin(s,i/23,(i+1)/23,-16,16,-.085);for(let j=0;j<g.index.array.length;j+=3){const k=g.index.array[j+1];g.index.array[j+1]=g.index.array[j+2];g.index.array[j+2]=k;}g.computeVertexNormals();return g;}));
  mesh(mergeGeometries(innerParts),m.weathered,[0,0,0],ship,'inner-hull');innerParts.forEach(g=>g.dispose());
  rope(Array.from({length:65},(_,i)=>{const x=-16+i*.5;return[x,keelHeight(x)+.11,0];}),.11,m.darkWood);
  for(const side of [-1,1]){
    for(let row=0;row<23;row++){
      const t0=row/23+.00025,t1=(row+1)/23-.00025;let a=-16;
      while(a<16){
        const b=Math.min(16,a+3.7+(row%3)*.42),n=Math.max(4,Math.ceil((b-a)*5));
        for(const[mat,limits]of [[m.underwater,[-Infinity,-.28]],[m.weathered,[-.28,Infinity]]])mesh(skin(side,t0,t1,a,b-.003,.012,n,limits),mat,[0,0,0],staticParts,'fitted-hull-plank');a=b;
      }
    }
    for(const [h,w]of [[.35,.19],[1.15,.16],[2.16,.14]]){
      rope(Array.from({length:65},(_,i)=>{const x=-15.8+31.6*i/64,y=h+sheerHeight(x);return[x,y,side*(hullHalfWidthAt(x,y)+.045)];}),w/2,m.darkWood,staticParts,128);
    }
    for(let i=0;i<16;i++){
      const x=-14.8+i*1.85,points=[],uv=[],indices=[];
      for(let j=0;j<=10;j++){const xx=x+1.85*j/10,low=-.28+.055*Math.sin(xx*2.3+side),high=.08+.045*Math.sin(xx*3.9);for(const y of [low,high]){points.push(xx,y,side*(hullHalfWidthAt(xx,y)+.022));uv.push(y*3,xx/4);}if(j<10){const k=j*2;indices.push(...(side>0?[k,k+2,k+1,k+2,k+3,k+1]:[k,k+1,k+2,k+2,k+1,k+3]));}}
      const band=new THREE.BufferGeometry();band.setAttribute('position',new THREE.Float32BufferAttribute(points,3));band.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));band.setIndex(indices);band.computeVertexNormals();mesh(band,m.algae);
      if(i%5===1)mesh(skin(side,.72,.765,x,x+1.2,.019,7),m.wood,[0,0,0],staticParts,'repair-plank');
    }
  }
  // Stern closure follows the same sections as the shell, including the lowest bilge.
  for(let i=0;i<26;i++){const y=keelHeight(-16)+(i+.5)*(2.4+sheerHeight(-16)-keelHeight(-16))/26,w=hullHalfWidthAt(-16,y);box([.12,.152,w*2+.025],[-15.99,y,0],y<-.28?m.underwater:m.weathered);}
  // Trimmed longitudinal planks, millimetre seams, deck camber and real hatch openings.
  function deck(x0,x1,y,holes=[]){
    for(let z=-4.1;z<4.1;z+=.245){
      let run=[];const flush=()=>{
        if(run.length<2){run=[];return;}const p=[],uv=[],ix=[];
        run.forEach((x,i)=>{const w=Math.max(.01,hullHalfWidthAt(x,2.4)-.08),a=Math.max(-w,z),b=Math.min(w,z+.242),dy=v=>y-(y===2.4?.12:.035)*(v/Math.max(.1,w))**2;
          p.push(x,dy(a),a,x,dy(b),b);uv.push(a/2,x/4,b/2,x/4);if(i<run.length-1){const k=i*2;ix.push(k,k+1,k+2,k+2,k+1,k+3);}});
        const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();mesh(g,m.deckWood);
        const underside=g.clone().translate(0,-.06,0),indices=underside.index.array;for(let i=0;i<indices.length;i+=3){const k=indices[i+1];indices[i+1]=indices[i+2];indices[i+2]=k;}underside.computeVertexNormals();mesh(underside,m.weathered);run=[];
      };
      for(let x=x0;x<=x1+.001;x+=.1){const w=hullHalfWidthAt(x,2.4)-.08,blocked=Math.max(z,-w)>=Math.min(z+.242,w)||holes.some(h=>Math.abs(x-h.x)<h.l/2+.025&&z+.245>h.z-h.w/2&&z<h.z+h.w/2);if(blocked)flush();else run.push(x);}flush();
      for(let x=x0+(Math.round((z+4.1)/.245)%4)*1.08;x<x1;x+=4.32)if(Math.abs(z)<hullHalfWidthAt(x,2.4)-.2&&!holes.some(h=>Math.abs(x-h.x)<h.l/2+.1&&Math.abs(z-h.z)<h.w/2+.15))box([.003,.003,.24],[x,y-(y===2.4?.12*(z/4)**2:0)+.002,z+.12],m.tar);
    }
  }
  deck(-15.85,15.92,2.4,[{x:-4,z:.25,l:.8,w:1},{x:3,z:0,l:2,w:1.6}]);deck(-15.95,-8,4.55,[{x:-8.05,z:-1.4,l:.65,w:.96},{x:-8.05,z:1.4,l:.65,w:.96}]);deck(12,15.95,3.1);
  for(const s of [-1,1]){
    rope(Array.from({length:67},(_,i)=>{const x=-15.6+31.2*i/66;return[x,2.3,s*(hullHalfWidthAt(x,2.4)-.13)];}),.06,m.darkWood);
    for(const x of [-6,-3,0,3,6,9]){const z=s*(hullHalfWidthAt(x,2.4)-.07);box([.11,.045,.17],[x,2.31,z],m.tar);box([.15,.012,.21],[x,2.335,z],m.iron);}
  }
  function wallPlank(side,x0,x1,y0,y1,mat=m.weathered){
    const p=[],uv=[],ix=[],n=Math.max(2,Math.ceil((x1-x0)*4));
    for(let i=0;i<=n;i++){
      const x=x0+(x1-x0)*i/n,z=side*(hullHalfWidthAt(x,2.4)-.045);
      // Four section vertices: exterior lower/upper, inner lower/upper, with genuine end grain.
      for(const[d,y]of [[0,y0],[0,y1],[-side*.14,y0],[-side*.14,y1]]){p.push(x,y,z+d);uv.push(y/2,x/4);}
      if(i<n){const a=i*4,b=a+4;ix.push(a,b,a+1,b,b+1,a+1,a+2,a+3,b+2,a+3,b+3,b+2,a+1,b+1,a+3,b+1,b+3,a+3,a,a+2,b,a+2,b+2,b);}
    }
    ix.push(0,1,2,1,3,2,n*4,n*4+2,n*4+1,n*4+1,n*4+2,n*4+3);
    if(side<0)for(let i=0;i<ix.length;i+=3){const t=ix[i+1];ix[i+1]=ix[i+2];ix[i+2]=t;}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();mesh(g,mat);
  }
  function bulwark(side,x0,x1,y){
    const access=side===1?SHROUD_GEOMETRY.filter(g=>(g.index===2?4.55:2.4)===y).map(g=>g.path.entry[0]):[];
    const inAccess=x=>access.some(center=>Math.abs(x-center)<.58);
    const cuts=[x0,x1,...access.flatMap(x=>[x-.58,x+.58]),...(y===2.4?GUN_X.flatMap(g=>[g-.425,g+.425]):[]),...(side===-1&&y===2.4?[-.05,1.25]:[])].filter(x=>x>=x0&&x<=x1).sort((a,b)=>a-b);
    for(let i=0;i<cuts.length-1;i++){
      const a=cuts[i],b=cuts[i+1],mid=(a+b)/2;if(inAccess(mid)||(side===-1&&y===2.4&&mid>-.05&&mid<1.25))continue;
      const maxY=y===2.4&&GUN_X.some(g=>Math.abs(mid-g)<.425)?2.75:y+.98;
      for(let yy=y-.1;yy<maxY-.005;yy+=.245)wallPlank(side,a,b,yy,Math.min(maxY,yy+.242));
    }
    for(let x=x0+.24;x<x1;x+=.75){if(inAccess(x)||(y===2.4&&GUN_X.some(g=>Math.abs(x-g)<.49))||(side===-1&&Math.abs(x-.6)<.8))continue;const z=side*(hullHalfWidthAt(x,2.4)-.17);box([.11,.94,.15],[x,y+.43,z],m.darkWood);box([.19,.09,.24],[x,y+.06,z],m.darkWood);}
    const p=Array.from({length:65},(_,i)=>{const x=x0+(x1-x0)*i/64;return[x,y+1,side*(hullHalfWidthAt(x,2.4)-.045)];});
    let run=[];for(const point of p){if(inAccess(point[0])||(side===-1&&y===2.4&&point[0]>-.15&&point[0]<1.35)){if(run.length>1)rope(run,.075,m.deckWood);run=[];}else run.push(point);}if(run.length>1)rope(run,.075,m.deckWood);
  }
  for(const s of [-1,1]){bulwark(s,-8,12,2.4);bulwark(s,-15.95,-8,4.55);bulwark(s,12,15.6,3.1);}
  for(const s of [-1,1]){
    const z=s*1.4;
    // The landing follows the last tread's height; a flat plug would catch descending feet.
    const landing=new THREE.BufferGeometry();landing.setAttribute('position',new THREE.Float32BufferAttribute([ -8.5,4.55,z-.60,-8.5,4.55,z+.60,-8.15,4.55,z-.60,-8.15,4.55,z+.60,-7.78,4.20,z-.60,-7.78,4.20,z+.60 ],3));landing.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,.5,1,.5,0,1,1,1],2));landing.setIndex([0,1,2,2,1,3,2,3,4,4,3,5]);landing.computeVertexNormals();mesh(landing,m.deckWood);
    for(let i=0;i<10;i++)box([.30,.08,.86],[-6.02-i*.22,2.4+(i+1)*.215,z],m.deckWood);
    for(const dz of [-.45,.45]){pole([-5.85,2.35,z+dz],[-8.12,4.58,z+dz],.072,m.darkWood);pole([-5.85,3.22,z+dz],[-8.12,5.36,z+dz],.034,m.rope);}
    for(let yy=2.4;yy<4.55;yy+=.245){
      const top=Math.min(4.55,yy+.242);
      if(top<3.25||yy>3.96)wallPlank(s,-15.78,-8.0,yy,top);
      else{wallPlank(s,-15.78,-13.22,yy,top);wallPlank(s,-12.58,-8,yy,top);if(yy<3.25)wallPlank(s,-13.22,-12.58,yy,3.25);if(top>3.96)wallPlank(s,-13.22,-12.58,3.96,top);}
    }
    const wz=s*(hullHalfWidthAt(-12.9,2.4)-.06);box([.56,.64,.025],[-12.9,3.59,wz],m.glass);
    for(const dx of [-.32,0,.32])box([.044,.74,.085],[-12.9+dx,3.59,wz+s*.014],m.red);for(const dy of [-.36,0,.36])box([.68,.044,.085],[-12.9,3.59+dy,wz+s*.014],m.red);
    for(let i=0;i<4;i++)box([.30,.075,.8],[11.12+i*.24,2.4+(i+1)*.175,s*.75],m.deckWood);
  }
  for(const s of [-1,1]){
    box([.14,1.8,2.63],[-8,3.295,s*1.74],m.weathered);
    for(const [z,w]of [[.6725,.495],[2.4675,1.175]])box([.14,.33,w],[-8,4.36,s*z],m.weathered);
  }
  box([.16,.39,.86],[-8,4.36,0],m.darkWood);for(const z of [-.45,.45])box([.23,1.79,.12],[-7.98,3.28,z],m.darkWood);
  // The transom has five divided glass windows and a shallow, supported stern gallery.
  box([.15,.62,4.18],[-15.99,2.7,0],m.weathered);box([.15,.51,4.2],[-16.02,4.30,0],m.red);
  for(const z of [-2.07,-1.85,-1.11,-.37,.37,1.11,1.85,2.07])box([.18,1.12,.15],[-16.02,3.52,z],m.red);
  for(const z of [-1.48,-.74,0,.74,1.48]){box([.026,.63,.48],[-16.08,3.60,z],m.glass);for(const dz of [-.26,0,.26])box([.075,.73,.027],[-16.12,3.60,z+dz],m.deckWood);for(const dy of [-.34,0,.34])box([.075,.027,.55],[-16.12,3.60+dy,z],m.deckWood);box([.21,.07,.69],[-16.09,3.23,z],m.darkWood);}
  box([.9,.12,4.6],[-16.22,4.52,0],m.darkWood);
  for(const z of [-2.1,-1.35,-.6,.15,.9,1.65,2.1]){pole([-16.58,4.55,z],[-16.58,5.28,z],.035,m.deckWood);rope([[-15.83,3.84,z],[-16.20,3.89,z],[-16.58,4.42,z]],.08,m.darkWood);}
  pole([-16.58,5.28,-2.14],[-16.58,5.28,2.14],.07,m.deckWood);box([.1,.29,2.3],[-16.2,4.29,0],m.darkWood);
  if(typeof document!=='undefined'){
    const c=document.createElement('canvas');c.width=768;c.height=160;const ctx=c.getContext('2d');ctx.fillStyle='#c0a878';ctx.font='58px Georgia';ctx.textAlign='center';ctx.fillText('THE BLACK TIDE',384,105);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
    const mat=new THREE.MeshStandardMaterial({map:t,transparent:true,alphaTest:.1,roughness:.9,side:THREE.DoubleSide});mesh(new THREE.PlaneGeometry(2.22,.46),mat,[-16.26,4.27,0]).rotation.y=-Math.PI/2;
  }
  for(const s of [-1,1])rope([[-16.12,4.05,s*1.33],[-16.18,4.09,s*1.7],[-16.16,4.24,s*1.91],[-16.14,4.41,s*1.72]],.025,m.deckWood);
  const rudder=new THREE.Group();rudder.name='working-rudder';rudder.position.set(-16.15,-.3,0);ship.add(rudder);
  slab([[0,1.15],[-.48,.9],[-.84,-2.12],[-.4,-2.8],[.08,-2.78],[.12,1.15]],.15,m.underwater,[0,0,-.075],rudder,.015);pole([0,1.05,0],[0,3.2,0],.08,m.darkWood,.075,rudder);
  for(const y of [-2.2,-.9,.4]){box([.5,.08,.22],[-.2,y,0],m.iron,rudder);ring([-16.10,y-.3,0],.12,.032,m.iron,staticParts,'y');}pole([-.1,3.17,0],[1.6,3.17,0],.065,m.darkWood,.1,rudder);
  // A barrel's lathe profile returns along the bore, making a true opening rather than a black cap.
  function cannon(x,s,index){
    const edge=hullHalfWidthAt(x,2.4),z=s*(edge-.98),y=mainDeckHeight(x,z),g=new THREE.Group();g.position.set(x,y,z);g.name=`gun-${s}-${index}`;staticParts.add(g);
    for(const dx of [-.36,.36]){const o=slab([[-.65,.19],[.65,.19],[.65,.52],[.36,.61],[.36,.72],[-.3,.72],[-.3,.48],[-.65,.40]],.13,m.red,[dx-.065,0,-.05],g);o.rotation.y=Math.PI/2;
      for(const zz of [-.41,.46]){pole([dx-.11,.18,zz],[dx+.11,.18,zz],.145,m.deckWood,.145,g);pole([dx-.13,.18,zz],[dx+.13,.18,zz],.033,m.iron,.033,g);}}
    for(const zz of [-.41,.46])pole([-.53,.19,zz],[.53,.19,zz],.043,m.darkWood,.043,g);
    box([.83,.14,.95],[0,.26,0],m.darkWood,g);
    const profile=[[.025,-1.02],[.09,-.95],[.16,-.81],[.17,-.7],[.145,-.62],[.14,-.50],[.115,.30],[.10,.73],[.12,.76],[.12,.84],[.052,.84],[.043,.55],[0,.49]];
    const barrel=mesh(new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),24),m.iron,[0,.91,s*.32],g,'bored-cannon-barrel');barrel.rotation.x=s*Math.PI/2;
    pole([-.49,.86,-s*.30],[.49,.86,-s*.30],.07,m.iron,.07,g);
    for(const dx of [-.4,.4]){box([.14,.10,.19],[dx,.87,-s*.3],m.iron,g);ring([dx,.86,-s*.3],.073,.018,m.iron,g);}
    const wedge=slab([[-.17,0],[.17,0],[.17,.12],[-.17,.03]],.24,m.deckWood,[-.17,.62,-s*.55],g);wedge.rotation.y=Math.PI/2;
    ring([0,.88,-s*.79],.075,.018,m.iron,g);
    rope([[-.62,.46,s*.75],[-.70,.23,-s*.24],[0,.83,-s*.83],[.70,.23,-s*.24],[.62,.46,s*.75]],.032,m.rope,g);
    for(const dx of [-.60,.60]){ring([dx,.47,s*.8],.055,.015,m.iron,g,'z');block([dx,.39,s*.25],.18,g);rope([[dx,.44,s*.78],[dx,.35,s*.24],[dx*.7,.35,-s*.48]],.013,m.rope,g);}
    box([.47,.07,.17],[.77,.07,-.33],m.darkWood,g);for(let i=0;i<4;i++)mesh(new THREE.SphereGeometry(.039,8,6),m.iron,[.61+i*.09,.12,-.33],g);
    pole([-.79,.17,-.62],[-.79,.17,.75],.017,m.weathered,.017,g);mesh(new THREE.SphereGeometry(.046,7,5),m.patch,[-.79,.17,.74],g).scale.set(.8,.8,1.6);coil([.79,.05,.45],.14,4,g);
    const pz=s*(edge-.035);for(const dx of [-.45,.45])box([.1,.81,.21],[x+dx,3.09,pz],m.darkWood);for(const dy of [-.29,.52])box([.92,.1,.21],[x,2.97+dy,pz],m.darkWood);
    const port=new THREE.Group();port.name=`gunport-${s}-${index}`;port.position.set(x,3.50,pz);ship.add(port);
    box([.80,.07,.76],[0,.035,s*.37],m.red,port);for(const dx of [-.29,.29]){box([.08,.035,.69],[dx,.082,s*.37],m.darkWood,port);box([.08,.035,.22],[dx,.082,s*.06],m.iron,port);rope([[x+dx,3.47,pz],[x+dx,3.76,pz+s*.4],[x+dx,3.63,pz+s*.7]],.009);}
    port.rotation.x=-s*.19;gunPorts.push(port);
  }
  for(const s of [-1,1])GUN_X.forEach((x,i)=>cannon(x,s,i));
  function coaming(x,z,l,w){for(const dx of [-l/2,l/2])box([.11,.25,w+.22],[x+dx,2.50,z],m.darkWood);for(const dz of [-w/2,w/2])box([l,.25,.11],[x,2.50,z+dz],m.darkWood);}
  coaming(-4,.25,.8,1);coaming(3,0,2,1.6);
  const hatchLid=new THREE.Group();hatchLid.name='working-hatch';hatchLid.position.set(-4,2.65,-.28);ship.add(hatchLid);
  for(let i=0;i<4;i++)box([.195,.065,1.05],[-.3+i*.2,0,.525],m.deckWood,hatchLid);for(const z of [.12,.9])box([.76,.045,.1],[0,-.04,z],m.darkWood,hatchLid);for(const x of [-.25,.25])box([.1,.04,.22],[x,.02,.1],m.iron,hatchLid);ring([0,.058,.86],.065,.011,m.iron,hatchLid,'y');
  const cargoGrating=new THREE.Group();cargoGrating.name='cargo-grating';cargoGrating.position.set(3,2.66,0);ship.add(cargoGrating);for(let x=-.9;x<=.91;x+=.18)box([.062,.055,1.5],[x,0,0],m.weathered,cargoGrating);for(let z=-.68;z<=.69;z+=.17)box([1.9,.045,.054],[0,-.04,z],m.darkWood,cargoGrating);
  for(const s of [-1,1]){pinRack(-1,s*1.35);pinRack(7.5,s*1.14);const x=-1.65,z=s*.73;pole([x,-2.35,z],[x,3.1,z],.065,m.darkWood,.085);ring([x,2.76,z],.084,.017,m.iron,staticParts,'y');pole([x,3.06,z],[x+.35,3.30,z],.028,m.iron,.018);pole([x+.27,3.32,z],[x+.55,3.32,z],.022,m.deckWood);rope([[x,2.72,z],[x,2.69,s*1.1],[x-.05,2.40,s*3.7]],.037,m.darkWood);}
  // Open fore grating, curved head rails and a wooden wolf with carved cheek and jaw planes.
  for(const s of [-1,1]){for(const dy of [0,.38])rope([[13.8,3.25+dy,s*1.4],[15.7,3.38+dy,s*.94],[17.2,3.2+dy,s*.42]],.06,m.darkWood);pole([14.2,2.4,s*1.2],[16.9,3.15,s*.4],.07,m.darkWood,.045);}
  for(let x=14.1;x<16.8;x+=.24){const w=Math.max(.27,1.5-(x-14.1)*.45);box([.073,.085,w*2],[x,3.18,0],m.weathered);}
  const figure=new THREE.Group();figure.position.set(16.42,3.38,0);figure.rotation.z=.28;figure.name='carved-wolf-figurehead';staticParts.add(figure);
  pole([-.68,-.34,0],[.25,.07,0],.25,m.darkWood,.17,figure);
  slab([[-.33,-.06],[.23,-.04],[.66,.08],[.63,.22],[.22,.36],[-.14,.43],[-.34,.30]],.34,m.weathered,[0,0,-.17],figure,.035);slab([[.11,-.06],[.58,-.025],[.66,.055],[.30,.11]],.24,m.darkWood,[0,-.05,-.12],figure,.025);
  for(const s of [-1,1]){slab([[-.20,.26],[-.25,.60],[-.08,.50],[.045,.30]],.055,m.weathered,[0,0,s*.14],figure,.012);rope([[-.30,.23,s*.18],[-.08,.25,s*.205],[.18,.17,s*.19]],.026,m.darkWood,figure);mesh(new THREE.SphereGeometry(.025,6,4),m.tar,[.16,.22,s*.179],figure);slab([[.31,.06],[.35,-.045],[.39,.055]],.025,m.bone,[0,0,s*.125],figure,0);}box([.085,.11,.20],[.64,.18,0],m.darkWood,figure).rotation.z=-.16;
  const anchors=[],cables=[];
  function buildAnchor(parent){pole([0,-1.06,0],[0,1.10,0],.075,m.iron,.10,parent);ring([0,1.28,0],.16,.037,m.iron,parent,'z');pole([0,.62,-.95],[0,.62,.95],.1,m.darkWood,.1,parent);for(const z of [-.70,-.15,.15,.70])ring([0,.62,z],.11,.021,m.iron,parent,'z');rope([[-.84,-.52,0],[-.65,-.99,0],[0,-1.21,0],[.65,-.99,0],[.84,-.52,0]],.072,m.iron,parent,24);for(const s of [-1,1])slab([[s*.57,-.83],[s*.94,-.48],[s*.93,-.89],[s*.68,-1.02]],.1,m.iron,[0,0,-.05],parent,.012);}
  for(const s of [-1,1]){
    const a=new THREE.Group();a.name=s>0?'dropped-anchor':'port-stock-anchor';ship.add(a);buildAnchor(a);anchors.push(a);
    const x=13.6,z=s*(hullHalfWidthAt(x,2.4)+1.28);pole([x,3.30,s*.9],[x+.22,3.75,z],.12,m.darkWood,.11);pole([x,2.75,s*1.0],[x+.08,3.65,z-.2*s],.072,m.darkWood,.085);block([x+.2,3.53,z],.33);rope([[x+.2,3.56,z],[x,3,z],[x-.5,3.1,s*1.02]],.025);
    const hz=s*(hullHalfWidthAt(14.2,1.48)+.08);ring([14.2,1.5,hz],.16,.045,m.darkWood,staticParts,'z');ring([14.2,1.5,hz+s*.02],.11,.018,m.tarRope,staticParts,'z');
    const g=new THREE.BufferGeometry(),p=new Float32Array(53*6*3),uv=new Float32Array(53*6*2),ix=[];for(let i=0;i<=52;i++)for(let j=0;j<6;j++){uv[(i*6+j)*2]=j/6;uv[(i*6+j)*2+1]=i/4;if(i<52){const a=i*6+j,b=i*6+(j+1)%6;ix.push(a,a+6,b,b,a+6,b+6);}}
    g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.setIndex(ix);const cable=mesh(g,m.tarRope,[0,0,0],ship,'retractable-hemp-anchor-cable');cable.frustumCulled=false;cables.push(cable);
    rope([[14.2,1.5,hz],[13.4,2.83,s*.79],[10.3,2.72,s*.75],[9,2.98,s*.45]],.052,m.tarRope);coil([11.2,2.43,s*1.3],.32,7);
  }
  function setAnchorLift(lift){anchors.forEach((a,k)=>{const s=k===0?-1:1,t=s>0?lift:1;a.position.lerpVectors(new THREE.Vector3(14.7,-5.8,s*3.45),new THREE.Vector3(13.8,.72,s*3.03),t);a.rotation.z=t*-.23;
    const curve=new THREE.CatmullRomCurve3([[14.2,1.5,s*(hullHalfWidthAt(14.2,1.5)+.09)],[14.7,.9,s*2.7],[a.position.x-.15,a.position.y+2,a.position.z],[a.position.x,a.position.y+1.28,a.position.z]].map(V)),g=cables[k].geometry,p=g.attributes.position;
    for(let i=0;i<=52;i++){const pt=curve.getPoint(i/52),tangent=curve.getTangent(i/52),normal=new THREE.Vector3(0,0,1).cross(tangent).normalize(),binormal=tangent.clone().cross(normal).normalize();for(let j=0;j<6;j++){const angle=j*Math.PI/3,q=pt.clone().addScaledVector(normal,Math.cos(angle)*.052).addScaledVector(binormal,Math.sin(angle)*.052);p.setXYZ(i*6+j,q.x,q.y,q.z);}}p.needsUpdate=true;g.computeVertexNormals();});}
  setAnchorLift(0);
  const windlass=new THREE.Group();windlass.name='horizontal-wood-windlass';windlass.position.set(9,2.4,0);ship.add(windlass);
  for(const z of [-1.14,1.14]){slab([[-.36,0],[.36,0],[.25,.94],[-.25,.94]],.21,m.darkWood,[0,0,z-.105],windlass);box([.94,.12,.50],[0,.04,z],m.darkWood,windlass);}
  const windlassDrum=new THREE.Group();windlassDrum.name='turning-windlass-drum';windlassDrum.position.y=.71;windlass.add(windlassDrum);
  pole([0,0,-1.20],[0,0,1.20],.265,m.weathered,.265,windlassDrum,16);for(const z of [-.93,-.45,.45,.93])ring([0,0,z],.28,.027,m.iron,windlassDrum,'z');
  for(const z of [-.59,.59])for(let i=0;i<4;i++){const a=i*Math.PI/2;box([.064,.012,.12],[Math.sin(a)*.267,Math.cos(a)*.267,z],m.tar,windlassDrum).rotation.z=-a;}
  for(let i=0;i<4;i++){const bar=new THREE.Group();bar.position.set(0,.71,i<2?-.59:.59);windlass.add(bar);pole([0,-.13,0],[0,1.3,0],.042,m.deckWood,.027,bar);bar.rotation.z=i*Math.PI/2;bar.name='windlass-handspike';capstanBars.push(bar);}
  const capstanBrake=new THREE.Group();capstanBrake.position.set(.24,.59,1.18);windlass.add(capstanBrake);box([.1,.59,.09],[0,.16,0],m.iron,capstanBrake);box([.2,.08,.12],[0,.47,0],m.deckWood,capstanBrake);
  for(let i=0;i<12;i++){const a=i*Math.PI/6;box([.06,.08,.08],[Math.cos(a)*.29,Math.sin(a)*.29,1.03],m.iron,windlassDrum).rotation.z=a;}
  for(const s of [-1,1])pole([11.1,2.4,s*.31],[11.1,3.39,s*.31],.05,m.darkWood);pole([11.1,3.39,-.35],[11.1,3.39,.35],.06,m.darkWood);mesh(new THREE.LatheGeometry([[.045,.22],[.06,.13],[.12,.02],[.13,0]].map(p=>new THREE.Vector2(...p)),16),m.brass,[11.1,3.03,0]);rope([[11.1,3.07,0],[11.1,2.68,.02]],.014);
  const wheel=new THREE.Group();wheel.name='ship-wheel';wheel.position.set(-12,5.60,0);ship.add(wheel);ring([0,0,0],.53,.045,m.deckWood,wheel);ring([0,0,0],.47,.018,m.darkWood,wheel);
  for(let i=0;i<8;i++){const a=i*Math.PI/4,dy=Math.cos(a),dz=Math.sin(a);pole([0,dy*.10,dz*.10],[0,dy*.67,dz*.67],.021,m.deckWood,.03,wheel);mesh(new THREE.SphereGeometry(.037,8,6),m.deckWood,[0,dy*.65,dz*.65],wheel);}
  pole([-.15,0,0],[.16,0,0],.105,m.darkWood,.105,wheel);
  for(const x of [-12.09,-11.70]){box([.16,.91,.17],[x,5.01,0],m.darkWood);box([.44,.09,.4],[x,4.57,0],m.darkWood);}pole([-.12,0,0],[.46,0,0],.18,m.weathered,.18,wheel);
  for(let i=0;i<6;i++)ring([.30+i*.045,0,0],.19,.018,m.rope,wheel);
  for(const s of [-1,1]){
    rope([[-11.55,5.58,s*.17],[-11.3,4.69,s*.44],[-11.3,4.35,s*.44],[-11.3,4.20,s*2.55],[-13,4.20,s*2.42],[-15.2,4.20,s*2.0],[-15.85,4.20,s*1.8],[-15.85,2.87,s*1.8],[-14.55,2.87,s*.08]],.026);
    for(const pos of [[-11.3,4.3,s*.44],[-11.3,4.2,s*2.55],[-13,4.2,s*2.42],[-15.2,4.2,s*2.0],[-15.85,4.2,s*1.8],[-15.85,2.87,s*1.8]]){block(pos,.17);ring(pos,.041,.008,m.iron,staticParts,'x');}
  }
  const binnacle=new THREE.Group();binnacle.name='gimballed-compass-binnacle';binnacle.position.set(-11.02,4.55,0);staticParts.add(binnacle);box([.73,.9,.46],[0,.45,0],m.weathered,binnacle);box([.8,.08,.53],[0,.05,0],m.darkWood,binnacle);box([.84,.06,.61],[0,.93,0],m.darkWood,binnacle);
  for(const s of [-1,1])box([.11,.19,.58],[s*.37,1.025,0],m.darkWood,binnacle);mesh(new THREE.CircleGeometry(.21,40),m.bone,[0,.982,0],binnacle).rotation.x=-Math.PI/2;ring([0,.995,0],.228,.014,m.brass,binnacle,'y');ring([0,1.001,0],.18,.007,m.brass,binnacle,'y');
  for(let i=0;i<32;i++){const a=i*Math.PI/16;box([i%4===0?.022:.009,.006,.027],[Math.sin(a)*.166,1.004,Math.cos(a)*.166],m.iron,binnacle).rotation.y=a;}
  const needle=slab([[0,.15],[-.038,0],[0,-.15],[.038,0]],.006,m.darkWood,[0,1.012,0],binnacle,0);needle.rotation.x=Math.PI/2;mesh(new THREE.SphereGeometry(.018,7,5),m.brass,[0,1.023,0],binnacle);
  function lantern(pos,name,point=false,size=.32){
    const g=new THREE.Group();g.name=name;g.position.set(...pos);ship.add(g);const w=size*.48;
    for(const dy of [0,size*.7])box([w,.022,w],[0,dy,0],m.iron,g);for(const x of [-w*.46,w*.46])for(const z of [-w*.46,w*.46])pole([x,0,z],[x,size*.7,z],.009,m.iron,.009,g);
    const glowMaterial=(m.lampGlass||m.glass).clone();box([w*.88,size*.63,w*.88],[0,size*.35,0],glowMaterial,g);mesh(new THREE.ConeGeometry(w*.82,size*.2,4),m.iron,[0,size*.79,0],g).rotation.y=Math.PI/4;ring([0,size*.94,0],size*.09,.01,m.iron,g,'z');mesh(new THREE.CylinderGeometry(w*.24,w*.27,size*.1,10),m.brass,[0,size*.14,0],g);
    const flame=mesh(new THREE.SphereGeometry(.015,8,6),m.flame,[0,size*.24,0],g);flame.scale.set(.54,1.4,.54);flame.castShadow=false;
    let light=null;if(point){light=new THREE.PointLight('#ffbd73',.65,3.3,2);light.position.set(0,size*.30,0);light.userData.base=.65;g.add(light);lamps.push(light);}lampFixtures.push({id:name,group:g,flame,light,on:true,room:'deck',position:pos,glowMaterial,phase:lampFixtures.length*1.73});return g;
  }
  for(const [pos,id]of [[[10.8,2.95,-1.45],'bow-work-lamp'],[[-4.6,3,-.36],'companion-upper-lamp'],[[-12.7,5.26,-1.4],'helm-lamp'],[[-16.55,5.39,0],'stern-navigation-lamp']]){pole([pos[0],pos[1]-.48,pos[2]],[pos[0],pos[1]+.30,pos[2]],.035,m.darkWood);lantern(pos,id,id==='companion-upper-lamp');}lantern([-11.28,5.49,.06],'binnacle-lamp',false,.18);
  const rig=buildRigging(ship,m);
  function batchDirect(group,keep=[]){
    const meshes=group.children.filter(o=>o.isMesh&&!keep.includes(o)),batches=new Map();
    if(meshes.length<2)return;
    for(const o of meshes){o.updateMatrix();let g=o.geometry.clone().applyMatrix4(o.matrix);if(g.index){const old=g;g=g.toNonIndexed();old.dispose();}if(!g.attributes.uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));for(const key of Object.keys(g.attributes))if(!['position','normal','uv'].includes(key))g.deleteAttribute(key);const list=batches.get(o.material)||[];list.push(g);batches.set(o.material,list);group.remove(o);o.geometry.dispose();}
    for(const[mat,gs]of batches){mesh(mergeGeometries(gs),mat,[0,0,0],group);gs.forEach(g=>g.dispose());}
  }
  [windlass,windlassDrum,wheel,...anchors,...gunPorts,...capstanBars].forEach(g=>batchDirect(g));
  lampFixtures.forEach(l=>batchDirect(l.group,[l.flame]));
  // Material batching keeps structural detail cheap. Mechanisms, doors, sails and lights retain pivots.
  staticParts.updateMatrixWorld(true);const batches=new Map();staticParts.traverse(o=>{if(!o.isMesh)return;let g=o.geometry.clone().applyMatrix4(o.matrixWorld);if(g.index){const old=g;g=g.toNonIndexed();old.dispose();}if(!g.attributes.uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));for(const key of Object.keys(g.attributes))if(!['position','normal','uv'].includes(key))g.deleteAttribute(key);const list=batches.get(o.material)||[];list.push(g);batches.set(o.material,list);});ship.remove(staticParts);
  for(const [mat,gs]of batches){const g=mergeGeometries(gs);if(!g)throw Error('Ship material batch failed');mesh(g,mat,[0,0,0],ship,'fittings');gs.forEach(g=>g.dispose());}staticParts.traverse(o=>{if(o.isMesh)o.geometry.dispose();});
  ship.userData.model={version:'brief-20261008',scale:1,hullLength:32,beam:8.5,draught:3.5,sailCount:rig.sails.length,gunCount:10,externalLamps:5,coordinates:'game=(-briefZ,briefY,briefX)'};
  return{ship,...rig,anchor:anchors[1],anchors,chain:cables[1],wheel,rudder,setAnchorLift,lamps,lampFixtures,hatchLid,cargoGrating,capstanBars,capstanBrake,windlassDrum,gunPorts,materials:m};
}
