import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildShip } from './ship.js';
import { buildShipInterior } from './ship-interior.js';
import { buildLifeboat } from './ship-boat.js';
import { HULL_WATERLINE_GLSL } from './ship-layout.js';

const container=document.querySelector('#viewer');
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<720?1.5:1.75));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;container.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#789197');scene.fog=new THREE.FogExp2('#789197',.0025);
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;scene.environmentIntensity=.50;room.dispose();pmrem.dispose();
const hemi=new THREE.HemisphereLight('#d7e5e5','#30352d',1.6);scene.add(hemi);
const sun=new THREE.DirectionalLight('#ffe0b8',2.3);sun.position.set(-25,46,26);sun.castShadow=true;sun.shadow.mapSize.set(innerWidth<720?1024:2048,innerWidth<720?1024:2048);Object.assign(sun.shadow.camera,{left:-32,right:32,top:36,bottom:-25,near:1,far:110});sun.shadow.normalBias=.035;sun.shadow.bias=-.00015;sun.target.position.set(0,9,0);scene.add(sun,sun.target);
const rim=new THREE.DirectionalLight('#94b6cd',.8);rim.position.set(18,17,-24);scene.add(rim);
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.05,500);camera.position.set(44,23,48);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,12,0);controls.enableDamping=true;controls.dampingFactor=.06;controls.minDistance=.5;controls.maxDistance=140;controls.maxPolarAngle=Math.PI*.88;controls.update();
const model=buildShip();scene.add(model.ship);
const interiors=buildShipInterior(model.ship,model.materials),boatModel=buildLifeboat(scene,model.ship,model.materials);
const fixtures=[...model.lampFixtures,...interiors.lampFixtures];
const practicalLights=interiors.lampFixtures.filter(f=>f.light).map(f=>f.light);
model.lampFixtures.forEach(f=>f.fixedLight=f.light);
interiors.lampFixtures.forEach(f=>f.light=null);
model.ship.userData.model={...model.ship.userData.model,hammocks:interiors.cabin.userData.hammockCount,waterBarrels:interiors.cabin.userData.waterBarrels,cellCount:interiors.cellDoors.length,lampCount:fixtures.length,boatLength:4.8};
const noiseGLSL=`float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}float fbm(vec2 p){return noise(p)*.57+noise(p*2.03+7.1)*.28+noise(p*4.17-3.2)*.15;}`;
const sky=new THREE.Mesh(new THREE.SphereGeometry(240,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{dark:{value:0}},vertexShader:'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec3 direction;uniform float dark;${noiseGLSL}
void main(){vec3 d=normalize(direction);vec3 c=mix(vec3(.53,.63,.63),vec3(.14,.30,.40),pow(clamp(d.y*1.9,0.,1.),.63));vec3 light=normalize(vec3(-25.,46.,26.));float glow=pow(max(dot(d,light),0.),18.);c+=vec3(.24,.13,.055)*glow;vec2 p=d.xz/(d.y+.27);float clouds=smoothstep(.48,.74,fbm(p*2.2));float band=smoothstep(.03,.22,d.y)*(1.-smoothstep(.55,.82,d.y));c=mix(c,vec3(.75,.77,.72),clouds*band*.50);c=mix(c,vec3(.024,.045,.073)+c*.13,dark);gl_FragColor=vec4(c,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`}));sky.renderOrder=-2;scene.add(sky);
const sea=new THREE.Mesh(new THREE.PlaneGeometry(500,500,128,128),new THREE.ShaderMaterial({uniforms:{time:{value:0},dark:{value:0},light:{value:sun.position.clone().normalize()}},vertexShader:`uniform float time;varying vec3 wp;void main(){vec3 p=position;p.z=sin(p.x*.38+p.y*.21+time*.6)*.045+sin(p.x*-.22+p.y*.49-time*.4)*.035;wp=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.);}`,fragmentShader:`varying vec3 wp;uniform float time;uniform float dark;uniform vec3 light;${noiseGLSL}
${HULL_WATERLINE_GLSL}
void main(){vec2 p=wp.xz;if(abs(p.y)<shipWaterlineWidth(p.x)-.04)discard;float a=p.x*.38+p.y*.21+time*.6,b=p.x*-.22+p.y*.49-time*.4;float fine=noise(p*2.7+vec2(time*.09,-time*.05));vec3 n=normalize(vec3(-cos(a)*.05+cos(b)*.025+(fine-.5)*.10,1.,-cos(a)*.026-cos(b)*.045+(noise(p*4.1-time*.07)-.5)*.09));vec3 v=normalize(cameraPosition-wp);float fresnel=pow(1.-max(dot(n,v),0.),4.);vec3 c=mix(vec3(.024,.106,.122),vec3(.055,.184,.196),fbm(p*.15));c=mix(c,vec3(.33,.45,.47),fresnel*.75);float spark=pow(max(dot(reflect(-light,n),v),0.),150.);c+=vec3(.9,.68,.40)*spark*.62;float contact=exp(-pow(p.x/15.8,6.)-pow(p.y/4.5,4.));c*=1.-contact*.43;c=mix(c,vec3(.25,.36,.39),1.-exp(-length(cameraPosition-wp)*.0025));c*=1.-dark*.81;gl_FragColor=vec4(c,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`}));
sea.rotation.x=-Math.PI/2;sea.position.y=.02;sea.receiveShadow=true;scene.add(sea);
// The viewer uses the same actual ship; interiors are attached once the builders are available.
let view='exterior',night=false,elapsed=0,fullSails=false;
const viewConfig={
  exterior:{position:[44,23,48],target:[0,12,0],title:'风与盐留下的形状',description:'拖动旋转，滚轮靠近。观察尖首、圆舭、三桅帆装与外挑艉台。'},
  stern:{position:[-27,8,12],target:[-13,4,0],title:'船艉的五扇小窗',description:'小格玻璃、旧漆木框与承托艉台。船舵连到水下舵叶。'},
  deck:{position:[6,6.9,7.4],target:[-2.6,3.0,0],title:'有秩序的工作甲板',description:'木炮架、索销、粗麻缆与木绞车，各有自己的位置。'},
  captain:{position:[-9.2,3.8,1.55],target:[-12.2,3.28,.1],title:'船长室',description:'固定海图桌、窄床、旧书与淡绿艉窗；光落在有人使用过的物件上。'},
  lower:{position:[-4.9,1.65,0],target:[-8.6,1.1,0],title:'水手住舱与四间牢房',description:'弧形船侧、低矮木梁、粗布吊床。中间留出通往铁栏门的窄走廊。'},
  hold:{position:[.2,-.48,1.3],target:[4.4,-1.14,.4],title:'水线下的储备',description:'淡水桶、粮袋与固定货箱。桅脚、泵管和内龙骨贯穿其中。'},
  crew:{position:[6.7,1.62,.35],target:[2.1,1.05,1.4],title:'航海人的住处',description:'粗布吊床挂在横梁下，个人海箱、淡水桶与折叠桌留出中央通路。'},
  galley:{position:[8.5,1.75,.1],target:[10.4,1.1,-.65],title:'厨房与修补工具',description:'烟道穿过甲板。炉边有锅具，工具与备用绳留在各自的固定处。'},
  boat:{position:[-7,5.65,-8.3],target:[-11,2.73,-4.6],title:'随船的小木艇',description:'搭接艇板、弧形肋、三块座板和五支桨；两吊点把艇稳稳吊在左舷。'},
};
function setView(name){
  const c=viewConfig[name];if(!c)throw Error(`Unknown ship view: ${name}`);view=name;
  camera.position.set(...c.position);controls.target.set(...c.target);controls.update();
  document.querySelector('#view-title').textContent=c.title;document.querySelector('#view-description').textContent=c.description;
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));
  const inside=['captain','lower','hold','crew','galley'].includes(name);scene.fog.density=inside?0:.0025;controls.minDistance=inside?.15:.5;
  interiors.cabin.visible=inside&&name!=='captain'||name==='deck';interiors.cargo.visible=interiors.cabin.visible;
  model.hatchLid.rotation.x=name==='lower'||name==='deck'?-1.42:0;
  model.cargoGrating.position.z=name==='hold'?1.9:0;model.cargoGrating.position.y=name==='hold'?3:2.66;
  interiors.cabinDoor.rotation.y=name==='captain'?-1.35:0;
  updateLighting();
  return{state:name};
}
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>setView(button.dataset.view));
function updateLighting(){
  const inside=['captain','lower','hold','crew','galley'].includes(view);
  hemi.intensity=night?.19:inside?.35:1.6;sun.intensity=night?.10:2.3;rim.intensity=night?.10:inside?.13:.8;scene.environmentIntensity=night?.07:inside?.13:.50;
  const room=view==='captain'?'captain':view==='hold'?'hold':'lower';
  const workId={hold:'cargo-work',lower:'brig-end',crew:'crew-passage',galley:'galley'}[view];
  for(const f of fixtures){f.light=f.fixedLight||null;f.previewOn=f.on||f.id===workId;}
  const candidates=interiors.lampFixtures.filter(f=>inside&&f.room===room&&f.previewOn).sort((a,b)=>new THREE.Vector3(...a.position).distanceTo(camera.position)-new THREE.Vector3(...b.position).distanceTo(camera.position));
  practicalLights.forEach((light,i)=>{const f=candidates[i];light.visible=Boolean(f);if(f){f.group.add(light);light.position.set(0,f.type==='table'?.13:0,0);f.light=light;}});
}
function setFullSails(value){fullSails=Boolean(value);for(const i of [0,3])model.setSailFurl(i,fullSails?1:.06);document.querySelector('#sails').setAttribute('aria-pressed',String(fullSails));document.querySelector('#sails').textContent=fullSails?'收起下帆':'展开下帆';}
document.querySelector('#sails').addEventListener('click',()=>setFullSails(!fullSails));
document.querySelector('#night').addEventListener('click',()=>{night=!night;document.querySelector('#night').setAttribute('aria-pressed',String(night));scene.background.set(night?'#182c37':'#789197');scene.fog.color.copy(scene.background);updateLighting();sea.material.uniforms.dark.value=sky.material.uniforms.dark.value=night?1:0;});
document.querySelector('#underwater').addEventListener('click',()=>{sea.visible=!sea.visible;document.querySelector('#underwater').setAttribute('aria-pressed',String(!sea.visible));});
document.querySelector('#export').addEventListener('click',async()=>{
  const button=document.querySelector('#export');button.disabled=true;button.textContent='正在导出…';
  const metadata=model.ship.userData;model.ship.userData={model:metadata.model};
  try{
    const assembly=new THREE.Group();assembly.name='Black Tide Complete Model';assembly.add(model.ship.clone(true),boatModel.boat.clone(true));
    // glTF matrix decomposition needs invertible transforms, including hidden spare canvas.
    assembly.traverse(object=>{for(const axis of ['x','y','z'])if(object.scale[axis]===0)object.scale[axis]=1e-6;object.updateMatrix();});
    const glb=await new GLTFExporter().parseAsync(assembly,{binary:true,onlyVisible:false});
    const url=URL.createObjectURL(new Blob([glb],{type:'model/gltf-binary'})),link=document.createElement('a');link.href=url;link.download='黑潮号.glb';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }catch(error){document.querySelector('#status').textContent='导出失败，请刷新后重试。';console.error(error);}finally{model.ship.userData=metadata;button.disabled=false;button.textContent='导出 GLB';}
});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<720?1.5:1.75));});
let paused=false,frameTime=16.7;const clock=new THREE.Clock();
renderer.setAnimationLoop(()=>{
  const raw=clock.getDelta(),dt=Math.min(.05,raw);frameTime+=(Math.min(250,raw*1000)-frameTime)*.08;if(!paused)elapsed+=dt;controls.update();sea.material.uniforms.time.value=elapsed;
  model.animateSails(elapsed,.75);
  for(const{mesh,rest}of model.flags){const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setZ(i,rest[i*3+2]+Math.sin(rest[i*3]*3.3+elapsed*2.1)*.04*Math.abs(rest[i*3]));p.needsUpdate=true;}
  for(const f of fixtures){const flicker=1+Math.sin(elapsed*7.3+f.phase)*.07+Math.sin(elapsed*11.9+f.phase*2)*.04,on=f.previewOn;if(f.flame)f.flame.visible=on;if(f.glowMaterial)f.glowMaterial.emissiveIntensity=on?.28*flicker:0;if(f.light)f.light.intensity=(on?1.25:0)*flicker;}
  renderer.render(scene,camera);document.querySelector('#status').textContent='';
});
if(new URLSearchParams(location.search).has('qa')){
  window.__THREE_GAME_DIAGNOSTICS__={renderer:{get calls(){return renderer.info.render.calls;},get triangles(){return renderer.info.render.triangles;},get geometries(){return renderer.info.memory.geometries;},get textures(){return renderer.info.memory.textures;}},get state(){return{mode:view,frameTimeMs:Math.round(frameTime*10)/10,model:model.ship.userData.model};},get quality(){return{dpr:renderer.getPixelRatio(),postPasses:0,shadowMap:sun.shadow.mapSize.x,shadowLights:1};}};
  window.__THREE_GAME_TEST_HOOKS__={setState:setView,setFullSails,setPausedForScreenshot(value){paused=Boolean(value);},inspect(){return{...model.ship.userData.model,rigging:model.staticRigging.userData.componentCounts};}};
}
setView('exterior');
