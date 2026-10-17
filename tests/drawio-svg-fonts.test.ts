import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {DOMParser} from '@xmldom/xmldom'
import {createHash} from 'node:crypto'
import {packageNativeSVGFonts,svgDrawingSignature} from '../server/rendering/svg-fonts'
import {RUNTIME_FONT_SHA256} from '../src/drawing/engine/runtime-assets'
const raw='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="160" viewBox="0 0 200 160"><defs><style type="text/css">@font-face{font-family:"Arial";src:url("/font.otf");font-weight:400;} .label {font-family: "Helvetica";fill:#123456;stroke-width:2}</style></defs><g transform="translate(2,3)" font-family="Microsoft YaHei" fill="#abcdef"><rect x="4" y="5" width="40" height="30" stroke="red"/><text x="20" y="40">Arial 是业务文字，不可替换</text><foreignObject x="5" y="6" width="100" height="90"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial; color:red;font-weight:bold;">中文边标签</div></foreignObject></g></svg>'
test('native SVG font packaging preserves text, geometry, paint and non-font CSS with a single exact font SHA',async()=>{
 const font=await readFile(new URL('../resources/fonts/NotoSansCJKsc-Regular.otf',import.meta.url)),result=packageNativeSVGFonts(raw,font);assert.equal(svgDrawingSignature(result),svgDrawingSignature(raw));assert.ok(result.includes('Arial 是业务文字，不可替换'));assert.ok(result.includes('中文边标签'));assert.ok(result.includes('fill:#123456;stroke-width:2'));assert.ok(result.includes('color:red;font-weight:bold;'));assert.ok(!result.includes('/font.otf'));assert.equal((result.match(/@font-face/g)||[]).length,1);assert.equal((result.match(/data:font\/otf;base64,/g)||[]).length,1);const url=/data:font\/otf;base64,([^"\)]+)/.exec(result)![1];assert.equal(createHash('sha256').update(Buffer.from(url,'base64')).digest('hex'),RUNTIME_FONT_SHA256)
 const doc=new DOMParser().parseFromString(result,'application/xml');assert.equal(doc.documentElement.getAttribute('viewBox'),'0 0 200 160');assert.equal(doc.getElementsByTagName('rect')[0].getAttribute('stroke'),'red')
})
test('drawing signature detects text, geometry, colors and ordinary stylesheet changes independently of aliases',()=>{
 assert.notEqual(svgDrawingSignature(raw),svgDrawingSignature(raw.replace('中文边标签','其他标签')));assert.notEqual(svgDrawingSignature(raw),svgDrawingSignature(raw.replace('x="4"','x="8"')));assert.notEqual(svgDrawingSignature(raw),svgDrawingSignature(raw.replace('stroke="red"','stroke="blue"')));assert.notEqual(svgDrawingSignature(raw),svgDrawingSignature(raw.replace('fill:#123456','fill:#654321')))
})
test('unknown font families in presentation, inline CSS, style block and font-face fail explicitly',()=>{
 for(const input of [raw.replace('font-family="Microsoft YaHei"','font-family="Unknown"'),raw.replace('font-family: Arial','font-family: Unknown'),raw.replace('font-family: "Helvetica"','font-family: "Unknown"'),raw.replace('font-family:"Arial"','font-family:"Unknown"')])assert.throws(()=>svgDrawingSignature(input),{code:'UNSUPPORTED_FONT'})
})
test('font packaging rejects bad font bytes and DTD/entities and preserves a document without original defs',async()=>{
 assert.throws(()=>packageNativeSVGFonts(raw,Buffer.from('bad')),{code:'FONT_HASH_MISMATCH'});assert.throws(()=>svgDrawingSignature('<!DOCTYPE svg><svg/>'),{code:'UNSAFE_SVG'});const font=await readFile(new URL('../resources/fonts/NotoSansCJKsc-Regular.otf',import.meta.url)),svg='<svg xmlns="http://www.w3.org/2000/svg"><text font-family="Arial" x="8" y="9">说明</text></svg>';assert.equal(svgDrawingSignature(svg),svgDrawingSignature(packageNativeSVGFonts(svg,font)))
})
