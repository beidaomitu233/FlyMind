import {DRAWIO_ADAPTER_VERSION} from '../constants'
import {RUNTIME_FONT_FAMILY,runtimeFontCSS} from '../runtime-assets'

const prototypes=[
  {kind:'task',title:'业务步骤',shape:'rounded=1',width:200,height:64},
  {kind:'decision',title:'业务判断',shape:'rhombus',width:160,height:100},
  {kind:'start',title:'开始',shape:'ellipse',width:100,height:56},
  {kind:'end',title:'结束',shape:'ellipse',width:100,height:56},
  {kind:'module',title:'架构模块',shape:'rounded=0',width:300,height:124},
  {kind:'topic',title:'脑图主题',shape:'rounded=1',width:200,height:64},
  {kind:'card',title:'数据卡片',shape:'rounded=1',width:284,height:160},
  {kind:'note',title:'浮动说明',shape:'text',width:240,height:72}
] as const

/** Inline data works with the fixed editor's offline=1; no URL library fetch. */
export function businessLibraryConfiguration(fontFamilies?:readonly string[]){
  return {
    defaultFonts:[RUNTIME_FONT_FAMILY],fontCss:runtimeFontCSS(fontFamilies),
    defaultVertexStyle:{fontFamily:RUNTIME_FONT_FAMILY},
    defaultEdgeStyle:{edgeStyle:'orthogonalEdgeStyle',rounded:'0',jettySize:'auto',orthogonalLoop:'1',fontFamily:RUNTIME_FONT_FAMILY},
    libraries:[{title:{main:'FlyMind 业务'},entries:[{id:'fm-business',title:{main:'FlyMind 业务节点'},libs:[{title:{main:'业务节点（按图形类型设置归属）'},data:prototypes.map(p=>({
      title:p.title,w:p.width,h:p.height,
      xml:`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><UserObject id="prototype" label="${p.title}" fmType="node" fmKind="${p.kind}" fmRole="main" fmAdapter="${DRAWIO_ADAPTER_VERSION}"><mxCell vertex="1" parent="1" style="${p.kind==='note'?'text;strokeColor=none;fillColor=none;align=left;verticalAlign=top;':`${p.shape};fillColor=#eef0ff;strokeColor=#596fea;`}whiteSpace=wrap;html=0;fontFamily=${RUNTIME_FONT_FAMILY};fontSize=16;"><mxGeometry x="0" y="0" width="${p.width}" height="${p.height}" as="geometry"/></mxCell></UserObject></root></mxGraphModel>`
    }))}]}]}],
    defaultLibraries:'fm-business;general'
  }
}

export function drawioHostURL(origin:string){
  const url=new URL('/drawio/index.html',origin)
  for(const [key,value] of Object.entries({embed:'1',proto:'json',configure:'1',offline:'1',local:'1',lang:'zh',libs:'fm-business;general',ui:'min',sidebar:'0',format:'0',saveAndExit:'0',noSaveBtn:'0',noExitBtn:'1'}))url.searchParams.set(key,value)
  return url.href
}
