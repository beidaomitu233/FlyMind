// D07 foundation batch only: controlled-field builder on existing native
// swimlane grammar. This does not claim the five new template batches complete.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {compileDrawio,projectDrawio,patchDrawio,drawioRenderSignature} from '../../src/drawing/engine/drawio/index.ts';
import {createDrawingProject} from '../../src/drawing/engine/project.ts';
import {parseNative,serialize} from '../../src/drawing/engine/drawio/xml.ts';
import {mainEntry} from '../../src/drawing/engine/drawio/state.ts';
import {writeControlledNode} from '../../src/drawing/engine/drawio/controlled.ts';
import {NativeDrawioRenderer} from '../../server/rendering/renderer.ts';
const out=resolve('output/playwright/drawio-controlled');await mkdir(out,{recursive:true});const renderer=new NativeDrawioRenderer(),report={ok:false,samples:[]};
try{
 const content={schemaVersion:1,id:'visible-fields',title:'原生可见业务字段',kind:'swimlane',nodes:[{id:'begin',kind:'start',label:'收到申请',laneId:'owner',phaseId:'work'},{id:'review',kind:'task',label:'核验材料',description:'核对来源与必要条件，并由负责人确认办理范围。',items:['材料齐全','责任明确'],badge:'复核',laneId:'owner',phaseId:'work'},{id:'finish',kind:'end',label:'完成核验',laneId:'owner',phaseId:'work'},{id:'note',kind:'note',label:'浮动说明',description:'正文是可见且可编辑的原生文本，不藏入完整内容副本。'}],edges:[{id:'first',source:'begin',target:'review'},{id:'last',source:'review',target:'finish'}],lanes:[{id:'owner',label:'办理人员'}],phases:[{id:'work',label:'办理'}],groups:[]};
 const preferences={nodeDefaults:{task:{width:320,height:360,fontSize:18},note:{width:320,height:200,fontSize:16}}},engine=await compileDrawio(content,{preferences}),native=parseNative(engine.xml);for(const node of content.nodes)writeControlledNode(native,mainEntry(native,'node',node.id),node);engine.xml=serialize(native.document);let project=await createDrawingProject(content,engine,{preferences,createdAt:1,updatedAt:1});
 for(const name of ['visible-fields','ai-actual-fields']){
  if(name==='ai-actual-fields'){const e=await patchDrawio(project,[{op:'update_node',id:'review',changes:{label:'复核办理范围',description:'实际AI修改：确认办理范围后核对材料清单。',items:['来源已确认','范围已确认','材料已核对'],badge:'终审'}}]);project=await createDrawingProject((await projectDrawio(e.xml)).content,e,{preferences,createdAt:1,updatedAt:2})}
  const result=await renderer.render(project);assert.equal((await projectDrawio(result.nativeXML)).contentHash,project.rendering.engine.contentHash);assert.equal(drawioRenderSignature(result.nativeXML),drawioRenderSignature(project.rendering.engine.xml));for(const text of ['复核','材料齐全','说明'])if(name==='visible-fields')assert.ok(result.svg.includes(text));await Promise.all([writeFile(resolve(out,name+'.png'),result.png),writeFile(resolve(out,name+'.svg'),result.svg),writeFile(resolve(out,name+'.drawio'),result.nativeXML),writeFile(resolve(out,name+'.project.json'),JSON.stringify(project,null,2))]);report.samples.push({name,width:result.width,height:result.height,timings:result.timings,strictSignature:true,contentHash:project.rendering.engine.contentHash})
 }
 report.ok=true
}catch(error){report.error=error.stack;process.exitCode=1}finally{await renderer.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
