import type { DiagramDocument, DiagramScene } from '../core/model'
import { renderScene, renderDrawio } from '../core/render'
import { toMindTree } from '../core/adapters'
import { themes } from '../../utils/theme'
function filename(title:string){return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,100)||'图形'}
export function download(name:string,content:string,mime:string){const url=URL.createObjectURL(new Blob([content],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
export async function exportDocument(d:DiagramDocument,scene:DiagramScene,format:'svg'|'png'|'json'|'drawio'|'fmd'){
  const name=filename(d.title)
  if(format==='json'){download(name+'.json',JSON.stringify(d,null,2),'application/json');return}
  if(format==='drawio'){download(name+'.drawio',renderDrawio(scene,d),'application/xml');return}
  if(format==='fmd'){download(name+'.fmd',JSON.stringify({version:'1.0',type:'flymind',metadata:{name:d.title,exportedAt:Date.now()},data:{id:d.id,name:d.title,root:toMindTree(d),theme:themes[0],layout:'logic',canvas:{width:scene.width,height:scene.height}}},null,2),'application/json');return}
  const svg=renderScene(scene,d)
  if(format==='svg'){download(name+'.svg',svg,'image/svg+xml');return}
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}))
  try{await new Promise<void>((resolve,reject)=>{const img=new Image();img.onload=()=>{const ratio=Math.min(2,8192/Math.max(scene.width,scene.height),Math.sqrt(32_000_000/(scene.width*scene.height))),canvas=document.createElement('canvas');canvas.width=Math.ceil(scene.width*ratio);canvas.height=Math.ceil(scene.height*ratio);const ctx=canvas.getContext('2d');if(!ctx){reject(new Error('当前浏览器不支持图像导出'));return}ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>{if(!blob){reject(new Error('PNG 导出失败'));return}const png=URL.createObjectURL(blob),a=document.createElement('a');a.href=png;a.download=name+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(png),1500);resolve()},'image/png')};img.onerror=()=>reject(new Error('图形转为 PNG 失败，请尝试 SVG'));img.src=url})}finally{URL.revokeObjectURL(url)}
}
