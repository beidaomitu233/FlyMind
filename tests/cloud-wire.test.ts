import {test} from 'node:test'
import assert from 'node:assert/strict'
import {wirePositiveInteger} from '../server/cloud/wire'
import {CloudControlPlane} from '../server/cloud/identity'
import {CloudOAuthProvider} from '../server/cloud/oauth-provider'

const invalid=[undefined,null,true,false,{},[],0,-1,1.2,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'',' ','0','01','+1','-1','1.0','1e3','0x10','9007199254740992','123\n']
test('Java wire positive integers accept only canonical decimal safe integers',()=>{
 for(const value of [1,123,Number.MAX_SAFE_INTEGER,'1','1730000000000',String(Number.MAX_SAFE_INTEGER)])assert.equal(wirePositiveInteger(value),Number(value))
 for(const value of invalid)assert.throws(()=>wirePositiveInteger(value),TypeError)
})

test('identity parses Jackson Long expiry but rejects malformed/unsafe values and retains expiry checks',async()=>{
 let expiry:unknown=String(Date.now()+60000)
 const identity=new CloudControlPlane('https://authority.invalid',{fetch:async()=>new Response(JSON.stringify({code:200,data:{user:{id:'alice',name:'Alice'},session:{id:'session-a',expiresAt:expiry},team:{id:'team-a',name:'A',role:'editor'}}}),{headers:{'Content-Type':'application/json'}})})
 assert.equal(typeof(await identity.authorize('app_session_'+ 'a'.repeat(40),'team-a','diagram:write')).session.expiresAt,'number')
 for(const value of invalid){expiry=value;await assert.rejects(identity.authorize('app_session_'+'a'.repeat(40),'team-a','diagram:read'),{code:'IDENTITY_INVALID_RESPONSE'})}
 expiry='1';await assert.rejects(identity.authorize('app_session_'+'a'.repeat(40),'team-a','diagram:read'),{code:'LOGIN_REQUIRED'})
})

test('OAuth normalizes authority issue/request/token time fields before strict SDK schema validation',async()=>{
 let issue:unknown='1730000000',expiry:unknown=String(Date.now()+60000),ttl:unknown='600'
 const metadata={client_id:'qa-client',client_id_issued_at:issue,redirect_uris:['http://127.0.0.1:12345/cb'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']}
 const provider=new CloudOAuthProvider({controlPlaneURL:'https://authority.invalid',publicOrigin:'https://flymind.example',gatewayKey:'qa-gateway-key-'+'x'.repeat(32),fetch:async(url)=>{
  const path=new URL(String(url)).pathname
  const data=path.includes('/clients')?{...metadata,client_id_issued_at:issue}:path.endsWith('/requests')?{requestId:'q'.repeat(43),expiresAt:expiry}:{access_token:'fm_mcp_'+'a'.repeat(43),refresh_token:'fm_refresh_'+'r'.repeat(43),expires_in:ttl,token_type:'Bearer',scope:'flymind:read flymind:write'}
  return new Response(JSON.stringify({code:200,data}),{headers:{'Content-Type':'application/json'}})
 }})
 const client=await provider.clientsStore.getClient('qa-client');assert.equal(client!.client_id_issued_at,1730000000)
 const params={redirectUri:metadata.redirect_uris[0],codeChallenge:'q'.repeat(43),scopes:['flymind:read'],resource:new URL('https://flymind.example/mcp')}
 let redirected='';await provider.authorize(client!,params,{redirect:(url:string)=>redirected=url} as any);assert.match(redirected,/authorize=/)
 const tokens=await provider.exchangeAuthorizationCode(client!,'qa-code','v'.repeat(43),params.redirectUri,params.resource);assert.equal(tokens.expires_in,600)
 assert.equal((await provider.exchangeRefreshToken(client!,tokens.refresh_token!,undefined,params.resource)).expires_in,600)
 for(const bad of invalid){if(bad!==undefined){issue=bad;await assert.rejects(provider.clientsStore.getClient('qa-client'))}issue='1730000000';expiry=bad;await assert.rejects(provider.authorize(client!,params,{redirect:()=>assert.fail('must not redirect')} as any));expiry=String(Date.now()+60000);ttl=bad;await assert.rejects(provider.exchangeRefreshToken(client!,tokens.refresh_token!,undefined,params.resource))}
})
