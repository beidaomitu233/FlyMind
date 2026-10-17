import type {DiagramContent} from '../core/model'

/** Stable JSON: object keys sort lexically; array order remains meaningful. */
export function canonicalContentJson(content:DiagramContent):string {
  const active=new Set<object>()
  function encode(value:unknown):string {
    if(value===null)return 'null'
    if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value)
    if(typeof value==='number'){
      if(!Number.isFinite(value))throw new Error('Content hash requires finite JSON numbers')
      return JSON.stringify(value)
    }
    if(typeof value!=='object')throw new Error('Content hash requires JSON data')
    if(active.has(value))throw new Error('Content hash does not accept cycles')
    const proto=Object.getPrototypeOf(value)
    if(!Array.isArray(value)&&proto!==Object.prototype&&proto!==null)throw new Error('Content hash requires plain JSON objects')
    active.add(value)
    try{
      if(Array.isArray(value)){
        for(let i=0;i<value.length;i++)if(!Object.hasOwn(value,i))throw new Error('Content hash does not accept sparse arrays')
        return '['+value.map(encode).join(',')+']'
      }
      if(Object.getOwnPropertySymbols(value).length)throw new Error('Content hash requires JSON object keys')
      const record=value as Record<string,unknown>
      return '{'+Object.keys(record).filter(key=>record[key]!==undefined).sort().map(key=>JSON.stringify(key)+':'+encode(record[key])).join(',')+'}'
    }finally{active.delete(value)}
  }
  return encode(content)
}

/** Web Crypto works in browsers and supported Node; no Node built-ins enter the client bundle. */
export async function contentHash(content:DiagramContent):Promise<string> {
  if(!globalThis.crypto?.subtle)throw new Error('SHA-256 requires Web Crypto in this runtime')
  const bytes=new TextEncoder().encode(canonicalContentJson(content))
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes)
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')
}
