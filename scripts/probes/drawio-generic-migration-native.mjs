// Focused D07-M: fixed real native load -> public save -> XML -> PNG/SVG.
// No Runtime, SQLite, user records, ELK, or simulated graph/model writes.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {genericMigrationFixture} from './helpers/generic-migration-fixtures.mjs';
import {previewLegacyGeneric,legacyNativeRoute} from '../../src/drawing/engine/migration/legacy-generic.ts';
import {NativeDrawioRenderer} from '../../server/rendering/renderer.ts';
import {DrawioHostController} from '../../src/drawing/engine/drawio-host/controller.ts';
import {projectDrawio,drawioRenderSignature} from '../../src/drawing/engine/drawio/index.ts';
import {validateDocument} from '../../src/drawing/core/model.ts';
import {layoutDocument} from '../../src/drawing/core/layout.ts';
import {renderScene} from '../../src/drawing/core/render.ts';
import {parseNative} from '../../src/drawing/engine/drawio/xml.ts';
import {mainEntry} from '../../src/drawing/engine/drawio/state.ts';
import {absoluteRouteBox} from '../../src/drawing/engine/drawio/routing.ts';
import {DOMParser} from '@xmldom/xmldom';

const out=resolve(process.env.FLYMIND_PROBE_OUTPUT??'output/playwright/drawio-generic-migration');await mkdir(out,{recursive:true});
const renderer=new NativeDrawioRenderer(),report={ok:false,samples:[],noDatabaseOrRuntime:true},original=DrawioHostController.prototype.captureXML,committing=new WeakSet();let name;
// This probe explicitly exercises the public native save action. The renderer
// itself remains untouched and still verifies full content/render signatures.
DrawioHostController.prototype.captureXML=async function(){
 if(committing.has(this))return original.call(this);
 committing.add(this);try{const xml=await this.commitAndCaptureXML();await writeFile(resolve(out,name+'.saved.drawio'),xml);return xml}finally{committing.delete(this)}
};
try{
 for(const kind of ['flowchart','architecture','mindmap','dataflow'].filter(k=>!process.argv.includes('--remaining')||['mindmap','dataflow'].includes(k)))for(const manual of [false,true]){
  name=kind+(manual?'-manual':'-basic');const source=genericMigrationFixture(kind,manual),before=JSON.stringify(source),preview=await previewLegacyGeneric(source);
  await writeFile(resolve(out,name+'.preview.json'),JSON.stringify(preview,null,2));assert.equal(preview.status,'ready',JSON.stringify(preview.diagnostics));const project=preview.project;
  const d=validateDocument(source),scene=layoutDocument(d);await Promise.all([writeFile(resolve(out,name+'.source-v2.json'),JSON.stringify(source,null,2)),writeFile(resolve(out,name+'.legacy.svg'),renderScene(scene,d)),writeFile(resolve(out,name+'.scene.json'),JSON.stringify(scene,null,2))]);
  const rendered=await renderer.render(project);assert.equal(JSON.stringify(source),before);assert.equal((await projectDrawio(rendered.nativeXML)).contentHash,preview.contentHash);assert.equal(drawioRenderSignature(rendered.nativeXML),drawioRenderSignature(project.rendering.engine.xml));
  const native=parseNative(rendered.nativeXML);for(const node of scene.nodes){const b=absoluteRouteBox(native,mainEntry(native,'node',node.node.id));assert.deepEqual([b.x,b.y,b.w,b.h],[node.x,node.y,node.width,node.height])}
  await writeFile(resolve(out,name+'.native-raw.svg'),rendered.nativeSVG??rendered.svg);const curveEvidence=[];
  if(kind==='mindmap'){
   const svg=new DOMParser().parseFromString(rendered.nativeSVG,'image/svg+xml'),rootNode=scene.nodes.find(n=>!n.node.parentId&&n.node.kind!=='note'),group=Array.from({length:svg.getElementsByTagName('g').length},(_,i)=>svg.getElementsByTagName('g').item(i)).find(e=>e.getAttribute('data-cell-id')==='fm:node:'+encodeURIComponent(rootNode.node.id)),rect=group.getElementsByTagName('rect').item(0),translate={x:Number(rect.getAttribute('x'))-rootNode.x,y:Number(rect.getAttribute('y'))-rootNode.y};
   const paths=[...(rendered.nativeSVG??'').matchAll(/\bd="([^"]*C[^"]*)"/g)].map(m=>m[1]);
   for(const e of scene.edges){const r=legacyNativeRoute(e.path);if(!r.bezier)continue;const expected=r.points.flatMap(p=>[p.x+translate.x,p.y+translate.y]);const actual=paths.find(path=>{const values=path.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)?.map(Number);return values?.length===expected.length&&values.every((v,i)=>Math.abs(v-expected[i])<=.01)});assert.ok(actual,`native cubic controls mismatch: ${JSON.stringify({expected,translate,path:e.path,native:paths})}`);curveEvidence.push({edgeId:e.edge.id,legacy:e.path,native:actual,exportTranslation:translate,exact:true})}
  }
  await Promise.all([writeFile(resolve(out,name+'.png'),rendered.png),writeFile(resolve(out,name+'.svg'),rendered.svg),writeFile(resolve(out,name+'.native-raw.svg'),rendered.nativeSVG??rendered.svg),writeFile(resolve(out,name+'.project.json'),JSON.stringify(project,null,2))]);
  report.samples.push({name,width:rendered.width,height:rendered.height,sourceHash:preview.sourceHash,contentHash:preview.contentHash,geometryDigest:preview.geometryDigest,sourceUnchanged:true,publicNativeSave:true,strictNativeSignature:true,allAbsoluteBoxesExact:true,curveEvidence,warnings:preview.diagnostics,timings:rendered.timings});console.log(name+' ok');
 }
 report.ok=true;
}catch(error){report.error=error.stack;process.exitCode=1}
finally{DrawioHostController.prototype.captureXML=original;await renderer.close();report.rendererClosed=true;await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
