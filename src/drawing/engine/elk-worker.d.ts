declare module 'elkjs/lib/elk-worker.min.js' {
 export class Worker {
  onmessage:((event:{data:unknown})=>void)|null
  postMessage(message:unknown):void
  terminate:()=>void
 }
 const module:{Worker:typeof Worker}
 export default module
}
