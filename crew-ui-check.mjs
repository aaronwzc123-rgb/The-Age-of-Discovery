import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const require=createRequire(import.meta.url);let pw;try{pw=require('playwright');}catch{pw=require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const out=resolve('artifacts/interaction-20261008');await mkdir(out,{recursive:true});
const browser=await pw.chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1280,height:720}}),page=await context.newPage();
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(()=>{window.__voiceMocks=[];window.SpeechRecognition=class{constructor(){window.__voiceMocks.push(this);}start(){}abort(){this.aborted=true;}};});
const crew=()=>page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__.crew);
async function panel(){if(!await page.locator('#crew-panel').evaluate(e=>e.open))await page.keyboard.press('b');}
async function order(target,id){await panel();await page.locator('#crew-target').selectOption(target);await page.locator('#crew-select').selectOption(id);await page.locator('#crew-primary').click();}
function note(name){checks.push(name);console.log('PASS '+name);}
let failure;
try{
  await page.goto('http://127.0.0.1:5173/?qa=1');await page.waitForFunction(()=>window.__THREE_GAME_TEST_HOOKS__&&document.querySelector('#loading').hidden);await page.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__.setState('crew'));await page.waitForTimeout(200);
  for(const marker of await page.locator('.ship-command-marker').all()){const key=await marker.getAttribute('data-target');await marker.click();assert.equal(await page.locator('#crew-target').inputValue(),key);}note('all 15 ship targets can be clicked in the initial desktop view');
  await order('guard-1','crew-1');await order('anchor','crew-0');
  await panel();await page.locator('#crew-target').selectOption('sail-1');await page.locator('#crew-select').selectOption('crew-0');await page.locator('#crew-primary').click();
  assert(await page.locator('#crew-panel').evaluate(e=>e.open));assert.match(await page.locator('#crew-notice').textContent(),/忙/);note('busy sailor rejection is visible inside the modal');
  await page.locator('#crew-target').selectOption('guard-1');await page.locator('#crew-select').selectOption('auto');await page.locator('#crew-secondary').click();const tasks=await crew();assert.equal(tasks[1].task,null);assert.equal(tasks[0].task.type,'anchor');note('recalling one lookout preserves the other sailor anchor order');
  await page.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__.setState('crew'));await page.locator('#crew-voice').click();await page.keyboard.press('b');await page.waitForFunction(()=>window.__voiceMocks[0].aborted);
  await page.evaluate(()=>window.__voiceMocks[0].onresult({results:[[{transcript:'收起船锚'}]]}));assert((await crew()).every(s=>!s.task));note('closing panel aborts speech and ignores a late result');
  await panel();await page.locator('#crew-voice').click();await page.evaluate(()=>window.__voiceMocks[1].onresult({results:[[{transcript:'收起第十二面帆'}]]}));assert((await crew()).every(s=>!s.task));assert.match(await page.locator('#crew-notice').textContent(),/没有识别/);
  await page.evaluate(()=>window.__voiceMocks[1].onresult({results:[[{transcript:'收起第十一面帆'}]]}));assert.equal((await crew())[0].task.index,10);note('speech command parser accepts sail 11 and rejects sail 12');
  for(const width of[1280,390]){await page.setViewportSize({width,height:width===390?844:720});await page.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__.setState('body'));await page.waitForTimeout(120);assert(await page.evaluate(()=>{const a=document.querySelector('#hotbar').getBoundingClientRect(),b=document.querySelector('nav').getBoundingClientRect();return a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom;}),`Hotbar overlaps navigation at ${width}`);}note('desktop and narrow mouse hotbar do not overlap navigation');
  assert.equal(errors.length,0,errors.join('\n'));
}catch(e){failure=e;console.error(e.stack);await page.screenshot({path:join(out,'crew-ui-failure.png')});}
finally{await writeFile(join(out,'crew-ui-check.json'),JSON.stringify({ok:!failure,checks,errors,failure:failure?.message},null,2));await context.close();await browser.close();}
if(failure)throw failure;
