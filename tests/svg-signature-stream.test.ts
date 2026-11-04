import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {svgDrawingSignature} from '../server/rendering/svg-fonts'
import {originalSvgSignature} from './helpers/svg-signature-reference'

const result=(fn:()=>unknown)=>{try{return {value:fn()}}catch(e){return {name:(e as Error).name,message:(e as Error).message,code:(e as any).code}}}
const compare=(svg:string)=>assert.deepEqual(result(()=>svgDrawingSignature(svg)),result(()=>originalSvgSignature(svg)))

test('repository examples match the original signature',()=>{
 for(const name of ['flowchart','swimlane','mindmap','dataflow','architecture'])compare(readFileSync(new URL(`../examples/${name}.svg`,import.meta.url),'utf8'))
})
test('nested omissions, namespaces, text, CDATA, comments and styles match',()=>{
 for(const body of [
  '<defs/><defs><style> </style><g data-runtime-font="canonical"><text>ignored</text></g></defs>',
  '<defs><defs/><style>@font-face{font-family:Arial;src:url(x)}</style><g>keep</g></defs>',
  '<g z="x" a="&quot;&amp;" font-family="Arial"><![CDATA[a中文😀]]><!-- note --><?pi value?><text>x&amp;y</text></g>',
  '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Helvetica;fill:red">中文</div></foreignObject>',
  '<style>.a{font-family:Arial;fill:red}</style><g data-runtime-font="canonical" font-family="Unknown"/>',
 ])compare(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`)
 compare('<svg data-runtime-font="canonical"/>')
})
test('error order and deep fallback match',()=>{
 for(const body of [
  '<g font-family="BadFirst"/><style>.a{font-family:BadSecond}</style>',
  '<style>@font-face{src:url(x)}</style><g font-family="BadLater"/>',
  '<defs><g data-runtime-font="canonical" font-family="Bad"/></defs><g font-family="Bad"/>',
  '<g>'.repeat(140)+'<text>deep</text>'+'</g>'.repeat(140)
 ])compare(`<svg>${body}</svg>`)
 for(const svg of ['<!DOCTYPE svg><svg/>','<svg><g></svg>','<html/>'])compare(svg)
})
test('deterministic generated trees match old signatures',()=>{
 let seed=71823;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0
 const leaves=['<defs/>','<style> </style>','<g data-runtime-font="canonical"><text>x</text></g>','<text>中文字😀 &amp; a</text>','<!-- comment -->','<rect x="2" fill="red"/>','<g font-family="Arial"/>','<style>.c{font-family:Helvetica;fill:red}</style>']
 function valid(depth:number):string{if(!depth||next()%3===0)return leaves[next()%leaves.length];let children='';for(let n=next()%5;n>0;n--)children+=valid(depth-1);const tag=next()%2?'g':'defs';return `<${tag}>${children}</${tag}>`}
 for(let i=0;i<300;i++)compare(`<svg xmlns="http://www.w3.org/2000/svg">${valid(4)}</svg>`)
})
test('altered array traversal methods fall back to the original signature',()=>{
 const original=Array.prototype.filter
 try{Array.prototype.filter=function(callback:any,thisArg?:any){return original.call(this,callback,thisArg)} as typeof Array.prototype.filter;compare('<svg><defs/><text>流程</text></svg>')}
 finally{Array.prototype.filter=original}
})
