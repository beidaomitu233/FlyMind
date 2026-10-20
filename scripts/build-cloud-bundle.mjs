// Build from verified outputs. Does not install, start services, or include user data.
import {readFile,writeFile,cp,mkdir,lstat,readdir,access} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {resolve,join,relative,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2)
const arg=name=>args.find(value=>value.startsWith(name+'='))?.slice(name.length+1)
if(args.some(value=>!/^--(?:output|release-id)=/.test(value)))throw Error('Use --output=<new-directory> --release-id=<id>')
const releaseId=arg('--release-id');if(!releaseId||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(releaseId))throw Error('A safe immutable release id is required')
if(!arg('--output'))throw Error('A new output directory is required')
const output=resolve(arg('--output'));if(output===resolve(root)||resolve(root).startsWith(output+sep))throw Error('Output cannot replace or contain the source workspace')
try{await lstat(output);throw Error('Output already exists; choose a new directory')}catch(error){if(error.code!=='ENOENT')throw error}
const required=['lib/server/cloud/start.js','lib/server/cloud/mcp-gateway-start.js','dist/index.html','integrations/xinghui-admin/backend/system-admin/target/system-admin.jar','integrations/xinghui-admin/frontend/apps/web-ele/dist/index.html']
for(const name of required)await access(join(root,name))
await mkdir(output,{recursive:false})
const application=join(output,'application');await mkdir(application)
async function copy(from,to){await cp(join(root,from),join(output,to),{recursive:true,errorOnExist:true,force:false,dereference:false,filter:async path=>{if((await lstat(path)).isSymbolicLink())throw Error('Unexpected source build symlink: '+relative(root,path));return true}})}
for(const name of ['lib','dist','server/start.mjs','scripts/setup-drawio-runtime.mjs','resources/drawio/LICENSE','resources/drawio/supply.json','resources/fonts','docs/DRAWING_STANDARD.md','docs/AI_DRAWING_GUIDE.md','LICENSE','THIRD_PARTY_NOTICES.md'])await copy(name,'application/'+name)
await copy('integrations/xinghui-admin/frontend/apps/web-ele/dist','admin')
await copy('integrations/xinghui-admin/backend/system-admin/target/system-admin.jar','control-plane/system-admin.jar')
for(const name of ['README.md','control-plane.env.example','flymind-control-plane.service','start-control-plane.ps1'])await copy('integrations/xinghui-admin/backend/deploy/'+name,'control-plane/deploy/'+name)
await copy('deploy/cloud','ops')
await copy('scripts/verify-cloud-candidate.mjs','ops/verify-cloud-candidate.mjs')
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')),lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'))
const applicationPackage={name:'flymind-cloud-private',version:pkg.version,private:true,type:'module',license:pkg.license,engines:pkg.engines,dependencies:pkg.dependencies,scripts:{'start:application':'node lib/server/cloud/start.js','start:gateway':'node lib/server/cloud/mcp-gateway-start.js','setup:runtime':'node scripts/setup-drawio-runtime.mjs','smoke':'node scripts/cloud-bundle-smoke.mjs'}}
lock.name=applicationPackage.name;lock.packages['']={name:applicationPackage.name,version:pkg.version,license:pkg.license,engines:pkg.engines,dependencies:pkg.dependencies}
await writeFile(join(application,'package.json'),JSON.stringify(applicationPackage,null,2)+'\n');await writeFile(join(application,'package-lock.json'),JSON.stringify(lock,null,2)+'\n')
await copy('scripts/cloud-bundle-smoke.mjs','application/scripts/cloud-bundle-smoke.mjs')
const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}),dirty=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',windowsHide:true})
if(git.status!==0||!/^[a-f0-9]{40}$/.test(git.stdout.trim()))throw Error('Cannot record source commit')
const files=[]
async function walk(directory){for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(directory,entry.name);if(entry.isSymbolicLink())throw Error('Bundle cannot contain external links');if(entry.isDirectory())await walk(path);else{const bytes=await readFile(path);files.push({path:relative(output,path).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})}}}
await walk(output)
await writeFile(join(output,'candidate.json'),JSON.stringify({schemaVersion:1,releaseId,sourceCommit:git.stdout.trim(),dirty:!!dirty.stdout.trim(),appVersion:pkg.version,targetVersion:'1.1.0',prepared:false,note:'Platform dependencies/resources and smoke verification must be completed before promotion.',files},null,2)+'\n')
console.log(JSON.stringify({output,releaseId,files:files.length,prepared:false}))
