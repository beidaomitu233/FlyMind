import type {DiagramContent,DiagramNode} from './model'

/** Business transcription of the supplied reference; provenance and anchor
 * limitations live in docs/validation/technical-reference-layout.md. */
export function technicalReferenceContent(id='technical-reference'):DiagramContent{
 const node=(id:string,label:string,technology:string,groupId?:string):DiagramNode=>({id,label,technology,kind:'module',...(groupId?{groupId}:{})})
 return {schemaVersion:1,id,title:'应用技术架构',kind:'technical',lanes:[],phases:[],groups:[
  {id:'frontend',label:'前端服务'},{id:'gateway',label:'接入服务'},{id:'backend',label:'后端服务'},{id:'storage',label:'存储服务'},
  {id:'schedule',label:'定时任务'},{id:'messages',label:'消息队列'},{id:'locks',label:'分布式锁'},{id:'operations',label:'运维工具'},{id:'observability',label:'监控工具'},
 ],nodes:[
  node('desktop','电脑','desktop'),node('mobile','手机','mobile'),
  node('admin-web','管理后台 Vue','vue','frontend'),node('admin-app','管理后台 UniApp','uniapp','frontend'),node('user-app','用户前台 UniApp','uniapp','frontend'),
  ...[1,2,3].map(i=>node('nginx-'+i,'Nginx','nginx','gateway')),
  ...[1,2,3].map(i=>node('service-'+i,'Spring Boot','springboot','backend')),
  node('mysql','MySQL','mysql','storage'),node('redis','Redis','redis','storage'),node('object-store','OSS / MinIO','minio','storage'),node('search','Elasticsearch','elasticsearch','storage'),
  node('quartz','Quartz','quartz','schedule'),node('stream','Redis Stream','redis-stream','messages'),node('redisson','Redisson','redisson','locks'),
  node('jenkins','Jenkins\n自动化部署','jenkins','operations'),node('docker','Docker\n容器','docker','operations'),node('portainer','Portainer\n容器管理','portainer','operations'),
  node('service-admin','Spring Boot Admin\n服务管理','spring-boot-admin','observability'),node('sql-monitor','Druid Admin\nSQL 监控','druid','observability'),node('tracing','SkyWalking\n链路追踪与日志','skywalking','observability'),
 ],edges:[
  {id:'desktop-web',source:'desktop',target:'admin-app'},{id:'mobile-web',source:'mobile',target:'admin-app'},
  {id:'http',source:'admin-app',target:'nginx-2',label:'HTTP'},{id:'balance',source:'nginx-2',target:'service-2',label:'负载均衡'},
  {id:'business-data',source:'service-1',target:'mysql',label:'业务数据'},{id:'cache-data',source:'service-2',target:'redis',label:'缓存数据'},
  {id:'file-data',source:'service-2',target:'object-store',label:'文件数据'},{id:'search-data',source:'service-3',target:'search',label:'搜索数据'},
  {id:'schedule-service',source:'quartz',target:'service-1',label:'调度任务'},{id:'send-message',source:'service-1',target:'stream',label:'收发消息'},
  {id:'receive-message',source:'stream',target:'service-1'},{id:'obtain-lock',source:'service-1',target:'redisson',label:'获得锁'},
  {id:'deploy-service',source:'jenkins',target:'service-3',label:'部署服务'},{id:'monitor-service',source:'service-admin',target:'service-3',label:'监控服务'},
 ]}
}
