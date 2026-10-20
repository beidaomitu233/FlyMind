// Invoked ONLY inside the owned Java HTTP fixture; stdin carries temporary
// credentials. Never print session/access/refresh tokens, secrets or redirects.
import assert from 'node:assert/strict'
import {randomBytes,createHash} from 'node:crypto'
import {CloudControlPlane} from '../../server/cloud/identity.ts'
import {CloudOAuthProvider} from '../../server/cloud/oauth-provider.ts'
import {wirePositiveInteger} from '../../server/cloud/wire.ts'
let stage='input',providerURL,appToken
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw Error('input budget')}
 const {provider,phone,password,teamId,gatewayKey,publicOrigin}=JSON.parse(raw);providerURL=provider
 stage='app-login';const login=await fetch(provider+'/app/flymind/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password})}),envelope=await login.json();assert.equal(login.status,200);assert.equal(envelope.code,200);appToken=envelope.data.sessionToken;assert.ok(wirePositiveInteger(envelope.data.expiresAt)>Date.now())
 stage='app-introspect';const identity=new CloudControlPlane(provider,{allowInsecureLoopback:true});const app=await identity.authorize(appToken,teamId,'diagram:write');assert.equal(app.team.id,teamId);assert.equal(typeof app.session.expiresAt,'number')
 const oauth=new CloudOAuthProvider({controlPlaneURL:provider,publicOrigin,gatewayKey,allowInsecureLoopback:true}),redirectUri='http://127.0.0.1:12345/cloud-java-callback',resource=new URL(publicOrigin+'/mcp')
 stage='dcr';const client=await oauth.clientsStore.registerClient({client_name:'Cloud Java interoperability probe',redirect_uris:[redirectUri],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']});assert.equal(typeof client.client_id_issued_at,'number');assert.equal((await oauth.clientsStore.getClient(client.client_id)).client_id,client.client_id)
 const verifier=randomBytes(32).toString('base64url'),codeChallenge=createHash('sha256').update(verifier).digest('base64url');let location
 stage='authorize';await oauth.authorize(client,{redirectUri,codeChallenge,scopes:['flymind:read','flymind:write'],state:'cloud-java-probe',resource},{redirect:url=>{location=url}})
 const requestId=new URLSearchParams(new URL(location).hash.split('?')[1]).get('authorize');assert.ok(requestId)
 stage='consent-inspect';const inspected=await oauth.internal('/requests/inspect',{requestId},appToken);assert.ok(inspected.teams.some(team=>team.id===teamId));assert.equal(typeof inspected.expiresAt,'number')
 stage='consent-approve';const approved=await oauth.internal('/requests/approve',{requestId,approved:true,teamId},appToken),redirect=new URL(approved.redirectUri),code=redirect.searchParams.get('code');assert.equal(redirect.searchParams.get('state'),'cloud-java-probe');assert.ok(code)
 stage='pkce-code';const tokens=await oauth.exchangeAuthorizationCode(client,code,verifier,redirectUri,resource);assert.equal(typeof tokens.expires_in,'number');assert.ok(tokens.expires_in>0)
 stage='mcp-introspect';const grant=await oauth.principal(tokens.access_token);assert.equal(grant.team.id,teamId);assert.equal(typeof grant.session.expiresAt,'number')
 stage='refresh';const refreshed=await oauth.exchangeRefreshToken(client,tokens.refresh_token,undefined,resource);assert.notEqual(refreshed.access_token,tokens.access_token);assert.equal((await oauth.principal(refreshed.access_token)).session.id,grant.session.id)
 stage='revoke';await oauth.revokeToken(client,{token:refreshed.refresh_token,token_type_hint:'refresh_token'});await assert.rejects(oauth.principal(refreshed.access_token))
 console.log(JSON.stringify({ok:true,checks:['real-app-login-long-expiry','app-introspect','dcr-issued-at','consent-request-expiry','pkce-code-token-ttl','mcp-introspect-expiry','refresh-same-grant','revoke']}))
}catch(error){console.error(JSON.stringify({ok:false,stage,code:typeof error?.code==='string'?error.code:'CLOUD_JAVA_PROBE_FAILED'}));process.exitCode=1}
finally{if(providerURL&&appToken)await fetch(providerURL+'/app/flymind/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+appToken}}).catch(()=>{})}
