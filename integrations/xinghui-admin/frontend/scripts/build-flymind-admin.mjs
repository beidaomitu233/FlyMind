import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,unlink,lstat,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,relative,resolve} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const app=join(root,'apps/web-ele');
const template=join(app,'.env.example');
const temporary=join(app,'.env.production.local');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const shell=process.platform==='win32';
const declared=JSON.parse(await readFile(join(root,'package.json'),'utf8')).packageManager;
const expectedVersion=declared.replace(/^pnpm@/,'');
const version=spawnSync('pnpm',['--version'],{cwd:root,shell,encoding:'utf8',windowsHide:true});
if(version.status!==0||version.stdout.trim()!==expectedVersion)throw Error(`Use locked pnpm: npx --yes ${declared} exec node scripts/build-flymind-admin.mjs`);
const source=await readFile(template);
// Exclusive creation: never replace an operator's production configuration.
await writeFile(temporary,source,{flag:'wx'});
try{
 await new Promise((yes,no)=>{
  // All arguments are fixed build operations, with no user supplied shell text.
  const child=spawn('pnpm',['exec','turbo','run','build','--filter=@vben/web-ele','--env-mode=loose','--concurrency=1'],{
   cwd:root,shell,windowsHide:true,stdio:'inherit',
   env:{...process.env,TURBO_TELEMETRY_DISABLED:'1',NODE_OPTIONS:process.env.NODE_OPTIONS||'--max-old-space-size=4096'},
  });
  child.once('error',no);
  child.once('close',(code,signal)=>code===0?yes():no(Error(`Build failed (${signal||code})`)));
 });
 const dist=join(app,'dist');
 const html=await readFile(join(dist,'index.html'),'utf8');
 const configText=await readFile(join(dist,'_app.config.js'),'utf8');
 const prefix='window._VBEN_ADMIN_PRO_APP_CONF_=';
 if(!configText.startsWith(prefix))throw Error('Unknown public config format');
 const config=JSON.parse(configText.slice(prefix.length,configText.indexOf(';')));
 if(config.VITE_GLOB_API_URL!=='/api'||!html.includes('/admin/'))throw Error('Public API/base configuration is missing');
 if(html.includes('hm.baidu.com'))throw Error('Unexpected inherited analytics');
 const files=[];
 async function walk(directory){for(const name of (await readdir(directory)).sort()){
  const p=join(directory,name),info=await lstat(p);
  if(info.isSymbolicLink())throw Error('Unexpected build output symlink');
  if(info.isDirectory())await walk(p);else if(info.isFile()){const bytes=await readFile(p);files.push({path:relative(dist,p).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)});}
 }}
 await walk(dist);files.sort((a,b)=>a.path.localeCompare(b.path));
 const result={node:process.version,pnpm:expectedVersion,base:'/admin/',api:'/api',analytics:false,fileCount:files.length,totalBytes:files.reduce((n,f)=>n+f.bytes,0),treeSha256:hash(files.map(f=>`${f.path}\0${f.sha256}\n`).join('')),files};
 await mkdir(join(root,'.validation'),{recursive:true});
 await writeFile(join(root,'.validation/build-result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({...result,files:undefined}));
}finally{
 // Delete only the exact public template bytes created by this invocation.
 const current=await lstat(temporary).catch(()=>undefined);
 if(current){if(current.isSymbolicLink()||hash(await readFile(temporary))!==hash(source))throw Error('Build config changed; retained for operator review');await unlink(temporary);}
}
