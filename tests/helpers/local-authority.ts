import express from 'express'
import assert from 'node:assert/strict'
/** Isolated authority fixture, never imported by production code. */
export async function localAuthorityFixture(){
 const app=express(),session='a'.repeat(43),grant='fm_local_'+'g'.repeat(43);app.use(express.json())
 app.post('/app/flymind/auth/login',(_q,r)=>r.json({code:200,data:{sessionToken:session,expiresAt:Date.now()+600000,user:{id:'test-user',name:'Test'}}}))
 app.get('/app/flymind/auth/me',(_q,r)=>r.json({code:200,data:{user:{id:'test-user',name:'Test'},expiresAt:Date.now()+600000,teams:[{id:'test-team',name:'Test',role:'owner'}]}}))
 app.post('/app/flymind/local/grants',(_q,r)=>r.json({code:200,data:{grantToken:grant,expiresAt:Date.now()+600000}}))
 app.post('/app/flymind/local/introspect',(q,r)=>r.json({code:200,data:{user:{id:'test-user',name:'Test'},session:{id:'test-grant',expiresAt:Date.now()+600000},team:{id:'test-team',name:'Test',role:'owner'},binding:q.body}}))
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();if(!address||typeof address==='string')throw Error('fixture address');const origin='http://127.0.0.1:'+address.port
 return {origin,async login(base:string){const response=await fetch(base+'/studio-api/local-auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({phone:'13800000001',password:'fixture-password',teamId:'test-team'})});assert.equal(response.status,200,await response.text())},async close(){await new Promise<void>(r=>server.close(()=>r()))}}
}
