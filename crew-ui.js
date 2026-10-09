import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {MASTS} from './ship-layout.js';

export function createCrewCommandPanel({ship,sails,crew,getGame,onCommand,onNotice}) {
  const dialog=document.querySelector('#crew-panel'),stage=document.querySelector('#crew-model'),labels=document.querySelector('#crew-labels');
  function notice(message){document.querySelector('#crew-notice').textContent=message;onNotice(message);}
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;stage.prepend(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.1,200),controls=new OrbitControls(camera,renderer.domElement);
  camera.position.set(8,25,61);controls.target.set(0,9,0);controls.minDistance=28;controls.maxDistance=85;controls.enablePan=false;controls.update();
  scene.add(new THREE.HemisphereLight('#e9f6ff','#54412a',2.5));const sun=new THREE.DirectionalLight('#ffeac7',3);sun.position.set(15,30,20);scene.add(sun);
  const copies=new Map(),materials=new Map();
  function copy(object){
    if(object.isLight)return null;
    let node;if(object.isMesh){const material=object.material;if(Array.isArray(material))node=new THREE.Mesh(object.geometry,material);else{if(!materials.has(material))materials.set(material,material.clone());node=new THREE.Mesh(object.geometry,materials.get(material));}}
    else if(object.isSprite)return null;else node=new THREE.Group();
    node.name=object.name;node.position.copy(object.position);node.quaternion.copy(object.quaternion);node.scale.copy(object.scale);copies.set(object,node);
    for(const child of object.children){const cloned=copy(child);if(cloned)node.add(cloned);}return node;
  }
  const model=copy(ship);model.position.set(0,0,0);model.quaternion.identity();scene.add(model);
  let selected={type:'anchor'},clock=0,signature='',dragStart=null;
  const points=[],raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  function addTarget(key,label,point,mesh=null){const button=document.createElement('button');button.className='ship-command-marker';button.textContent=label;button.dataset.target=key;button.setAttribute('aria-label',key==='anchor'?'选择船锚':key.startsWith('sail')?'选择第'+(Number(key.slice(5))+1)+'面帆':'选择第'+(Number(key.slice(6))+1)+'座瞭望塔');button.addEventListener('click',()=>select(key));labels.append(button);points.push({key,point,mesh,button});}
  addTarget('anchor','锚',new THREE.Vector3(11,2.6,-3));
  sails.forEach((sail,index)=>addTarget('sail-'+index,String(index+1),new THREE.Vector3(),copies.get(sail.mesh)));
  MASTS.forEach((mast,index)=>addTarget('guard-'+index,'瞭望'+(index+1),new THREE.Vector3(mast.x,mast.nest+.65,0)));
  const selector=document.querySelector('#crew-target');for(const target of points){const option=document.createElement('option');option.value=target.key;option.textContent=target.key==='anchor'?'船锚':target.key.startsWith('sail')?'第'+(Number(target.key.slice(5))+1)+'面帆':'第'+(Number(target.key.slice(6))+1)+'座瞭望塔';selector.append(option);}
  function select(key){selected=key==='anchor'?{type:'anchor'}:key.startsWith('sail')?{type:'sail',index:Number(key.slice(5))}:{type:'guard',mast:Number(key.slice(6))};selector.value=key;signature='';refresh();}
  selector.addEventListener('change',()=>select(selector.value));
  renderer.domElement.addEventListener('pointerdown',e=>{dragStart=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!dragStart||Math.hypot(e.clientX-dragStart[0],e.clientY-dragStart[1])>5)return;const bounds=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-bounds.left)/bounds.width*2-1,-(e.clientY-bounds.top)/bounds.height*2+1);raycaster.setFromCamera(pointer,camera);
    const targets=points.filter(p=>p.mesh),hit=raycaster.intersectObjects(targets.map(p=>p.mesh),false)[0];if(hit)select(targets.find(p=>p.mesh===hit.object).key);
  });
  function order(spec){const id=document.querySelector('#crew-select').value;const result=crew.command({...spec,...(spec.crewId||id==='auto'?{}:{crewId:id})});notice(result.message);signature='';refresh();if(result.ok)onCommand(result);}
  document.querySelector('#crew-primary').addEventListener('click',()=>order({...selected,...(selected.type==='anchor'?{raised:true}:selected.type==='sail'?{set:false}:{})}));
  document.querySelector('#crew-secondary').addEventListener('click',()=>{if(selected.type==='guard'){const owner=crew.state.find(s=>s.task?.type==='guard'&&s.task.mast===selected.mast);if(owner)order({type:'rest',crewId:owner.id});else notice('这座瞭望塔没有站岗水手。');return;}order({...selected,...(selected.type==='anchor'?{raised:false}:{set:true})});});
  document.querySelector('#crew-rest').addEventListener('click',()=>order({type:'rest'}));
  const crewSelect=document.querySelector('#crew-select');for(const sailor of crew.state){const option=document.createElement('option');option.value=sailor.id;option.textContent=sailor.name;crewSelect.append(option);}
  function refresh(){
    const state=crew.state,game=getGame(),next=JSON.stringify([state.map(s=>[s.id,s.status,s.label,s.blockedReason]),selected,game.ship.anchorLift,game.world.sailsSet]);if(signature===next)return;signature=next;
    const title=selected.type==='anchor'?'船锚':selected.type==='sail'?'第'+(selected.index+1)+'面帆':'第'+(selected.mast+1)+'座瞭望塔';document.querySelector('#crew-target-title').textContent=title;
    document.querySelector('#crew-primary').textContent=selected.type==='anchor'?'命令收锚':selected.type==='sail'?'命令收起此帆':'命令前往站岗';document.querySelector('#crew-secondary').textContent=selected.type==='anchor'?'命令抛锚':selected.type==='sail'?'命令展开此帆':'撤回休息';
    document.querySelector('#crew-target-status').textContent=selected.type==='anchor'?'已收起 '+Math.round(game.ship.anchorLift*100)+'%':selected.type==='sail'?game.world.sailsSet[selected.index]?'当前展开':'当前收起':'选择水手后下令，站岗持续到撤回。';
    const list=document.querySelector('#crew-roster');list.replaceChildren();for(const sailor of state){const item=document.createElement('li'),name=document.createElement('strong'),status=document.createElement('span');name.textContent=sailor.name;status.textContent=sailor.blockedReason||sailor.label||sailor.status;item.append(name,status);list.append(item);}
    for(const p of points)p.button.classList.toggle('selected',p.key===selector.value);
  }
  const voice=document.querySelector('#crew-voice'),Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
  let activeRecognition=null;
  dialog.addEventListener('close',()=>{const previous=activeRecognition;activeRecognition=null;previous?.abort();voice.disabled=!Speech;voice.textContent=Speech?'语音下令':'此浏览器不支持语音';});
  voice.disabled=!Speech;if(!Speech)voice.textContent='此浏览器不支持语音';
  voice.addEventListener('click',()=>{
    const recognition=new Speech();activeRecognition=recognition;recognition.lang='zh-CN';recognition.interimResults=false;voice.disabled=true;voice.textContent='正在听命令…';
    recognition.onresult=event=>{if(activeRecognition!==recognition||!dialog.open)return;const text=event.results[0][0].transcript,number=text.match(/第?([0-9]+|[零一二三四五六七八九十]+)(?:面|号|个|座)?(?:帆|瞭望)/),n=number?(/\d/.test(number[1])?Number(number[1]):['','一','二','三','四','五','六','七','八','九','十','十一'].indexOf(number[1])):0;
      if(/休息|撤回|取消/.test(text))order({type:'rest'});else if(/锚/.test(text))order({type:'anchor',raised:!/放|抛|落/.test(text)});else if(/帆/.test(text)&&n>=1&&n<=11)order({type:'sail',index:n-1,set:/展开|升|张/.test(text)});else if(/站岗|瞭望/.test(text)&&n>=1&&n<=3)order({type:'guard',mast:n-1});else notice('没有识别到船务命令，请点选船模目标。');};
    recognition.onerror=()=>{if(activeRecognition===recognition&&dialog.open)notice('语音暂不可用，请通过船模下令。');};recognition.onend=()=>{if(activeRecognition!==recognition)return;activeRecognition=null;voice.disabled=false;voice.textContent='语音下令';};try{recognition.start();}catch{activeRecognition=null;voice.disabled=false;voice.textContent='语音下令';notice('语音暂不可用，请通过船模下令。');}
  });
  select('anchor');
  return {dialog,render(delta=0){if(!dialog.open)return;refresh();clock+=delta;if(clock<1/30)return;clock=0;const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;if(renderer.domElement.width!==Math.round(w*renderer.getPixelRatio())||renderer.domElement.height!==Math.round(h*renderer.getPixelRatio())){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}for(const[source,node]of copies){if(source===ship)continue;node.position.copy(source.position);node.quaternion.copy(source.quaternion);node.scale.copy(source.scale);node.visible=source.visible;}controls.update();model.updateMatrixWorld(true);
    for(const p of points){const v=p.point.clone();if(p.mesh){p.mesh.geometry.computeBoundingBox();p.mesh.geometry.boundingBox.getCenter(v);p.mesh.localToWorld(v);}v.project(camera);const lookout=p.key.startsWith('guard-'),offset=lookout?50:w<500&&p.key==='sail-9'?-12:w<500&&p.key==='sail-10'?12:0;p.button.classList.toggle('lookout',lookout);p.button.hidden=v.z>1||v.z< -1;p.button.style.left=((v.x+1)*w/2)+'px';p.button.style.top=((-v.y+1)*h/2+offset)+'px';}renderer.render(scene,camera);
  }};
}
