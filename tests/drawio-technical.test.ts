import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extractContent,validateContent} from '../src/drawing/core/layers'
import {sampleFor} from '../src/drawing/core/samples'
import {compileDrawio,projectDrawio,patchDrawio,normalizeDrawioEdits} from '../src/drawing/engine/drawio'
import {createDrawingProject} from '../src/drawing/engine/project'
import {parseNative,serialize,attr,children} from '../src/drawing/engine/drawio/xml'
import {mainEntry,box,setBox,cellSignature} from '../src/drawing/engine/drawio/state'
import {TECHNOLOGY_ICONS} from '../src/drawing/engine/drawio/technology-icons-data'
// Small contract fixture is stable when the product's full visual sample changes.
const technicalFixture=()=>validateContent({schemaVersion:1,id:'technical-contract',title:'应用技术架构',kind:'technical',groups:[{id:'app',label:'应用服务'},{id:'storage',label:'数据存储'}],lanes:[],phases:[],nodes:[{id:'web',kind:'module',label:'Vue',technology:'vue',groupId:'app'},{id:'service',kind:'module',label:'Spring Boot',technology:'springboot',groupId:'app'},{id:'db',kind:'module',label:'MySQL',technology:'mysql',groupId:'storage'}],edges:[{id:'call',source:'web',target:'service',label:'HTTP'},{id:'store',source:'service',target:'db',label:'业务数据'}]})
test('technical is a distinct semantic kind with offline brand icons and strict editable roundtrip',async()=>{
 const content=technicalFixture(),engine=await compileDrawio(content),native=parseNative(engine.xml)
 assert.deepEqual((await projectDrawio(engine.xml)).content,content)
 for(const node of content.nodes){const owner=mainEntry(native,'node',node.id),icon=native.cells.get(owner.id+':technology-icon')!;assert.equal(attr(icon.object,'fmRole'),'technology-icon');assert.ok(attr(icon.cell,'style')?.includes('image=data:image/svg+xml,'));assert.equal(attr(owner.object,'fmTechnology'),node.technology)}
 assert.equal(TECHNOLOGY_ICONS.vue.svg,TECHNOLOGY_ICONS.vuedotjs.svg)
 const unknown=structuredClone(content);unknown.nodes[0].technology='unlisted-technology';const un=parseNative((await compileDrawio(unknown)).xml);assert.match(attr(un.cells.get(mainEntry(un,'node','web').id+':technology-icon')!.cell,'style')!,/hexagon/)
 assert.throws(()=>validateContent({...content,nodes:[{...content.nodes[0],technology:'https://external/icon.svg'}]}))
})
test('technical manual group/module/icon geometry survives save/project and AI wording change',async()=>{
 const content=technicalFixture();let project=await createDrawingProject(content,await compileDrawio(content),{createdAt:1,updatedAt:1})
 const native=parseNative(project.rendering.engine.xml),module=mainEntry(native,'node','web'),group=mainEntry(native,'layer','app'),other=mainEntry(native,'node','db')
 setBox(module,{width:260,height:180});module.cell.setAttribute('style',attr(module.cell,'style')+';fillColor=#fff4d8;rounded=1;strokeWidth=3;');const moduleStyle=attr(module.cell,'style');setBox(group,{width:700,height:350});group.cell.setAttribute('style',attr(group.cell,'style')+';fillColor=#f8f8fa;strokeColor=#60646c;');const title=[...native.cells.values()].find(e=>attr(e.cell,'parent')===module.id&&attr(e.object,'fmRole')==='title')!;setBox(title,{width:230,height:40})
 const before=box(module),groupBefore=cellSignature(group),otherBefore=cellSignature(other),icon=native.cells.get(module.id+':technology-icon')!,iconBefore=cellSignature(icon)
 project.rendering.engine.xml=serialize(native.document);const normalized=await normalizeDrawioEdits(project.rendering.engine.xml,project);assert.deepEqual(normalized.content,content)
 const result=await patchDrawio(project,[{op:'update_node',id:'web',changes:{label:'Vue UI'}}]),after=parseNative(result.xml)
 assert.deepEqual(box(mainEntry(after,'node','web')),before);assert.equal(attr(mainEntry(after,'node','web').cell,'style'),moduleStyle);assert.equal(cellSignature(mainEntry(after,'layer','app')),groupBefore);assert.equal(cellSignature(mainEntry(after,'node','db')),otherBefore);assert.equal(cellSignature(after.cells.get(icon.id)!),iconBefore)
 assert.equal((await projectDrawio(result.xml)).content.nodes.find(n=>n.id==='web')!.label,'Vue UI')
})
test('architecture native module remains freely resizable and wording does not reset manually resized fields',async()=>{
 const content=extractContent(sampleFor('architecture'));const project=await createDrawingProject(content,await compileDrawio(content),{createdAt:1,updatedAt:1}),native=parseNative(project.rendering.engine.xml),node=content.nodes.find(n=>n.kind==='module'&&n.items?.length)!,owner=mainEntry(native,'node',node.id)
 assert.match(attr(owner.cell,'style')!,/recursiveResize=1/);setBox(owner,{width:500,height:400})
 for(const child of native.cells.values())if(attr(child.cell,'parent')===owner.id&&children(child.cell,'mxGeometry').length)setBox(child,{width:450})
 const before=box(owner);project.rendering.engine.xml=serialize(native.document)
 const patched=await patchDrawio(project,[{op:'update_node',id:node.id,changes:{label:'应用模块'}}]);assert.deepEqual(box(mainEntry(parseNative(patched.xml),'node',node.id)),before)
})

test('technical optional groups, technology changes, full text and embedded-resource safety remain strict',async()=>{
 const {assertNativeResourceSafety}=await import('../src/drawing/engine/native-canvas');const content=technicalFixture();content.nodes=content.nodes.map(({groupId,...n})=>n);content.groups=[];content.nodes[0].description='属性中完整保留';content.nodes[0].items=['短能力一','短能力二'];const project=await createDrawingProject(content,await compileDrawio(content),{createdAt:1,updatedAt:1});assert.equal(project.rendering.preferences.orientation,'horizontal');assertNativeResourceSafety(project.rendering.engine.xml);
 const engine=await patchDrawio(project,[{op:'update_node',id:'web',changes:{technology:'react',label:'React UI'}}]);assert.deepEqual((await projectDrawio(engine.xml)).content.nodes[0],{...content.nodes[0],technology:'react',label:'React UI'});assert.match(attr(parseNative(engine.xml).cells.get('fm:node:web:technology-icon')!.cell,'style')!,/image=data:image/);assert.throws(()=>assertNativeResourceSafety(engine.xml.replace(/image=data:image\/svg\+xml,[^;]+;/,'image=data:image/svg+xml,%3Csvg%20onload%3D%22alert(1)%22%2F%3E;')),/UNSAFE_NATIVE_RESOURCE/);
})

test('technical explicit relayout respects direction without changing semantic content',async()=>{
 const {configureDrawio}=await import('../src/drawing/engine/drawio/configure');const content=technicalFixture();const base=await createDrawingProject(content,await compileDrawio(content),{createdAt:1,updatedAt:1});const configured=await configureDrawio(base,{orientation:'vertical',relayout:true});assert.deepEqual((await projectDrawio(configured.engine.xml)).content,content);assert.equal(configured.engine.contentHash,base.rendering.engine.contentHash);assert.equal(configured.preferences.orientation,'vertical');
})

test('technical wording preserves deleted or individually restyled native icon',async()=>{
 const content=technicalFixture(),project=await createDrawingProject(content,await compileDrawio(content),{createdAt:1,updatedAt:1}),n=parseNative(project.rendering.engine.xml),owner=mainEntry(n,'node','web'),icon=n.cells.get(owner.id+':technology-icon')!;icon.object.parentNode!.removeChild(icon.object);project.rendering.engine.xml=serialize(n.document);const engine=await patchDrawio(project,[{op:'update_node',id:'web',changes:{label:'Vue UI'}}]);assert.equal(parseNative(engine.xml).cells.has(icon.id),false);
 const fresh=parseNative((await compileDrawio(content)).xml),restyled=fresh.cells.get(icon.id)!;setBox(restyled,{width:60,height:52});restyled.cell.setAttribute('style',attr(restyled.cell,'style')+';rotation=15;opacity=80;');const before=cellSignature(restyled);project.rendering.engine.xml=serialize(fresh.document);const result=await patchDrawio(project,[{op:'update_node',id:'web',changes:{label:'Vue UI'}}]);assert.equal(cellSignature(parseNative(result.xml).cells.get(icon.id)!),before);
})
