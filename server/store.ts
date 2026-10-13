import { mkdir, readFile, writeFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { validateDocument, copy, type DiagramDocument } from '../src/drawing/core/model'
import { projectDocument } from '../src/drawing/core/layers'
import { assertLockedObjects,freezeNewLocks } from '../src/drawing/core/objects'
import { samples } from '../src/drawing/core/samples'
import { applyOperations, type DiagramOperation } from '../src/drawing/core/operations'
export const PROJECT_ROOT=fileURLToPath(new URL('../',import.meta.url))
export const DATA_ROOT=resolve(process.env.FLYMIND_DATA_DIR||join(PROJECT_ROOT,'data'))
export interface DiagramRecord {document:DiagramDocument;revision:number;savedAt:number}
export class StoreError extends Error {constructor(message:string,public status=400,public currentRevision?:number){super(message)}}
export class DiagramStore {
  constructor(public root=DATA_ROOT){}
  id(id:string){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new StoreError('图形 ID 仅支持字母、数字、下划线、短横线（1–100 字）');return id}
  path(id:string){return join(this.root,'diagrams',this.id(id)+'.json')}
  async lock<T>(id:string,fn:()=>Promise<T>):Promise<T>{
    await mkdir(join(this.root,'locks'),{recursive:true});const path=join(this.root,'locks',this.id(id));const deadline=Date.now()+10000
    while(true){try{await mkdir(path);break}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(Date.now()>deadline)throw new StoreError('文件正被另一项操作使用，请稍后重试',423);await new Promise(r=>setTimeout(r,25))}}
    try{return await fn()}finally{await rm(path,{recursive:true,force:true})}
  }
  async init(){await mkdir(join(this.root,'diagrams'),{recursive:true});await this.lock('initialize',async()=>{try{await stat(join(this.root,'.initialized'));return}catch{}for(const d of samples){try{await stat(this.path(d.id))}catch{await this.write({document:copy(d),revision:1,savedAt:Date.now()})}}await writeFile(join(this.root,'.initialized'),'1')})}
  async write(r:DiagramRecord){await mkdir(join(this.root,'diagrams'),{recursive:true});const target=this.path(r.document.id),tmp=target+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify({...r,document:projectDocument(r.document)},null,2),'utf8');await rename(tmp,target)}finally{await rm(tmp,{force:true})}return r}
  async get(id:string):Promise<DiagramRecord>{try{const r=JSON.parse(await readFile(this.path(id),'utf8'));return {...r,document:validateDocument(r.document)}}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new StoreError('图形不存在',404);throw e}}
  async list(){const files=await readdir(join(this.root,'diagrams'));return Promise.all(files.filter(f=>f.endsWith('.json')).map(f=>this.get(f.slice(0,-5))))}
  async create(input:unknown){const d=validateDocument(input);freezeNewLocks(d);this.id(d.id);return this.lock(d.id,async()=>{try{await stat(this.path(d.id));throw new StoreError('该图形 ID 已存在，请读取后更新，或使用新的 ID',409)}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}d.updatedAt=Date.now();return this.write({document:d,revision:1,savedAt:Date.now()})})}
  async update(id:string,revision:number,input:unknown){return this.change(id,revision,()=>validateDocument(input))}
  async patch(id:string,revision:number,ops:DiagramOperation[]){return this.change(id,revision,d=>applyOperations(d,ops))}
  async change(id:string,revision:number,fn:(d:DiagramDocument)=>DiagramDocument){return this.lock(id,async()=>{const prev=await this.get(id);if(!Number.isInteger(revision)||revision!==prev.revision)throw new StoreError(`版本冲突：当前为 ${prev.revision}，请读取最新图形后再修改`,409,prev.revision);const next=validateDocument(fn(copy(prev.document)));assertLockedObjects(prev.document,next);freezeNewLocks(next,prev.document);next.id=id;next.updatedAt=Date.now();return this.write({document:next,revision:prev.revision+1,savedAt:Date.now()})})}
  async delete(id:string,revision:number){await this.lock(id,async()=>{const prev=await this.get(id);if(revision!==prev.revision)throw new StoreError('版本冲突，请读取最新图形',409);await rm(this.path(id))})}
}
