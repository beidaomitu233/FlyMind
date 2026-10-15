import { mkdir, readFile, writeFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { validateDocument, copy, type DiagramDocument } from '../src/drawing/core/model'
import { projectDocument } from '../src/drawing/core/layers'
import { assertLockedObjects,freezeNewLocks } from '../src/drawing/core/objects'
import { samples } from '../src/drawing/core/samples'
import { applyOperations, type DiagramOperation } from '../src/drawing/core/operations'
import type { WorkspaceGroup } from '../src/drawing/services/workspace-types'
export const PROJECT_ROOT=fileURLToPath(new URL('../',import.meta.url))
export const DATA_ROOT=resolve(process.env.FLYMIND_DATA_DIR||join(PROJECT_ROOT,'data'))
export interface DiagramRecord {document:DiagramDocument;revision:number;savedAt:number;createdAt?:number;workspaceGroupId?:string|null}
interface Organization { groups:WorkspaceGroup[]; assignments:Record<string,string> }
export class StoreError extends Error {constructor(message:string,public status=400,public currentRevision?:number){super(message)}}
export class DiagramStore {
  constructor(public root=DATA_ROOT){}
  id(id:string){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new StoreError('图形 ID 仅支持字母、数字、下划线、短横线（1–100 字）');return id}
  path(id:string){return join(this.root,'diagrams',this.id(id)+'.json')}
  trashPath(id:string){return join(this.root,'trash',this.id(id)+'.json')}
  async atomic(path:string,value:unknown){const tmp=path+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(value,null,2),'utf8');await rename(tmp,path)}finally{await rm(tmp,{force:true})}}
  async organization():Promise<Organization>{try{return JSON.parse(await readFile(join(this.root,'workspace.json'),'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {groups:[],assignments:{}};throw e}}
  async writeOrganization(value:Organization){await this.atomic(join(this.root,'workspace.json'),value)}
  async deleted(id:string){try{await stat(this.trashPath(id));return true}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e}}
  async assertLive(id:string){if(await this.deleted(id))throw new StoreError('图形已删除，旧备份不能重新创建该 ID；如需恢复，请显式另存为新图形',410)}
  async lock<T>(id:string,fn:()=>Promise<T>,scope='diagram'):Promise<T>{
    const directory=join(this.root,scope==='diagram'?'locks':'system-locks');await mkdir(directory,{recursive:true});const path=join(directory,this.id(id));const deadline=Date.now()+10000
    while(true){try{await mkdir(path);break}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(Date.now()>deadline)throw new StoreError('文件正被另一项操作使用，请稍后重试',423);await new Promise(r=>setTimeout(r,25))}}
    try{return await fn()}finally{await rm(path,{recursive:true,force:true})}
  }
  workspaceLock<T>(fn:()=>Promise<T>){return this.lock('workspace',fn,'system')}
  async init(){await mkdir(join(this.root,'diagrams'),{recursive:true});await mkdir(join(this.root,'trash'),{recursive:true});await this.lock('initialize',async()=>{try{await stat(join(this.root,'.initialized'));return}catch{}for(const d of samples){if(await this.deleted(d.id))continue;try{await stat(this.path(d.id))}catch{await this.write({document:copy(d),revision:1,savedAt:Date.now()})}}await writeFile(join(this.root,'.initialized'),'1')});await this.migrateCreationTimes()}
  async migrateCreationTimes(){
    for(const file of await readdir(join(this.root,'diagrams'))){if(!file.endsWith('.json'))continue;const id=file.slice(0,-5);await this.lock(id,async()=>{if(await this.deleted(id))return;const raw=JSON.parse(await readFile(this.path(id),'utf8'));if(Number.isFinite(raw.createdAt)&&raw.createdAt>0)return;await this.write(await this.get(id))})}
  }
  async write(r:DiagramRecord){r.createdAt??=r.document.createdAt??Date.now();r.document.createdAt=r.createdAt;await mkdir(join(this.root,'diagrams'),{recursive:true});const target=this.path(r.document.id),tmp=target+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify({...r,document:projectDocument(r.document)},null,2),'utf8');await rename(tmp,target)}finally{await rm(tmp,{force:true})}return r}
  async get(id:string):Promise<DiagramRecord>{try{
    await this.assertLive(id);const path=this.path(id),[raw,info]=await Promise.all([readFile(path,'utf8'),stat(path)]),r=JSON.parse(raw),document=validateDocument(r.document)
    let createdAt=r.createdAt||document.createdAt
    if(!Number.isFinite(createdAt)||createdAt<=0){try{const first=JSON.parse(await readFile(join(this.root,'artifacts',id,'r1','diagram.project.json'),'utf8'));createdAt=first.createdAt||first.updatedAt}catch{}}
    if(!Number.isFinite(createdAt)||createdAt<=0)createdAt=Math.min(...[info.birthtimeMs,info.mtimeMs,r.savedAt,document.updatedAt].filter(v=>Number.isFinite(v)&&v>0))
    await this.assertLive(id);document.createdAt=createdAt;return {...r,createdAt,document,workspaceGroupId:(await this.organization()).assignments[id]||null}
  }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new StoreError('图形不存在',404);throw e}}
  async list(){const files=await readdir(join(this.root,'diagrams')),records=await Promise.all(files.filter(f=>f.endsWith('.json')).map(async f=>{try{return await this.get(f.slice(0,-5))}catch(e){if(e instanceof StoreError&&[404,410].includes(e.status))return null;throw e}}));return records.filter((r):r is DiagramRecord=>!!r).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)||a.document.id.localeCompare(b.document.id))}
  async snapshot(){return this.workspaceLock(async()=>({diagrams:await this.list(),groups:(await this.organization()).groups,deletedIds:(await readdir(join(this.root,'trash'))).filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5))}))}
  async create(input:unknown,workspaceGroupId?:string|null){const d=validateDocument(input);freezeNewLocks(d);this.id(d.id);return this.workspaceLock(async()=>{const org=await this.organization();this.checkGroup(org,workspaceGroupId);return this.lock(d.id,async()=>{await this.assertLive(d.id);try{await stat(this.path(d.id));throw new StoreError('该图形 ID 已存在，请读取后更新，或使用新的 ID',409)}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}d.updatedAt=Date.now();d.createdAt=d.updatedAt;const r=await this.write({document:d,revision:1,savedAt:Date.now(),createdAt:d.createdAt});if(workspaceGroupId){org.assignments[d.id]=workspaceGroupId;await this.writeOrganization(org)}return {...r,workspaceGroupId:workspaceGroupId||null}})})}
  async update(id:string,revision:number,input:unknown){return this.change(id,revision,()=>validateDocument(input))}
  async patch(id:string,revision:number,ops:DiagramOperation[]){return this.change(id,revision,d=>applyOperations(d,ops))}
  async change(id:string,revision:number,fn:(d:DiagramDocument)=>DiagramDocument){return this.lock(id,async()=>{const prev=await this.get(id);if(!Number.isInteger(revision)||revision!==prev.revision)throw new StoreError(`版本冲突：当前为 ${prev.revision}，请读取最新图形后再修改`,409,prev.revision);const next=validateDocument(fn(copy(prev.document)));assertLockedObjects(prev.document,next);freezeNewLocks(next,prev.document);next.id=id;next.createdAt=prev.createdAt;next.updatedAt=Date.now();const saved=await this.write({document:next,revision:prev.revision+1,savedAt:Date.now(),createdAt:prev.createdAt});return {...saved,workspaceGroupId:(await this.organization()).assignments[id]||null}})}
  async delete(id:string,revision:number){await this.workspaceLock(()=>this.lock(id,async()=>{if(await this.deleted(id))return;const prev=await this.get(id);if(revision!==prev.revision)throw new StoreError('版本冲突，请读取最新图形',409,prev.revision);await mkdir(join(this.root,'trash'),{recursive:true});await this.atomic(this.trashPath(id),{deletedAt:Date.now(),record:{...prev,document:projectDocument(prev.document)}});await rm(this.path(id),{force:true});const org=await this.organization();delete org.assignments[id];await this.writeOrganization(org)}))}
  checkGroup(org:Organization,id?:string|null){if(id&&!org.groups.some(g=>g.id===id))throw new StoreError('工作区分组不存在',404)}
  groupName(name:string){if(typeof name!=='string'||!name.trim()||name.trim().length>80)throw new StoreError('分组名称需为 1–80 字');return name.trim()}
  async listGroups(){return (await this.organization()).groups}
  async createGroup(name:string){return this.workspaceLock(async()=>{const org=await this.organization(),normalized=this.groupName(name);if(org.groups.some(g=>g.name===normalized))throw new StoreError('分组名称已存在',409);const now=Date.now(),group={id:'group_'+randomUUID(),name:normalized,revision:1,createdAt:now,updatedAt:now};org.groups.push(group);await this.writeOrganization(org);return group})}
  async updateGroup(id:string,revision:number,name:string){return this.workspaceLock(async()=>{const org=await this.organization();this.checkGroup(org,id);const group=org.groups.find(g=>g.id===id)!;if(group.revision!==revision)throw new StoreError('分组已被修改，请刷新后重试',409,group.revision);const normalized=this.groupName(name);if(org.groups.some(g=>g.id!==id&&g.name===normalized))throw new StoreError('分组名称已存在',409);group.name=normalized;group.revision++;group.updatedAt=Date.now();await this.writeOrganization(org);return group})}
  async deleteGroup(id:string,revision:number){return this.workspaceLock(async()=>{const org=await this.organization();this.checkGroup(org,id);if(org.groups.find(g=>g.id===id)!.revision!==revision)throw new StoreError('分组已被修改，请刷新后重试',409);org.groups=org.groups.filter(g=>g.id!==id);org.assignments=Object.fromEntries(Object.entries(org.assignments).filter(([,g])=>g!==id));await this.writeOrganization(org)})}
  async moveToGroup(id:string,groupId:string|null,expectedGroupId:string|null){return this.workspaceLock(async()=>{const org=await this.organization();this.checkGroup(org,groupId);const record=await this.get(id);if((org.assignments[id]||null)!==expectedGroupId)throw new StoreError('图形所属分组已改变，请刷新后重试',409);if(groupId)org.assignments[id]=groupId;else delete org.assignments[id];await this.writeOrganization(org);return {...record,workspaceGroupId:groupId}})}
}
