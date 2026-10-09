import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const require=createRequire(import.meta.url);
let pw;try{pw=require('playwright');}catch{pw=require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const out=resolve('artifacts',process.argv[2]||'model-20261008-input');await mkdir(out,{recursive:true});
const browser=await pw.chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1365,height:900}}),page=await context.newPage();
const errors=[],checks=[],samples=[],motion=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const state=()=>page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__.state);
const hold=async(keys,ms)=>{for(const k of keys)await page.keyboard.down(k);await page.waitForTimeout(ms);for(const k of keys)await page.keyboard.up(k);};
async function note(name){const s=await state();checks.push(name);samples.push({name,...s});console.log(`PASS ${name}`);}
async function capture(name){const s=await state();await page.screenshot({path:resolve(out,`${name}.png`)});motion.push({name,timeMs:Math.round(performance.now()),...s});}
async function walkTo(x,z,segment=true){
  if(segment){const s=await state(),p=['deck','cabin'].includes(s.mode)?s.localPlayer:s.player,n=Math.ceil(Math.hypot(x-p.x,z-p.z)/.8);if(n>1){for(let i=1;i<=n;i++)await walkTo(p.x+(x-p.x)*i/n,p.z+(z-p.z)*i/n,false);return;}}
  let stuck=0;
  for(let i=0;i<220;i++){
    const s=await state(),local=['deck','cabin'].includes(s.mode),c=Math.cos(s.ship.heading),sn=Math.sin(s.ship.heading);
    const tx=local?s.ship.x+c*x+sn*z:x,tz=local?s.ship.z-sn*x+c*z:z;
    const dx=tx-s.player.x,dz=tz-s.player.z,d=Math.hypot(dx,dz);if(d<.14)return;
    const fx=Math.sin(s.lookYaw),fz=Math.cos(s.lookYaw),f=(dx*fx+dz*fz)/d,r=(-dx*fz+dz*fx)/d;
    const keys=[];if(Math.abs(f)>.005)keys.push(f>0?'w':'s');if(Math.abs(r)>.005)keys.push(r>0?'d':'a');
    await hold(keys,Math.max(30,Math.min(150,d/2.65*650)));
    const n=await state();stuck=Math.hypot(n.player.x-s.player.x,n.player.z-s.player.z)<.003?stuck+1:0;
    if(stuck>8)throw Error(`Walking blocked: target ${x},${z}, actual ${JSON.stringify(n.localPlayer)}, mode ${n.mode}`);
  }
  throw Error(`Walk did not reach ${x},${z}`);
}
async function act(id){
  await page.waitForTimeout(130);
  for(let i=0;i<20;i++){const s=await state();assert(s.choices.some(c=>c.id===id),`Action ${id} absent at ${JSON.stringify(s.localPlayer)}: ${JSON.stringify(s.choices)}`);if(s.selectedActionId===id){await page.keyboard.press('e');await page.waitForTimeout(150);return;}await page.keyboard.press('q');}
  throw Error(`Could not cycle to ${id}`);
}
async function climb(key,end){await page.keyboard.down(key);try{await page.waitForFunction(end=>{const c=window.__THREE_GAME_DIAGNOSTICS__.state.climb;return c&&Math.abs(c.t-end)<.001;},end,{timeout:30000});}finally{await page.keyboard.up(key);}await act('climb-off');}
let failure;
try{
  await page.goto('http://127.0.0.1:5173/?qa=1');await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__&&document.querySelector('#loading').hidden);
  const frozen=await state();await hold(['w'],200);assert.deepEqual((await state()).player,frozen.player);
  await page.locator('#start-button').click();await note('start button unlocks real input');
  for(const p of [[-5.5,1.1],[-5.5,0],[-7.45,0]])await walkTo(...p);
  await hold(['w'],350);assert.equal((await state()).mode,'deck');assert((await state()).localPlayer.x>=-7.79);
  await act('cabin-door');await walkTo(-8.6,0);assert.equal((await state()).world.room,'captain');await capture('captain-door-entry');
  await page.keyboard.press('m');assert(await page.locator('#chart').evaluate(e=>e.open));const chart=await state();await hold(['w'],200);assert.deepEqual((await state()).player,chart.player);await page.keyboard.press('Escape');
  await walkTo(-7.4,0);assert.equal((await state()).mode,'deck');await note('smaller captain walks through open door both ways; chart freezes motion');
  for(const p of [[-5.3,0],[-3.6,1.1]])await walkTo(...p);
  await act('hatch');await act('ladder-hatch');await climb('s',1);assert.equal((await state()).world.room,'lower');
  await walkTo(-5.8,0);await act('cell-2');assert((await page.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__.inspect())).cellsOpen[2]);
  await act('lamp-brig-watch');assert.equal((await state()).world.lamps['brig-watch'],false);await act('lamp-brig-watch');assert.equal((await state()).world.lamps['brig-watch'],true);await capture('brig-lamp-door');
  await walkTo(-3.7,.25);await act('leave-cabin');await climb('w',0);await note('lower hatch, cell door, lamp switch and return ladder');
  for(const p of [[-2,1.3],[3.5,1.3]])await walkTo(...p);
  await act('cargo-hatch');await act('ladder-cargo');await climb('s',1);assert.equal((await state()).world.room,'hold');await act('lamp-cargo-work');assert((await state()).world.lamps['cargo-work']);await capture('cargo-lamp');await act('leave-cabin');await climb('w',0);await note('cargo grating and real descent, work lamp, return');
  for(const p of [[3,1.6],[7,1.6],[9.3,1.6]])await walkTo(...p);await act('capstan-brake');
  await walkTo(8.3,1.6);await walkTo(8.3,-.4);await act('anchor');await page.waitForTimeout(500);assert((await state()).ship.anchorLift>0&&(await state()).ship.anchorLift<1);await capture('anchor-moving');await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.state.ship.anchorLift===1,null,{timeout:7000});await note('brake and windlass actually lift anchor');
  for(const p of [[8.3,-1.45],[-5.7,-1.45],[-8.5,-1.45],[-11.5,-1]])await walkTo(...p);await act('helm');
  await hold(['w'],20500);assert((await state()).voyage.sailed);const heading=(await state()).ship.heading;await hold(['d'],500);assert((await state()).ship.heading<heading-.1);await capture('sailing-steering');
  await page.keyboard.press('Escape');const pause=await state();await hold(['w','a'],200);assert.deepEqual((await state()).ship,pause.ship);await page.keyboard.press('Escape');await note('60 m departure, steering and pause via real keys');
  await act('leave-helm');for(const p of [[-8.5,-1.45],[-5.6,-1.45],[8.3,-1.45],[8.3,1.6],[9.3,1.6]])await walkTo(...p);await act('capstan-brake');await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.state.ship.anchorLift===0,null,{timeout:7000});assert((await state()).voyage.moored);await note('return to windlass and complete first voyage');
  await page.keyboard.press('Escape');await page.locator('#restart').click();assert.equal((await state()).voyage.distance,0);assert.equal((await state()).lookYaw,-Math.PI/2);await note('restart clears movement, look direction and progress');
  for(const p of [[.6,-1.45],[-5.7,-1.45],[-8.5,-1.45],[-11,-2.65]])await walkTo(...p);await act('boat');await act('boat');await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__.state.boat.deployed,null,{timeout:7000});await act('boat');assert.equal((await state()).mode,'boat');await hold(['w'],700);await capture('rowboat');await page.keyboard.press('Space');await page.waitForTimeout(900);assert.equal((await state()).mode,'swim');await capture('swimming');await note('untie, timed lowering, board, row and dive');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);const touch=page.getByRole('button',{name:'向右移动',exact:true}),r=await touch.boundingBox();assert(r.width>=44&&r.height>=44);const before=await state();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.waitForTimeout(300);await page.mouse.up();await page.waitForTimeout(220);assert(Math.hypot((await state()).player.x-before.player.x,(await state()).player.z-before.player.z)>.2);await capture('narrow-swim');await note('narrow touch movement and release');
  assert.equal(errors.length,0,errors.join('\n'));
}catch(e){failure=e;console.error(e.message);await capture('input-failure');}
finally{await writeFile(resolve(out,'input-check.json'),JSON.stringify({ok:!failure,checks,samples,errors,failure:failure?.message},null,2));await writeFile(resolve(out,'motion-sequence.json'),JSON.stringify({method:'unpaused real-keyboard frames',frames:motion},null,2));await context.close();await browser.close();}
if(failure)throw failure;
