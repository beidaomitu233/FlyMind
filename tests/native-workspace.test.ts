import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildNativeWorkspaceView,type WorkspaceMetadata} from '../src/drawing/state/native-workspace'

const groups=[{id:'later',name:'后建组',createdAt:20},{id:'first',name:'先建组',createdAt:10}]
const item=(id:string,group:string|null=null,overrides:Partial<WorkspaceMetadata>={}):WorkspaceMetadata=>({id,title:id,createdAt:10,updatedAt:20,workspaceGroupId:group,...overrides})
const ids=(rows:{item:WorkspaceMetadata}[])=>rows.map(row=>row.item.id)

test('grouped/ungrouped are exclusive, canvas metadata needs no kind/content, and trash never appears as active',()=>{
 const canvas=item('canvas','first',{mode:'canvas-only'}),items=[item('business',null,{kind:'swimlane'}),canvas,item('grouped','later'),item('deleted',null,{deletedAt:500})],before=structuredClone(items),view=buildNativeWorkspaceView({items,groups})
 assert.deepEqual(view.sections.map(s=>s.groupId),['first','later',null]);assert.deepEqual(ids(view.sections[0].rows),['canvas']);assert.deepEqual(ids(view.sections[2].rows),['business'])
 const all=view.sections.flatMap(s=>ids(s.rows));assert.equal(new Set(all).size,3);assert.ok(!all.includes('deleted'));assert.equal(view.sections[0].rows[0].item,canvas);assert.equal(canvas.kind,undefined);assert.ok(!('content'in canvas));assert.deepEqual(items,before)
})
test('search ignores outer whitespace/Latin case, crosses groups once, and reports current ownership',()=>{
 const items=[item('one','first',{title:'Pump 设计'}),item('two',null,{title:'pump校验'}),item('three','later',{title:'其他'})],v=buildNativeWorkspaceView({items,groups,preferences:{search:'  PUMP  '}})
 assert.equal(v.searching,true);assert.deepEqual(ids(v.searchRows),['one','two']);assert.deepEqual(v.searchRows.map(r=>r.groupName),['先建组','未分组']);assert.equal(new Set(ids(v.searchRows)).size,2)
 const cleared=buildNativeWorkspaceView({items,groups,preferences:{search:' ',expandedGroupIds:['first']},previousOrder:v.order});assert.equal(cleared.searching,false);assert.equal(cleared.sections[0].expanded,true)
})
test('modified/created ordering uses document timestamps with deterministic ID ties, regardless of input ordering',()=>{
 const items=[item('z',null,{createdAt:30,updatedAt:20}),item('b',null,{createdAt:10,updatedAt:50}),item('a',null,{createdAt:20,updatedAt:50})]
 assert.deepEqual(ids(buildNativeWorkspaceView({items,groups:[]}).sections[0].rows),['a','b','z'])
 assert.deepEqual(ids(buildNativeWorkspaceView({items:[...items].reverse(),groups:[],preferences:{sort:'createdAt'}}).sections[0].rows),['z','a','b'])
})
test('first five expand by section and current/edited rows beyond five remain visible without duplicating them',()=>{
 const items=Array.from({length:8},(_,i)=>item('n'+i,'first',{updatedAt:100-i})),v=buildNativeWorkspaceView({items,groups,currentId:'n7',editingIds:['n6']})
 assert.deepEqual(ids(v.sections[0].rows),['n0','n1','n2','n3','n4','n6','n7']);assert.equal(v.sections[0].hiddenCount,1);assert.equal(v.sections[0].total,8)
 const expanded=buildNativeWorkspaceView({items,groups,preferences:{expandedGroupIds:['first']}});assert.equal(expanded.sections[0].rows.length,8);assert.equal(expanded.sections[0].hiddenCount,0);assert.equal(expanded.sections[1].expanded,false)
})
test('inline rename/menu keeps existing sibling slots during refresh, then applies latest sort after editing ends',()=>{
 const items=[item('a','first',{updatedAt:30}),item('b','first',{updatedAt:20}),item('c','first',{updatedAt:10})],prior=buildNativeWorkspaceView({items,groups})
 const refreshed=[{...items[0],updatedAt:35},{...items[1],title:'正在改名',updatedAt:60},{...items[2],updatedAt:90},item('new','first',{updatedAt:100})],before=structuredClone(refreshed)
 const editing=buildNativeWorkspaceView({items:refreshed,groups,editingIds:['b'],previousOrder:prior.order});assert.deepEqual(ids(editing.sections[0].rows),['a','b','c','new'])
 const settled=buildNativeWorkspaceView({items:refreshed,groups,previousOrder:editing.order});assert.deepEqual(ids(settled.sections[0].rows),['new','c','b','a']);assert.deepEqual(refreshed,before)
})
test('editing a matching search row does not make its input disappear when its draft title stops matching',()=>{
 const original=[item('a','first',{title:'Pump A',updatedAt:30}),item('b',null,{title:'Pump B',updatedAt:20})],prior=buildNativeWorkspaceView({items:original,groups,preferences:{search:'pump'}}),renamed=[{...original[0],title:'已改名'},original[1]]
 const editing=buildNativeWorkspaceView({items:renamed,groups,preferences:{search:'pump'},editingIds:['a'],previousOrder:prior.order});assert.deepEqual(ids(editing.searchRows),['a','b']);assert.equal(editing.searchRows[0].matchesSearch,false)
 assert.deepEqual(ids(buildNativeWorkspaceView({items:renamed,groups,preferences:{search:'pump'},previousOrder:editing.order}).searchRows),['b'])
})
test('external move/delete wins over frozen order and reports interrupted inline targets instead of stale duplicates',()=>{
 const original=[item('a','first'),item('b','first'),item('c','first')],prior=buildNativeWorkspaceView({items:original,groups})
 const v=buildNativeWorkspaceView({items:[{...original[0],workspaceGroupId:'later'},original[2]],groups,editingIds:['a','b'],previousOrder:prior.order})
 assert.deepEqual(ids(v.sections[0].rows),['c']);assert.deepEqual(ids(v.sections[1].rows),['a']);assert.deepEqual(v.relocatedEditingIds,['a']);assert.deepEqual(v.removedEditingIds,['b'])
 const stale=buildNativeWorkspaceView({items:[item('orphan','removed')],groups});assert.equal(stale.sections[2].rows[0].unavailableGroupId,'removed');assert.equal(stale.sections[2].rows[0].groupName,'原分组不可用');assert.equal(stale.sections.flatMap(s=>s.rows).length,1)
})
