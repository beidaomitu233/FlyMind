import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {technicalReferenceContent} from '../../src/drawing/core/technical-sample.ts'
import {compileDrawio,projectDrawio,patchDrawio} from '../../src/drawing/engine/drawio/index.ts'
import {createDrawingProject} from '../../src/drawing/engine/project.ts'
import {NativeDrawioRenderer} from '../../server/rendering/renderer.ts'
import {parseNative,attr,children} from '../../src/drawing/engine/drawio/xml.ts'

const out=resolve(process.env.FLYMIND_PROBE_OUTPUT??'output/u30-technical-reference');await mkdir(out,{recursive:true})
const renderer=new NativeDrawioRenderer(),report={ok:false,source:'user supplied screenshot c2a93565; 24 total nodes including 2 clients; 9 groups',samples:[]}
try{
 const content=technicalReferenceContent(),engine=await compileDrawio(content),project=await createDrawingProject(content,engine,{createdAt:1,updatedAt:1}),projected=await projectDrawio(engine.xml)
 assert.deepEqual(projected.content,content);assert.equal(content.nodes.length,24);assert.equal(content.groups.length,9)
 const native=parseNative(engine.xml),icons=[...native.cells.values()].filter(e=>attr(e.object,'fmRole')==='technology-icon');assert.equal(icons.length,24);assert.ok(icons.every(e=>Number(attr(children(e.cell,'mxGeometry')[0],'width'))===72))
 const before=new Map([...native.cells].map(([id,e])=>[id,{geometry:children(e.cell,'mxGeometry')[0]?.toString(),style:attr(e.cell,'style')}]))
 const patched=await patchDrawio(project,[{op:'update_node',id:'admin-app',changes:{label:'管理后台应用'}}]),after=parseNative(patched.xml)
 for(const [id,signature]of before)assert.deepEqual({geometry:children(after.cells.get(id).cell,'mxGeometry')[0]?.toString(),style:attr(after.cells.get(id).cell,'style')},signature,'ordinary wording must preserve native layout/style: '+id)
 const image=await renderer.render(project)
 await Promise.all([writeFile(resolve(out,'reference.content.json'),JSON.stringify(content,null,2)),writeFile(resolve(out,'reference.project.json'),JSON.stringify(project,null,2)),writeFile(resolve(out,'reference.drawio'),engine.xml),writeFile(resolve(out,'reference.png'),image.png),writeFile(resolve(out,'reference.svg'),image.svg)])
 report.samples.push({name:'full-reference',nodes:content.nodes.length,groups:content.groups.length,edges:content.edges.length,width:image.width,height:image.height,pngBytes:image.png.length,originalWordingPatchPreservesGeometryStyle:true,iconSize:72,runtime:image.runtime});report.ok=true
}catch(error){report.error=error.stack;process.exitCode=1}finally{await renderer.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
