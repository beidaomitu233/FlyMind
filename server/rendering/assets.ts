import {Router} from 'express'
import {readFile,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {drawioStaticRouter} from '../native-routes'
import {DRAWIO_VERSION} from '../../src/drawing/engine/constants'
import {RUNTIME_FONT_FILE,RUNTIME_FONT_SHA256,RUNTIME_BROWSER_REVISION} from '../../src/drawing/engine/runtime-assets'
import {NativeRenderError,type RuntimeAssetPaths} from './types'
export type {RuntimeAssetPaths} from './types'
export function resolveRuntimeAssets(projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..')):RuntimeAssetPaths{
 const shell=process.platform==='win32'?'chrome-headless-shell-win64/chrome-headless-shell.exe':process.platform==='linux'?'chrome-headless-shell-linux64/chrome-headless-shell':`chrome-headless-shell-mac-${process.arch==='arm64'?'arm64':'x64'}/chrome-headless-shell`
 return {projectRoot,drawioRoot:resolve(projectRoot,'resources/drawio/vendor'),fontRoot:resolve(projectRoot,'resources/fonts'),browserExecutable:resolve(projectRoot,`resources/browsers/chromium_headless_shell-${RUNTIME_BROWSER_REVISION}`,shell)}
}
export async function checkRuntimeAssets(assets=resolveRuntimeAssets()){
 for(const [code,path] of [['DRAWIO_MISSING',resolve(assets.drawioRoot,'js/app.min.js')],['FONT_MISSING',resolve(assets.fontRoot,RUNTIME_FONT_FILE)],['FONT_LICENSE_MISSING',resolve(assets.fontRoot,'OFL.txt')],['BROWSER_MISSING',assets.browserExecutable]] as const){try{if(!(await stat(path)).isFile())throw Error()}catch{throw new NativeRenderError(code,`${path}；运行 node scripts/setup-drawio-runtime.mjs`)}}
 const app=await readFile(resolve(assets.drawioRoot,'js/app.min.js'),'utf8');if(!app.includes(`EditorUi.VERSION="${DRAWIO_VERSION}"`))throw new NativeRenderError('DRAWIO_VERSION_MISMATCH','本地 draw.io 不是固定版本')
 const fontHash=createHash('sha256').update(await readFile(resolve(assets.fontRoot,RUNTIME_FONT_FILE))).digest('hex');if(fontHash!==RUNTIME_FONT_SHA256)throw new NativeRenderError('FONT_HASH_MISMATCH','本地字体 SHA256 不匹配')
 if(createHash('sha256').update(await readFile(resolve(assets.fontRoot,'OFL.txt'))).digest('hex')!=='6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2')throw new NativeRenderError('FONT_LICENSE_HASH_MISMATCH','字体许可 SHA256 不匹配')
 return {fontHash,drawioVersion:DRAWIO_VERSION}
}
/** Root mount: app.use(runtimeAssetsRouter()). No parent-directory fallback. */
export function runtimeAssetsRouter(assets=resolveRuntimeAssets()){
 const router=Router();try{router.use('/drawio',drawioStaticRouter(assets.drawioRoot))}catch{throw new NativeRenderError('DRAWIO_MISSING',`${assets.drawioRoot}；运行 node scripts/setup-drawio-runtime.mjs`)}
 router.get(`/runtime-assets/fonts/${RUNTIME_FONT_FILE}`,(_req,res)=>{res.setHeader('Content-Type','font/otf');res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.sendFile(resolve(assets.fontRoot,RUNTIME_FONT_FILE))})
 router.get('/runtime-assets/fonts/OFL.txt',(_req,res)=>res.sendFile(resolve(assets.fontRoot,'OFL.txt')))
 return router
}
