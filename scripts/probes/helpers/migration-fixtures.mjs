// Deterministic v2 fixtures made through the old editor's persisted structures.
// No DB, user data, timestamps or random IDs.
import {readFile} from 'node:fs/promises';
import {defaultRendering} from '../../../src/drawing/core/render-config.ts';
import {validateDocument} from '../../../src/drawing/core/model.ts';
import {projectDocument} from '../../../src/drawing/core/layers.ts';
import {layoutDocument} from '../../../src/drawing/core/layout.ts';
import {pinScene,placeNodes} from '../../../src/drawing/core/editor.ts';
import {lockObjects,reorderObjects} from '../../../src/drawing/core/objects.ts';
import {resizeSwimlanePhase} from '../../../src/drawing/core/phase-editing.ts';
export async function migrationFixture(manual=false){
 const content=JSON.parse(await readFile(new URL('../../../tests/fixtures/drawio-baseline/pbs-main.content.json',import.meta.url),'utf8')),d=validateDocument({...content,presentation:defaultRendering('swimlane'),createdAt:1700000000000,updatedAt:1700000001000});
 if(manual){
  let scene=layoutDocument(d);pinScene(d,scene);const n=scene.nodes.find(n=>n.node.id==='n02');placeNodes(d,scene,{n02:{x:n.x-18,y:n.y+12,width:n.width+32,height:n.height+16}});
  d.presentation.styles={n02:{fill:'#fff8ec',stroke:'#8050aa',textColor:'#223344',fontSize:19,shape:'rectangle'}};
  d.presentation.texts={n21:{width:248,fontSize:18,color:'#8050aa'}};d.presentation.positions.n21={x:1740,y:200};
  scene=layoutDocument(d);const edge=scene.edges.find(e=>e.edge.id==='e02');d.presentation.edges={e02:{sourcePort:'right',targetPort:'left',points:edge.points.slice(1,-1),labelPosition:{x:edge.labelX+22,y:edge.labelY-10},labelColor:'#8050aa',labelFontSize:18,width:3,color:'#557185',arrow:'both',dashed:true}};
  scene=layoutDocument(d);const phase=scene.containers.find(c=>c.kind==='phase'&&c.id==='p02');resizeSwimlanePhase(d,scene,'p02',phase.height+80);
  // n01/n02 share r01/p01. This is a real persisted old object-group shape,
  // with a fixed fixture ID instead of old groupObjects' random ID generator.
  (d.presentation.objects??={}).groups={'manual-group':['n01','n02']};reorderObjects(d,['n16'],'front');lockObjects(d,layoutDocument(d),['n02'],true);
 }
 return projectDocument(d);
}
