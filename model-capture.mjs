// Local, repeatable browser captures using the runtime's existing Playwright installation.
import { createRequire } from 'node:module';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const run=process.argv[2]||'model-20261008-1',target=process.argv[3]||'viewer';
const states=process.argv.slice(4);if(!states.length)states.push(...(target==='viewer'?['exterior','stern','deck']:['deck','sailing','cabin']));
const folder=join('artifacts',run);await mkdir(folder,{recursive:true});
const browser=await playwright.chromium.launch({channel:'msedge',headless:true});
try{
  for(const state of states){
    const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(`http://127.0.0.1:5173/${target==='viewer'?'ship-view.html':''}?qa=1`);
    await page.waitForFunction(()=>Boolean(window.__THREE_GAME_TEST_HOOKS__));
    await page.evaluate(name=>window.__THREE_GAME_TEST_HOOKS__.setState(name),state);
    await page.waitForTimeout(900);
    const metrics=await page.evaluate(()=>{const d=window.__THREE_GAME_DIAGNOSTICS__,gl=document.querySelector('canvas').getContext('webgl2'),gpu=gl?.getExtension('WEBGL_debug_renderer_info');return{renderer:{calls:d.renderer.calls,triangles:d.renderer.triangles,geometries:d.renderer.geometries,textures:d.renderer.textures},state:d.state,quality:d.quality,model:window.__THREE_GAME_TEST_HOOKS__.inspect(),gpu:gpu?gl.getParameter(gpu.UNMASKED_RENDERER_WEBGL):null};});
    await page.screenshot({path:join(folder,`${target}-${state}.png`)});
    await writeFile(join(folder,`${target}-${state}.json`),JSON.stringify({run,state,metrics,errors},null,2));
    console.log(`${errors.length?'FAIL':'PASS'} ${target}/${state} ${JSON.stringify(metrics.renderer)} ${metrics.gpu}`);
    if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}await page.close();
  }
}finally{await browser.close();}
