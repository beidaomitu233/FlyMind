/** Bound bytes before JSON/base64 expansion, including missing/false length headers. */
export async function readBoundedInlineBytes(response:Response,limit:number,overLimit:(observed:number)=>Error):Promise<Buffer>{
 const header=response.headers.get('content-length'),declared=header===null?undefined:Number(header)
 if(declared!==undefined&&Number.isFinite(declared)&&declared>limit){void response.body?.cancel().catch(()=>{});throw overLimit(declared)}
 if(!response.body)return Buffer.alloc(0)
 const reader=response.body.getReader(),chunks:Buffer[]=[];let total=0
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength
   if(total>limit){void reader.cancel().catch(()=>{});throw overLimit(total)}
   chunks.push(Buffer.from(value.buffer,value.byteOffset,value.byteLength))
  }
  return Buffer.concat(chunks,total)
 }finally{reader.releaseLock()}
}
