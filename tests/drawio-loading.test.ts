import {test} from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {runtimeAssetsRouter} from '../server/rendering/assets'
import {DRAWIO_VERSION} from '../src/drawing/engine/constants'

test('version-pinned editor assets are immutable while legacy entry remains revalidated and paths remain confined',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-loading-')),vendor=join(root,'vendor')
 await mkdir(join(vendor,'js'),{recursive:true});await writeFile(join(vendor,'index.html'),'<html>fixture</html>');await writeFile(join(vendor,'js','app.min.js'),'fixture-source')
 const app=express();app.use(runtimeAssetsRouter({projectRoot:root,drawioRoot:vendor,fontRoot:root,browserExecutable:join(root,'unused')}));const server=createServer(app)
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port
 try{
  const pinned=await fetch(origin+`/drawio/v${DRAWIO_VERSION}/js/app.min.js`)
  assert.equal(pinned.status,200);assert.equal(pinned.headers.get('cache-control'),'public, max-age=31536000, immutable');assert.equal(await pinned.text(),'fixture-source')
  const legacy=await fetch(origin+'/drawio/js/app.min.js');assert.equal(legacy.headers.get('cache-control'),'no-cache');assert.equal(await legacy.text(),'fixture-source')
  assert.equal((await fetch(origin+`/drawio/v${DRAWIO_VERSION}/WEB-INF/private`)).status,404)
  assert.equal((await fetch(origin+'/drawio/v0.0.0/index.html')).status,404)
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
})
