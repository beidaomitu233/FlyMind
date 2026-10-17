import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compileDrawio,projectDrawio,normalizeDrawioEdits,patchDrawio} from '../src/drawing/engine/drawio'
import {createDrawingProject} from '../src/drawing/engine/project'
import {parseNative,serialize,attr,children} from '../src/drawing/engine/drawio/xml'
import {mainEntry,cellSignature,geometry} from '../src/drawing/engine/drawio/state'
import {writeControlledNode,controlledChildren} from '../src/drawing/engine/drawio/controlled'
import type {DiagramContent} from '../src/drawing/core/model'
const content=():DiagramContent=>({schemaVersion:1,id:'controlled-fields',title:'可见字段',kind:'swimlane',nodes:[{id:'a',kind:'task',label:'核验材料',laneId:'r',phaseId:'p',description:'核对来源与必要条件',items:['材料齐全','责任明确'],badge:'复核'},{id:'b',kind:'note',label:'浮动说明',description:'说明正文应当可见',laneId:'r',phaseId:'p'}],edges:[],lanes:[{id:'r',label:'办理人'}],phases:[{id:'p',label:'办理'}],groups:[]})
async function fixture(){const c=content(),engine=await compileDrawio(c),n=parseNative(engine.xml);for(const node of c.nodes)writeControlledNode(n,mainEntry(n,'node',node.id),node);engine.xml=serialize(n.document);return createDrawingProject(c,engine,{createdAt:1,updatedAt:1})}
test('controlled title/body/items/badge are visible native text, including note description, not a second hidden content copy',async()=>{
 const p=await fixture(),n=parseNative(p.rendering.engine.xml);assert.deepEqual((await projectDrawio(p.rendering.engine.xml)).content,p.content)
 const a=mainEntry(n,'node','a'),parts=controlledChildren(n,a);assert.equal(attr(a.object,'label'),'');for(const key of ['fmDescription','fmItems','fmBadge'])assert.equal(attr(a.object,key),undefined)
 assert.deepEqual(parts.map(e=>attr(e.object,'fmRole')),['title','body','item','item','badge']);assert.ok(parts.every(e=>attr(e.cell,'vertex')==='1'&&Number(attr(geometry(e),'height'))>0));assert.ok(controlledChildren(n,mainEntry(n,'node','b')).some(e=>attr(e.object,'fmRole')==='body'&&attr(e.object,'label')==='说明正文应当可见'))
})
test('native text edits and serialized array order project correctly; missing or duplicate children reject',async()=>{
 const p=await fixture(),n=parseNative(p.rendering.engine.xml),a=mainEntry(n,'node','a'),parts=controlledChildren(n,a),body=parts.find(e=>attr(e.object,'fmRole')==='body')!,item=parts.find(e=>attr(e.object,'fmRole')==='item')!;body.object.setAttribute('label','人工修改正文');item.object.setAttribute('label','人工修改首项');for(const part of [...parts].reverse())n.root.appendChild(part.object)
 const projected=await normalizeDrawioEdits(serialize(n.document),p);assert.equal(projected.content.nodes[0].description,'人工修改正文');assert.deepEqual(projected.content.nodes[0].items,['人工修改首项','责任明确'])
 const bad=parseNative(projected.xml),title=controlledChildren(bad,mainEntry(bad,'node','a')).find(e=>attr(e.object,'fmRole')==='title')!;title.object.parentNode!.removeChild(title.object);await assert.rejects(()=>projectDrawio(serialize(bad.document)),/MISSING_CONTROLLED_ELEMENT/)
 const duplicate=parseNative(projected.xml),items=controlledChildren(duplicate,mainEntry(duplicate,'node','a')).filter(e=>attr(e.object,'fmRole')==='item');items.find(e=>attr(e.object,'fmItemIndex')==='1')!.object.setAttribute('fmItemIndex','0');await assert.rejects(()=>projectDrawio(serialize(duplicate.document)),/DUPLICATE_CONTROLLED_BINDING/)
})
test('native subtree copies receive a new main ID and matching controlled IDs without changing the original',async()=>{
 const p=await fixture(),n=parseNative(p.rendering.engine.xml),a=mainEntry(n,'node','a'),original=cellSignature(a),parts=controlledChildren(n,a),copyId='native-copy';const clone=(e:typeof a,newId:string,parent:string)=>{const o=e.object.cloneNode(true) as Element;o.setAttribute('id',newId);children(o,'mxCell')[0].setAttribute('parent',parent);n.root.appendChild(o)};clone(a,copyId,attr(a.cell,'parent')!);parts.forEach((e,i)=>clone(e,'native-copy-field-'+i,copyId))
 const result=await normalizeDrawioEdits(serialize(n.document),p),normalized=parseNative(result.xml),copied=result.content.nodes.find(node=>!p.content.nodes.some(old=>old.id===node.id))!;assert.ok(copied);assert.deepEqual({...copied,id:'a'},p.content.nodes[0]);assert.equal(cellSignature(mainEntry(normalized,'node','a')),original);for(const child of controlledChildren(normalized,mainEntry(normalized,'node',copied.id)))assert.equal(attr(child.object,'fmId'),copied.id)
})
test('confirmed native deletion removes only the visible optional field/item; standalone damaged imports still reject',async()=>{
 const p=await fixture(),n=parseNative(p.rendering.engine.xml),a=mainEntry(n,'node','a'),parts=controlledChildren(n,a);for(const part of parts.filter(e=>['body','badge'].includes(attr(e.object,'fmRole')!)||attr(e.object,'fmRole')==='item'&&attr(e.object,'fmItemIndex')==='0'))part.object.parentNode!.removeChild(part.object)
 const raw=serialize(n.document);await assert.rejects(()=>projectDrawio(raw),/MISSING_CONTROLLED_ELEMENT/);const normalized=await normalizeDrawioEdits(raw,p),node=normalized.content.nodes[0];assert.equal(node.description,undefined);assert.equal(node.badge,undefined);assert.deepEqual(node.items,['责任明确']);assert.equal(node.label,'核验材料');assert.deepEqual(normalized.content.nodes[1],p.content.nodes[1])
 const acknowledged=await createDrawingProject(normalized.content,{...p.rendering.engine,xml:normalized.xml,contentHash:normalized.contentHash},{createdAt:1,updatedAt:2}),newer=parseNative(raw);controlledChildren(newer,mainEntry(newer,'node','a')).find(e=>attr(e.object,'fmRole')==='item')!.object.setAttribute('label','B晚于A继续输入');assert.deepEqual((await normalizeDrawioEdits(serialize(newer.document),acknowledged)).content.nodes[0].items,['B晚于A继续输入'])
})
test('a native item-only copy under the confirmed main appends one business item; singleton copies remain ambiguous',async()=>{
 const p=await fixture(),n=parseNative(p.rendering.engine.xml),a=mainEntry(n,'node','a'),item=controlledChildren(n,a).find(e=>attr(e.object,'fmRole')==='item')!,clone=item.object.cloneNode(true) as Element;clone.setAttribute('id','copied-item');n.root.appendChild(clone);const raw=serialize(n.document);await assert.rejects(()=>projectDrawio(raw),/DUPLICATE_CONTROLLED_BINDING/);const edited=await normalizeDrawioEdits(raw,p);assert.deepEqual(edited.content.nodes[0].items,['材料齐全','责任明确','材料齐全'])
 const title=controlledChildren(n,a).find(e=>attr(e.object,'fmRole')==='title')!,ambiguous=title.object.cloneNode(true) as Element;ambiguous.setAttribute('id','copied-title');n.root.appendChild(ambiguous);await assert.rejects(()=>normalizeDrawioEdits(serialize(n.document),p),/DUPLICATE_CONTROLLED_BINDING/)
})
test('AI changes update actual controlled text and local height while leaving another node subtree exact',async()=>{
 const p=await fixture(),old=parseNative(p.rendering.engine.xml),note=mainEntry(old,'node','b'),preserved=[note,...controlledChildren(old,note)].map(e=>[e.id,cellSignature(e)]),engine=await patchDrawio(p,[{op:'update_node',id:'a',changes:{description:'实际修改正文并保留核验条件。'.repeat(25),items:['更新第一项','更新第二项','新增第三项'],badge:'终审'}}]),projected=await projectDrawio(engine.xml),n=parseNative(engine.xml)
 assert.equal(projected.content.nodes[0].badge,'终审');assert.equal(projected.content.nodes[0].items!.length,3);assert.ok(Number(attr(geometry(mainEntry(n,'node','a')),'height'))>Number(attr(geometry(mainEntry(old,'node','a')),'height')));for(const[id,sig]of preserved)assert.equal(cellSignature(n.cells.get(id)!),sig)
})
