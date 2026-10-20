// Synthetic screenshot reconstructions; no DB, UI runtime, or user data.
import {mkdir,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import assert from 'node:assert/strict';
import {NativeDrawioRenderer} from '../../server/rendering/renderer.ts';
import {compileDrawio,projectDrawio,drawioRenderSignature} from '../../src/drawing/engine/drawio/index.ts';
import {createDrawingProject} from '../../src/drawing/engine/project.ts';
import {parseNative} from '../../src/drawing/engine/drawio/xml.ts';
import {inspectNativeLayout} from '../../src/drawing/engine/drawio/routing.ts';
import {layerHeaders,componentCollaboration,wideMindmap,compactFlow} from '../../tests/fixtures/drawing-quality/scenarios.ts';
const out=resolve(process.env.FLYMIND_PROBE_OUTPUT??'output/playwright/drawing-quality-layout');await mkdir(out,{recursive:true});
const renderer=new NativeDrawioRenderer(),report={ok:false,samples:[]};
try{for(const factory of [layerHeaders,componentCollaboration,wideMindmap,compactFlow].filter(f=>!process.env.FLYMIND_PROBE_ONLY||f.name===process.env.FLYMIND_PROBE_ONLY)){
 const content=factory(),engine=await compileDrawio(content),project=await createDrawingProject(content,engine,{createdAt:1,updatedAt:1});
 await writeFile(join(out,content.id+'.content.json'),JSON.stringify(content,null,2));await writeFile(join(out,content.id+'.input.drawio'),engine.xml);
 const r=await renderer.render(project);assert.deepEqual((await projectDrawio(r.nativeXML)).content,content);assert.equal(drawioRenderSignature(r.nativeXML),drawioRenderSignature(engine.xml));
 const issues=inspectNativeLayout(parseNative(r.nativeXML),true);assert.ok(!issues.some(i=>i.code!=='UNREADABLE_ASPECT_RATIO'),JSON.stringify(issues));
 await Promise.all([writeFile(join(out,content.id+'.png'),r.png),writeFile(join(out,content.id+'.svg'),r.svg),writeFile(join(out,content.id+'.drawio'),r.nativeXML)]);
 report.samples.push({id:content.id,width:r.width,height:r.height,orientation:project.rendering.preferences.orientation??'vertical',nodes:content.nodes.length,edges:content.edges.length,contentHash:engine.contentHash,issues,timings:r.timings});
 }report.ok=true}catch(error){report.error=error.stack;process.exitCode=1}finally{await renderer.close();await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
