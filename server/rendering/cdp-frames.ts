import {NativeRenderError} from './types'

const BLOCK_BYTES=64*1024
interface Block {bytes:Buffer;start:number;end:number}

/** Chrome's private CDP pipe separates UTF-8 JSON messages with NUL bytes. */
export function createCDPFrameDecoder(deliver:(message:object)=>void,limit=128*1024*1024){
 let blocks:Block[]=[],head=0,length=0,scanBlock=0,scanOffset=0,scanned=0,spare:Buffer|undefined
 function append(chunk:Buffer){
  let offset=0
  // A partially filled tail may have already been scanned on a prior call.
  if(chunk.length&&blocks.length&&scanBlock===blocks.length){scanBlock=blocks.length-1;scanOffset=blocks[scanBlock].end}
  while(offset<chunk.length){let block=blocks[blocks.length-1]
   if(!block||block.end===block.bytes.length){block={bytes:spare??Buffer.allocUnsafe(Math.min(BLOCK_BYTES,limit)),start:0,end:0};spare=undefined;blocks.push(block)}
   const count=Math.min(chunk.length-offset,block.bytes.length-block.end)
   chunk.copy(block.bytes,block.end,offset,offset+count);block.end+=count;offset+=count
  }
  length+=chunk.length
 }
 function take(size:number){
  const frame=size?Buffer.allocUnsafe(size):undefined;let copied=0,remaining=size+1
  while(remaining){const block=blocks[head],count=Math.min(remaining,block.end-block.start),data=Math.min(count,size-copied)
   if(data){block.bytes.copy(frame!,copied,block.start,block.start+data);copied+=data}
   block.start+=count;remaining-=count;if(block.start===block.end){spare??=block.bytes;head++}
  }
  length-=size+1
  if(head===blocks.length){blocks=[];head=0}else if(head>=64&&head*2>=blocks.length){blocks=blocks.slice(head);head=0}
  scanBlock=head;scanOffset=blocks[head]?.start??0;scanned=0
  return frame
 }
 return (chunk:Buffer)=>{
  // Preserve admission before parsing, including complete messages in this chunk.
  if(length+chunk.length>limit)throw new NativeRenderError('BROWSER_PROTOCOL_FAILED','CDP frame budget exceeded')
  append(chunk)
  while(scanBlock<blocks.length){const block=blocks[scanBlock],from=Math.max(scanOffset,block.start)
   const boundary=block.bytes.subarray(0,block.end).indexOf(0,from)
   if(boundary<0){scanned+=block.end-from;scanBlock++;scanOffset=blocks[scanBlock]?.start??0;continue}
   const frame=take(scanned+boundary-from)
   if(frame)try{const message:unknown=JSON.parse(frame.toString('utf8'));if(!message||typeof message!=='object'||Array.isArray(message))throw Error();deliver(message)}catch{throw new NativeRenderError('BROWSER_PROTOCOL_FAILED','Invalid private CDP frame')}
  }
 }
}
