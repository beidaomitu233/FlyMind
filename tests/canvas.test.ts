import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapMovement,resizeBox,resizeHandles,marqueeSelection } from '../src/drawing/core/canvas-geometry'

test('拖动吸附按屏幕阈值，多选保留相对位置，Alt 绕过',()=>{
  const a={x:100,y:100,width:100,height:60},b={x:250,y:180,width:100,height:60},target={x:500,y:100,width:100,height:60}
  const snapped=snapMovement([a,b],[target],{x:156,y:0},1)
  assert.equal(snapped.delta.x,150);assert.ok(snapped.guides.some(g=>g.axis==='x'&&g.value===500))
  const normal=snapMovement([a],[target],{x:406,y:80},1);assert.equal(normal.delta.x,400)
  const close=snapMovement([a],[target],{x:406,y:80},2);assert.equal(close.delta.x,406)
  const zoomedOut=snapMovement([a],[target],{x:414,y:80},.5);assert.equal(zoomedOut.delta.x,400)
  const alt=snapMovement([a],[target],{x:406,y:80},1,true);assert.equal(alt.delta.x,406);assert.equal(alt.guides.length,0)
  const limit=snapMovement([a,b],[],{x:-300,y:0},1);assert.equal(limit.delta.x,-84)
})
test('八方向缩放固定对侧，Shift 保持比例，最小尺寸与图纸边界',()=>{
  const base={x:200,y:200,width:200,height:100}
  for(const h of resizeHandles){const b=resizeBox(base,h,{x:20,y:10});assert.ok(b.width>=72&&b.height>=40);if(h.includes('w'))assert.equal(b.x+b.width,400);if(h.includes('n'))assert.equal(b.y+b.height,300);if(h.includes('e'))assert.equal(b.x,200);if(h.includes('s'))assert.equal(b.y,200)}
  assert.deepEqual(resizeBox(base,'nw',{x:-40,y:-20}),{x:160,y:180,width:240,height:120})
  for(const h of resizeHandles){const b=resizeBox(base,h,{x:50,y:40},true);assert.equal(b.width/b.height,2)}
  const minimum=resizeBox(base,'nw',{x:900,y:900});assert.deepEqual(minimum,{x:328,y:260,width:72,height:40})
  const bounded=resizeBox(base,'nw',{x:-1000,y:-1000},true);assert.ok(Math.abs(bounded.x-16)<1e-8);assert.ok(Math.abs(bounded.x+bounded.width-400)<1e-8);assert.ok(Math.abs(bounded.y+bounded.height-300)<1e-8);assert.equal(bounded.width/bounded.height,2)
})
test('Shift 框选追加且去重，不丢已有选择',()=>{
  const nodes=[{node:{id:'a'},x:100,y:100,width:80,height:50},{node:{id:'b'},x:300,y:100,width:80,height:50}]
  assert.deepEqual(marqueeSelection(nodes,{x:290,y:90,width:100,height:80},['a']),['a','b'])
  assert.deepEqual(marqueeSelection(nodes,{x:290,y:90,width:100,height:80},['b']),['b'])
  assert.deepEqual(marqueeSelection(nodes,{x:290,y:90,width:100,height:80}),['b'])
})
