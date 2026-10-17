import {businessContent} from '../../../tests/fixtures/native-business.ts'
/** Synthetic old projects, never user databases. Manual overrides are inputs,
 * not claims that this probe performed historical pointer gestures. */
export function genericMigrationFixture(kind,manual=false){
 const content=businessContent(kind,'legacy-'+kind),rendering={theme:kind==='architecture'||kind==='dataflow'?'blue':'indigo',orientation:'vertical',positions:{}}
 if(kind==='architecture'){
  content.nodes[0].badge='一期';content.nodes[0].items=['接收申请','校验附件','提交审核'];content.nodes[1].items=['核对资料','记录结果']
 }
 if(kind==='mindmap'&&!manual)content.nodes.push({id:'audit',kind:'topic',label:'审核资料',parentId:'root'},{id:'archive',kind:'topic',label:'归档材料',parentId:'root'})
 if(manual){
  if(kind==='flowchart'){
   rendering.positions={start:{x:80,y:120,width:240,height:80},task:{x:440,y:280,width:260,height:100},end:{x:800,y:520,width:240,height:80}}
   rendering.edges={a:{sourcePort:'bottom',targetPort:'left',points:[{x:200,y:240},{x:360,y:240},{x:360,y:330}],labelPosition:{x:300,y:240},labelColor:'#663399',labelFontSize:18,width:3,dashed:true,arrow:'both'}};content.edges[0].label='核对请求'
   rendering.styles={task:{fill:'#eeffee',stroke:'#337755',textColor:'#224433',fontSize:19,shape:'rectangle'}}
  }else if(kind==='architecture'){
   content.nodes.splice(1,0,{id:'peer',kind:'module',label:'附件入口',groupId:'app',items:['接收附件']})
   content.groups.push({id:'governance',kind:'governance',label:'统一治理'});content.nodes.push({id:'governance-node',kind:'module',label:'安全管理',groupId:'governance',items:['访问控制','审计记录']})
   rendering.positions={entry:{x:180,y:190,width:320,height:150},peer:{x:530,y:190,width:280,height:130},task:{x:180,y:430,width:340,height:150}}
   rendering.objects={groups:{pair:['entry','peer']},locked:['task'],order:['entry','peer','task']};rendering.groups={app:{tone:'green',columns:2}}
  }else if(kind==='mindmap'){
   rendering.positions={root:{x:480,y:280,width:240,height:64},task:{x:80,y:140,width:220,height:70},deliver:{x:900,y:420,width:260,height:80}}
   content.edges.push({id:'relation',source:'task',target:'deliver',kind:'feedback',label:'协同'})
   rendering.edges={relation:{labelPosition:{x:600,y:215}}}
  }else {
   rendering.cards={source:{icon:'database',tone:'teal'},task:{icon:'network'},sink:{icon:'check'}}
   rendering.positions={source:{x:60,y:60,width:340,height:260},task:{x:480,y:420,width:400,height:290},sink:{x:960,y:820,width:360,height:260}}
  }
  content.nodes.push({id:'note',kind:'note',label:'演练说明',description:'保留原稿'})
  rendering.positions.note={x:60,y:1200,width:320,height:90};rendering.texts={note:{width:320,fontSize:18,color:'#556677'}}
 }
 return {schemaVersion:2,content,rendering,createdAt:1700000000000,updatedAt:1700000060000}
}
