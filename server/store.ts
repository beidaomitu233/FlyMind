import Database from 'better-sqlite3'
import {mkdir,readFile,readdir,stat,cp,writeFile,rm} from 'node:fs/promises'
import {mkdirSync,existsSync} from 'node:fs'
import {resolve,join,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {validateDocument,copy,type DiagramDocument} from '../src/drawing/core/model'
import {projectDocument,extractContent} from '../src/drawing/core/layers'
import {assertLockedObjects,freezeNewLocks} from '../src/drawing/core/objects'
import {samples} from '../src/drawing/core/samples'
import {applyOperations,type DiagramOperation} from '../src/drawing/core/operations'
import type {WorkspaceGroup,TrashItem} from '../src/drawing/services/workspace-types'
import {decodeDiagramRow,diagramMetadata,nativeIdentity,isCanvasRecord,validateNativeProject,type DiagramRow,type NativeDiagramRecord,type NativeDrawingRecord,type NativeTrashItem,type StoredDiagramRecord} from './document-record'
import type {DrawingProjectV3} from '../src/drawing/engine/types'
import {validateDrawingProject} from '../src/drawing/engine/project'
import {drawioRenderSignature} from '../src/drawing/engine/drawio'
import {nativeCanvasRenderSignature} from '../src/drawing/engine/native-canvas'
import {canonicalContentJson} from '../src/drawing/engine/content-hash'
import {workspaceDataRootId} from './native-pilot'
import type {EnqueueNativeExport,StoredNativeExport,NativeExportManifest} from './exports/types'
import type {MigrationCommit} from './migrations/types'
import {RESTORE_MARKER} from './backups/marker'
import type {NativeImportSource} from './imports/source'
export {PACKAGE_ROOT as PROJECT_ROOT} from './package-paths'
import {PACKAGE_ROOT as PROJECT_ROOT} from './package-paths'
export const DATA_ROOT=resolve(process.env.FLYMIND_DATA_DIR||join(PROJECT_ROOT,'data'))
export interface DiagramRecord {document:DiagramDocument;revision:number;savedAt:number;createdAt?:number;workspaceGroupId?:string|null}
export class StoreError extends Error {constructor(message:string,public status=400,public currentRevision?:number,public code=status===409?'CONFLICT':status===410?'DELETED':status===404?'NOT_FOUND':'VALIDATION_FAILED'){super(message)}}
export interface NativeMutation {requestId:string;requestHash:string;operation:'create'|'editor-save'|'content-patch'|'ai-create'|'ai-content-patch'|'ai-content-update'|'configure-rendering'|'import-content'|'import-project'|'import-drawio'|'canvas-map';expectedDataRootId?:string}
type DB=Database.Database
const schema=`
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL CHECK(revision>0),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS diagrams(id TEXT PRIMARY KEY,document TEXT NOT NULL CHECK(json_valid(document)),revision INTEGER NOT NULL CHECK(revision>0),saved_at INTEGER NOT NULL,created_at INTEGER NOT NULL,workspace_group_id TEXT REFERENCES workspace_groups(id) ON DELETE SET NULL,deleted_at INTEGER);
CREATE TABLE IF NOT EXISTS diagram_versions(diagram_id TEXT NOT NULL REFERENCES diagrams(id),revision INTEGER NOT NULL,document TEXT NOT NULL CHECK(json_valid(document)),saved_at INTEGER NOT NULL,PRIMARY KEY(diagram_id,revision));
CREATE INDEX IF NOT EXISTS diagrams_created ON diagrams(deleted_at,created_at DESC);
CREATE INDEX IF NOT EXISTS diagrams_group ON diagrams(workspace_group_id,deleted_at);
CREATE TABLE IF NOT EXISTS diagram_tombstones(id TEXT PRIMARY KEY,purged_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS prevent_deleted_recreation BEFORE INSERT ON diagrams WHEN EXISTS(SELECT 1 FROM diagram_tombstones WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'该 ID 已永久删除，不能重新创建'); END;
`
export class DiagramStore {
  constructor(public root=DATA_ROOT){}
  get databasePath(){return join(this.root,'flymind.sqlite')}
  // Legacy paths are migration inputs only. All subsequent reads use SQLite.
  path(id:string){return join(this.root,'diagrams',this.id(id)+'.json')}
  trashPath(id:string){return join(this.root,'trash',this.id(id)+'.json')}
  id(id:string){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new StoreError('图形 ID 仅支持字母、数字、下划线、短横线（1–100 字）');return id}
  private connect(){if(existsSync(join(this.root,RESTORE_MARKER)))throw new StoreError('工作区有未完成恢复，必须先通过离线维护工具显式回退',423,undefined,'RESTORE_RECOVERY_REQUIRED');mkdirSync(this.root,{recursive:true});const db=new Database(this.databasePath,{timeout:10000});try{db.pragma('journal_mode = WAL');db.pragma('synchronous = FULL');db.pragma('foreign_keys = ON');db.exec(schema);return db}catch(e){db.close();if((e as any).code==='SQLITE_BUSY')throw new StoreError('数据正在保存，请稍后重试',423);throw e}}
  private use<T>(fn:(db:DB)=>T):T{const db=this.connect();try{return fn(db)}catch(e){if((e as any).code==='SQLITE_BUSY')throw new StoreError('数据正在保存，请稍后重试',423);throw e}finally{db.close()}}
  private transaction<T>(fn:(db:DB)=>T){return this.use(db=>db.transaction(()=>fn(db)).immediate())}
  private initialized(db:DB){return !!db.prepare("SELECT 1 FROM metadata WHERE key='initialized'").get()}
  async init(options:{seedExamples?:boolean}={}){
    if(this.use(db=>this.initialized(db)))return
    const records=new Map<string,{record:DiagramRecord;deletedAt?:number}>();let legacy=false
    const org:{groups:WorkspaceGroup[];assignments:Record<string,string>}=await this.json(join(this.root,'workspace.json'),{groups:[],assignments:{}})
    for(const folder of ['diagrams','trash']){
      for(const file of await this.files(join(this.root,folder))){if(!file.endsWith('.json'))continue;legacy=true;const raw=await this.json(join(this.root,folder,file),null),id=this.id(file.slice(0,-5));if(!raw)throw new StoreError('旧存档无法读取：'+file)
        const record=await this.legacyRecord(folder==='trash'?raw.record:raw,id,join(this.root,folder,file));if(!records.has(id)||folder==='trash')records.set(id,{record,deletedAt:folder==='trash'?raw.deletedAt||Date.now():undefined})
      }
    }
    try{await stat(join(this.root,'.initialized'));legacy=true}catch{}
    let backupDirectory:string|undefined
    if(legacy){backupDirectory=join(this.root,'backups','legacy-json-'+Date.now()+'-'+randomUUID().slice(0,8));await mkdir(backupDirectory,{recursive:true});for(const name of ['diagrams','trash','workspace.json','.initialized']){try{await cp(join(this.root,name),join(backupDirectory,name),{recursive:true,errorOnExist:true,force:false})}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}}await writeFile(join(backupDirectory,'manifest.json'),JSON.stringify({createdAt:Date.now(),records:records.size,format:'flymind-json-backup'},null,2))}
    this.transaction(db=>{
      if(this.initialized(db))return
      for(const g of org.groups){this.id(g.id);db.prepare('INSERT INTO workspace_groups VALUES(?,?,?,?,?)').run(g.id,this.groupName(g.name),g.revision,g.createdAt,g.updatedAt)}
      if(!legacy&&options.seedExamples!==false)for(const document of samples){const now=Date.now(),d=copy(document);d.createdAt??=now;records.set(d.id,{record:{document:d,revision:1,savedAt:now,createdAt:d.createdAt}})}
      for(const [id,{record,deletedAt}] of records){const groupId=org.assignments[id]||null;this.insert(db,{...record,workspaceGroupId:groupId},deletedAt)}
      db.prepare('INSERT INTO metadata VALUES(?,?)').run('initialized','1');db.prepare('INSERT INTO metadata VALUES(?,?)').run('schema_version','1');if(backupDirectory)db.prepare('INSERT INTO metadata VALUES(?,?)').run('legacy_backup',backupDirectory)
    })
    const result=this.use(db=>db.pragma('quick_check',{simple:true}));if(result!=='ok')throw new StoreError('SQLite 完整性检查失败，请保留原始备份',500)
  }
  private async files(path:string){try{return await readdir(path)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}}
  private async json<T>(path:string,fallback:T):Promise<any>{try{return JSON.parse(await readFile(path,'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw new StoreError('存档读取失败：'+path+'；原始文件已保留',500)}}
  private async legacyRecord(raw:any,id:string,path:string):Promise<DiagramRecord>{
    const document=validateDocument(raw.document);if(document.id!==id)throw new StoreError('旧存档 ID 不匹配：'+id)
    let createdAt=raw.createdAt||document.createdAt
    if(!createdAt){const first=await this.json(join(this.root,'artifacts',id,'r1','diagram.project.json'),null);createdAt=first?.createdAt||first?.updatedAt}
    if(!createdAt){const info=await stat(path);createdAt=Math.min(...[info.birthtimeMs,info.mtimeMs,raw.savedAt,document.updatedAt].filter(n=>Number.isFinite(n)&&n>0))}
    document.createdAt=createdAt;return {document,revision:raw.revision,savedAt:raw.savedAt,createdAt}
  }
  private fromRow(row:any):DiagramRecord{const record=decodeDiagramRow(row);if(record.format===3)throw new StoreError('此图使用原生 draw.io 文档，请使用 native 接口',409,row.revision,'NATIVE_DOCUMENT_REQUIRED');const {format,...legacy}=record;return legacy}
  private row(db:DB,id:string,includeDeleted=false):DiagramRow{this.id(id);const row=db.prepare('SELECT * FROM diagrams WHERE id=?').get(id) as DiagramRow|undefined;if(!row){if(db.prepare('SELECT 1 FROM diagram_tombstones WHERE id=?').get(id))throw new StoreError('图形已永久删除',410);throw new StoreError('图形不存在',404)}if(!includeDeleted&&row.deleted_at!==null)throw new StoreError('图形已在回收站，请显式恢复后编辑',410,row.revision);return row}
  private storedRecord(db:DB,id:string):StoredDiagramRecord{return decodeDiagramRow(this.row(db,id))}
  private record(db:DB,id:string){this.id(id);const row=db.prepare('SELECT * FROM diagrams WHERE id=?').get(id) as any;if(!row){if(db.prepare('SELECT 1 FROM diagram_tombstones WHERE id=?').get(id))throw new StoreError('图形已永久删除',410);throw new StoreError('图形不存在',404)}if(row.deleted_at!==null)throw new StoreError('图形已在回收站，请显式恢复后编辑',410);return this.fromRow(row)}
  private insert(db:DB,r:DiagramRecord,deletedAt?:number){const d=copy(r.document);d.createdAt=r.createdAt??d.createdAt??Date.now();const json=JSON.stringify(projectDocument(d));db.prepare('INSERT INTO diagrams VALUES(?,?,?,?,?,?,?)').run(d.id,json,r.revision,r.savedAt,d.createdAt,r.workspaceGroupId||null,deletedAt??null);db.prepare('INSERT INTO diagram_versions VALUES(?,?,?,?)').run(d.id,r.revision,json,r.savedAt)}
  async get(id:string){return this.use(db=>this.record(db,id))}
  async getStored(id:string){return this.use(db=>this.storedRecord(db,id))}
  async getNativeDrawing(id:string):Promise<NativeDrawingRecord>{const record=await this.getStored(id);if(record.format!==3)throw new StoreError('该图仍为旧格式，未自动迁移',409,record.revision,'NATIVE_DOCUMENT_REQUIRED');return record}
  async getNative(id:string):Promise<NativeDiagramRecord>{const record=await this.getNativeDrawing(id);if(isCanvasRecord(record))throw new StoreError('仅画布尚未映射业务内容',422,record.revision,'BUSINESS_MAPPING_REQUIRED');return record}
  async getNativeDrawingRevision(id:string,revision:number):Promise<NativeDrawingRecord>{
    if(!Number.isSafeInteger(revision)||revision<1)throw new StoreError('历史修订无效')
    return this.transaction(db=>{const current=this.storedRecord(db,id);if(current.format!==3)throw new StoreError('该图仍为旧格式',409,current.revision,'NATIVE_DOCUMENT_REQUIRED');const version=db.prepare('SELECT document,saved_at FROM diagram_versions WHERE diagram_id=? AND revision=?').get(id,revision) as {document:string;saved_at:number}|undefined;if(!version)throw new StoreError('指定历史修订不存在',404,undefined,'REVISION_NOT_FOUND');const document=JSON.parse(version.document);if(document.schemaVersion!==3||nativeIdentity(document).id!==id)throw new StoreError('指定历史修订不是同一原生图形',409,undefined,'NATIVE_DOCUMENT_REQUIRED');return {format:3,document,revision,savedAt:version.saved_at,createdAt:document.createdAt,workspaceGroupId:current.workspaceGroupId}})
  }
  async getNativeRevision(id:string,revision:number):Promise<NativeDiagramRecord>{const record=await this.getNativeDrawingRevision(id,revision);if(isCanvasRecord(record))throw new StoreError('该修订仅画布，无业务内容',422,record.revision,'BUSINESS_MAPPING_REQUIRED');return record}
  nativeWorkspaceId(create=false):string|undefined{
    return this.use(db=>{
      const lookup=()=>((db.prepare("SELECT value FROM metadata WHERE key='native_workspace_id'").get() as {value:string}|undefined)?.value)
      if(!create)return lookup()
      return db.transaction(()=>{
        db.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES('native_workspace_id',?)").run(randomUUID())
        return lookup()
      }).immediate()
    })
  }
  async listStored(){return this.use(db=>(db.prepare('SELECT * FROM diagrams WHERE deleted_at IS NULL ORDER BY created_at DESC,id').all() as DiagramRow[]).map(decodeDiagramRow))}
  async listMetadata(){return this.use(db=>(db.prepare('SELECT * FROM diagrams WHERE deleted_at IS NULL ORDER BY created_at DESC,id').all() as DiagramRow[]).map(diagramMetadata))}
  async snapshotStored(){return this.use(db=>db.transaction(()=>({diagrams:(db.prepare('SELECT * FROM diagrams WHERE deleted_at IS NULL ORDER BY created_at DESC,id').all() as DiagramRow[]).map(decodeDiagramRow),metadata:(db.prepare('SELECT * FROM diagrams WHERE deleted_at IS NULL ORDER BY created_at DESC,id').all() as DiagramRow[]).map(diagramMetadata),groups:this.groups(db),trash:this.trash(db),deletedIds:(db.prepare('SELECT id FROM diagrams WHERE deleted_at IS NOT NULL UNION SELECT id FROM diagram_tombstones').all() as {id:string}[]).map(r=>r.id)}))())}
  async list(){return this.use(db=>db.prepare('SELECT * FROM diagrams WHERE deleted_at IS NULL ORDER BY created_at DESC,id').all().map(row=>this.fromRow(row)))}
  async snapshot(){return this.use(db=>db.transaction(()=>({diagrams:db.prepare('SELECT * FROM diagrams WHERE deleted_at IS NULL ORDER BY created_at DESC,id').all().map(row=>this.fromRow(row)),groups:this.groups(db),trash:this.trash(db),deletedIds:(db.prepare('SELECT id FROM diagrams WHERE deleted_at IS NOT NULL UNION SELECT id FROM diagram_tombstones').all() as {id:string}[]).map(r=>r.id)}))())}
  async create(input:unknown,workspaceGroupId?:string|null){if((input as any)?.schemaVersion===3)throw new StoreError('原生文档必须通过 native 接口保存',409,undefined,'NATIVE_DOCUMENT_REQUIRED');const d=validateDocument(input);this.id(d.id);freezeNewLocks(d);return this.transaction(db=>{this.checkGroup(db,workspaceGroupId);if(db.prepare('SELECT 1 FROM diagram_tombstones WHERE id=?').get(d.id))throw new StoreError('该 ID 已永久删除，不能重新创建',410);const existing=db.prepare('SELECT deleted_at FROM diagrams WHERE id=?').get(d.id) as any;if(existing){if(existing.deleted_at!==null)throw new StoreError('该 ID 已删除，不能重新创建',410);throw new StoreError('该图形 ID 已存在，请读取后更新，或使用新的 ID',409)}d.createdAt=d.updatedAt=Date.now();this.insert(db,{document:d,revision:1,savedAt:d.updatedAt,createdAt:d.createdAt,workspaceGroupId});return this.record(db,d.id)})}
  async update(id:string,revision:number,input:unknown){return this.change(id,revision,()=>validateDocument(input))}
  async patch(id:string,revision:number,ops:DiagramOperation[]){return this.change(id,revision,d=>applyOperations(d,ops))}
  async change(id:string,revision:number,fn:(d:DiagramDocument)=>DiagramDocument){return this.transaction(db=>{const prev=this.record(db,id);if(!Number.isInteger(revision)||revision!==prev.revision)throw new StoreError(`版本冲突：当前为 ${prev.revision}，请重新读取并合并`,409,prev.revision);const next=validateDocument(fn(copy(prev.document)));assertLockedObjects(prev.document,next);freezeNewLocks(next,prev.document);next.id=id;next.createdAt=prev.createdAt;next.updatedAt=Date.now();const json=JSON.stringify(projectDocument(next));db.prepare('UPDATE diagrams SET document=?,revision=revision+1,saved_at=? WHERE id=? AND revision=? AND deleted_at IS NULL').run(json,next.updatedAt,id,revision);db.prepare('INSERT INTO diagram_versions VALUES(?,?,?,?)').run(id,revision+1,json,next.updatedAt);return this.record(db,id)})}
  async delete(id:string,revision:number,expectedDataRootId?:string){return this.transaction(db=>{if(expectedDataRootId!==undefined)this.assertNativeIdentity(db,expectedDataRootId);this.id(id);const row=db.prepare('SELECT deleted_at FROM diagrams WHERE id=?').get(id) as any;if(row?.deleted_at!==null&&row?.deleted_at!==undefined)return;const prev=this.storedRecord(db,id);if(revision!==prev.revision)throw new StoreError('版本冲突，请读取最新图形',409,prev.revision);db.prepare('UPDATE diagrams SET deleted_at=? WHERE id=?').run(Date.now(),id)})}
  private trash(db:DB):NativeTrashItem[]{return (db.prepare('SELECT * FROM diagrams WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC,id').all() as any[]).map(row=>{const raw=JSON.parse(row.document),content=raw.content||raw;return {id:row.id,title:content.title,...(raw.mode==='canvas-only'?{mode:'canvas-only'}:{kind:content.kind}),revision:row.revision,deletedAt:row.deleted_at,createdAt:row.created_at,workspaceGroupId:row.workspace_group_id}})}
  async listTrash(){return this.use(db=>this.trash(db))}
  private deletedRecord(db:DB,id:string,revision:number,deletedAt:number){this.id(id);const row=db.prepare('SELECT * FROM diagrams WHERE id=?').get(id) as any;if(!row)throw new StoreError('回收站中没有该图形',404);if(row.deleted_at===null||row.revision!==revision||row.deleted_at!==deletedAt)throw new StoreError('回收站内容已变化，请刷新后重试',409,row.revision);return row}
  async restore(id:string,revision:number,deletedAt:number){return this.transaction(db=>{const row=this.deletedRecord(db,id,revision,deletedAt),d=this.fromRow(row).document,now=Date.now();d.updatedAt=now;const json=JSON.stringify(projectDocument(d));db.prepare('UPDATE diagrams SET deleted_at=NULL,revision=revision+1,saved_at=?,document=? WHERE id=?').run(now,json,id);db.prepare('INSERT INTO diagram_versions VALUES(?,?,?,?)').run(id,revision+1,json,now);return this.record(db,id)})}
  async restoreStored(id:string,revision:number,deletedAt:number,expectedDataRootId?:string){return this.transaction(db=>{if(expectedDataRootId!==undefined)this.assertNativeIdentity(db,expectedDataRootId);const row=this.deletedRecord(db,id,revision,deletedAt),record=decodeDiagramRow(row),now=Date.now();record.document.updatedAt=now;const json=JSON.stringify(record.format===3?record.document:projectDocument(record.document));const result=db.prepare('UPDATE diagrams SET deleted_at=NULL,revision=revision+1,saved_at=?,document=? WHERE id=? AND revision=? AND deleted_at=?').run(now,json,id,revision,deletedAt);if(result.changes!==1)throw new StoreError('恢复版本冲突',409,row.revision);db.prepare('INSERT INTO diagram_versions VALUES(?,?,?,?)').run(id,revision+1,json,now);return this.storedRecord(db,id)})}
  async purge(id:string,revision:number,deletedAt:number,expectedDataRootId?:string){const directory=resolve(this.root,'artifacts',this.id(id)),artifactRoot=resolve(this.root,'artifacts')+sep;if(!directory.startsWith(artifactRoot))throw new StoreError('制品路径无效');this.transaction(db=>{if(expectedDataRootId!==undefined)this.assertNativeIdentity(db,expectedDataRootId);this.deletedRecord(db,id,revision,deletedAt);db.prepare('INSERT INTO diagram_tombstones VALUES(?,?)').run(id,Date.now());db.prepare('DELETE FROM diagram_versions WHERE diagram_id=?').run(id);db.prepare('DELETE FROM diagrams WHERE id=?').run(id)});await rm(directory,{recursive:true,force:true})}
  private checkGroup(db:DB,id?:string|null){if(id&&!db.prepare('SELECT 1 FROM workspace_groups WHERE id=?').get(this.id(id)))throw new StoreError('工作区分组不存在',404)}
  groupName(name:string){if(typeof name!=='string'||!name.trim()||name.trim().length>80)throw new StoreError('分组名称需为 1–80 字');return name.trim()}
  private groups(db:DB):WorkspaceGroup[]{return db.prepare('SELECT id,name,revision,created_at AS createdAt,updated_at AS updatedAt FROM workspace_groups ORDER BY created_at,id').all() as WorkspaceGroup[]}
  async listGroups(){return this.use(db=>this.groups(db))}
  async createGroup(name:string,expectedDataRootId?:string){return this.transaction(db=>{if(expectedDataRootId!==undefined)this.assertNativeIdentity(db,expectedDataRootId);const n=this.groupName(name);if(db.prepare('SELECT 1 FROM workspace_groups WHERE name=?').get(n))throw new StoreError('分组名称已存在',409);const now=Date.now(),g={id:'group_'+randomUUID(),name:n,revision:1,createdAt:now,updatedAt:now};db.prepare('INSERT INTO workspace_groups VALUES(?,?,?,?,?)').run(g.id,n,1,now,now);return g})}
  async updateGroup(id:string,revision:number,name:string,expectedDataRootId?:string){return this.transaction(db=>{if(expectedDataRootId!==undefined)this.assertNativeIdentity(db,expectedDataRootId);this.checkGroup(db,id);const g=this.groups(db).find(g=>g.id===id)!;if(g.revision!==revision)throw new StoreError('分组已被修改，请刷新后重试',409,g.revision);const n=this.groupName(name);if(db.prepare('SELECT 1 FROM workspace_groups WHERE name=? AND id<>?').get(n,id))throw new StoreError('分组名称已存在',409);g.name=n;g.revision++;g.updatedAt=Date.now();db.prepare('UPDATE workspace_groups SET name=?,revision=?,updated_at=? WHERE id=?').run(n,g.revision,g.updatedAt,id);return g})}
  async deleteGroup(id:string,revision:number,expectedDataRootId?:string){return this.transaction(db=>{if(expectedDataRootId!==undefined)this.assertNativeIdentity(db,expectedDataRootId);this.checkGroup(db,id);if(this.groups(db).find(g=>g.id===id)!.revision!==revision)throw new StoreError('分组已被修改，请刷新后重试',409);db.prepare('DELETE FROM workspace_groups WHERE id=?').run(id)})}
  async moveToGroup(id:string,groupId:string|null,expectedGroupId:string|null){return this.transaction(db=>{this.checkGroup(db,groupId);const r=this.record(db,id);if(r.workspaceGroupId!==expectedGroupId)throw new StoreError('图形所属分组已改变，请刷新后重试',409);db.prepare('UPDATE diagrams SET workspace_group_id=? WHERE id=?').run(groupId,id);return this.record(db,id)})}
  async moveStoredToGroup(id:string,groupId:string|null,expectedGroupId:string|null,expectedDataRootId?:string){return this.transaction(db=>{if(expectedDataRootId!==undefined)this.assertNativeIdentity(db,expectedDataRootId);this.checkGroup(db,groupId);const r=this.storedRecord(db,id);if(r.workspaceGroupId!==expectedGroupId)throw new StoreError('图形所属分组已改变，请刷新后重试',409,r.revision);db.prepare('UPDATE diagrams SET workspace_group_id=? WHERE id=?').run(groupId,id);return this.storedRecord(db,id)})}

  private nativeMutationSchema(db:DB){db.exec('CREATE TABLE IF NOT EXISTS native_mutation_requests(request_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,diagram_id TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,operation TEXT NOT NULL,response TEXT NOT NULL CHECK(json_valid(response)),created_at INTEGER NOT NULL)')}
  private mutation(m:NativeMutation){if(!m||typeof m.requestId!=='string'||!(/^[a-zA-Z0-9_-]{1,128}$/).test(m.requestId)||typeof m.requestHash!=='string'||!(/^[a-f0-9]{64}$/).test(m.requestHash)||!['create','editor-save','content-patch','ai-create','ai-content-patch','ai-content-update','configure-rendering','import-content','import-project','import-drawio','canvas-map'].includes(m.operation))throw new StoreError('requestId 或请求摘要无效')}
  private requestEpoch(db:DB,scope:string,key:string){if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='restored_request_barriers'").get()&&db.prepare('SELECT 1 FROM restored_request_barriers WHERE scope=? AND request_id=?').get(scope,key))throw new StoreError('该请求属于恢复前工作区，请读取当前状态并使用新请求键',409,undefined,'REQUEST_EPOCH_CHANGED')}
  private replay(db:DB,m:NativeMutation):NativeDrawingRecord|undefined{
    this.mutation(m)
    if(m.expectedDataRootId!==undefined)this.assertNativeIdentity(db,m.expectedDataRootId)
    this.requestEpoch(db,'mutation',m.requestId)
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_mutation_requests'").get())return
    const saved=db.prepare('SELECT * FROM native_mutation_requests WHERE request_id=?').get(m.requestId) as any
    if(!saved)return
    if(saved.request_hash!==m.requestHash||saved.operation!==m.operation)throw new StoreError('同一 requestId 不能用于不同请求',409,undefined,'IDEMPOTENCY_KEY_REUSED')
    this.row(db,saved.diagram_id) // A retry must never revive a deleted/purged record.
    return JSON.parse(saved.response) as NativeDrawingRecord
  }
  async replayNativeDrawing(m:NativeMutation){m={...m};return this.use(db=>db.transaction(()=>this.replay(db,m))())}
  async replayNative(m:NativeMutation):Promise<NativeDiagramRecord|undefined>{const record=await this.replayNativeDrawing(m);if(record&&isCanvasRecord(record))throw new StoreError('仅画布没有业务内容',422,record.revision,'BUSINESS_MAPPING_REQUIRED');return record}
  async createNative(input:unknown,workspaceGroupId:string|null,m:NativeMutation,source?:NativeImportSource):Promise<NativeDiagramRecord>{if((input as any)?.mode!==undefined)throw new StoreError('业务入口不接受仅画布项目',422,undefined,'BUSINESS_MAPPING_REQUIRED');return await this.createNativeDrawing(input,workspaceGroupId,m,source) as NativeDiagramRecord}
  async commitNative(id:string,expectedRevision:number,input:unknown,m:NativeMutation):Promise<NativeDiagramRecord>{if((input as any)?.mode!==undefined)throw new StoreError('业务入口不接受仅画布项目',422,undefined,'BUSINESS_MAPPING_REQUIRED');return await this.commitNativeDrawing(id,expectedRevision,input,m) as NativeDiagramRecord}
  private remember(db:DB,m:NativeMutation,r:NativeDrawingRecord){this.nativeMutationSchema(db);db.prepare('INSERT INTO native_mutation_requests VALUES(?,?,?,?,?,?)').run(m.requestId,m.requestHash,nativeIdentity(r.document).id,m.operation,JSON.stringify(r),Date.now())}
  async createNativeDrawing(input:unknown,workspaceGroupId:string|null,m:NativeMutation,importSource?:NativeImportSource):Promise<NativeDrawingRecord>{
    m={...m}
    this.mutation(m);if(!['create','ai-create','import-content','import-project','import-drawio'].includes(m.operation)||m.operation.startsWith('import-')!==!!importSource)throw new StoreError('创建请求操作或导入来源无效')
    const snapshot=structuredClone(input);if(typeof(snapshot as any)?.rendering?.engine?.xml==='string'&&Buffer.byteLength((snapshot as any).rendering.engine.xml)>4_000_000)throw new StoreError('原生XML超过4,000,000字节预算',413,undefined,'NATIVE_XML_TOO_LARGE');const project=await validateNativeProject(snapshot);this.id(nativeIdentity(project).id)
    return this.transaction(db=>{
      const replay=this.replay(db,m);if(replay)return replay
      this.checkGroup(db,workspaceGroupId)
      if(db.prepare('SELECT 1 FROM diagram_tombstones WHERE id=?').get(nativeIdentity(project).id))throw new StoreError('该 ID 已永久删除，不能重新创建',410)
      const existing=db.prepare('SELECT revision,deleted_at FROM diagrams WHERE id=?').get(nativeIdentity(project).id) as any
      if(existing)throw new StoreError(existing.deleted_at===null?'图形 ID 已存在':'图形已删除',existing.deleted_at===null?409:410,existing.revision)
      if('mode'in project&&m.operation==='ai-create')throw new StoreError('AI新建不接受仅画布项目',422,undefined,'BUSINESS_MAPPING_REQUIRED')
      const json=JSON.stringify(project)
      db.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES('native_workspace_id',?)").run(randomUUID())
      db.prepare('INSERT INTO diagrams VALUES(?,?,?,?,?,?,NULL)').run(nativeIdentity(project).id,json,1,project.updatedAt,project.createdAt,workspaceGroupId)
      db.prepare('INSERT INTO diagram_versions VALUES(?,?,?,?)').run(nativeIdentity(project).id,1,json,project.updatedAt)
      if(importSource){if(importSource.diagramId!==nativeIdentity(project).id||!m.operation.startsWith('import-'))throw new StoreError('来源记录与导入身份不符');db.exec('CREATE TABLE IF NOT EXISTS native_import_sources(import_id TEXT PRIMARY KEY,diagram_id TEXT NOT NULL UNIQUE REFERENCES diagrams(id) ON DELETE CASCADE,source TEXT NOT NULL CHECK(json_valid(source)))');db.prepare('INSERT INTO native_import_sources VALUES(?,?,?)').run(importSource.importId,nativeIdentity(project).id,JSON.stringify(importSource))}
      const record=this.storedRecord(db,nativeIdentity(project).id) as NativeDrawingRecord
      this.remember(db,m,record)
      return record
    })
  }
  async commitNativeDrawing(id:string,expectedRevision:number,input:unknown,m:NativeMutation):Promise<NativeDrawingRecord>{
    m={...m}
    this.id(id);this.mutation(m);if(!['editor-save','content-patch','ai-content-patch','ai-content-update','configure-rendering','canvas-map'].includes(m.operation)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new StoreError('原生保存修订或操作无效')
    const snapshot=structuredClone(input);if(typeof(snapshot as any)?.rendering?.engine?.xml==='string'&&Buffer.byteLength((snapshot as any).rendering.engine.xml)>4_000_000)throw new StoreError('原生XML超过4,000,000字节预算',413,undefined,'NATIVE_XML_TOO_LARGE');const project=await validateNativeProject(snapshot)
    if(nativeIdentity(project).id!==id)throw new StoreError('原生项目 ID 与路径不一致')
    const candidateSignature=('mode'in project?nativeCanvasRenderSignature:drawioRenderSignature)(project.rendering.engine.xml),candidatePreferences=canonicalContentJson(('preferences'in project.rendering?project.rendering.preferences:{}) as any)
    // All asynchronous projection/validation completes before this short CAS transaction.
    return this.transaction(db=>{
      const replay=this.replay(db,m);if(replay)return replay
      const previous=this.storedRecord(db,id)
      if(previous.format!==3)throw new StoreError('旧图未自动迁移为原生格式',409,previous.revision,'NATIVE_DOCUMENT_REQUIRED')
      if(previous.revision!==expectedRevision)throw new StoreError('图形已有新的修改',409,previous.revision,'REVISION_CONFLICT')
      if(project.createdAt!==previous.createdAt)throw new StoreError('不能修改创建时间')
      const previousCanvas=isCanvasRecord(previous),candidateCanvas='mode'in project
      if(candidateCanvas&&m.operation!=='editor-save')throw new StoreError('仅画布只接受原生编辑保存',422,previous.revision,'BUSINESS_MAPPING_REQUIRED')
      if(previousCanvas!==candidateCanvas&&!(m.operation==='canvas-map'&&previousCanvas&&!candidateCanvas))throw new StoreError('项目模式改变必须通过显式映射',409,previous.revision,'NATIVE_MODE_MISMATCH')
      const unchanged=previousCanvas===candidateCanvas&&nativeIdentity(project).title===nativeIdentity(previous.document).title
        &&(candidateCanvas||!previousCanvas&&'contentHash'in project.rendering.engine&&project.rendering.engine.contentHash===previous.document.rendering.engine.contentHash)
        &&candidateSignature===(isCanvasRecord(previous)?nativeCanvasRenderSignature:drawioRenderSignature)(previous.document.rendering.engine.xml)
        &&candidatePreferences===canonicalContentJson(('preferences'in previous.document.rendering?previous.document.rendering.preferences:{}) as any)
      if(unchanged){this.remember(db,m,previous);return previous}
      project.updatedAt=Math.max(Date.now(),previous.document.updatedAt+1,project.createdAt)
      const json=JSON.stringify(project)
      const result=db.prepare("UPDATE diagrams SET document=?,revision=revision+1,saved_at=? WHERE id=? AND revision=? AND deleted_at IS NULL AND json_extract(document,'$.schemaVersion')=3").run(json,project.updatedAt,id,expectedRevision)
      if(result.changes!==1)throw new StoreError('图形保存冲突',409,previous.revision,'REVISION_CONFLICT')
      db.prepare('INSERT INTO diagram_versions VALUES(?,?,?,?)').run(id,expectedRevision+1,json,project.updatedAt)
      const record=this.storedRecord(db,id) as NativeDrawingRecord
      this.remember(db,m,record)
      return record
    })
  }
  private exportSchema(db:DB,create=false){
    const exists=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_export_jobs'").get()
    if(!exists&&create)db.exec(`CREATE TABLE native_export_jobs(
      id TEXT PRIMARY KEY,diagram_id TEXT NOT NULL,data_root_id TEXT NOT NULL,revision INTEGER NOT NULL,
      request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),snapshot_hash TEXT NOT NULL,
      options TEXT NOT NULL CHECK(json_valid(options)),source_job_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,lease_owner TEXT,lease_token TEXT,lease_until INTEGER,manifest TEXT,error TEXT);
      CREATE INDEX native_export_queue ON native_export_jobs(status,created_at);`)
    return exists||create
  }
  private assertNativeIdentity(db:DB,expected:string){
    const workspace=db.prepare("SELECT value FROM metadata WHERE key='native_workspace_id'").get() as {value:string}|undefined
    if(!expected||!workspace||workspaceDataRootId(workspace.value)!==expected)throw new StoreError('工作区身份缺失或已改变，请保留本机草稿',409,undefined,'WORKSPACE_MISMATCH')
  }
  private exportRecord(row:any):StoredNativeExport{
    return {id:row.id,diagramId:row.diagram_id,dataRootId:row.data_root_id,revision:row.revision,requestId:row.request_id,requestHash:row.request_hash,snapshot:JSON.parse(row.snapshot),snapshotSha256:row.snapshot_hash,options:JSON.parse(row.options),status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,attempts:row.attempts,...(row.source_job_id?{sourceJobId:row.source_job_id}:{}),...(row.lease_owner?{leaseOwner:row.lease_owner}:{}),...(row.lease_token?{leaseToken:row.lease_token}:{}),...(row.lease_until?{leaseUntil:row.lease_until}:{}),...(row.manifest?{manifest:JSON.parse(row.manifest)}:{}),...(row.error?{error:JSON.parse(row.error)}:{})}
  }
  private exportRow(db:DB,id:string):StoredNativeExport{
    this.id(id)
    const row=this.exportSchema(db)&&db.prepare('SELECT * FROM native_export_jobs WHERE id=?').get(id)
    if(!row)throw new StoreError('导出任务不存在',404,undefined,'EXPORT_NOT_FOUND')
    return this.exportRecord(row)
  }
  private exportAccess(db:DB,job:StoredNativeExport){
    const workspace=db.prepare("SELECT value FROM metadata WHERE key='native_workspace_id'").get() as {value:string}|undefined
    const currentRoot=workspace?workspaceDataRootId(workspace.value):''
    if(currentRoot!==job.dataRootId){
      const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='restored_export_bindings'").get()
      const binding=exists?db.prepare('SELECT * FROM restored_export_bindings WHERE job_id=? AND target_data_root_id=?').get(job.id,currentRoot) as any:undefined
      if(job.status!=='succeeded'||!job.manifest||!binding||binding.source_data_root_id!==job.dataRootId||binding.manifest_sha256!==createHash('sha256').update(canonicalContentJson(job.manifest as any)).digest('hex'))throw new StoreError('历史导出恢复来源与当前工作区不符',409,undefined,'WORKSPACE_MISMATCH')
    }else this.assertNativeIdentity(db,job.dataRootId)
    const record=this.storedRecord(db,job.diagramId);if(record.format!==3)throw new StoreError('导出任务的图形格式已改变',409,record.revision,'NATIVE_DOCUMENT_REQUIRED');return record
  }
  async findNativeExportRequest(requestId:string,requestHash:string,expectedDataRootId:string){
    return this.transaction(db=>{
      this.assertNativeIdentity(db,expectedDataRootId)
      this.requestEpoch(db,'export',requestId)
      if(!this.exportSchema(db))return undefined
      const row=db.prepare('SELECT * FROM native_export_jobs WHERE request_id=?').get(requestId)
      if(!row)return undefined
      const job=this.exportRecord(row);this.exportAccess(db,job)
      if(job.requestHash!==requestHash)throw new StoreError('同一 requestId 不能用于不同导出请求',409,undefined,'IDEMPOTENCY_KEY_REUSED')
      return job
    })
  }
  async enqueueNativeExport(input:EnqueueNativeExport):Promise<StoredNativeExport>{
    const value=structuredClone(input),canonical=canonicalContentJson(value.snapshot as any)
    if(createHash('sha256').update(canonical).digest('hex')!==value.snapshotSha256)throw new StoreError('导出快照摘要不一致',400,undefined,'SNAPSHOT_MISMATCH')
    return this.transaction(db=>{
      this.assertNativeIdentity(db,value.expectedDataRootId);this.requestEpoch(db,'export',value.requestId);this.exportSchema(db,true)
      const replay=db.prepare('SELECT * FROM native_export_jobs WHERE request_id=?').get(value.requestId)
      if(replay){const job=this.exportRecord(replay);this.exportAccess(db,job);if(job.requestHash!==value.requestHash)throw new StoreError('同一 requestId 不能用于不同导出请求',409,undefined,'IDEMPOTENCY_KEY_REUSED');return job}
      const current=this.storedRecord(db,value.diagramId)
      if(current.format!==3)throw new StoreError('旧图尚未迁移为原生格式',409,current.revision,'NATIVE_DOCUMENT_REQUIRED')
      if(value.sourceJobId){const source=this.exportRow(db,value.sourceJobId);this.exportAccess(db,source);if(source.status!=='failed'||source.diagramId!==value.diagramId||source.snapshotSha256!==value.snapshotSha256||source.revision!==value.expectedRevision)throw new StoreError('只能重试原失败任务的不可变快照',409,undefined,'EXPORT_RETRY_INVALID')}
      else if(value.historical){const history=db.prepare('SELECT document FROM diagram_versions WHERE diagram_id=? AND revision=?').get(value.diagramId,value.expectedRevision) as {document:string}|undefined;if(!history)throw new StoreError('指定历史修订不存在',404,undefined,'REVISION_NOT_FOUND');const original=JSON.parse(history.document);if(original.schemaVersion!==3||nativeIdentity(original).id!==value.diagramId||canonicalContentJson(original)!==canonical)throw new StoreError('历史快照在入队前已改变',409,current.revision,'SNAPSHOT_MISMATCH')}
      else if(current.revision!==value.expectedRevision)throw new StoreError('图形已有新的修订，请先保存当前编辑',409,current.revision,'REVISION_CONFLICT')
      else if(canonicalContentJson(current.document as any)!==canonical)throw new StoreError('导出快照与事务中的图形不一致',409,current.revision,'SNAPSHOT_MISMATCH')
      const now=Date.now(),jobId=randomUUID()
      db.prepare("INSERT INTO native_export_jobs(id,diagram_id,data_root_id,revision,request_id,request_hash,snapshot,snapshot_hash,options,source_job_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?,?)").run(jobId,value.diagramId,value.expectedDataRootId,value.expectedRevision,value.requestId,value.requestHash,JSON.stringify(value.snapshot),value.snapshotSha256,JSON.stringify(value.options),value.sourceJobId??null,now,now)
      return this.exportRow(db,jobId)
    })
  }
  async getNativeExport(id:string){return this.transaction(db=>{const job=this.exportRow(db,id),current=this.exportAccess(db,job);return {job,currentRevision:current.revision}})}
  /** Queue scheduling only; does not claim jobs or change their durable state. */
  async nativeExportQueueState(now=Date.now()):Promise<{pending:boolean;ready:boolean;nextAttemptAt?:number}>{
    if(!Number.isSafeInteger(now)||now<0)throw new StoreError('导出队列时间无效')
    return this.use(db=>{
      if(!this.exportSchema(db))return {pending:false,ready:false}
      const pending=!!db.prepare("SELECT 1 FROM native_export_jobs WHERE status IN ('queued','running') LIMIT 1").get()
      if(!pending)return {pending:false,ready:false}
      const running=db.prepare("SELECT MAX(lease_until) AS until FROM native_export_jobs WHERE status='running' AND lease_until>?").get(now) as {until:number|null}
      if(running.until!==null)return {pending:true,ready:false,nextAttemptAt:running.until}
      const ready=!!db.prepare("SELECT 1 FROM native_export_jobs WHERE status='queued' OR (status='running' AND lease_until<=?) LIMIT 1").get(now)
      return {pending:true,ready}
    })
  }
  async claimNativeExport(owner:string,leaseMs:number,now=Date.now(),maxAttempts=3):Promise<StoredNativeExport|undefined>{
    if(!owner||!Number.isSafeInteger(leaseMs)||leaseMs<10)throw new StoreError('导出租约参数无效')
    return this.transaction(db=>{
      if(!this.exportSchema(db))return undefined
      if(db.prepare("SELECT 1 FROM native_export_jobs WHERE status='running' AND lease_until>? LIMIT 1").get(now))return undefined
      for(;;){
        const row=db.prepare("SELECT * FROM native_export_jobs WHERE status='queued' OR (status='running' AND lease_until<=?) ORDER BY created_at,id LIMIT 1").get(now)
        if(!row)return undefined
        const job=this.exportRecord(row)
        let failure:{code:string;message:string}|undefined
        try{this.exportAccess(db,job)}catch(error){const e=error as StoreError;failure={code:e.code,message:e.message}}
        if(job.attempts>=maxAttempts)failure={code:'EXPORT_LEASE_EXPIRED',message:'导出进程多次失去租约，请显式重试'}
        if(failure){db.prepare("UPDATE native_export_jobs SET status='failed',error=?,updated_at=?,lease_owner=NULL,lease_until=NULL WHERE id=?").run(JSON.stringify(failure),now,job.id);continue}
        db.prepare("UPDATE native_export_jobs SET status='running',attempts=attempts+1,lease_owner=?,lease_token=?,lease_until=?,updated_at=?,error=NULL WHERE id=?").run(owner,randomUUID(),now+leaseMs,now,job.id)
        return this.exportRow(db,job.id)
      }
    })
  }
  private exportLease(db:DB,id:string,owner:string,token:string,now:number,allowExpired=false){
    const job=this.exportRow(db,id);this.exportAccess(db,job)
    if(job.status!=='running'||job.leaseOwner!==owner||job.leaseToken!==token||!job.leaseUntil||!allowExpired&&job.leaseUntil<=now)throw new StoreError('导出租约已失效，迟到结果未登记',409,undefined,'EXPORT_LEASE_LOST')
    return job
  }
  async renewNativeExport(id:string,owner:string,token:string,leaseMs:number,now=Date.now()){
    return this.transaction(db=>{this.exportLease(db,id,owner,token,now);db.prepare('UPDATE native_export_jobs SET lease_until=?,updated_at=? WHERE id=? AND lease_owner=? AND lease_token=?').run(now+leaseMs,now,id,owner,token);return true})
  }
  async assertNativeExportLease(id:string,owner:string,token:string,now=Date.now()){return this.transaction(db=>this.exportLease(db,id,owner,token,now))}
  async completeNativeExport(id:string,owner:string,token:string,manifest:NativeExportManifest,now?:number,deadline?:number){
    return this.transaction(db=>{
      if(deadline!==undefined&&Date.now()>=deadline)throw new StoreError('导出尝试已超过硬截止时间',504,undefined,'EXPORT_TIMEOUT')
      const completedAt=now??Date.now(),job=this.exportLease(db,id,owner,token,completedAt)
      if(manifest.exportId!==id||manifest.diagramId!==job.diagramId||manifest.revision!==job.revision||manifest.dataRootId!==job.dataRootId||manifest.snapshotSha256!==job.snapshotSha256)throw new StoreError('导出清单与任务快照不符',400,undefined,'EXPORT_MANIFEST_INVALID')
      const result=db.prepare("UPDATE native_export_jobs SET status='succeeded',manifest=?,updated_at=?,lease_owner=NULL,lease_until=NULL,error=NULL WHERE id=? AND status='running' AND lease_owner=? AND lease_token=?").run(JSON.stringify(manifest),completedAt,id,owner,token)
      if(result.changes!==1)throw new StoreError('导出租约已改变',409,undefined,'EXPORT_LEASE_LOST')
      return this.exportRow(db,id)
    })
  }
  async failNativeExport(id:string,owner:string,token:string,error:{code:string;message:string},now=Date.now()){
    return this.transaction(db=>{this.exportLease(db,id,owner,token,now,error.code==='EXPORT_TIMEOUT');db.prepare("UPDATE native_export_jobs SET status='failed',error=?,updated_at=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND status='running' AND lease_owner=? AND lease_token=?").run(JSON.stringify(error),now,id,owner,token);return this.exportRow(db,id)})
  }
  async backup(){await mkdir(join(this.root,'backups'),{recursive:true});const destination=join(this.root,'backups','flymind-'+Date.now()+'-'+randomUUID().slice(0,8)+'.sqlite'),db=this.connect();try{await db.backup(destination);return destination}finally{db.close()}}
  async nativeImportSource(id:string):Promise<NativeImportSource>{return this.use(db=>{this.row(db,id);const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE name='native_import_sources'").get(),row=exists?db.prepare('SELECT source FROM native_import_sources WHERE diagram_id=?').get(id) as {source:string}|undefined:undefined;if(!row)throw new StoreError('此图没有文件导入来源',404,undefined,'IMPORT_SOURCE_NOT_FOUND');return JSON.parse(row.source)})}
  /** Caller has asynchronously validated the candidate; all source guards are rechecked here. */
  async replayLegacyMigration(requestId:string,requestHash:string,expectedDataRootId:string){return this.transaction(db=>{
    this.assertNativeIdentity(db,expectedDataRootId)
    this.requestEpoch(db,'migration',requestId)
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_migration_records'").get())return
    const r=db.prepare('SELECT * FROM native_migration_records WHERE request_id=?').get(requestId) as any
    if(!r)return
    if(r.request_hash!==requestHash)throw new StoreError('迁移请求键已用于不同载荷',409,undefined,'IDEMPOTENCY_KEY_REUSED')
    this.row(db,r.diagram_id,true);return JSON.parse(r.response)
  })}
  async commitLegacyMigration(value:MigrationCommit){
    const project=await validateDrawingProject(value.project),s=structuredClone(value.source)
    if(project.content.id!==s.diagramId||project.createdAt!==s.createdAt||project.updatedAt!==s.updatedAt)throw new StoreError('迁移不得修改身份或业务时间',400,undefined,'MIGRATION_IDENTITY_INVALID')
    if(canonicalContentJson(project.content)!==canonicalContentJson(extractContent(validateDocument(JSON.parse(s.rawDocument)))))throw new StoreError('迁移不得改变源业务内容',400,undefined,'MIGRATION_CONTENT_MISMATCH')
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(value.requestId)||![value.requestHash,value.sourceHash,value.geometryDigest,s.rawDocumentSha256].every(h=>/^[a-f0-9]{64}$/.test(h)))throw new StoreError('迁移摘要或请求键无效')
    return this.transaction(db=>{
      this.assertNativeIdentity(db,value.expectedDataRootId)
      this.requestEpoch(db,'migration',value.requestId)
      const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_migration_records'").get()
      const receipt=exists?db.prepare('SELECT request_hash,response FROM native_migration_records WHERE request_id=?').get(value.requestId) as any:undefined
      if(receipt){if(receipt.request_hash!==value.requestHash)throw new StoreError('迁移请求键已用于不同载荷',409,undefined,'IDEMPOTENCY_KEY_REUSED');return JSON.parse(receipt.response)}
      const row=this.row(db,s.diagramId,true)
      if(row.revision!==s.revision||row.document!==s.rawDocument||createHash('sha256').update(row.document).digest('hex')!==s.rawDocumentSha256||row.workspace_group_id!==s.workspaceGroupId||row.deleted_at!==s.deletedAt||row.created_at!==s.createdAt||row.saved_at!==s.savedAt)throw new StoreError('迁移预览后源记录已改变',409,row.revision,'MIGRATION_SOURCE_CHANGED')
      if(JSON.parse(row.document).schemaVersion===3)throw new StoreError('迁移源已是v3',409,row.revision,'MIGRATION_ALREADY_NATIVE')
      const now=Date.now(),revision=s.revision+1,json=JSON.stringify(project)
      db.exec('CREATE TABLE IF NOT EXISTS native_migration_records(request_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,diagram_id TEXT NOT NULL,source_revision INTEGER NOT NULL,target_revision INTEGER NOT NULL,source_raw TEXT NOT NULL,source_raw_hash TEXT NOT NULL,source_hash TEXT NOT NULL,converter_version TEXT NOT NULL,geometry_digest TEXT NOT NULL,report TEXT NOT NULL,response TEXT NOT NULL,created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL,description TEXT NOT NULL)')
      const result=db.prepare('UPDATE diagrams SET document=?,revision=?,saved_at=? WHERE id=? AND revision=? AND document=?').run(json,revision,now,s.diagramId,s.revision,s.rawDocument)
      if(result.changes!==1)throw new StoreError('迁移并发冲突',409,row.revision,'REVISION_CONFLICT')
      db.prepare('INSERT INTO diagram_versions VALUES(?,?,?,?)').run(s.diagramId,revision,json,now)
      const response={...decodeDiagramRow({...row,document:json,revision,saved_at:now}),deletedAt:row.deleted_at}
      db.prepare('INSERT INTO native_migration_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(value.requestId,value.requestHash,s.diagramId,s.revision,revision,s.rawDocument,s.rawDocumentSha256,value.sourceHash,value.converterVersion,value.geometryDigest,JSON.stringify(value.report),JSON.stringify(response),now)
      db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(?,?,?)').run(2,now,'native explicit legacy conversion and provenance')
      return response
    })
  }
}
