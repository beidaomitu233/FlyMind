// Linux CI source build only: the public desktop package is still Windows-only.
// Use the same OS-neutral root metadata as build-cloud-bundle, without changing
// dependency versions, npm checks, or the source bytes used for the candidate.
import {readFile,writeFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
if(process.platform!=='linux')throw Error('Linux cloud source installation only')
const paths=['package.json','package-lock.json'],originals=await Promise.all(paths.map(path=>readFile(path)))
try{
 for(let index=0;index<paths.length;index++){
  const value=JSON.parse(originals[index].toString('utf8')),root=index===0?value:value.packages?.['']
  if(!root||JSON.stringify(root.os)!=='["win32"]')throw Error('Unexpected desktop OS declaration')
  delete root.os
  await writeFile(paths[index],JSON.stringify(value,null,2)+'\n')
 }
 await new Promise((resolve,reject)=>{
  const child=spawn('npm',['ci'],{stdio:'inherit',shell:false})
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Linux source dependency installation failed')))
 })
}finally{for(let index=0;index<paths.length;index++)await writeFile(paths[index],originals[index])}
