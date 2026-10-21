import type {DiagramOperation} from '../core/operations'

/** Unsubmitted form text is independent of server records and editor autosaves. */
export class NativeTextDrafts {
  private values=new Map<string,string>()
  read(key:string,committed:string):string{return this.values.get(key)??committed}
  write(key:string,value:string):void{this.values.set(key,value)}
  acknowledge(key:string,submitted:string):void{if(this.values.get(key)===submitted)this.values.delete(key)}
  hasDocument(id:string):boolean{return [...this.values.keys()].some(key=>key.startsWith(id+'\n'))}
}

/** Capture at the user action boundary, before capture/flush/network awaits. */
export function snapshotNativeContentFields(drafts:Pick<NativeTextDrafts,'read'>,diagramId:string,operations:DiagramOperation[]):Array<{key:string;value:string}>{
  const field=(name:string,value:unknown,nodeId='')=>{
    const key=diagramId+'\n'+JSON.stringify([nodeId,name])
    return {key,value:drafts.read(key,Array.isArray(value)?value.join('\n'):String(value??''))}
  }
  return operations.flatMap(op=>op.op==='set_title'?[field('title',op.title)]:op.op==='update_node'?Object.entries(op.changes)
    .filter(([name])=>['label','items','badge','description'].includes(name)).map(([name,value])=>field(name,value,op.id)):[])
}
