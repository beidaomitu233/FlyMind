import {mkdir,writeFile,stat,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {NativeDrawioRenderer} from '../../server/rendering/renderer.ts';
import {resolveRuntimeAssets} from '../../server/rendering/assets.ts';
import {launchHiddenBrowser,hiddenBrowserSpawnOptions} from '../../server/rendering/hidden-browser.ts';
import {compileDrawio} from '../../src/drawing/engine/drawio/index.ts';
import {createDrawingProject} from '../../src/drawing/engine/project.ts';
const out=resolve(process.env.FLYMIND_PROBE_OUTPUT??'output/playwright/hidden-renderer'),assets=resolveRuntimeAssets(),report={ok:false,scope:'one isolated native export, owned process exit and profile cleanup; no desktop/window inspection'},renderer=new NativeDrawioRenderer();
await mkdir(out,{recursive:true});
try{
 if(process.platform==='win32'){
  const h=await open(assets.browserExecutable,'r'),dos=Buffer.alloc(64),pe=Buffer.alloc(100);await h.read(dos,0,64,0);await h.read(pe,0,100,dos.readUInt32LE(60));await h.close();report.peSubsystem=pe.readUInt16LE(92);assert.equal(report.peSubsystem,3);

 }
 const content={schemaVersion:1,id:'silent-export',kind:'flowchart',title:'后台静默导出核验',nodes:[{id:'a',kind:'task',label:'核对中文需求'},{id:'b',kind:'end',label:'完成导出'}],edges:[{id:'ab',source:'a',target:'b',label:'通过'}],lanes:[],phases:[],groups:[]};
 const project=await createDrawingProject(content,await compileDrawio(content),{createdAt:1,updatedAt:1}),rendered=await renderer.render(project),owned=renderer.ownedBrowser;assert.ok(owned?.pid);
 report.ownedPID=owned.pid;report.spawnOptions=hiddenBrowserSpawnOptions();report.version=rendered.runtime.browserVersion;report.bytes={png:rendered.png.length,svg:Buffer.byteLength(rendered.svg)};report.privatePipeNoTCP=true;
 await Promise.all([writeFile(resolve(out,'silent.png'),rendered.png),writeFile(resolve(out,'silent.svg'),rendered.svg)]);
 await renderer.close();try{process.kill(owned.pid,0);throw Error('Owned browser still alive')}catch(e){if(e.code!=='ESRCH')throw e}
 assert.equal(await stat(owned.profileDirectory).then(()=>true,()=>false),false);report.ownedExited=true;report.profileRemoved=true;
 const started=Date.now();await assert.rejects(()=>launchHiddenBrowser(resolve(out,'missing-browser.exe')),{code:'BROWSER_START_FAILED'});report.missingExecutableMs=Date.now()-started;assert.ok(report.missingExecutableMs<3000);report.ok=true;
}catch(e){report.error=e.stack;process.exitCode=1}
finally{
 await renderer.close().catch(e=>{report.cleanupError=e.message;report.ok=false;process.exitCode=1});

 await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
