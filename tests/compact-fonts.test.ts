import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sampleFor} from '../src/drawing/core/samples'
import {extractContent} from '../src/drawing/core/layers'
import {compileDrawio} from '../src/drawing/engine/drawio'
import {parseNative,serialize,attr,type NativeDocument} from '../src/drawing/engine/drawio/xml'
import {compactFontSubset} from '../server/rendering/compact-fonts'
import {selectedBrowserFontCSS,BROWSER_FONT_MANIFEST} from '../src/drawing/engine/browser-fonts'

async function fixture(){return (await compileDrawio({schemaVersion:1,id:'font-test',title:'字体测试',kind:'flowchart',nodes:[{id:'a',kind:'task',label:'汉字'},{id:'b',kind:'end',label:'完成'}],edges:[{id:'ab',source:'a',target:'b',label:'通过'}],lanes:[],phases:[],groups:[]})).xml}
function change(xml:string,edit:(native:NativeDocument)=>void){const n=parseNative(xml);edit(n);return serialize(n.document)}
function vertex(n:NativeDocument){return [...n.cells.values()].find(e=>attr(e.cell,'vertex')==='1'&&!!attr(e.object,'label'))!}
const choose=(xml:string)=>compactFontSubset(xml,parseNative(xml))

test('all six fixed product samples use bounded pinned fonts; default CSS remains independent',async()=>{
 for(const kind of ['swimlane','flowchart','architecture','mindmap','dataflow','technical'] as const){
  const xml=(await compileDrawio(extractContent(sampleFor(kind)))).xml,files=choose(xml)
  assert.ok(files,kind);assert.ok(files.includes(BROWSER_FONT_MANIFEST.files[0].file));assert.ok(files.reduce((sum,name)=>sum+BROWSER_FONT_MANIFEST.files.find(f=>f.file===name)!.bytes,0)<=2*1024*1024)
  const css=selectedBrowserFontCSS(['Noto Sans CJK SC','Helvetica'],files);assert.equal((css.match(/@font-face/g)||[]).length,files.length*2);assert.ok(!css.includes('opentype'));assert.ok(!css.includes('NotoSansCJKsc-Regular.otf'))
 }
 assert.throws(()=>selectedBrowserFontCSS(['Noto Sans CJK SC'],['bad.woff2']))
})

test('numeric XML and static HTML entities contribute decoded characters',async()=>{
 const original=await fixture(),literal=change(original,n=>{vertex(n).object.setAttribute('label','汉字')}),numeric=literal.replace('汉字','&#27721;&#x5B57;')
 assert.deepEqual(choose(numeric),choose(literal))
 const html=change(original,n=>{const e=vertex(n);e.object.setAttribute('label','<div style="width:32px;line-height:32.8px;white-space:normal;">&#27721;&#x5B57;</div>');e.cell.setAttribute('style',(attr(e.cell,'style')??'').replace('html=0','html=1'))})
 assert.deepEqual(choose(html),choose(change(original,n=>{const e=vertex(n);e.object.setAttribute('label','<div style="width:32px;line-height:32.8px;white-space:normal;">汉字</div>');e.cell.setAttribute('style',(attr(e.cell,'style')??'').replace('html=0','html=1'))})))
 const plain=change(original,n=>vertex(n).object.setAttribute('label','95% C:\\temp'))
 assert.ok(choose(plain));assert.deepEqual(choose(plain.replace('95%','95&#37;')),choose(plain))
 assert.ok(choose(change(original,n=>vertex(n).object.setAttribute('label','“完成”——继续… 95%'))))
 const encodedPlaceholder=change(original,n=>vertex(n).object.setAttribute('label','%name%')).replaceAll('%','&#37;')
 assert.equal(choose(encodedPlaceholder),undefined)
})

test('unsupported dynamic text, shapes, resources and shaping conservatively retain OTF',async()=>{
 const xml=await fixture();assert.ok(choose(xml))
 const edits:Array<(n:NativeDocument)=>void>=[
  n=>n.model.setAttribute('math','1'),
  n=>vertex(n).object.setAttribute('label','变量%name%'),
  n=>vertex(n).object.setAttribute('label','a\u0301'),
  n=>vertex(n).object.setAttribute('label','甲\u200d乙'),
  n=>vertex(n).object.setAttribute('label','😀'),
  n=>vertex(n).object.setAttribute('placeholder','1'),
  n=>vertex(n).cell.setAttribute('style','shape=mxgraph.aws4.group;html=0;'),
  n=>vertex(n).cell.setAttribute('style','inheritedStyle;html=0;'),
  n=>vertex(n).cell.setAttribute('style','text;html=0;fontFamily=Noto Sans CJK SC;unknown=1;'),
  n=>vertex(n).cell.setAttribute('style','text;html=0;html=1;'),
  n=>vertex(n).cell.setAttribute('style','shape=image;image=data:image/svg+xml,%3Csvg%3E%3Ctext%3Ebad%3C/text%3E%3C/svg%3E;'),
  n=>{const e=vertex(n);e.object.setAttribute('label','<div style="content:evil">字</div>');e.cell.setAttribute('style','text;html=1;')},
  n=>{const e=vertex(n);e.object.setAttribute('label','<span lang="zh">字</span>');e.cell.setAttribute('style','text;html=1;')},
  n=>{const e=vertex(n);e.object.setAttribute('label','<img src="data:image/png;base64,AA=="/>');e.cell.setAttribute('style','text;html=1;')},
  n=>{const e=vertex(n);e.object.setAttribute('label','<div>&#37;name&#37;</div>');e.cell.setAttribute('style','text;html=1;')},
  n=>{const e=vertex(n);e.object.setAttribute('label','<div>&unknown;</div>');e.cell.setAttribute('style','text;html=1;')},
 ]
 for(const edit of edits)assert.equal(choose(change(xml,edit)),undefined)
 const encoded=change(xml,n=>{const e=vertex(n);e.object.setAttribute('label','<img/>');e.cell.setAttribute('style','text;html=1;')}).replace('html=1','html&#x3d;1')
 assert.equal(choose(encoded),undefined)
})
