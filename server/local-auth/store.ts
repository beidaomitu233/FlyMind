import {mkdir,lstat,realpath,readFile,open,rename,unlink,rmdir,chmod} from 'node:fs/promises'
import {isAbsolute,join,resolve,parse,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {LocalAuthError,type LocalAuthState,type LocalAuthStore} from './types'
/** Owner-only credential directory. Same-user malware/admin access is not hardware attestation. */
export class PrivateLocalAuthStore implements LocalAuthStore {
 private initialized?:Promise<void>
 constructor(readonly directory:string){if(!isAbsolute(directory)||resolve(directory)===parse(resolve(directory)).root)throw new LocalAuthError(500,'LOCAL_AUTH_CONFIGURATION_REQUIRED','必须配置独立的绝对私有授权目录')}
 private setup(){
  if(this.initialized)return this.initialized
  const initializing=(async()=>{
  await mkdir(this.directory,{recursive:true,mode:0o700})
  let current=resolve(this.directory);for(;;){const info=await lstat(current);if(info.isSymbolicLink()||!info.isDirectory())throw new LocalAuthError(503,'LOCAL_AUTH_STORE_UNSAFE','授权目录不能为链接或重定向目录');const parent=resolve(current,'..');if(parent===current)break;current=parent}
  if(process.platform==='win32'){
   const script="$ErrorActionPreference='Stop';$p=$env:FLYMIND_LOCAL_AUTH_PRIVATE_PATH;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=[IO.Directory]::GetAccessControl($p);$acl.SetAccessRuleProtection($true,$false);foreach($old in @($acl.Access)){$acl.RemoveAccessRuleSpecific($old)};$acl.SetOwner($sid);$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule);[IO.Directory]::SetAccessControl($p,$acl);$check=[IO.Directory]::GetAccessControl($p);if(!$check.AreAccessRulesProtected){throw 'ACL protection failed'};foreach($a in $check.Access){if($a.AccessControlType -eq 'Allow' -and $a.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'Unexpected ACL principal'}};$file=[IO.Path]::Combine($p,'state.json');if([IO.File]::Exists($file)){foreach($a in [IO.File]::GetAccessControl($file).Access){if($a.AccessControlType -eq 'Allow' -and $a.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'Unexpected file ACL principal'}}}"
   // Cold Windows PowerShell/Defender startup can exceed 10s on hosted CI. Keep a finite
   // 30s budget and fail closed; wait for close so its pipes/process have fully settled.
   await new Promise<void>((yes,no)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,shell:false,stdio:'ignore',env:{...process.env,FLYMIND_LOCAL_AUTH_PRIVATE_PATH:resolve(this.directory)},timeout:30000});child.once('error',()=>no(new LocalAuthError(503,'LOCAL_AUTH_STORE_UNSAFE','无法设置私有授权目录ACL')));child.once('close',(code,signal)=>code===0?yes():no(new LocalAuthError(503,signal==='SIGTERM'?'LOCAL_AUTH_STORE_TIMEOUT':'LOCAL_AUTH_STORE_UNSAFE',signal==='SIGTERM'?'私有授权目录ACL检查超时，访问未放行':'私有授权目录ACL校验失败')))})
  }else await chmod(this.directory,0o700)
  })()
  this.initialized=initializing
  // A later independent request may retry the full ACL check; never replay a write,
  // invalidate a successful check, or clear a newer initialization attempt.
  void initializing.catch(()=>{if(this.initialized===initializing)this.initialized=undefined})
  return initializing
 }
 private async load():Promise<LocalAuthState|undefined>{
  const file=join(this.directory,'state.json');let info;try{info=await lstat(file)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e}
  if(info.isSymbolicLink()||!info.isFile()||info.size>8192||process.platform!=='win32'&&(info.mode&0o077)!==0)throw new LocalAuthError(503,'LOCAL_AUTH_STORE_UNSAFE','授权记录权限或格式不安全')
  try{return JSON.parse(await readFile(file,'utf8'))}catch{throw new LocalAuthError(503,'LOCAL_AUTH_STORE_INVALID','授权记录损坏，未自动重置绑定')}
 }
 async read(){await this.setup();return this.load()}
 async update(change:(state:LocalAuthState|undefined)=>LocalAuthState){
  await this.setup();const lock=join(this.directory,'.lock');let locked=false
  for(let n=0;n<100;n++){try{await mkdir(lock,{mode:0o700});locked=true;break}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;await new Promise(r=>setTimeout(r,20))}}
  if(!locked)throw new LocalAuthError(503,'LOCAL_AUTH_STORE_LOCKED','授权记录被占用；未自动移除未知维护锁')
  const temporary=join(this.directory,'.state-'+randomUUID()+'.pending')
  try{
   const state=change(await this.load()),bytes=JSON.stringify(state);if(Buffer.byteLength(bytes)>8192)throw new LocalAuthError(503,'LOCAL_AUTH_STORE_INVALID','授权记录超限')
   const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync()}finally{await file.close()}
   await rename(temporary,join(this.directory,'state.json'));return state
  }finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e});if(await realpath(lock)!==join(await realpath(this.directory),'.lock')||!(await realpath(lock)).startsWith(await realpath(this.directory)+sep))throw new LocalAuthError(503,'LOCAL_AUTH_STORE_UNSAFE','拒绝清理已改变的授权锁');await rmdir(lock)}
 }
}
