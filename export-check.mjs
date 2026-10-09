// Export the same visible button a user presses, then reload that saved GLB.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const folder='artifacts/model-20261008-export',file=join(folder,'黑潮号.glb');await mkdir(folder,{recursive:true});
const errors=[],warnings=[];
const browser=await playwright.chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
let summary;
try{
  await page.goto('http://127.0.0.1:5173/ship-view.html?qa=1');await page.waitForFunction(()=>Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.getByRole('button',{name:'展开下帆',exact:true}).click();
  await page.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
  const source=await page.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__.inspect());
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:120000}),page.getByRole('button',{name:'导出 GLB',exact:true}).click()]);
  assert.equal(await download.failure(),null,'The export download must complete');await download.saveAs(file);
  await page.getByRole('button',{name:'导出 GLB',exact:true}).waitFor({state:'visible'});
  const bytes=await readFile(file);assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
  let json=null,binary=null;for(let offset=12;offset<bytes.length;){const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4),chunk=bytes.subarray(offset+8,offset+8+length);if(type===0x4e4f534a)json=JSON.parse(chunk.toString('utf8'));if(type===0x004e4942)binary=chunk;offset+=length+8;}
  assert(json&&binary,'A binary glTF must contain JSON and BIN chunks');assert.equal(json.asset.version,'2.0');
  const nodes=json.nodes||[],find=name=>nodes.filter(n=>n.name===name);
  for(const name of ['Black Tide Complete Model','black-tide','hull','sails-and-flags','walkable-cabin','captain-cabin','brig','cargo-hold','powder-magazine','lifeboat','timber-boat-davits'])assert.equal(find(name).length,1,`Missing or duplicate ${name}`);
  const sails=nodes.filter(n=>n.name?.endsWith('-furlable-canvas'));
  // Cannons are included in the ship's material batches; their original groups are removed.
  const guns=find('black-tide')[0].extras.model.gunCount;
  const gunports=nodes.filter(n=>/^gunport-(?:-1|1)-\d+$/.test(n.name||''));
  const cells=nodes.filter(n=>n.name?.startsWith('cell-door-')&&n.extras?.width===.67);
  const internalLamps=nodes.filter(n=>n.extras?.lampId);
  const exteriorNames=['bow-work-lamp','companion-upper-lamp','helm-lamp','stern-navigation-lamp','binnacle-lamp'];
  assert.equal(sails.length,11);assert.equal(guns,10);assert.equal(gunports.length,10);assert.equal(cells.length,4);assert.equal(internalLamps.length,14);exteriorNames.forEach(name=>assert.equal(find(name).length,1));
  assert.equal(find('walkable-cabin')[0].extras.hammockCount,27);assert.equal(find('walkable-cabin')[0].extras.waterBarrels,20);
  assert.equal(find('lifeboat')[0].extras.length,4.8);assert.equal(find('lifeboat')[0].extras.workingOars,4);assert.equal(find('lifeboat')[0].extras.spareOars,1);
  const images=json.images||[];assert(images.length>=6,'Material images must be embedded');
  for(const image of images){assert(Number.isInteger(image.bufferView),'The saved model must be self-contained');assert(['image/png','image/jpeg'].includes(image.mimeType));const view=json.bufferViews[image.bufferView];assert(view.byteLength>32,'Texture cannot be empty');}
  for(const view of json.bufferViews||[])assert((view.byteOffset||0)+view.byteLength<=binary.length,'Buffer view bounds');
  for(const node of nodes)for(const key of ['matrix','translation','rotation','scale'])if(node[key])assert(node[key].every(Number.isFinite),`Nonfinite transform on ${node.name}`);
  const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};let finiteFloatValues=0;
  for(const accessor of json.accessors||[]){if(accessor.componentType!==5126||accessor.bufferView===undefined)continue;const view=json.bufferViews[accessor.bufferView],width=widths[accessor.type],stride=view.byteStride||width*4,offset=(view.byteOffset||0)+(accessor.byteOffset||0);for(let i=0;i<accessor.count;i++)for(let j=0;j<width;j++){assert(Number.isFinite(binary.readFloatLE(offset+i*stride+j*4)),'Nonfinite exported attribute');finiteFloatValues++;}}
  const rawExtras=JSON.stringify(nodes.map(n=>n.extras));assert(!rawExtras.includes('"isObject3D"'),'Scene objects must not be serialized as userData');assert(!rawExtras.includes('"materials":'),'Runtime material library must not be serialized as ship userData');
  const load=await page.evaluate(async()=>{
    const THREE=await import('three'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),{RoomEnvironment}=await import('three/addons/environments/RoomEnvironment.js');
    const {buildShip}=await import('./ship.js'),{buildShipInterior}=await import('./ship-interior.js'),{buildLifeboat}=await import('./ship-boat.js'),{GUN_X,mainDeckHeight,hullHalfWidthAt}=await import('./ship-layout.js');
    const original=buildShip(),assembly=new THREE.Group();assembly.add(original.ship);buildShipInterior(original.ship,original.materials);const originalBoat=buildLifeboat(assembly,original.ship,original.materials);
    let sourceMeshes=0,sourceTriangles=0;assembly.traverse(o=>{if(o.isMesh){sourceMeshes++;sourceTriangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}});
    const gltf=await new GLTFLoader().loadAsync('./artifacts/model-20261008-export/'+encodeURIComponent('黑潮号.glb'));
    let meshes=0,triangles=0,textureMaps=0,lights=0;const uniqueTextures=new Set();gltf.scene.traverse(o=>{if(o.isLight)lights++;if(!o.isMesh)return;meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;for(const m of Array.isArray(o.material)?o.material:[o.material])for(const key of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap'])if(m[key]){textureMaps++;uniqueTextures.add(m[key]);}});
    // Check both bore-rim radii outside each side of the hull, independent of metadata.
    const ironVertices=new Set(),key=v=>v.toArray().map(x=>Math.round(x*1000)).join(',');gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o=>{if(!o.isMesh||o.material.name!=='ship-iron-forged')return;const p=o.geometry.attributes.position,v=new THREE.Vector3();for(let i=0;i<p.count;i++)ironVertices.add(key(v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld)));});
    let verifiedCannonBores=0;for(const side of [-1,1])for(const x of GUN_X){const edge=hullHalfWidthAt(x,2.4),y=mainDeckHeight(x,side*(edge-.98))+.91;let found=true;for(const radius of [.12,.052])for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const v=new THREE.Vector3(x+radius*Math.sin(angle),y-side*radius*Math.cos(angle),side*(edge+.18));found&&=ironVertices.has(key(v));}if(found)verifiedCannonBores++;}
    const bounds=new THREE.Box3().setFromObject(gltf.scene),r=new THREE.WebGLRenderer({antialias:true});r.setSize(1440,1000);r.outputColorSpace=THREE.SRGBColorSpace;r.toneMapping=THREE.ACESFilmicToneMapping;r.toneMappingExposure=1.04;r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;
    document.querySelector('#viewer').replaceChildren(r.domElement);const scene=new THREE.Scene();scene.background=new THREE.Color('#789197');const pmrem=new THREE.PMREMGenerator(r),env=pmrem.fromScene(new RoomEnvironment(),.04);scene.environment=env.texture;scene.environmentIntensity=.4;pmrem.dispose();scene.add(gltf.scene);scene.add(new THREE.HemisphereLight('#d7e5e5','#30352d',1.6));const sun=new THREE.DirectionalLight('#ffe0b8',2.3);sun.position.set(-25,46,26);scene.add(sun);const rim=new THREE.DirectionalLight('#94b6cd',.8);rim.position.set(18,17,-24);scene.add(rim);const camera=new THREE.PerspectiveCamera(42,1.44,.05,150);camera.position.set(44,23,48);camera.lookAt(0,12,0);r.render(scene,camera);
    window.__EXPORTED_MODEL__={gltf,scene,r,camera,hemi:scene.children.find(o=>o.isHemisphereLight),sun,rim};
    return{meshes,triangles,textureMaps,uniqueTextures:uniqueTextures.size,lights,verifiedCannonBores,sourceGeometry:{meshes:sourceMeshes,triangles:sourceTriangles,gunPorts:original.gunPorts.length,workingOars:originalBoat.oars.length,allOars:originalBoat.oars.length+Number(Boolean(originalBoat.boat.getObjectByName('spare-oar')))},bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},shipMetadata:gltf.scene.getObjectByName('black-tide').userData,renderer:{calls:r.info.render.calls,triangles:r.info.render.triangles,geometries:r.info.memory.geometries,textures:r.info.memory.textures}};
  });
  await writeFile(join(folder,'export-inspection.json'),JSON.stringify(load,null,2));
  assert([...load.bounds.min,...load.bounds.max].every(Number.isFinite),'Reloaded scene bounds must be finite');
  assert.equal(load.shipMetadata.model.sailCount,11);assert(load.uniqueTextures>=6);assert(load.meshes>100);assert(load.bounds.max[0]>21&&load.bounds.min[0]<-16);assert(load.bounds.max[1]>29);assert(load.triangles>100000);
  assert.equal(load.triangles,load.sourceGeometry.triangles,'The export must contain every original triangle, including hidden interiors and the boat');assert.equal(load.sourceGeometry.gunPorts,10);assert.equal(load.sourceGeometry.allOars,5);
  assert.equal(load.verifiedCannonBores,10,'All ten cannon bores must face outward and exist in the saved geometry');
  await page.locator('#viewer canvas').screenshot({path:join(folder,'glb-reloaded-exterior.png')});
  // Close views of the exported geometry itself, independent of the procedural builder.
  const presets={captain:{p:[-9.2,3.8,1.55],t:[-12.2,3.28,.1]},boat:{p:[-7,5.65,-8.3],t:[-11,2.73,-4.6]},crew:{p:[6.7,1.62,.35],t:[2.1,1.05,1.4]},galley:{p:[8.5,1.75,.1],t:[10.4,1.1,-.65]}};
  for(const[name,preset]of Object.entries(presets)){
    await page.evaluate(({name,preset})=>{const d=window.__EXPORTED_MODEL__;d.camera.position.set(...preset.p);d.camera.lookAt(...preset.t);const inside=name!=='boat';d.hemi.intensity=inside?.6:1.6;d.rim.intensity=inside?.3:.8;d.scene.environmentIntensity=inside?.25:.4;d.r.render(d.scene,d.camera);},{name,preset});
    await page.locator('#viewer canvas').screenshot({path:join(folder,`glb-reloaded-${name}.png`)});
  }
  assert.deepEqual(errors,[],'Export and GLTFLoader reload must have no browser errors');
  summary={pass:true,file,bytes:bytes.length,source,raw:{nodes:nodes.length,meshes:json.meshes.length,materials:json.materials.length,images:images.length,sails:sails.length,guns,gunports:gunports.length,cells:cells.length,internalLamps:internalLamps.length,externalLamps:exteriorNames.length,finiteFloatValues},loaded:load,errors,warnings};
  await writeFile(join(folder,'export-check.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({pass:true,bytes:bytes.length,counts:summary.raw,loaded:load,errors,warnings},null,2));
}catch(error){await writeFile(join(folder,'export-failure.json'),JSON.stringify({message:error.message,errors,warnings},null,2));throw error;}finally{await browser.close();}
