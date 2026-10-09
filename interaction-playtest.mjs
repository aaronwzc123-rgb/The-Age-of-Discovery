import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const require=createRequire(import.meta.url);
let pw;try{pw=require('playwright');}catch{pw=require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const out=resolve('artifacts','interaction-20261008');await mkdir(out,{recursive:true});
const browser=await pw.chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1365,height:900}}),page=await context.newPage();
const errors=[],checks=[],motion=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const state=()=>page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__.state);
async function note(name){checks.push(name);console.log('PASS '+name);}
async function shot(name){await page.screenshot({path:resolve(out,name+'.png')});}
async function crewFrame(name){await shot(name);motion.push({name,time:Date.now(),crew:await page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__.crew),bodies:await page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__.crewBodies),state:await state()});}
async function lookAtCrew(index){const s=await state(),crew=await page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__.crew),p=crew[index].worldPosition;await look(Math.atan2(p[0]-s.camera[0],p[2]-s.camera[2]),Math.atan2(p[1]+1.0-s.camera[1],Math.hypot(p[0]-s.camera[0],p[2]-s.camera[2])));}
let failure;
let mouseX=685,mouseY=895;
async function look(yaw,pitch=0){await page.mouse.move(682,450);mouseX=682;mouseY=450;await page.waitForTimeout(30);const s=await state();const angle=Math.atan2(Math.sin(yaw-s.lookYaw),Math.cos(yaw-s.lookYaw));mouseX-=angle/.0028;mouseY-=(pitch-s.lookPitch)/.0028;await page.mouse.move(mouseX,mouseY);await page.waitForTimeout(130);}
async function aim(id,regionIndex=0){
  const regions=await page.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__.interactionRegions());
  const entry=regions.find(x=>x.id===id);assert(entry?.regions.length,`No candidate ${id}: ${JSON.stringify(await state())}`);
  const s=await state(),p=entry.regions[regionIndex].point,c=s.camera,dx=p[0]-c[0],dy=p[1]-c[1],dz=p[2]-c[2];
  await look(Math.atan2(dx,dz),Math.atan2(dy,Math.hypot(dx,dz)));
  const aimed=await state();assert.equal(aimed.target?.id,id,`Target ${id}: ${JSON.stringify({target:aimed.target,look:[aimed.lookYaw,aimed.lookPitch],expected:[Math.atan2(dx,dz),Math.atan2(dy,Math.hypot(dx,dz))],camera:aimed.camera,point:p,choices:aimed.choices})}`);assert(aimed.target.reachable,`Out of reach ${id}`);
}
async function place(p,mode='deck'){await page.evaluate(({p,mode})=>window.__THREE_GAME_TEST_HOOKS__.placePlayer(p,mode),{p,mode});await page.waitForTimeout(160);}
async function hold(key,ms){await page.keyboard.down(key);await page.waitForTimeout(ms);await page.keyboard.up(key);}
try{
  await page.goto('http://127.0.0.1:5173/?qa=1');
  await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__&&document.querySelector('#loading').hidden,null,{timeout:60000});
  await page.locator('#start-button').click();
  await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.state.pointerLocked,null,{timeout:7000});
  assert.equal((await state()).paused,false);await note('real Start click obtains pointer lock');
  const s=await state();await page.mouse.move(720,510);await page.waitForTimeout(180);
  assert.notEqual((await state()).lookYaw,s.lookYaw);await note('mouse movement changes view without holding a button');
  assert((await state()).inventory.stowed);await page.keyboard.press('1');await page.waitForTimeout(100);assert.equal((await state()).body.equipped,'chart');await page.keyboard.press('x');await page.waitForTimeout(100);assert.equal((await state()).body.equipped,null);await note('start empty handed; X stows the selected chart');await page.mouse.move(685,895);await page.waitForTimeout(150);await shot('real-input-body');
  await page.keyboard.press('e');await page.waitForTimeout(100);
  assert(await page.locator('#inventory').evaluate(e=>e.open));assert((await state()).paused);assert.equal((await state()).pointerLocked,false);
  await shot('inventory-desktop');await page.keyboard.press('e');await page.locator('#mouse-resume-button').click();
  await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.state.pointerLocked);await note('inventory pauses, releases and resumes mouse control');
  await page.keyboard.press('m');assert(await page.locator('#chart').evaluate(e=>e.open));await page.keyboard.press('m');await page.locator('#mouse-resume-button').click();
  await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.state.pointerLocked);await note('map opens and resumes');
  await place([-7.52,2.4,.05]);await aim('cabin-door');await page.mouse.click(mouseX,mouseY);assert((await state()).world.cabinDoorOpen);
  await page.waitForTimeout(700);await look(-Math.PI/2);await hold('w',600);assert.equal((await state()).mode,'cabin',JSON.stringify((await state()).localPlayer));
  await shot('captain-door-entry');await hold('s',600);assert.equal((await state()).mode,'deck');await note('crosshair left click opens door; normal keys enter and leave captain cabin');
  await place([-4.23,2.4,1.03]);await page.keyboard.down('Shift');await page.waitForTimeout(150);await aim('hatch');await page.mouse.click(mouseX,mouseY);assert((await state()).world.hatchOpen);await page.keyboard.up('Shift');await page.waitForTimeout(800);await note('crouch and crosshair open physical hatch');
  await place([-4.48,.15,1.18],'cabin');await aim('hatch');await page.mouse.click(mouseX,mouseY);assert.equal((await state()).world.hatchOpen,false);await page.waitForTimeout(850);await aim('hatch');await page.mouse.click(mouseX,mouseY);assert((await state()).world.hatchOpen);await shot('lower-hatch-pull');await note('lower cabin pull ring closes and reopens the shared hatch');
  for(const side of[-1,1]){await place([-5.7,2.4,side*1.4]);await look(-Math.PI/2);await hold('w',1700);assert((await state()).localPlayer.y>4.5,JSON.stringify((await state()).localPlayer));await shot(side<0?'port-stair-top':'starboard-stair-top');await hold('s',1700);assert((await state()).localPlayer.y<2.6,JSON.stringify((await state()).localPlayer));}await note('both aft stairs walk up across the repaired top and back down');
  await place([-12.56,4.55,0]);await aim('helm');await page.mouse.click(mouseX,mouseY);assert.equal((await state()).mode,'helm',await page.locator('#toast').textContent());await hold('d',200);await shot('helm-hands');await page.mouse.click(mouseX,mouseY);assert.equal((await state()).mode,'deck');await note('crosshair wheel grip, rudder input and release');
  await place([9.08,2.4,1.57]);await aim('capstan-brake');await page.mouse.click(mouseX,mouseY);assert((await state()).world.capstanBraked);await place([8.11,2.4,-.59]);await aim('anchor',1);await page.mouse.down();await page.waitForTimeout(200);assert((await state()).ship.anchorLift>0);await hold('w',300);const stoppedLift=(await state()).ship.anchorLift;await page.waitForTimeout(300);assert.equal((await state()).ship.anchorLift,stoppedLift);await page.mouse.up();await note('manual windlass stops when the rotating bar leaves real hand reach');
  await place([-3.3,2.4,1.9]);await look(Math.PI/2,-.05);await page.keyboard.press('b');assert(await page.locator('#crew-panel').evaluate(e=>e.open));assert((await state()).paused);assert.equal(await page.locator('#crew-roster li').count(),3);await page.waitForTimeout(200);await shot('crew-panel-desktop');
  await page.locator('.ship-command-marker[data-target="anchor"]').click();await page.locator('#crew-primary').click();await page.waitForFunction(()=>!document.querySelector('#crew-panel').open&&window.__THREE_GAME_DIAGNOSTICS__.state.pointerLocked);
  assert.equal((await page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__.crew))[0].task?.type,'anchor');await crewFrame('crew-order-start');await page.waitForTimeout(1300);
  await page.keyboard.press('b');const crewPaused=await page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__.crew);await page.waitForTimeout(400);assert.deepEqual(await page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__.crew),crewPaused);await page.keyboard.press('b');await page.locator('#mouse-resume-button').click();await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.state.pointerLocked);await note('ship-model anchor order resumes play; command panel freezes NPCs');
  await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.crew[0].status==='climbing',null,{timeout:30000});await lookAtCrew(0);await crewFrame('crew-hatch-climb');
  await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.crew[0].status==='working',null,{timeout:50000});await place([7.4,2.4,2.15]);await lookAtCrew(0);await crewFrame('crew-anchor-work');
  await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.state.ship.anchorLift>=.999,null,{timeout:12000});await crewFrame('crew-anchor-complete');
  await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.crew[0].status==='rest',null,{timeout:60000});await note('sailor physically climbs out, walks to windlass, raises anchor and returns below');
  await page.keyboard.press('b');await page.locator('#crew-target').selectOption('guard-1');await page.locator('#crew-select').selectOption('crew-1');await page.locator('#crew-primary').click();await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.state.pointerLocked);
  await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.crew[1].climb?.id==='main-shroud'&&window.__THREE_GAME_DIAGNOSTICS__.crew[1].climb.progress>.2,null,{timeout:45000});await place([-1.8,2.4,1.9]);await look(.16,.72);await crewFrame('crew-rope-climb');
  for(let i=0;i<6;i++){await page.waitForTimeout(160);await lookAtCrew(1);await crewFrame('crew-rope-motion-'+i);}
  await page.keyboard.press('b');await page.locator('#crew-rest').click();await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.state.pointerLocked);await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.crew[1].status==='rest',null,{timeout:60000});await note('specified sailor climbs toward selected lookout and recall returns continuously');
  const narrow=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),mobile=await narrow.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto('http://127.0.0.1:5173/?qa=1');await mobile.waitForFunction(()=>window.__THREE_GAME_TEST_HOOKS__&&document.querySelector('#loading').hidden);await mobile.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__.setState('crew'));await mobile.waitForTimeout(400);await mobile.screenshot({path:resolve(out,'crew-panel-mobile.png')});assert(await mobile.locator('#crew-panel').evaluate(e=>e.scrollWidth<=e.clientWidth+2));await mobile.locator('#crew-target').selectOption('sail-10');await mobile.locator('#crew-primary').click();assert.equal((await mobile.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__.crew))[0].task?.index,10);await narrow.close();await note('narrow touch layout stays inside dialog and can issue sail 11');
  assert.equal(errors.length,0,errors.join('\n'));await note('no browser runtime errors');
  console.log(JSON.stringify({physics:await page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__.physics),state:await state()}));
}catch(e){failure=e;console.error(e.stack);await shot('input-failure');}
finally{await writeFile(resolve(out,'input-check.json'),JSON.stringify({ok:!failure,checks,errors,failure:failure?.message},null,2));await writeFile(resolve(out,'crew-motion.json'),JSON.stringify(motion,null,2));await context.close();await browser.close();}
if(failure)throw failure;
