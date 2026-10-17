import assert from 'node:assert/strict';
import {createNativeEditor,assertCellsPreserved} from './native-editor.mjs';

export async function prepareG1UI(options){const editor=createNativeEditor(options);await editor.waitReady({zoomPercent:50});await editor.screenshot('g1-initial-pbs');return editor}
export async function round1Human(editor,{editedNodeId='n02',anchorNodeId='n06',label='指定统筹负责人'}={}){
 const before=await editor.snapshot(),from=editor.actions.length;
 await editor.editLabel({nodeId:editedNodeId,label});
 const edited=await editor.moveResize({nodeId:editedNodeId,dx:-40,dy:20,dWidth:32,dHeight:16});
 const anchor=await editor.moveResize({nodeId:anchorNodeId,dx:-32,dy:24});
 const after=await editor.snapshot();await editor.screenshot('g1-round1-human');
 return {before,after,edited:{businessId:editedNodeId,cellId:edited.after.cells.find(c=>c.type==='node'&&c.businessId===editedNodeId)?.cellId},anchor:{businessId:anchorNodeId,cellId:anchor.after.cells.find(c=>c.type==='node'&&c.businessId===anchorNodeId)?.cellId},actions:editor.actions.slice(from)};
}
/** Caller MUST run actual MCP structural patch between round1Human and this round. */
export async function round2Human(editor,{sourceNodeId='g1-test-step',incomingNodeId='n02',outgoingNodeId='n03',laneId='r02',phaseId='p02'}={}){
 const before=await editor.snapshot(),from=editor.actions.length;await editor.zoomTo(25);assert.ok(before.cells.some(c=>c.type==='node'&&c.businessId===sourceNodeId),'MCP round1 test node is missing');
 const copied=await editor.duplicateInto({sourceNodeId,label:'测试副本',laneId,phaseId});
 const incoming=await editor.connect({sourceNodeId:incomingNodeId,targetNodeId:copied.businessId});
 const outgoing=await editor.connect({sourceNodeId:copied.businessId,targetNodeId:outgoingNodeId});
 const temporary=await editor.duplicateInto({sourceNodeId,label:'临时删除测试',laneId,phaseId});
 const deleted=await editor.deleteSelection({nodeId:temporary.businessId});
 const after=await editor.snapshot();assert.ok(!after.cells.some(c=>c.businessId===temporary.businessId));await editor.screenshot('g1-round2-human');
 return {before,after,copy:{businessId:copied.businessId,cellId:copied.cellId},deletedTemporary:{businessId:deleted.businessId,cellId:deleted.cellId},edges:[incoming,outgoing].map(e=>({businessId:e.businessId,cellId:e.cellId,sourceNodeId:e.sourceNodeId,targetNodeId:e.targetNodeId})),actions:editor.actions.slice(from)};
}
export {assertCellsPreserved};
