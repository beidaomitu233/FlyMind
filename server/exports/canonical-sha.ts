import {createHash} from 'node:crypto'
import {constants} from 'node:buffer'
import {types as utilTypes} from 'node:util'
import {canonicalContentJson} from '../../src/drawing/engine/content-hash'
const originalArrayMap=Array.prototype.map,originalArrayJoin=Array.prototype.join,originalArrayFilter=Array.prototype.filter,originalArraySort=Array.prototype.sort
const originalSpecies=Object.getOwnPropertyDescriptor(Array,Symbol.species)

// Saved snapshots are plain JSON. Exotic objects, proxies and accessors keep
// the original serializer, including its getter/map side effects and errors.
function plainSnapshot(input:unknown){
 const map=Object.getOwnPropertyDescriptor(Array.prototype,'map'),join=Object.getOwnPropertyDescriptor(Array.prototype,'join'),filter=Object.getOwnPropertyDescriptor(Array.prototype,'filter'),sort=Object.getOwnPropertyDescriptor(Array.prototype,'sort'),ctor=Object.getOwnPropertyDescriptor(Array.prototype,'constructor'),species=Object.getOwnPropertyDescriptor(Array,Symbol.species)
 if(map?.value!==originalArrayMap||join?.value!==originalArrayJoin||filter?.value!==originalArrayFilter||sort?.value!==originalArraySort||ctor?.value!==Array||species?.get!==originalSpecies?.get||species?.set!==originalSpecies?.set||species?.value!==originalSpecies?.value)return false
 const active=new Set<object>();let count=0,upperBound=0
 function plain(value:unknown,depth=0):boolean{
  if(++count>500_000||depth>128)return false
  upperBound+=typeof value==='string'?value.length*6+2:32
  if(upperBound>constants.MAX_STRING_LENGTH)return false
  if(value===null||['string','boolean','number','undefined'].includes(typeof value))return true
  if(typeof value!=='object'||utilTypes.isProxy(value))return false
  if(active.has(value))return false
  const array=Array.isArray(value),proto=Object.getPrototypeOf(value)
  if(array?proto!==Array.prototype||Object.hasOwn(value,'map')||Object.hasOwn(value,'constructor'):proto!==Object.prototype&&proto!==null)return false
  active.add(value)
  try{
   if(array){for(let i=0;i<value.length;i++){const descriptor=Object.getOwnPropertyDescriptor(value,String(i));if(!descriptor||!('value'in descriptor)||!plain(descriptor.value,depth+1))return false}}
   else{if(Object.getOwnPropertySymbols(value).length)return false
    for(const key of Object.keys(value)){upperBound+=key.length*6+4;if(upperBound>constants.MAX_STRING_LENGTH)return false;const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value'in descriptor)||!plain(descriptor.value,depth+1))return false}
   }
   return true
  }finally{active.delete(value)}
 }
 return plain(input)
}

/** SHA-256 of canonicalContentJson, without retaining the canonical document. */
export function canonicalSHA256(input:unknown){
 if(!plainSnapshot(input))return createHash('sha256').update(canonicalContentJson(input as any)).digest('hex')
 const hash=createHash('sha256'),active=new Set<object>();let units=0
 const emit=(text:string)=>{units+=text.length;if(units>constants.MAX_STRING_LENGTH)throw new RangeError('Invalid string length');hash.update(text)}
 const string=(value:string)=>{emit('"');for(let start=0;start<value.length;){let end=Math.min(start+64*1024,value.length)
   if(end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff&&value.charCodeAt(end)>=0xdc00&&value.charCodeAt(end)<=0xdfff)end++
   const part=JSON.stringify(value.slice(start,end));emit(part.slice(1,-1));start=end
  }emit('"')}
 function visit(value:unknown):void{
  if(value===null){emit('null');return}
  if(typeof value==='string'){string(value);return}
  if(typeof value==='boolean'){emit(JSON.stringify(value));return}
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Content hash requires finite JSON numbers');emit(JSON.stringify(value));return}
  if(typeof value!=='object')throw new Error('Content hash requires JSON data')
  if(active.has(value))throw new Error('Content hash does not accept cycles')
  const proto=Object.getPrototypeOf(value)
  if(!Array.isArray(value)&&proto!==Object.prototype&&proto!==null)throw new Error('Content hash requires plain JSON objects')
  active.add(value)
  try{
   if(Array.isArray(value)){
    for(let i=0;i<value.length;i++)if(!Object.hasOwn(value,i))throw new Error('Content hash does not accept sparse arrays')
    const length=value.length
    emit('[');for(let i=0;i<length;i++){if(i)emit(',');if(i in value)visit(value[i])}emit(']');return
   }
   if(Object.getOwnPropertySymbols(value).length)throw new Error('Content hash requires JSON object keys')
   const record=value as Record<string,unknown>,keys=Object.keys(record).filter(key=>record[key]!==undefined).sort()
   emit('{');for(let i=0;i<keys.length;i++){if(i)emit(',');string(keys[i]);emit(':');visit(record[keys[i]])}emit('}')
  }finally{active.delete(value)}
 }
 visit(input);return hash.digest('hex')
}
