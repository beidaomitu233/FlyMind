import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createWorkspaceBackup} from './workspace'
import {planWorkspaceRestore,applyWorkspaceRestore,recoverWorkspaceRestore} from './restore'
/** Explicit pilot maintenance CLI; no default production root and no implicit initialization. */
async function main(){
 const [command,rootArg,inputArg,outputArg]=process.argv.slice(2)
 if(!rootArg||process.env.FLYMIND_NATIVE_PILOT!=='1')throw Error('需要 FLYMIND_NATIVE_PILOT=1 和显式隔离数据根')
 const root=resolve(rootArg),options={dataRoot:root,env:{...process.env,FLYMIND_DATA_DIR:root},port:0}
 if(command==='backup'&&inputArg){const result=await createWorkspaceBackup({sourceRoot:root,backupRoot:resolve(inputArg)});console.log(JSON.stringify({backupRoot:result.backupRoot,backupId:result.manifest.backupId}));return}
 if(command==='plan'&&inputArg&&outputArg){const plan=await planWorkspaceRestore({...options,backupRoot:resolve(inputArg)});await writeFile(resolve(outputArg),JSON.stringify(plan,null,2),{flag:'wx'});console.log(JSON.stringify({planId:plan.planId,targetStateHash:plan.targetStateHash}));return}
 if(command==='restore'&&inputArg){const result=await applyWorkspaceRestore({...options,plan:JSON.parse(await readFile(resolve(inputArg),'utf8'))});console.log(JSON.stringify(result));return}
 if(command==='recover'){console.log(JSON.stringify(await recoverWorkspaceRestore(options)));return}
 throw Error('用法: backup <root> <backup-directory> | plan <root> <backup> <new-plan.json> | restore <root> <plan.json> | recover <root>')
}
main().catch(error=>{console.error(JSON.stringify({code:error.code??'MAINTENANCE_FAILED',message:error.message}));process.exitCode=1})
