import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copy,validateDocument } from '../src/drawing/core/model'
import { sampleFor,samples } from '../src/drawing/core/samples'
import { layoutDocument } from '../src/drawing/core/layout'
import { renderScene,renderDrawio } from '../src/drawing/core/render'
import { createFragment,parseFragment,pasteFragment } from '../src/drawing/core/clipboard'
import { groupObjects,ungroupObjects,expandGroups,lockObjects,assertLockedObjects,reorderObjects,scaleSelection } from '../src/drawing/core/objects'
import { extractContent,applyContentOperations,replaceContent,projectDocument } from '../src/drawing/core/layers'
import { placeNodes } from '../src/drawing/core/editor'
import {selectionBounds} from '../src/drawing/core/canvas-geometry'

test('整体缩放的最小节点尺寸保留对角，Shift 仍保持比例',()=>{
  const boxes=[{node:{id:'small'},x:100,y:100,width:40,height:40},{node:{id:'large'},x:200,y:180,width:200,height:80}]
  const result=scaleSelection(boxes,{x:300,y:220,width:100,height:40},'nw',true),bounds=selectionBounds(Object.values(result))!
  assert.equal(result.small.width,32);assert.equal(result.small.height,32)
  assert.equal(bounds.x+bounds.width,400);assert.equal(bounds.y+bounds.height,260)
  assert.ok(Math.abs(bounds.width/bounds.height-300/160)<.001)
})

test('六类选择片段互相粘贴：新 ID、完整关系、目标归属、两层数据均合法',()=>{
  for(const source of samples){const fragment=createFragment(source,layoutDocument(source),source.nodes.map(n=>n.id));assert.ok(!JSON.stringify(fragment.content).includes('positions'));parseFragment(JSON.stringify(fragment))
    for(const sample of samples){const target=copy(sample),oldIds=new Set(target.nodes.map(n=>n.id)),newIds=pasteFragment(target,fragment,{x:700,y:700});validateDocument(target);const scene=layoutDocument(target)
      assert.equal(newIds.length,source.nodes.length);assert.ok(newIds.every(id=>!oldIds.has(id)));assert.equal(new Set(target.nodes.map(n=>n.id)).size,target.nodes.length);assert.equal(scene.nodes.length,target.nodes.length)
      assert.ok(target.edges.every(e=>target.nodes.some(n=>n.id===e.source)&&target.nodes.some(n=>n.id===e.target)))
      if(target.kind==='mindmap')assert.ok(scene.edges.length>=source.edges.length)
      assert.ok(newIds.every(id=>target.presentation.positions[id].width!>=32))
      if(target.kind==='technical'&&source.kind==='technical')assert.deepEqual(newIds.map(id=>target.nodes.find(n=>n.id===id)!.technology),source.nodes.map(n=>n.technology));else if(target.kind!=='technical')assert.ok(newIds.every(id=>target.nodes.find(n=>n.id===id)!.technology===undefined))
    }
  }
})
test('复制组合、内部线路与样式，整体缩放同步折点，原业务内容不变',()=>{
  const d=sampleFor('flowchart'),ids=d.nodes.slice(0,2).map(n=>n.id),scene=layoutDocument(d),edge=d.edges.find(e=>ids.includes(e.source)&&ids.includes(e.target))!
  d.presentation.edges={[edge.id]:{points:[{x:100,y:120}],labelPosition:{x:110,y:120}}};groupObjects(d,ids)
  assert.deepEqual(expandGroups(d,[ids[0]]),ids);const fragment=createFragment(d,scene,[ids[0]]);assert.equal(fragment.content.nodes.length,2)
  const pasted=pasteFragment(d,fragment,{x:800,y:800});assert.ok(Object.values(d.presentation.objects!.groups!).some(m=>m.every(id=>pasted.includes(id))))
  const before=extractContent(d),boxes=layoutDocument(d).nodes.filter(n=>ids.includes(n.node.id)),bounds={x:Math.min(...boxes.map(b=>b.x)),y:Math.min(...boxes.map(b=>b.y)),width:500,height:500},scaled=scaleSelection(boxes,bounds)
  const old=copy(d.presentation.edges![edge.id].points);placeNodes(d,layoutDocument(d),scaled);assert.notDeepEqual(d.presentation.edges![edge.id].points,old);assert.deepEqual(extractContent(d),before);validateDocument(d)
  ungroupObjects(d,ids);assert.ok(!Object.values(d.presentation.objects!.groups!).some(m=>m.includes(ids[0])))
})
test('锁定拒绝人工/MCP 移动修改删除，解锁只修改渲染；组合删除自动清理',()=>{
  const d=sampleFor('flowchart'),id=d.nodes[0].id;lockObjects(d,layoutDocument(d),[id],true);validateDocument(d)
  const changed=copy(d);changed.presentation.positions[id].x!+=20;assert.throws(()=>assertLockedObjects(d,changed),/锁定/)
  const reordered=copy(d);reordered.nodes[0]=Object.fromEntries(Object.entries(reordered.nodes[0]).reverse()) as any;reordered.presentation.positions[id]=Object.fromEntries(Object.entries(reordered.presentation.positions[id]).reverse());assert.doesNotThrow(()=>assertLockedObjects(d,reordered))
  assert.throws(()=>applyContentOperations(d,[{op:'update_node',id,changes:{label:'覆盖'}}]),/锁定/)
  const content=extractContent(d);content.nodes=content.nodes.filter(n=>n.id!==id);content.edges=content.edges.filter(e=>e.source!==id&&e.target!==id);assert.throws(()=>replaceContent(d,content),/锁定/)
  const before=extractContent(d);lockObjects(d,layoutDocument(d),[id],false);assert.deepEqual(extractContent(d),before)
  const pair=d.nodes.slice(0,2).map(n=>n.id);groupObjects(d,pair);const removed=applyContentOperations(d,[{op:'remove_node',id:pair[0]}]);assert.equal(Object.keys(removed.presentation.objects!.groups!).length,0)
  const restored=validateDocument(projectDocument(d));assert.deepEqual(restored.presentation.objects,d.presentation.objects)
})
test('堆叠顺序改变 SVG/draw.io 绘制顺序，不改变语义节点顺序',()=>{
  const d=sampleFor('flowchart'),before=copy(d.nodes),id=d.nodes[0].id;reorderObjects(d,[id],'front');assert.deepEqual(d.nodes,before)
  const svg=renderScene(layoutDocument(d),d);assert.ok(svg.indexOf('data-node-id="'+id+'"')>svg.indexOf('data-node-id="'+d.nodes[1].id+'"'))
  const drawio=renderDrawio(layoutDocument(d),d);assert.ok(drawio.indexOf('id="n-'+id+'"')>drawio.indexOf('id="n-'+d.nodes[1].id+'"'))
  const fragment=createFragment(d,layoutDocument(d),[id]);const invalid=copy(fragment);(invalid.content.nodes[0] as any).x=1;assert.throws(()=>parseFragment(JSON.stringify(invalid)),/内容层/)
})

test('思维导图额外图关系保留，拒绝与自动父子连线重复的 ID',()=>{
  const d=sampleFor('mindmap'),child=d.nodes.find(n=>n.parentId)!
  d.edges.push({id:'extra',source:child.id,target:d.nodes.find(n=>!n.parentId)!.id});validateDocument(d)
  assert.ok(layoutDocument(d).edges.some(e=>e.edge.id==='extra'))
  d.edges[0].id='parent_'+child.id;assert.throws(()=>validateDocument(d),/自动父子连线重复/)
})
