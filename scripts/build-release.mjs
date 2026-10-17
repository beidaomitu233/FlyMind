// Assemble the GitHub download bundle from an already verified npm tarball.
import {readFile,writeFile,mkdir,copyFile,stat} from 'node:fs/promises'
import {dirname,resolve,join,basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {zipSync,strToU8} from 'fflate'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const argument=name=>process.argv.find(a=>a.startsWith(name+'='))?.slice(name.length+1)
if(!argument('--tarball'))throw Error('Pass --tarball=<verified npm .tgz>')
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')),out=resolve(argument('--output')||join(root,'output/npm-release/github'))
const source=resolve(argument('--tarball')),tarName=basename(source),tag='mcp-v'+pkg.version,zipName=`FlyMind-MCP-${pkg.version}-Windows.zip`
if(tarName!==`${pkg.name.replace(/^@/,'').replace('/','-')}-${pkg.version}.tgz`)throw Error('TARBALL_IDENTITY_MISMATCH')
await mkdir(out,{recursive:true})
const tar=await readFile(source),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const files={
 [tarName]:tar,
 'README.md':strToU8(`# FlyMind MCP ${pkg.version}\n\n支持 Windows。安装前准备 Node.js（推荐22.12+）和 npm。\n\n打开 [安装与使用](docs/INSTALL_AND_USE.md)，按步骤安装本目录的 ${tarName}、准备绘图资源并连接 Codex。首次依赖与固定资源准备需要联网。\n\n支持泳道图、流程图、架构图、思维导图、数据流图；可在网页继续编辑。\n\n[发布页面](https://github.com/beidaomitu233/FlyMind/releases/tag/${tag}) · [源码](https://github.com/beidaomitu233/FlyMind) · [MIT](LICENSE) · [第三方许可](THIRD_PARTY_NOTICES.md)\n\n应用版本 ${pkg.version}；npm 在线包和 MCP Registry 尚未发布。\n`)
}
for(const file of ['docs/INSTALL_AND_USE.md','docs/CODEX_SETUP.md','LICENSE','THIRD_PARTY_NOTICES.md'])files[file]=await readFile(join(root,file))
files['SHA256SUMS.txt']=strToU8(`${hash(tar)}  ${tarName}\n`)
const zip=zipSync(files,{level:6})
await writeFile(join(out,zipName),zip)
if(source!==join(out,tarName))await copyFile(source,join(out,tarName))
await copyFile(join(root,'docs/INSTALL_AND_USE.md'),join(out,'INSTALL_AND_USE.md'))
const assets=[tarName,zipName,'INSTALL_AND_USE.md'],records=[]
for(const name of assets){const bytes=await readFile(join(out,name));records.push({name,bytes:bytes.length,sha256:hash(bytes)})}
await writeFile(join(out,'SHA256SUMS.txt'),records.map(r=>`${r.sha256}  ${r.name}`).join('\n')+'\n')
await writeFile(join(out,'artifacts.json'),JSON.stringify({version:pkg.version,tag,platform:'win32',assets:records},null,2))
console.log(JSON.stringify({version:pkg.version,tag,assets:records},null,2))
