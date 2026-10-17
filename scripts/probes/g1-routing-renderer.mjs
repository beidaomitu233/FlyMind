// Three fixed-native render samples only. No user DB or Web Runtime.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {NativeDrawioRenderer} from '../../server/rendering/renderer.ts';
import {compileDrawio,patchDrawio,projectDrawio,drawioRenderSignature} from '../../src/drawing/engine/drawio/index.ts';
import {createDrawingProject} from '../../src/drawing/engine/project.ts';
import {parseNative,attr} from '../../src/drawing/engine/drawio/xml.ts';
import {mainEntry,mainEntries,businessType,cellSignature} from '../../src/drawing/engine/drawio/state.ts';
import {absoluteRouteBox} from '../../src/drawing/engine/drawio/routing.ts';
import {DrawioHostController} from '../../src/drawing/engine/drawio-host/controller.ts';
const out=resolve('output/playwright/native-g1-routing');await mkdir(out,{recursive:true});
const renderer=new NativeDrawioRenderer(),report={samples:[],ok:false};
const capture=DrawioHostController.prototype.captureXML;let activeName;
DrawioHostController.prototype.captureXML=async function(){const xml=await capture.call(this);await writeFile(resolve(out,activeName+'.captured.drawio'),xml);return xml};
const project=async(c,e)=>createDrawingProject(c,e,{createdAt:1,updatedAt:1});
function svgPaths(svg){const d=new DOMParser().parseFromString(svg,'image/svg+xml');return [...Array(d.getElementsByTagName('g').length)].map((_,i)=>d.getElementsByTagName('g').item(i)).filter(e=>e.hasAttribute('data-cell-id')).map(e=>({id:e.getAttribute('data-cell-id'),paths:[...Array(e.getElementsByTagName('path').length)].map((_,i)=>e.getElementsByTagName('path').item(i)).filter(p=>p.getAttribute('fill')==='none').map(p=>p.getAttribute('d'))})).filter(e=>e.paths.length)}
async function render(name,p){activeName=name;await writeFile(resolve(out,name+'.input.drawio'),p.rendering.engine.xml);const r=await renderer.render(p);assert.equal((await projectDrawio(r.nativeXML)).contentHash,p.rendering.engine.contentHash);assert.equal(drawioRenderSignature(r.nativeXML),drawioRenderSignature(p.rendering.engine.xml));await Promise.all([writeFile(resolve(out,name+'.png'),r.png),writeFile(resolve(out,name+'.svg'),r.svg),writeFile(resolve(out,name+'.drawio'),r.nativeXML)]);const paths=svgPaths(r.svg);report.samples.push({name,width:r.width,height:r.height,timings:r.timings,paths});return {r,paths}}
try{
 const content=JSON.parse(await readFile('tests/fixtures/drawio-baseline/pbs-main.content.json','utf8')),fresh=await compileDrawio(content);await render('fresh-pbs',await project(content,fresh));
 const raw=JSON.parse(await readFile('output/playwright/native-g1/ui-round1.project.json','utf8')),base=raw.document??raw,old=parseNative(base.rendering.engine.xml),engine=await patchDrawio(base,[{op:'add_node',node:{id:'g1-test-step',label:'测试演练',kind:'task',laneId:'r01',phaseId:'p01'}},{op:'update_edge',id:'e02',changes:{target:'g1-test-step'}},{op:'add_edge',edge:{id:'g1-test-next',source:'g1-test-step',target:'n03'}}]),n=parseNative(engine.xml);
 const preserved=[];for(const [id,e] of old.cells)if(id!==mainEntry(old,'edge','e02').id){assert.ok(n.cells.has(id));assert.equal(cellSignature(n.cells.get(id)),cellSignature(e),id+' unrelated native cell changed');preserved.push(id)}report.preservedCells=preserved;
 const p=await project((await projectDrawio(engine.xml)).content,engine);await render('patched-e02',p);
 const loopContent={schemaVersion:1,id:'native-loop',title:'原生自环与邻接障碍',kind:'swimlane',nodes:[{id:'a',label:'复核任务',kind:'task',laneId:'r',phaseId:'p'},{id:'b',label:'其他业务障碍',kind:'task',laneId:'r',phaseId:'p'}],edges:[{id:'loop',source:'a',target:'a',label:'需要复核'},{id:'next',source:'a',target:'b'}],lanes:[{id:'r',label:'责任人'}],phases:[{id:'p',label:'阶段'}],groups:[]},loopEngine=await compileDrawio(loopContent),loop=await render('native-loop',await project(loopContent,loopEngine)),loopNative=parseNative(loopEngine.xml),loopId=mainEntry(loopNative,'edge','loop').id;
 const path=loop.paths.find(e=>e.id===loopId)?.paths[0];assert.ok(path,'native loop SVG path missing');assert.ok(!/[CQAST]/i.test(path),'native loop must use straight orthogonal segments');const nums=path.match(/-?\d+(?:\.\d+)?/g).map(Number),points=[];for(let i=0;i<nums.length;i+=2)points.push({x:nums[i],y:nums[i+1]});for(let i=1;i<points.length;i++)assert.ok(points[i-1].x===points[i].x||points[i-1].y===points[i].y,'native loop rendered diagonal');
 // Native SVG export applies one global translation. Recover it from the real
 // business rect rather than assuming model and export origins are identical.
 const doc=new DOMParser().parseFromString(loop.r.svg,'image/svg+xml'),groups=doc.getElementsByTagName('g'),source=mainEntry(loopNative,'node','a'),sourceBox=absoluteRouteBox(loopNative,source);let rect;for(let i=0;i<groups.length;i++)if(groups.item(i).getAttribute('data-cell-id')===source.id)rect=groups.item(i).getElementsByTagName('rect').item(0);assert.ok(rect);const dx=Number(rect.getAttribute('x'))-sourceBox.x,dy=Number(rect.getAttribute('y'))-sourceBox.y;
 const obstacles=mainEntries(loopNative).filter(e=>businessType(e)==='node'&&e.id!==source.id).map(e=>absoluteRouteBox(loopNative,e));for(const o of obstacles)for(let i=1;i<points.length;i++){const a={x:points[i-1].x-dx,y:points[i-1].y-dy},b={x:points[i].x-dx,y:points[i].y-dy},cross=a.x===b.x?a.x>o.x&&a.x<o.x+o.w&&Math.max(a.y,b.y)>o.y&&Math.min(a.y,b.y)<o.y+o.h:a.y>o.y&&a.y<o.y+o.h&&Math.max(a.x,b.x)>o.x&&Math.min(a.x,b.x)<o.x+o.w;assert.equal(cross,false,'native loop intersects other node')}
 report.nativeLoop={path,points,orthogonal:true,otherNodesClear:true,style:attr(mainEntry(loopNative,'edge','loop').cell,'style')};report.ok=true;
}catch(error){report.error=error.stack;process.exitCode=1}finally{await renderer.close();await writeFile(resolve(out,'render-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,samples:report.samples.map(({paths,...s})=>s)},null,2))}
