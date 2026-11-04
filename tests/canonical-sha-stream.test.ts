import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {canonicalContentJson} from '../src/drawing/engine/content-hash'
import {canonicalSHA256} from '../server/exports/canonical-sha'
import {exportSnapshotHash} from '../server/exports/artifacts'

const old=(value:unknown)=>createHash('sha256').update(canonicalContentJson(value as any)).digest('hex')
function failure(fn:()=>unknown){try{fn()}catch(error){return {name:(error as Error).name,message:(error as Error).message}}assert.fail('expected failure')}

test('streamed hash matches canonical JSON for values, sorting and unicode chunk boundaries',()=>{
 const boundary='x'.repeat(65535)+'😀'+'\ud800'+'中'+'\udfff'+'\n\t"\\\0'
 const nullProto=Object.assign(Object.create(null),{b:1,a:'中文'})
 const examples:unknown[]=[null,true,false,0,-0,1.1,1e22,'',boundary,[],[null,0,'\\',false],{z:undefined,b:[3,2,1],a:{'𠮷':boundary}},nullProto]
 for(const value of examples){assert.equal(canonicalSHA256(value),old(value));assert.equal(exportSnapshotHash(value),old(value))}
})
test('invalid input, cycles, sparse arrays and nonplain objects preserve failures',()=>{
 const cycle:any={};cycle.self=cycle
 const sparse=[];sparse[1]=1
 const symbol={};Object.defineProperty(symbol,Symbol('x'),{value:1})
 for(const value of [undefined,NaN,Infinity,1n,()=>{},cycle,sparse,symbol,new Date(),new Uint8Array([1])])assert.deepEqual(failure(()=>canonicalSHA256(value)),failure(()=>old(value)))
})
test('object getters retain canonical filter and traversal order',()=>{
 function sample(){const calls:string[]=[],value:any={};for(const k of ['z','a','b'])Object.defineProperty(value,k,{enumerable:true,get(){calls.push(k);return k==='b'?undefined:k}});return {value,calls}}
 const a=sample(),b=sample();assert.equal(canonicalSHA256(a.value),old(b.value));assert.deepEqual(a.calls,b.calls)
})
test('array mutations during getters produce the previous canonical hash',()=>{
 function sample(){const value:any[]=[1,2,3];Object.defineProperty(value,0,{enumerable:true,configurable:true,get(){delete value[1];return 1}});return value}
 assert.equal(canonicalSHA256(sample()),old(sample()))
})
test('custom array maps and proxy behavior use the original serializer',()=>{
 const array:any=[1,2];array.map=()=>['custom'];assert.equal(canonicalSHA256(array),old(array))
 const proxy=new Proxy({a:1},{get(target,key,receiver){return Reflect.get(target,key,receiver)}});assert.equal(canonicalSHA256(proxy),old(proxy))
})
test('custom array species and species errors preserve historical behavior',()=>{
 function altered(){const value:any=[1];Object.defineProperty(value,'constructor',{value:{[Symbol.species]:class extends Array{join(){return '"forged"'}}}});return value}
 function broken(){const value:any=[1];Object.defineProperty(value,'constructor',{value:{[Symbol.species]:class{constructor(){throw Error('species failed')}}}});return value}
 assert.equal(canonicalSHA256(altered()),old(altered()));assert.deepEqual(failure(()=>canonicalSHA256(broken())),failure(()=>old(broken())))
})
test('deep later values do not take precedence over earlier canonical errors',()=>{
 const root:any={a:NaN,z:{}};let cursor=root.z;for(let i=0;i<20000;i++)cursor=cursor.next={}
 assert.deepEqual(failure(()=>canonicalSHA256(root)),failure(()=>old(root)))
})
test('deterministic mixed JSON corpus matches the original digest',()=>{
 let seed=0xabc123;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0
 function make(depth:number):unknown{const choice=next()%6;if(depth===0||choice<3)return [null,next()%1000-500,'字😀\ud800\\\n'.repeat(next()%12)][choice%3]
  if(choice===3)return Array.from({length:next()%5},()=>make(depth-1))
  const result:Record<string,unknown>={};for(let i=next()%5;i>0;i--)result[`k${next()%10}`]=make(depth-1);return result
 }
 for(let i=0;i<1000;i++){const value=make(4);assert.equal(canonicalSHA256(value),old(value),`case ${i}`)}
})
