import {createHash} from 'node:crypto'
import {resolve,join} from 'node:path'
import {mkdir,realpath,lstat} from 'node:fs/promises'
import {DiagramStore} from '../store'
import {NativeDiagramService} from '../application/native-diagrams'
import {NativeExportService} from '../application/native-exports'
import {assertIsolatedNativeRoot} from '../native-pilot'
import {PACKAGE_ROOT} from '../package-paths'
import {CloudAccessError,assertCloudPermission,teamIdSchema,type CloudIdentityProvider,type CloudPermission,type CloudPrincipal} from './identity'

export interface CloudTeamWorkspace {
  readonly store:DiagramStore
  readonly diagrams:NativeDiagramService
  readonly exports:NativeExportService
  readonly dataRootId:string
}
interface Entry {workspace:Promise<CloudTeamWorkspace>;active:number;lastUsed:number}

/** Single-process ownership. Every acquisition authenticates before touching disk. */
export class CloudTeamWorkspaces {
  private readonly entries=new Map<string,Entry>()
  readonly root:string
  private closed=false
  constructor(root:string,private readonly identity:CloudIdentityProvider,private readonly options:{maxOpenTeams?:number;idleMs?:number;now?:()=>number}={}){
    this.root=resolve(root)
    assertIsolatedNativeRoot(this.root,PACKAGE_ROOT)
    if(!Number.isSafeInteger(options.maxOpenTeams??32)||(options.maxOpenTeams??32)<1)throw new Error('maxOpenTeams must be a positive integer')
  }
  async run<T>(token:string,teamId:string,permission:CloudPermission,operation:(workspace:CloudTeamWorkspace,principal:CloudPrincipal)=>Promise<T>):Promise<T>{
    if(this.closed)throw new CloudAccessError(503,'CLOUD_STOPPING','服务正在关闭')
    if(!teamIdSchema.safeParse(teamId).success)throw new CloudAccessError(400,'INVALID_TEAM','团队标识无效')
    const principal=await this.identity.authorize(token,teamId,permission)
    // Check provider responses at the boundary, including non-HTTP implementations.
    if(principal.team.id!==teamId)throw new CloudAccessError(403,'TEAM_ACCESS_DENIED','授权团队不匹配')
    if(principal.session.expiresAt<=Date.now())throw new CloudAccessError(401,'LOGIN_REQUIRED','登录已失效，请重新登录')
    assertCloudPermission(principal,permission)
    if(this.closed)throw new CloudAccessError(503,'CLOUD_STOPPING','服务正在关闭')
    const now=(this.options.now??Date.now)()
    for(const [id,value] of this.entries)if(!value.active&&now-value.lastUsed>(this.options.idleMs??15*60_000))this.entries.delete(id)
    let entry=this.entries.get(teamId)
    if(!entry){
      if(this.entries.size>=(this.options.maxOpenTeams??32)){
        const idle=[...this.entries.entries()].filter(([,value])=>!value.active).sort((a,b)=>a[1].lastUsed-b[1].lastUsed)[0]
        if(!idle)throw new CloudAccessError(503,'WORKSPACE_CAPACITY','当前工作区繁忙，请稍后重试')
        this.entries.delete(idle[0])
      }
      entry={workspace:this.open(teamId),active:0,lastUsed:now}
      this.entries.set(teamId,entry)
    }
    entry.active++
    try{return await operation(await entry.workspace,principal)}
    catch(error){void entry.workspace.catch(()=>{if(this.entries.get(teamId)===entry)this.entries.delete(teamId)});throw error}
    finally{entry.active--;entry.lastUsed=(this.options.now??Date.now)()}
  }
  private async open(teamId:string):Promise<CloudTeamWorkspace>{
    // Neither account identity nor a caller-provided path becomes a filesystem path.
    await mkdir(this.root,{recursive:true})
    if((await lstat(this.root)).isSymbolicLink())throw new CloudAccessError(503,'WORKSPACE_PATH_INVALID','云端存储根不能使用符号链接')
    const root=await realpath(this.root),teams=join(root,'teams')
    await mkdir(teams,{recursive:true})
    if((await lstat(teams)).isSymbolicLink())throw new CloudAccessError(503,'WORKSPACE_PATH_INVALID','团队存储路径配置无效')
    const storageKey=createHash('sha256').update(teamId).digest('hex'),path=join(teams,storageKey)
    await mkdir(path,{recursive:true})
    if((await lstat(path)).isSymbolicLink()||await realpath(path)!==path)throw new CloudAccessError(503,'WORKSPACE_PATH_INVALID','团队存储路径配置无效')
    const store=new DiagramStore(path)
    await store.init({seedExamples:false})
    const diagrams=new NativeDiagramService(store,true),exports=new NativeExportService(store,true)
    return {store,diagrams,exports,dataRootId:diagrams.dataRootId!}
  }
  close(){this.closed=true;this.entries.clear()}
}

/** Different members cannot replay or collide with each other's mutation keys. */
export function cloudRequestId(principal:CloudPrincipal,requestId:string):string{
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId))throw new CloudAccessError(400,'INVALID_REQUEST_ID','requestId 格式无效')
  return 'cloud_'+createHash('sha256').update(JSON.stringify([principal.team.id,principal.user.id,requestId])).digest('hex')
}
