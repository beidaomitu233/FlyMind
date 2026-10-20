import {createHash,randomUUID} from 'node:crypto'
import type Database from 'better-sqlite3'
import {canonicalContentJson} from '../../src/drawing/engine/content-hash'
import {currentActivityActor,type ActivityActor} from './context'
export interface ActivityDelta {added:number;removed:number;updated:number;changed:Array<{id:string;fields:string[]}>;truncated?:boolean;orderChanged?:boolean}
export interface ActivitySummary {contentFields?:string[];nodes?:ActivityDelta;edges?:ActivityDelta;lanes?:ActivityDelta;phases?:ActivityDelta;groups?:ActivityDelta;renderingChanged?:boolean;affectedDiagrams?:number}
export interface ActivityEvent {
 eventVersion:1;eventId:string;commitSequence:number;occurredAt:number;dataRootId:string|null;actor:Omit<ActivityActor,'requestId'|'dataRootId'>;action:string;exportId?:string;diagramId?:string;groupId?:string|null;fromGroupId?:string|null;source?:{format:string;sha256:string;bytes:number};fromRevision?:number;toRevision?:number;requestIdDigest?:string;batchId?:string;itemId?:string;summary:ActivitySummary
}
export interface ActivityInput {action:string;exportId?:string;diagramId?:string;groupId?:string|null;fromGroupId?:string|null;source?:{format:string;sha256:string;bytes:number};fromRevision?:number;toRevision?:number;requestId?:string;batchId?:string;itemId?:string;summary?:ActivitySummary}
export interface ActivityQuery {diagramId?:string;groupId?:string;cursor?:string;limit?:number;actorUserId?:string;channel?:ActivityActor['channel'];action?:string}
export interface ActivityPage {items:ActivityEvent[];nextCursor?:string}
const digest=(v:string)=>createHash('sha256').update(v).digest('hex')
function collection(before:unknown,after:unknown):ActivityDelta|undefined{
 const map=(value:unknown)=>new Map((Array.isArray(value)?value:[]).map(v=>[v.id,v as Record<string,unknown>]))
 const previous=map(before),next=map(after),changed:ActivityDelta['changed']=[];let added=0,removed=0,updated=0
 for(const [id,value]of next){const prev=previous.get(id);if(!prev){added++;if(changed.length<100)changed.push({id,fields:[]});continue}const fields=[...new Set([...Object.keys(prev),...Object.keys(value)])].filter(k=>canonicalContentJson((prev[k]??null) as any)!==canonicalContentJson((value[k]??null) as any)).sort();if(fields.length){updated++;if(changed.length<100)changed.push({id,fields})}}
 for(const id of previous.keys())if(!next.has(id)){removed++;if(changed.length<100)changed.push({id,fields:[]})}
 const orderChanged=added===0&&removed===0&&JSON.stringify([...previous.keys()])!==JSON.stringify([...next.keys()])
 return added||removed||updated||orderChanged?{added,removed,updated,changed,...(orderChanged?{orderChanged:true}:{}),...(added+removed+updated>100?{truncated:true}:{})}:undefined
}
/** Compare the transaction's current server content to the accepted result, never the sender's stale base. */
export function activitySummary(before:unknown,after:unknown,renderingChanged=false):ActivitySummary{
 const a=(before??{}) as Record<string,unknown>,b=(after??{}) as Record<string,unknown>,summary:ActivitySummary={}
 const collections=['nodes','edges','lanes','phases','groups'] as const
 for(const key of collections){const value=collection(a[key],b[key]);if(value)summary[key]=value}
 const fields=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>!['id','schemaVersion',...collections].includes(k)&&canonicalContentJson((a[k]??null) as any)!==canonicalContentJson((b[k]??null) as any)).sort()
 if(fields.length)summary.contentFields=fields
 if(renderingChanged)summary.renderingChanged=true
 return summary
}
export function appendActivity(db:Database.Database,dataRootId:string|null,input:ActivityInput){
 const actor=currentActivityActor(),{requestId:actorRequest,dataRootId:_,...publicActor}=actor
 db.exec('CREATE TABLE IF NOT EXISTS workspace_activity(commit_sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,diagram_id TEXT,group_id TEXT,data_root_id TEXT,occurred_at INTEGER NOT NULL,event TEXT NOT NULL CHECK(json_valid(event))); CREATE INDEX IF NOT EXISTS workspace_activity_diagram ON workspace_activity(diagram_id,commit_sequence DESC); CREATE INDEX IF NOT EXISTS workspace_activity_group ON workspace_activity(group_id,commit_sequence DESC)')
 const eventId=randomUUID(),occurredAt=Date.now(),{requestId,...details}=input
 const event={eventVersion:1 as const,eventId,occurredAt,dataRootId,actor:publicActor,...details,summary:input.summary??{},...(requestId||actorRequest?{requestIdDigest:digest(requestId??actorRequest!)}:{})}
 db.prepare('INSERT INTO workspace_activity(event_id,diagram_id,group_id,data_root_id,occurred_at,event) VALUES(?,?,?,?,?,?)').run(eventId,input.diagramId??null,input.groupId??null,dataRootId,occurredAt,JSON.stringify(event))
}
export function readActivity(db:Database.Database,dataRootId:string|null,query:ActivityQuery={}):ActivityPage{
 const limit=query.limit??50
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||Object.keys(query).some(k=>!['diagramId','groupId','cursor','limit','actorUserId','channel','action'].includes(k))||[query.diagramId,query.groupId,query.actorUserId,query.action].some(v=>v!==undefined&&(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v))))throw new TypeError('操作记录分页参数无效')
 if(query.channel!==undefined&&!['web','mcp','system'].includes(query.channel))throw new TypeError('操作记录渠道无效')
 const filter=digest(JSON.stringify([dataRootId,query.diagramId??null,query.groupId??null,query.actorUserId??null,query.channel??null,query.action??null]));let before=Number.MAX_SAFE_INTEGER
 if(query.cursor){if(typeof query.cursor!=='string'||query.cursor.length>512||!/^[A-Za-z0-9_-]+$/.test(query.cursor))throw new TypeError('操作记录游标无效');let value;try{value=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'))}catch{throw new TypeError('操作记录游标无效')}if(value.version!==1||value.filter!==filter||!Number.isSafeInteger(value.before)||value.before<1)throw new TypeError('操作记录游标与当前工作区或筛选不匹配');before=value.before}
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='workspace_activity'").get())return {items:[]}
 const where=['commit_sequence<?'],parameters:Array<string|number>=[before]
 if(query.diagramId){where.push('diagram_id=?');parameters.push(query.diagramId)}if(query.groupId){where.push("(group_id=? OR json_extract(event,'$.fromGroupId')=?)");parameters.push(query.groupId,query.groupId)}if(query.actorUserId){where.push("json_extract(event,'$.actor.userId')=?");parameters.push(query.actorUserId)}if(query.channel){where.push("json_extract(event,'$.actor.channel')=?");parameters.push(query.channel)}if(query.action){where.push("json_extract(event,'$.action')=?");parameters.push(query.action)}parameters.push(limit+1)
 const rows=db.prepare('SELECT commit_sequence,event FROM workspace_activity WHERE '+where.join(' AND ')+' ORDER BY commit_sequence DESC LIMIT ?').all(...parameters) as {commit_sequence:number;event:string}[]
 const items=rows.slice(0,limit).map(row=>({...JSON.parse(row.event),commitSequence:row.commit_sequence}) as ActivityEvent)
 return {items,...(rows.length>limit?{nextCursor:Buffer.from(JSON.stringify({version:1,filter,before:items.at(-1)!.commitSequence})).toString('base64url')}:{})}
}
