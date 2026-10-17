// Fixed local draw.io routing API smoke: no Runtime, browser, CDN or user data.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const base=resolve('resources/drawio/vendor/js/libavoid-js'),output=resolve('output/playwright/native-g1-routing');await mkdir(output,{recursive:true});
const expected={'libavoid.min.js':'1c963a8f53b464a87c2fba3dc304a720d924fdcda4737cfd950e33f6a4c41c1d','libavoid-routing.js':'9327d57d3c4f3fa04fc1eeb91d7da045c2b1a2ba87df681e029145d3ee2f04b6','LICENSE':'6da7ddf40cfea6f568961825b14478e879875f6ad033fad57889ae5bd52103f4'};
const report={supply:{},routersCreated:0,routersReleased:0,ok:false};const start=performance.now();
try{
 for(const [file,hash] of Object.entries(expected)){const bytes=await readFile(join(base,file)),actual=createHash('sha256').update(bytes).digest('hex');assert.equal(actual,hash);report.supply[file]={sha256:actual,bytes:bytes.length}}
 await import(pathToFileURL(join(base,'libavoid.min.js')).href);const Avoid=await globalThis.__libavoidReady;assert.ok(Avoid&&typeof Avoid.Router==='function','actual initialized Avoid.Router missing');await import(pathToFileURL(join(base,'libavoid-routing.js')).href);assert.equal(typeof globalThis.AvoidRouting?.computeRoutes,'function');
 const pending=[];const tracked=Object.create(Avoid);tracked.Router=function(...args){const router=new Avoid.Router(...args),release=router.delete.bind(router);let deleted=false;report.routersCreated++;router.delete=()=>{if(!deleted){deleted=true;release();report.routersReleased++}};pending.push(()=>router.delete());return router};
 const vertices=[{id:'s',x:0,y:0,w:80,h:40},{id:'obstacle',x:100,y:-20,w:80,h:80},{id:'t',x:240,y:0,w:80,h:40}],edges=[{id:'test',source:'s',target:'t'}];let routes;
 try{routes=globalThis.AvoidRouting.computeRoutes(tracked,vertices,edges,{shapeBufferDistance:16,idealNudgingDistance:14})}finally{for(const release of pending)release()}
 assert.ok(routes.test?.length>=2,'solver failed to route around middle obstacle');const points=[{x:40,y:20},...routes.test,{x:280,y:20}];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];assert.ok(a.x===b.x||a.y===b.y,'non-orthogonal solver output');const crosses=a.x===b.x?a.x>100&&a.x<180&&Math.max(a.y,b.y)>-20&&Math.min(a.y,b.y)<60:a.y>-20&&a.y<60&&Math.max(a.x,b.x)>100&&Math.min(a.x,b.x)<180;assert.equal(crosses,false,'route crosses current node obstacle')}
 assert.equal(report.routersCreated,report.routersReleased);report.route=routes.test;report.elapsedMs=performance.now()-start;report.ok=true;
}catch(error){report.error=error.stack;process.exitCode=1}finally{await writeFile(join(output,'api-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
