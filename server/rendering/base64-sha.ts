import {createHash} from 'node:crypto'

const CHUNK=64*1024 // divisible by four, so no base64 quartet crosses a chunk
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Match Buffer.from's permissive decoding; only canonical base64 takes the bounded path. */
export function sha256Base64(value:string):string{
 const length=value.length,padding=value.endsWith('==')?2:value.endsWith('=')?1:0,end=length-padding
 let canonical=length%4===0&&(!padding||end>=2)
 for(let start=0;canonical&&start<end;start+=CHUNK)if(/[^A-Za-z0-9+/]/.test(value.slice(start,Math.min(end,start+CHUNK))))canonical=false
 // Reject non-zero unused pad bits from the fast path, even though Buffer accepts them.
 if(canonical&&padding){const last=alphabet.indexOf(value[end-1]);canonical=last>=0&&(last&(padding===2?15:3))===0}
 const hash=createHash('sha256')
 if(!canonical)return hash.update(Buffer.from(value,'base64')).digest('hex')
 for(let start=0;start<length;start+=CHUNK)hash.update(Buffer.from(value.slice(start,Math.min(length,start+CHUNK)),'base64'))
 return hash.digest('hex')
}
