import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sampleFor} from '../src/drawing/core/samples'
import {validateDocument} from '../src/drawing/core/model'
import {layoutDocument} from '../src/drawing/core/layout'
import {renderScene,renderDrawio} from '../src/drawing/core/render'
import {placeNodes} from '../src/drawing/core/editor'
import {createFragment,pasteFragment} from '../src/drawing/core/clipboard'
import {lockObjects} from '../src/drawing/core/objects'
for(const kind of ['flowchart','swimlane','architecture','mindmap','dataflow'] as const)test(`${kind} 独立文字尺寸随内容，编辑不改变主布局和路线，导出浮在上层`,()=>{
  const d=sampleFor(kind);d.nodes=d.nodes.filter(n=>n.kind!=='note');const before=layoutDocument(d);d.nodes.push({id:'floating',kind:'note',label:'批注'});d.presentation.positions.floating={x:200,y:180,width:900,height:600};let scene=layoutDocument(validateDocument(d)),note=scene.nodes.find(n=>n.node.id==='floating')!
  assert.ok(note.width<80&&note.height<40);assert.deepEqual(scene.nodes.filter(n=>n.node.kind!=='note'),before.nodes);assert.deepEqual(scene.edges,before.edges)
  d.nodes.at(-1)!.label='独立说明文字可以编辑，并自动换行';d.presentation.texts={floating:{width:120,fontSize:20,color:'#8050aa'}};placeNodes(d,scene,{floating:{x:400,y:300}});scene=layoutDocument(d);note=scene.nodes.find(n=>n.node.id==='floating')!;assert.equal(note.x,400);assert.equal(note.width,120);assert.ok(note.height>40);assert.deepEqual(scene.nodes.filter(n=>n.node.kind!=='note'),before.nodes);assert.deepEqual(scene.edges,before.edges)
  const svg=renderScene(scene,d),last=svg.lastIndexOf('data-node-id='),xml=renderDrawio(scene,d);assert.ok(svg.slice(last).startsWith('data-node-id="floating"'));assert.ok(svg.slice(last).includes('font-size="20"'));assert.ok(xml.includes('strokeColor=none'));if(scene.edges.length)assert.ok(xml.indexOf('id="n-floating"')>xml.indexOf('id="e-'+scene.edges[0].edge.id+'"'))
  const fragment=createFragment(d,scene,['floating']),ids=pasteFragment(d,fragment,{x:600,y:300});validateDocument(d);const pasted=layoutDocument(d).nodes.find(n=>n.node.id===ids[0])!;assert.equal(pasted.node.kind,'note');assert.equal(pasted.width,note.width);assert.equal(pasted.height,note.height);assert.deepEqual(d.presentation.texts![ids[0]],d.presentation.texts!.floating)
  lockObjects(d,layoutDocument(d),['floating'],true);assert.equal(layoutDocument(d).nodes.find(n=>n.node.id==='floating')!.height,note.height)
})
