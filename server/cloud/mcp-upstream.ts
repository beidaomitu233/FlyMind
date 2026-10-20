import {request as httpRequest} from 'node:http'
import {request as httpsRequest} from 'node:https'
import {Readable,Transform} from 'node:stream'
/** Node fetch strips Host on some supported Node20 builds. This fixed-origin
 * service hop uses the built-in HTTP client so the public virtual host is exact.
 * It never follows redirects, disables TLS verification, or accepts stream bodies. */
export function fixedApplicationFetch(url:URL,init:RequestInit):Promise<Response>{
 if(init.body!==undefined&&init.body!==null&&typeof init.body!=='string')return Promise.reject(Error('Unsupported internal request body'))
 if(typeof init.body==='string'&&Buffer.byteLength(init.body)>4_500_000)return Promise.reject(Error('Internal request budget exceeded'))
 return new Promise((resolve,reject)=>{
  const headers=Object.fromEntries(new Headers(init.headers).entries()),request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:init.method??'GET',headers,signal:init.signal??undefined},response=>{
   if((response.statusCode??0)>=300&&(response.statusCode??0)<400){response.destroy();reject(Error('Internal application redirect refused'));return}
   const output=new Headers();for(const [name,value] of Object.entries(response.headers))if(value!==undefined)for(const item of Array.isArray(value)?value:[value])output.append(name,item)
   let bytes=0
   const bounded=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;callback(bytes>64*1024*1024?Error('Internal response budget exceeded'):null,chunk)}})
   response.once('error',error=>bounded.destroy(error));bounded.once('close',()=>response.destroy())
   const body=[204,304].includes(response.statusCode??200)?null:Readable.toWeb(response.pipe(bounded)) as unknown as BodyInit
   resolve(new Response(body,{status:response.statusCode??503,headers:output}))
  })
  request.once('error',reject);request.end(init.body??undefined)
 })
}
