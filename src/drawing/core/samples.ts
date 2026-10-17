import { copy, newId, type DiagramDocument, type DiagramKind, type DiagramNode, type DiagramEdge } from './model'
function base(id:string,title:string,kind:DiagramKind):DiagramDocument {return {schemaVersion:1,id,title,kind,nodes:[],edges:[],lanes:[],phases:[],groups:[],presentation:{theme:kind==='architecture'||kind==='dataflow'?'blue':'indigo',orientation:'vertical',positions:{}},updatedAt:Date.now()}}
const swim=base('sample-swimlane','工业客户项目对接流程','swimlane')
swim.lanes=[{id:'customer',label:'客户'},{id:'bd',label:'BD'},{id:'pm',label:'产品经理（兼售前）'},{id:'project',label:'项目经理'}]
swim.phases=[{id:'intake',label:'需求导入'},{id:'consult',label:'业务咨询'},{id:'analysis',label:'需求分析'},{id:'clarify',label:'需求澄清'},{id:'delivery',label:'项目交付'}]
swim.nodes=[
  ['request','提出需求','task','customer','intake',0],['screen','需求初筛','task','bd','intake',0],['context','了解客户背景\n与原始需求','task','pm','intake',0],
  ['goal','客户目标\n是否明确','decision','pm','consult',0],['consulting','售前咨询','task','pm','consult',1],['match','是否匹配\n涂码业务','decision','pm','consult',2],['feedback','反馈沟通信息','task','bd','consult',2],['stop','沟通终止合作','end','customer','consult',2],
  ['customer-needs','需求沟通','task','customer','analysis',0],['pm-needs','需求沟通','task','pm','analysis',0],['solution','软硬件方案输出','task','pm','analysis',1],
  ['proposal','方案沟通','task','pm','clarify',0],['agree','客户是否\n确认需求','decision','customer','clarify',0],['revise','方案修改','task','pm','clarify',1],
  ['confirm','确认项目范围','task','customer','delivery',0],['handoff','项目交接','task','pm','delivery',0],['plan','启动与交付计划','task','project','delivery',0],['done','项目落地','end','project','delivery',1]
].map(([id,label,kind,laneId,phaseId,order])=>{(swim.presentation.ranks??={})[String(id)]=Number(order);return {id,label,kind,laneId,phaseId} as DiagramNode})
swim.edges=[['request','screen'],['screen','context'],['context','goal'],['goal','consulting','N'],['goal','match','Y'],['consulting','match'],['match','feedback','N'],['feedback','stop'],['match','pm-needs','Y'],['customer-needs','pm-needs'],['pm-needs','customer-needs'],['pm-needs','solution'],['solution','proposal'],['proposal','agree'],['agree','revise','N'],['revise','proposal'],['agree','confirm','Y'],['confirm','handoff'],['handoff','plan'],['plan','done']].map(([source,target,label],i)=>({id:`e${i}`,source,target,label}))
swim.edges.find(e=>e.id==='e9')!.kind='feedback'
swim.edges.find(e=>e.id==='e15')!.kind='feedback'
const architecture=base('sample-architecture','生殖专科 AI 辅助诊疗｜总体架构','architecture')
architecture.groups=[{id:'app',label:'01\n应用层'},{id:'business',label:'02\n业务层'},{id:'system',label:'03\n系统层'},{id:'ai',label:'04\nAI 层'},{id:'data',label:'05\n数据层'},{id:'governance',label:'持续改进与全程治理',kind:'governance'}]
architecture.presentation.groups={app:{tone:'blue'},business:{tone:'green',columns:5},system:{tone:'blue'},ai:{tone:'green',columns:3},data:{tone:'blue'}}
const mod=(id:string,label:string,groupId:string,items:string[],badge?:string):DiagramNode=>({id,label,kind:'module',groupId,items,badge})
architecture.nodes=[
  mod('doctor','生殖医生 / 医师工作台','app',['患者概览页','诊疗决策页','报告页','工作台 / 检查 / 随访 / 患者周期']),
  mod('ultrasound','超声医生 / 超声工作站','app',['检查任务页','智能报告页']),
  mod('lab','实验室 / 胚胎 / 遗传人员','app',['检验终端','PGT 页'],'2期'),
  mod('patient','患者 / 患者触达端','app',['随访问答页','报告查询页'],'2期'),
  mod('platform','平台运营 / 管理看板','app',['运营监控页','科研分析页'],'2期'),
  mod('primary','基层医生 / 基层协作端','app',['AI 筛查页','会诊转诊页'],'3期'),
  mod('b1','01 智能超声影像分析','business',['超声任务与阅片页','测量数据 / 报告页','卵泡自动识别与计数','子宫内膜自动测量','卵巢体积估算','报告整合与回写'],'1期'),
  mod('b3','03 辅助诊断决策','business',['患者生育力总览页','病因分析 / 建议页','卵巢储备综合评估','不孕原因分类','生育力综合评分','证据链与差异提示'],'2期'),
  mod('b5','05 胚胎评估与优选','business',['胚胎时间序列页','评级优选 / 报告页','发育动力学分析','胚胎形态自动评级','着床潜能预测','关键事件标注'],'2期'),
  mod('b7','07 智能随访与全周期管理','business',['随访任务工作台','患者问诊 / 满意度页','智能随访问答','多渠道消息触达','随访异常预警','节点周期任务'],'2期'),
  mod('b9','09 PGT 遗传咨询辅助','business',['家系与遗传风险页','咨询记录 / 报告页','遗传风险解读','PGT 指征提示','遗传咨询辅助','知识图谱检索'],'2期'),
  mod('b2','02 精液质量 AI 分析','business',['精液标本分析页','指标复核 / 报告页','精子计数与密度','精子形态学分析','WHO 第六版报告','异常数据采集'],'1期'),
  mod('b4','04 个体化促排方案','business',['促排方案推荐页','剂量 / 机制调整页','促排方案推荐','Gn 启动剂量预测','扳机时机建议','用药依从监控'],'2期'),
  mod('b6','06 预后预测与风险预警','business',['预后风险总览页','风险处置 / 趋势页','临床妊娠预测','OHSS 风险预警','多胎妊娠风险','预警处置留痕'],'2期'),
  mod('b8','08 数据看板与质量控制','business',['运营监控驾驶舱','科研检索 / 导出页','运营数据看板','科研数据检索','科室绩效分析','数据质量监控'],'2期'),
  mod('b10','10 生殖健康区域协同','business',['基层筛查 / 转诊页','中心会诊 / 质控页','基层 AI 辅助筛查','远程会诊支持','区域质控协同','转诊状态跟踪'],'3期'),
  mod('s1','统一入口与协作','system',['角色 / 机构门户','患者周期主题索引','跨系统待办','操作留痕']),
  mod('s2','临床审核与报告','system',['AI 结果复核','报告模板与版本','签名与归档','HIS / LIS / EMR 回写']),
  mod('s3','可复用组件库','system',['影像 / 视频阅片器','时序 / 趋势图表','评级与风险展示','问卷 / 表单组件']),
  mod('s4','接口与异步任务','system',['多系统接口适配','主数据关联','任务与状态管理','失败重试与补偿']),
  mod('s5','配置与运行治理','system',['规则 / 阈值配置','权限与授权','运行监控告警','应用发布与回滚']),
  mod('a1','01 模型算法协同','ai',['影像检测 / 分割 / 测量','视频跟踪 / 胚胎时序','决策建议 / 结果预测','风险预测 / 临床规则']),
  mod('a2','02 AI 知识库','ai',['指南 / SOP / 知识图谱','解析 / 混合检索 / 重排','专家审核 / 检索权限','证据引用 / 版本有效期']),
  mod('a3','03 Agent 与临床工作流','ai',['场景路由 / 工具契约','Agent 编排','执行跟踪 / 权限 / 轨迹','人工审核 / 超时补偿']),
  mod('a4','04 数据集与标注','ai',['样本抽样 / 标注流水线','双人复核 / 专家仲裁','患者分组 / 测试集隔离']),
  mod('a5','05 训练与微调','ai',['视觉迁移学习 / 预测建模','大模型 SFT / LoRA','实验追踪 / 沙盒环境']),
  mod('a6','06 模型与应用评测','ai',['算法 / RAG / Agent 评测','分组性能 / 专家盲评','安全 / 压测 / 上线门槛']),
  mod('a7','07 MaaS 模型服务管理','ai',['模型目录 / 统一 API','鉴权 / 机构应用配额','版本路由 / 容量与成本']),
  mod('a8','08 推理服务与并发','ai',['在线 / 视频 / 批量队列','预热 / 批处理 / 缓存','容量观测 / 扩容 / 降级']),
  mod('a9','09 发布与运行治理','ai',['模型 / 知识 / 规则绑定','影子 / 灰度 / 整组回滚','审计 / 反馈 / 受控更新']),
  mod('d1','院方数据库','data',['影像设备','检验与实验室','区域网络','临床数据','科研平台']),
  mod('d2','统一信息化系统','data',['HIS','LIS','PACS','EMR']),
  mod('d3','数据定义标准化','data',['数据字典 / 单位 / 术语','脱敏 / 权限 / 加密','实体关联 / 时间','数据版本 / 审计','临床 / 科研数据边界']),
  mod('g1','01 反馈入池','governance',['医师修正 / 失败案例','运行指标 / 临床结局','授权后进入候选池']),
  mod('g2','02 复核评测','governance',['专家审核 / 样本去重','算法分组 / 回归评估','判断数据或模型问题']),
  mod('g3','03 输出调优','governance',['知识 / 规则 / 模型更新','提交测试 / 模型对比','保留全部制品版本']),
  mod('g4','04 沉淀入库','governance',['临床 / 技术准入评审','灰度 / 运行监测','独立评测 / 专家标准'])
]
const flow=base('sample-flowchart','客户问题处理流程','flowchart')
flow.nodes=[{id:'f1',label:'收到客户问题',kind:'start'},{id:'f2',label:'客服初步判断',kind:'task'},{id:'f3',label:'能否直接解决？',kind:'decision'},{id:'f4',label:'回复客户',kind:'task'},{id:'f5',label:'升级研发处理',kind:'task'},{id:'f6',label:'复现问题并修复',kind:'task'},{id:'f7',label:'客户确认结果',kind:'decision'},{id:'f8',label:'关闭问题',kind:'end'}]
flow.presentation.ranks=Object.fromEntries(flow.nodes.map((n,i)=>[n.id,[0,1,2,3,3,4,5,6][i]]))
architecture.edges=[{id:'data-standard-1',source:'d1',target:'d3'},{id:'data-standard-2',source:'d2',target:'d3'}]
flow.edges=[['f1','f2'],['f2','f3'],['f3','f4','是'],['f3','f5','否'],['f5','f6'],['f6','f4'],['f4','f7'],['f7','f8','确认'],['f7','f5','未解决']].map(([source,target,label],i)=>({id:`fe${i}`,source,target,label}))
const mind=base('sample-mindmap','产品从想法到交付','mindmap')
mind.nodes=[{id:'root',label:'产品从想法到交付',kind:'topic'}]
const branches=[['发现问题',['用户访谈','现状流程','机会判断']],['定义方案',['目标与范围','功能结构','业务规则']],['设计产品',['信息架构','交互原型','需求评审']],['验证与交付',['研发协作','验收测试','上线复盘']]] as Array<[string,string[]]>
branches.forEach(([label,children],i)=>{mind.nodes.push({id:`m${i}`,label,kind:'topic',parentId:'root'});children.forEach((label,j)=>mind.nodes.push({id:`m${i}_${j}`,label,kind:'topic',parentId:`m${i}`}))})
const dataflow=base('sample-dataflow','医院系统集成与数据闭环','dataflow')
dataflow.nodes=[
  {id:'his',label:'HIS',description:'患者  医嘱',kind:'card'},
  {id:'lis',label:'LIS',description:'标本  检验',kind:'card'},
  {id:'pacs',label:'PACS',description:'影像  尺度',kind:'card'},
  {id:'emr',label:'EMR',description:'病史  病程',kind:'card'},
  {id:'incubator',label:'培养箱',description:'时序  孔位',kind:'card'},
  {id:'integration',label:'医院集成平台与前置接口',description:'授权适配  字段映射  身份核验  单位与时间校验  来源版本',kind:'card'},
  {id:'analysis',label:'读入分析链路',description:'质控后进入业务与 AI 服务\n显示依据  置信度与使用限制',kind:'card'},
  {id:'review',label:'专业确认与报告回写',description:'复核  修订  电子签名\n幂等键  版本号  回执与补偿',kind:'card'},
  {id:'trace',label:'原始输入 → AI 建议 → 人工修改 → 签名结果 → 回写回执',description:'发生患者或标本错配时阻断回写  由专业人员核验',kind:'note'}
]
dataflow.presentation.ranks={his:0,lis:0,pacs:0,emr:0,incubator:0,integration:1,analysis:2,review:2,trace:3}
dataflow.presentation.cards={his:{icon:'database'},lis:{icon:'database'},pacs:{icon:'database'},emr:{icon:'database'},incubator:{icon:'database'},integration:{variant:'band',tone:'teal'},analysis:{icon:'network'},review:{icon:'check',tone:'teal'}}
dataflow.edges=[...['his','lis','pacs','emr','incubator'].map(id=>({id:`read-${id}`,source:id,target:'integration'})),{id:'integrate',source:'integration',target:'analysis'},{id:'confirm',source:'analysis',target:'review'},{id:'evidence',source:'review',target:'analysis',label:'可追溯证据链',kind:'feedback'}]
export const samples:DiagramDocument[]=[swim,architecture,flow,mind,dataflow]
export function sampleFor(kind:DiagramKind){return copy(samples.find(d=>d.kind===kind)!)}
export function blankDocument(kind:DiagramKind):DiagramDocument {
  const d=base(newId('diagram'),{swimlane:'未命名泳道图',flowchart:'未命名流程图',architecture:'未命名架构图',mindmap:'未命名思维导图',dataflow:'未命名数据流架构图'}[kind],kind)
  if(kind==='swimlane'){d.lanes=[{id:'lane1',label:'角色 1'},{id:'lane2',label:'角色 2'},{id:'lane3',label:'角色 3'}];d.phases=[{id:'phase1',label:'阶段 1'}];d.nodes=[{id:newId(),label:'开始',kind:'start',laneId:'lane1',phaseId:'phase1'}]}
  else if(kind==='architecture'){d.groups=[{id:'layer1',label:'应用层'},{id:'layer2',label:'服务层'},{id:'layer3',label:'数据层'}];d.nodes=[{id:newId(),label:'应用模块',kind:'module',groupId:'layer1',items:['功能 1','功能 2']}]}
  else if(kind==='dataflow'){d.nodes=[{id:newId(),label:'数据源',description:'输入数据',kind:'card'}];d.presentation.cards={[d.nodes[0].id]:{icon:'database'}}}
  else d.nodes=[{id:newId(),label:kind==='mindmap'?'中心主题':'开始',kind:kind==='mindmap'?'topic':'start'}]
  return d
}
