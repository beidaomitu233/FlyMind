// CI-only uploader. Remote execution is restricted to the root-owned dispatcher.
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const env=process.env,environment=env.DEPLOY_ENVIRONMENT,id=env.DEPLOY_RELEASE_ID,host=env.DEPLOY_SSH_HOST,user=env.DEPLOY_SSH_USER,port=env.DEPLOY_SSH_PORT||'22'
if(!['staging','production'].includes(environment)||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(id??'')||!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host??'')||!/^[a-z_][a-z0-9_-]{0,31}$/.test(user??'')||!/^\d{1,5}$/.test(port)||+port<1||+port>65535)throw Error('Deployment identity invalid')
if(!env.DEPLOY_SSH_KEY?.includes('PRIVATE KEY')||!env.DEPLOY_KNOWN_HOSTS?.trim())throw Error('Pinned SSH host and deployment key are required')
const archive=resolve('download/flymind-linux-x64.tar.gz'),sidecar=(await readFile(archive+'.sha256','utf8')).trim(),expected=sidecar.split(/\s+/)[0]
if(!/^[a-f0-9]{64}$/.test(expected))throw Error('Invalid digest sidecar')
const hash=createHash('sha256');for await(const bytes of createReadStream(archive))hash.update(bytes);if(hash.digest('hex')!==expected)throw Error('Downloaded artifact digest mismatch')
const root=await mkdtemp(join(tmpdir(),'flymind-deploy-')),key=join(root,'key'),known=join(root,'known_hosts')
function run(command,args){return new Promise((yes,no)=>{const child=spawn(command,args,{stdio:'inherit',shell:false,windowsHide:true});child.once('error',no);child.once('exit',code=>code===0?yes():no(Error(command+' failed with code '+code)))})}
try{
 await writeFile(key,env.DEPLOY_SSH_KEY.replaceAll('\r','')+'\n',{mode:0o600});await writeFile(known,env.DEPLOY_KNOWN_HOSTS+'\n',{mode:0o600})
 const options=['-i',key,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+known,'-o','ConnectTimeout=15']
 await run('scp',[...options,'-P',port,archive,user+'@'+host+':/var/lib/flymind/incoming/'+id+'.tar.gz'])
 await run('ssh',[...options,'-p',port,user+'@'+host,'sudo -n /usr/local/libexec/flymind-promote '+environment+' '+id+' '+expected])
}finally{await rm(root,{recursive:true,force:true})}
