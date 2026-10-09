import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildShip } from './ship.js';
import { hullWidth, hullHalfWidthAt } from './ship-layout.js';
import { createGame, stepGame, interact, interactions, heaveAnchor, dive, toWorld, toLocal, islandHeight, recordChartVisit, voyageObjective, deckHeight, CELLS, LADDERS, STATIONS, PLAYER_HEIGHT, PLAYER_EYE_HEIGHT } from './game.js';
import { buildWorld, buildPirate } from './world.js';
import {moveSlot,returnCursor,dropSelected,pickDrop,inventoryTotals,saveVoyage,restoreVoyage,STORAGE_KEY} from './inventory.js';
const model=buildShip(),{ship,sails,flags,anchors,setAnchorLift}=model;
assert.equal(sails.length,11);assert.equal(flags.length,3);assert.equal(model.gunPorts.length,10);assert.equal(model.lampFixtures.length,5);assert.equal(anchors.length,2);
assert.equal(hullWidth(0)*2,8.5);assert(hullWidth(10)>hullWidth(14)&&hullWidth(14)>hullWidth(16));
assert(hullHalfWidthAt(0,0)>hullHalfWidthAt(0,2.4),'Tumblehome');assert(hullHalfWidthAt(0,-2)>hullHalfWidthAt(0,-3.3),'Round bilge');
const bounds=new THREE.Box3().setFromObject(ship);assert(bounds.max.x>21&&bounds.min.x<-16&&bounds.max.x-bounds.min.x<41);assert(Math.abs(bounds.max.y-30)<.5);
assert(anchors[1].position.y<-4&&anchors[0].position.y>0);setAnchorLift(1);assert(anchors[1].position.y>0);setAnchorLift(0);
for(const factor of [.06,.5,1])for(let i=0;i<11;i++)model.setSailFurl(i,factor);
function checkGeometry(root){let meshes=0,triangles=0;root.traverse(o=>{if(!o.isMesh)return;meshes++;for(const a of Object.values(o.geometry.attributes))assert(a.array.every(Number.isFinite),`Nonfinite: ${o.name}`);const index=o.geometry.index;if(index)assert(index.array.every(i=>i<o.geometry.attributes.position.count),`Index: ${o.name}`);triangles+=(index?index.count:o.geometry.attributes.position.count)/3;});return{meshes,triangles};}
const hull=ship.getObjectByName('hull').geometry;for(let i=0;i<hull.attributes.position.count;i++){const p=hull.attributes.position,n=hull.attributes.normal;if(Math.abs(p.getX(i))<1&&p.getY(i)>-.5)assert(p.getZ(i)*n.getZ(i)>0,'Outward hull normals');}
console.log('PASS model dimensions, topology, eleven sails, ten guns, two anchors:',checkGeometry(ship));
// Labels need only a no-op canvas in this Node geometry pass.
globalThis.document={createElement:()=>({getContext:()=>new Proxy({},{get:()=>()=>{}})})};const scene=new THREE.Scene();scene.add(ship);const world=buildWorld(scene,ship,null),character=buildPirate();scene.add(character.pirate);delete globalThis.document;
console.log('PASS finite world/interior geometry:',checkGeometry(scene));assert.equal(world.cellDoors.length,4);assert(world.cellDoors.every(d=>d.parent===world.brig));assert(world.cabin.parent===ship&&world.oars.every(o=>o.parent===world.boat));
assert.equal(world.layout.collisions.filter(c=>c.kind==='cell-back-wall').length,4,'Four cells have solid rear walls');
assert.deepEqual(world.cellDoors.map(d=>[d.position.x+.335,Math.sign(d.position.z)]),CELLS.map(c=>[c.x,c.side]),'Visual and interactive cell door indices match');
const terrain=world.island.children.find(o=>o.material?.name==='ground').geometry.attributes.position;for(let i=0;i<terrain.count;i++)assert(Math.abs(terrain.getY(i)-islandHeight(terrain.getX(i),terrain.getZ(i)))<1e-5);const pirateBounds=new THREE.Box3().setFromObject(character.pirate);assert(Math.abs(pirateBounds.max.y-pirateBounds.min.y-PLAYER_HEIGHT)<.06);assert.equal(deckHeight(0,0),2.4);assert.equal(deckHeight(-12,0),4.55);assert.equal(deckHeight(13,0),3.1);
const bagGame=createGame(),totals=inventoryTotals(bagGame);
assert.equal(interact(bagGame),null,'No target must never operate nearest fixture');
assert(moveSlot(bagGame,'captain',1,{quick:true}));
assert(moveSlot(bagGame,'player',1,{right:true}));assert.equal(bagGame.inventory.cursor.count,2);
assert(moveSlot(bagGame,'player',9,{right:true}));assert(returnCursor(bagGame));
bagGame.inventory.selected=9;bagGame.inventory.stowed=false;assert(dropSelected(bagGame,[1,2.4,1]));
assert(pickDrop(bagGame,bagGame.inventory.drops[0].id));
bagGame.inventory.selected=0;assert.equal(dropSelected(bagGame,[1,2.4,1]),false);
assert.deepEqual(inventoryTotals(bagGame),totals);
const values=new Map(),storage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)};
assert(saveVoyage(bagGame,storage));const restored=createGame();assert(restoreVoyage(restored,storage));assert.deepEqual(inventoryTotals(restored),totals);
const good=values.get(STORAGE_KEY);
for(const corrupt of [s=>s.ship.heading=null,s=>s.boat.lowering=5,s=>s.world.sailsSet[0]='yes',s=>s.inventory.nextDrop=0,s=>s.cellsOpen[0]='true',s=>s.inventory.slots[0].count=2]){
  const saved=JSON.parse(good);corrupt(saved);values.set(STORAGE_KEY,JSON.stringify(saved));const g=createGame();assert.equal(restoreVoyage(g,storage),false);assert.deepEqual(inventoryTotals(g),totals);assert.equal(g.ship.x,0);
}
assert.equal(saveVoyage(bagGame,{setItem(){throw new Error('quota');}}),false);
console.log('PASS inventory split/transfer/drop/pickup conservation and validated save/restore');
await import('./physics-check.mjs');
await import('./body-check.mjs');
