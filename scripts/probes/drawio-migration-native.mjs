// Native fixed Chromium renderer, two migration snapshots; no user DB/Runtime.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {migrationFixture} from './helpers/migration-fixtures.mjs';
import {previewLegacySwimlane} from '../../src/drawing/engine/migration/index.ts';
import {NativeDrawioRenderer} from '../../server/rendering/renderer.ts';
import {DrawioHostController} from '../../src/drawing/engine/drawio-host/controller.ts';
import {projectDrawio,drawioRenderSignature} from '../../src/drawing/engine/drawio/index.ts';
import {validateDocument} from '../../src/drawing/core/model.ts';
import {layoutDocument} from '../../src/drawing/core/layout.ts';
import {inspectDrawing} from '../../src/drawing/core/drawing-quality.ts';
import {parseNative} from '../../src/drawing/engine/drawio/xml.ts';
import {mainEntry} from '../../src/drawing/engine/drawio/state.ts';
import {absoluteRouteBox} from '../../src/drawing/engine/drawio/routing.ts';
const out=resolve('output/playwright/drawio-migration');await mkdir(out,{recursive:true});const renderer=new NativeDrawioRenderer(),report={ok:false,samples:[]};let name;
const capture=DrawioHostController.prototype.captureXML;DrawioHostController.prototype.captureXML=async function(){const xml=await capture.call(this);await writeFile(resolve(out,name+'.captured.drawio'),xml);return xml};
try{for(const manual of [false,true]){
 name=manual?'manual-overrides':'pbs-source';const source=await migrationFixture(manual),before=JSON.stringify(source),preview=await previewLegacySwimlane(source);await writeFile(resolve(out,name+'.preview.json'),JSON.stringify(preview,null,2));assert.equal(preview.status,'ready',JSON.stringify(preview.diagnostics));assert.equal(JSON.stringify(source),before);const project=preview.project;
 await writeFile(resolve(out,name+'.source-v2.json'),JSON.stringify(source,null,2));await writeFile(resolve(out,name+'.input.drawio'),project.rendering.engine.xml);const r=await renderer.render(project);assert.equal((await projectDrawio(r.nativeXML)).contentHash,preview.contentHash);assert.equal(drawioRenderSignature(r.nativeXML),drawioRenderSignature(project.rendering.engine.xml));const scene=layoutDocument(validateDocument(source)),native=parseNative(r.nativeXML);for(const node of scene.nodes){const box=absoluteRouteBox(native,mainEntry(native,'node',node.node.id));assert.deepEqual([box.x,box.y,box.w,box.h],[node.x,node.y,node.width,node.height])}
 await Promise.all([writeFile(resolve(out,name+'.png'),r.png),writeFile(resolve(out,name+'.svg'),r.svg),writeFile(resolve(out,name+'.drawio'),r.nativeXML),writeFile(resolve(out,name+'.scene.json'),JSON.stringify(scene,null,2))]);report.samples.push({name,width:r.width,height:r.height,timings:r.timings,sourceHash:preview.sourceHash,contentHash:preview.contentHash,geometryDigest:preview.geometryDigest,sourceUnchanged:true,strictNativeSignature:true,allNodeGeometryExact:true,quality:inspectDrawing(project.content),warnings:preview.diagnostics});
 }report.ok=true
}catch(error){report.error=error.stack;process.exitCode=1}finally{await renderer.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
