import { z } from 'zod'

// Discovery schemas are contracts, not layout instructions. Cross-reference and
// graph invariants remain in the platform-independent core validator.
export const diagramKind=z.enum(['swimlane','flowchart','architecture','mindmap','dataflow'])
export const diagramId=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).describe('工作区图形 ID；创建时唯一，修改时沿用读取的 ID')
export const revision=z.number().int().positive().describe('刚读取的 revision；冲突后重新读取，不能盲目重试')
const ref=z.string().min(1),color=z.string().regex(/^#[0-9a-f]{6}$/i)
const nodeKind=z.enum(['task','decision','start','end','module','topic','card','note'])
const node=z.strictObject({
  id:ref,label:z.string().trim().min(1).max(500),kind:nodeKind,
  laneId:z.string().optional().describe('泳道图角色归属'),phaseId:z.string().optional().describe('泳道图阶段归属'),
  groupId:z.string().optional().describe('架构图分层归属'),parentId:z.string().optional().describe('思维导图父主题；根主题不填'),
  color:color.optional().describe('可选语义颜色；自动美化无需填写'),description:z.string().max(4000).optional(),
  items:z.array(z.string().max(200)).max(30).optional(),badge:z.string().max(30).optional()
})
const edge=z.strictObject({id:ref,source:ref,target:ref,label:z.string().max(200).optional(),kind:z.enum(['flow','feedback']).optional()})
const container=z.strictObject({id:ref,label:z.string().trim().min(1).max(160)})
const group=container.extend({kind:z.enum(['layer','governance']).optional(),color:color.optional()})
export const contentSchema=z.strictObject({
  schemaVersion:z.literal(1).optional(),id:diagramId.optional(),title:z.string().trim().min(1).max(160),kind:diagramKind,
  nodes:z.array(node).min(1).max(500),edges:z.array(edge).max(2000).optional(),
  lanes:z.array(container).max(30).optional(),phases:z.array(container).max(30).optional(),groups:z.array(group).max(30).optional()
}).describe('纯业务内容；禁止 order、坐标、尺寸、字体、图标、线型和 presentation。渲染器自动布局美化')

const collection=z.enum(['lanes','phases','groups']),index=z.number().int().min(0)
export const operationSchema=z.discriminatedUnion('op',[
  z.strictObject({op:z.literal('set_title'),title:z.string().trim().min(1).max(160)}),
  z.strictObject({op:z.literal('add_node'),node}),
  z.strictObject({op:z.literal('update_node'),id:ref,changes:node.omit({id:true}).partial()}),
  z.strictObject({op:z.literal('remove_node'),id:ref}),
  z.strictObject({op:z.literal('add_edge'),edge}),
  z.strictObject({op:z.literal('update_edge'),id:ref,changes:edge.omit({id:true}).partial()}),
  z.strictObject({op:z.literal('remove_edge'),id:ref}),
  z.strictObject({op:z.literal('add_container'),collection,item:group,index:index.optional()}),
  z.strictObject({op:z.literal('update_container'),collection,id:ref,changes:group.omit({id:true}).partial()}),
  z.strictObject({op:z.literal('remove_container'),collection,id:ref,moveTo:ref.optional().describe('非空容器删除时的节点迁移目标')}),
  z.strictObject({op:z.literal('reorder_container'),collection,id:ref,index})
])
const coordinate=z.number().min(-50000).max(50000),point=z.strictObject({x:coordinate,y:coordinate})
const shape=z.enum(['rectangle','rounded','ellipse','diamond']),fontSize=z.number().min(10).max(48)
const nodeStyle=z.strictObject({fill:color.optional(),stroke:color.optional(),textColor:color.optional(),fontSize:fontSize.optional(),shape:shape.optional()})
const preset=nodeStyle.extend({width:z.number().min(32).max(2000).optional(),height:z.number().min(32).max(2000).optional()})
const edgeDefault=z.strictObject({route:z.enum(['orthogonal','straight','curved']).optional(),color:color.optional(),width:z.number().min(1).max(8).optional(),arrow:z.enum(['end','both','none']).optional(),dashed:z.boolean().optional()})
const port=z.enum(['top','right','bottom','left'])
const edgeStyle=edgeDefault.extend({sourcePort:port.optional(),targetPort:port.optional(),points:z.array(point).max(40).optional(),labelPosition:point.optional()})
export const renderingSchema=z.strictObject({
  objects:z.strictObject({
    groups:z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),z.array(ref).min(2).max(500)).optional().describe('画布组合 ID → 节点 ID；不嵌套，节点最多属于一个组合'),
    locked:z.array(ref).max(500).optional().describe('锁定节点 ID；编辑前显式解锁'),
    order:z.array(ref).max(500).optional().describe('节点从底到顶的顺序，不改变业务节点数组')
  }).optional().describe('画布组合、锁定与堆叠顺序，独立于业务分层'),
  theme:z.enum(['blue','indigo','forest']).optional(),orientation:z.enum(['vertical','horizontal']).optional(),
  nodeDefaults:z.partialRecord(nodeKind,preset).optional(),edgeDefaults:edgeDefault.optional(),
  positions:z.record(z.string(),z.strictObject({x:coordinate.optional(),y:coordinate.optional(),width:z.number().min(32).max(50000).optional(),height:z.number().min(32).max(50000).optional()})).optional(),
  ranks:z.record(z.string(),z.number().int().min(0).max(200)).optional(),
  groups:z.record(z.string(),z.strictObject({tone:z.enum(['blue','green','amber']).optional(),columns:z.number().int().min(1).max(10).optional()})).optional(),
  cards:z.record(z.string(),z.strictObject({icon:z.enum(['database','network','check','none']).optional(),tone:z.enum(['blue','teal']).optional(),variant:z.enum(['card','band']).optional()})).optional(),
  styles:z.record(z.string(),nodeStyle).optional(),edges:z.record(z.string(),edgeStyle).optional()
}).describe('独立完整渲染配置；仅用户明确要求视觉调整时读取并修改，保留其他覆盖')

const metadata={diagramId,title:z.string(),kind:diagramKind,revision,createdAt:z.number().positive().optional(),updatedAt:z.number().positive(),workspaceGroupId:z.string().nullable(),editorUrl:z.string()}
export const workspaceGroupSchema=z.object({id:diagramId,name:z.string(),revision,createdAt:z.number().positive(),updatedAt:z.number().positive()})
export const groupOutput=z.object({group:workspaceGroupSchema})
export const groupsOutput=z.object({groups:z.array(workspaceGroupSchema)})
export const successOutput=z.object({success:z.literal(true)})
export const diagramOutput=z.object({...metadata,content:contentSchema.optional(),documentPath:z.string().optional(),
  files:z.record(z.string(),z.string()).optional(),urls:z.record(z.string(),z.string()).optional(),
  resources:z.record(z.string(),z.string()).optional(),width:z.number().optional(),height:z.number().optional()})
export const guideOutput=z.object({guide:z.string(),sample:contentSchema.optional()})
export const listOutput=z.object({diagrams:z.array(z.object(metadata))})
export const renderingOutput=z.object({...metadata,rendering:renderingSchema,standards:z.object({nodes:z.record(z.string(),preset),effectiveNodes:z.record(z.string(),preset),edges:edgeDefault})})
export const validationOutput=z.object({valid:z.literal(true),width:z.number(),height:z.number(),nodes:z.number().int(),edges:z.number().int()})

// Hints help clients choose approval policies; they do not enforce permissions.
export const readAnnotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
export const createAnnotations={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
export const editAnnotations={readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}
