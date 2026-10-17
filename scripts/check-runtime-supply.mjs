// npm ci first; read-only diagnostics of the project-local fixed runtime.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {resolveRuntimeAssets,checkRuntimeAssets} from '../server/rendering/assets.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(root,'output/playwright/runtime-supply'),assets=resolveRuntimeAssets(root),report={checkedAt:new Date().toISOString(),assets};let browser;
try{report.runtime=await checkRuntimeAssets(assets);const manifest=JSON.parse(await readFile(resolve(root,'resources/drawio/supply.json'),'utf8'));if(manifest.archiveSha256!=='6c4ab25145c3479bf0097e4fccd20c602968615986bc999af8a214719fabd3f4')throw Error('WAR_MANIFEST_MISMATCH');for(const f of manifest.files){const data=await readFile(resolve(assets.drawioRoot,f.path));if(data.length!==f.bytes||createHash('sha256').update(data).digest('hex')!==f.sha256)throw Error('VENDOR_HASH_MISMATCH '+f.path)}report.verifiedVendorFiles=manifest.files.length;browser=await chromium.launch({headless:true,executablePath:assets.browserExecutable});report.browserVersion=browser.version();if(report.browserVersion!=='151.0.7922.34')throw Error('BROWSER_VERSION_MISMATCH');report.ok=true}catch(e){report.ok=false;report.error=e.stack;process.exitCode=1}finally{await browser?.close();await mkdir(out,{recursive:true});await writeFile(resolve(out,'project-runtime.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
