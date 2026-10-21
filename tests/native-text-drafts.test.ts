import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRenderer,h,nextTick,reactive,ref} from 'vue'
import {NativeTextDrafts,snapshotNativeContentFields} from '../src/drawing/state/native-text-drafts'

test('content action snapshots raw fields before a slow capture and exact retry cannot clear newer input',async()=>{
 const drafts=new NativeTextDrafts(),titleKey='diagram-a\n'+JSON.stringify(['','title']),itemsKey='diagram-a\n'+JSON.stringify(['node-a','items'])
 drafts.write(titleKey,'提交的标题');drafts.write(itemsKey,'第一项\n第二项\n')
 const fields=snapshotNativeContentFields(drafts,'diagram-a',[{op:'set_title',title:'提交的标题'},{op:'update_node',id:'node-a',changes:{items:['第一项','第二项']}}])
 let release!:()=>void
 const capture=new Promise<void>(resolve=>{release=resolve})
 const action=(async()=>{await capture;for(const field of fields)drafts.acknowledge(field.key,field.value)})()
 drafts.write(titleKey,'等待时的新标题');drafts.write(itemsKey,'等待时的新条目')
 release();await action
 assert.equal(fields[0].value,'提交的标题');assert.equal(fields[1].value,'第一项\n第二项\n')
 assert.equal(drafts.read(titleKey,''),'等待时的新标题');assert.equal(drafts.read(itemsKey,''),'等待时的新条目')
 // Retrying the same request uses the same snapshots, never a fresh form read.
 for(const field of fields)drafts.acknowledge(field.key,field.value)
 assert.equal(drafts.read(titleKey,''),'等待时的新标题');assert.equal(drafts.read(itemsKey,''),'等待时的新条目')
})

test('input before blur survives Vue status rerenders and remote record updates until its own commit',async()=>{
 // A small Vue renderer exercises the same controlled value/input binding as
 // NativeStudio without starting a browser or loading the native editor.
 type Element={type:string;props:Record<string,any>;children:Element[]}
 const renderer=createRenderer<Element,Element>({
  createElement:type=>({type,props:{},children:[]}),createText:text=>({type:'#text',props:{text},children:[]}),createComment:()=>({type:'#comment',props:{},children:[]}),
  insert:(child,parent)=>{parent.children.push(child)},remove:()=>{},setText:(node,text)=>{node.props.text=text},setElementText:(node,text)=>{node.props.text=text},parentNode:()=>null,nextSibling:()=>null,
  patchProp:(element,key,_old,value)=>{element.props[key]=value},
 })
 const drafts=reactive(new NativeTextDrafts()),committed=ref('新建流程图'),label=ref('收到客户问题'),status=ref('ready'),key='diagram-a\ntitle',labelKey='diagram-a\nnode-label'
 const root:Element={type:'root',props:{},children:[]}
 const app=renderer.createApp({setup:()=>()=>h('div',[
  h('input',{value:drafts.read(key,committed.value),'data-status':status.value,onInput:(event:{target:{value:string}})=>drafts.write(key,event.target.value)}),
  h('textarea',{value:drafts.read(labelKey,label.value),'data-status':status.value,onInput:(event:{target:{value:string}})=>drafts.write(labelKey,event.target.value)}),
 ])})
 app.mount(root);const [input,textarea]=root.children[0].children
 input.props.value='客户反馈处理';input.props.onInput({target:input.props})
 textarea.props.value='接收客户反馈';textarea.props.onInput({target:textarea.props})
 status.value='saving';await nextTick();assert.equal(input.props.value,'客户反馈处理');assert.equal(textarea.props.value,'接收客户反馈')
 committed.value='同事修改的标题';label.value='远端旧字段';status.value='ready';await nextTick();assert.equal(input.props.value,'客户反馈处理');assert.equal(textarea.props.value,'接收客户反馈')
 // A late acknowledgement must not clear a newer keystroke.
 drafts.acknowledge(key,'旧输入');await nextTick();assert.equal(input.props.value,'客户反馈处理')
 committed.value='客户反馈处理';label.value='接收客户反馈';drafts.acknowledge(key,'客户反馈处理');drafts.acknowledge(labelKey,'接收客户反馈');await nextTick();assert.equal(input.props.value,'客户反馈处理');assert.equal(textarea.props.value,'接收客户反馈');assert.equal(drafts.hasDocument('diagram-a'),false)
 drafts.write(labelKey,'接收新的反馈');assert.equal(drafts.hasDocument('diagram-a'),true);assert.equal(drafts.hasDocument('diagram-b'),false)
 app.unmount()
})
