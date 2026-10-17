// Fixed local runtime installer. Run after npm ci. Never installs a machine Chrome.
import {readFile,writeFile,mkdir,stat,rename,rm} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {unzipSync} from 'fflate';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),arg=name=>args.find(a=>a.startsWith(name+'='))?.slice(name.length+1);
const version='31.5.3',archiveSHA='6c4ab25145c3479bf0097e4fccd20c602968615986bc999af8a214719fabd3f4',fontSHA='2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b',licenseSHA='43070e2d4e532684de521b885f385d0841030efa2b1a20bafb76133a5e1379c1',fontLicenseSHA='6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2';
const sha=b=>createHash('sha256').update(b).digest('hex'),source=`https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78`;
async function fetchFixed(url,hash,maxBytes){const r=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`Download ${r.status}: ${url}`);const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>maxBytes){await r.body.cancel().catch(()=>{});throw Error('DOWNLOAD_BUDGET')}chunks.push(chunk)}const b=Buffer.concat(chunks);if(sha(b)!==hash)throw Error(`SHA256_MISMATCH ${url}`);return b}
async function fixedFile(path,url,hash,maxBytes){try{const b=await readFile(path);if(sha(b)===hash)return b;throw Error(`SHA256_MISMATCH ${path}`)}catch(e){if(e.code!=='ENOENT')throw e}const b=await fetchFixed(url,hash,maxBytes);await mkdir(dirname(path),{recursive:true});await writeFile(path,b);return b}
export function unpackFixedWar(bytes){
 if(sha(bytes)!==archiveSHA)throw Error('WAR_SHA256_MISMATCH')
 const names=new Set();let size=0,count=0
 return unzipSync(bytes,{filter:entry=>{const name=entry.name,parts=name.split('/');if(!name||name.startsWith('/')||/[\\:\x00]/.test(name)||parts.some(p=>p==='..'||p==='.')||names.has(name.toLowerCase()))throw Error(`UNSAFE_ZIP_ENTRY ${name}`);names.add(name.toLowerCase());if(++count>5000||entry.originalSize>64*1024*1024||(size+=entry.originalSize)>256*1024*1024)throw Error('ZIP_BUDGET');return !name.endsWith('/')}})
}
async function main(){
 const resources=arg('--resources-root')?resolve(arg('--resources-root')):resolve(root,'resources'),drawio=resolve(resources,'drawio'),target=resolve(drawio,'vendor');if(!args.includes('--only-fonts')){await mkdir(drawio,{recursive:true});
 let installed=false;try{const manifest=JSON.parse(await readFile(resolve(drawio,'supply.json'),'utf8'));installed=manifest.archiveSha256===archiveSHA&&(await stat(resolve(target,'js/app.min.js'))).isFile()}catch{}
 if(!installed){
  try{await stat(target);throw Error(`VENDOR_EXISTS_UNVERIFIED ${target}；请保留后人工移开再重试`)}catch(e){if(e.code!=='ENOENT')throw e}
  const archivePath=arg('--archive')?resolve(arg('--archive')):resolve(root,`resources/cache/draw-v${version}.war`),archive=await fixedFile(archivePath,`https://github.com/jgraph/drawio/releases/download/v${version}/draw.war`,archiveSHA,64*1024*1024),entries=unpackFixedWar(archive);
  const temporary=resolve(drawio,`vendor.install-${randomUUID()}`);if(!temporary.startsWith(resolve(drawio)+sep))throw Error('UNSAFE_INSTALL_PATH');await mkdir(temporary);try{for(const [name,data] of Object.entries(entries)){const file=resolve(temporary,name);if(!file.startsWith(temporary+sep))throw Error('UNSAFE_ZIP_PATH');await mkdir(dirname(file),{recursive:true});await writeFile(file,data)}await rename(temporary,target)}catch(e){if(!resolve(temporary).startsWith(resolve(drawio)+sep))throw Error('UNSAFE_CLEANUP_PATH');await rm(temporary,{recursive:true,force:true});throw e}
  const manifest={version,archiveUrl:`https://github.com/jgraph/drawio/releases/download/v${version}/draw.war`,archiveSha256:archiveSHA,files:Object.entries(entries).map(([path,b])=>({path,bytes:b.length,sha256:sha(b)}))};await writeFile(resolve(drawio,'supply.json'),JSON.stringify(manifest,null,2));
 }
 const license=arg('--license')?await readFile(resolve(arg('--license'))):await fixedFile(resolve(drawio,'LICENSE'),`https://raw.githubusercontent.com/jgraph/drawio/v${version}/LICENSE`,licenseSHA,100000);if(sha(license)!==licenseSHA)throw Error('DRAWIO_LICENSE_HASH_MISMATCH');await writeFile(resolve(drawio,'LICENSE'),license);
 }
 const fonts=resolve(resources,'fonts');await fixedFile(resolve(fonts,'NotoSansCJKsc-Regular.otf'),`${source}/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf`,fontSHA,20*1024*1024);await fixedFile(resolve(fonts,'OFL.txt'),`${source}/LICENSE`,fontLicenseSHA,100000);
 await writeFile(resolve(fonts,'COPYRIGHT.txt'),`© 2014-2021 Adobe (http://www.adobe.com/).\nSource: ${source}\nLicense: SIL Open Font License 1.1, see OFL.txt and embedded font metadata.\n`);
 await writeFile(resolve(fonts,'supply.json'),JSON.stringify({name:'Noto Sans CJK SC',release:'Sans2.004',commit:'523d033d6cb47f4a80c58a35753646f5c3608a78',source,license:'SIL Open Font License 1.1',fontSha256:fontSHA,licenseSha256:fontLicenseSHA,size:16437364},null,2));
 if(!args.includes('--skip-browser')&&!args.includes('--only-fonts')){const pkg=JSON.parse(await readFile(resolve(root,'node_modules/playwright-core/package.json'),'utf8')),registry=JSON.parse(await readFile(resolve(root,'node_modules/playwright-core/browsers.json'),'utf8')),shell=registry.browsers.find(b=>b.name==='chromium-headless-shell');if(pkg.version!=='1.62.1'||shell?.revision!=='1234'||shell?.browserVersion!=='151.0.7922.34')throw Error('PLAYWRIGHT_REGISTRY_MISMATCH');const p=spawnSync(process.execPath,[resolve(root,'node_modules/playwright-core/cli.js'),'install','chromium','--only-shell'],{env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:resolve(resources,'browsers')},stdio:'inherit',windowsHide:true,timeout:180000});if(p.error||p.status!==0)throw Error(`BROWSER_INSTALL_FAILED ${p.error?.message??p.status}`)}
 console.log(JSON.stringify({ok:true,version,components:{drawio:!args.includes('--only-fonts'),font:true,browser:!args.includes('--skip-browser')&&!args.includes('--only-fonts')},vendor:target,font:resolve(fonts,'NotoSansCJKsc-Regular.otf'),browser:'playwright-core pinned registry chromium headless shell revision 1234',note:'Apache-2.0 plus bundled third-party licenses retained; no vendor files are served from WAR private directories.'},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
