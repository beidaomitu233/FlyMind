import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'

test('promote accepts backported Python data_filter and still rejects missing capability, traversal and external links',async()=>{
 const source=await readFile(new URL('../deploy/cloud/materialize-candidate.mjs',import.meta.url),'utf8'),literal=source.match(/const EXTRACT=String\.raw`([\s\S]*?)`\r?\n/)
 assert.ok(literal,'exercise the exact production extraction program')
 for(const caller of ['promote.mjs','control-plane-promote.mjs'])assert.match(await readFile(new URL('../deploy/cloud/'+caller,import.meta.url),'utf8'),/await materializeCandidate\(/,'both publishers must use the tested extraction')
 const extraction=literal[1],program=String.raw`
import sys,tarfile,tempfile,pathlib,io,json
extract=sys.argv[1]
assert hasattr(tarfile,'data_filter'), 'test requires the real safe tarfile implementation'
version=sys.version.split()[0]
with tempfile.TemporaryDirectory(prefix='flymind-safe-tar-') as directory:
 root=pathlib.Path(directory).resolve()
 assert root.parent==pathlib.Path(tempfile.gettempdir()).resolve() and root.name.startswith('flymind-safe-tar-')
 def archive(name,member,link=None):
  path=root/name
  with tarfile.open(path,'w:gz') as output:
   entry=tarfile.TarInfo(member)
   if link is None:
    content=b'fixed fixture';entry.size=len(content);output.addfile(entry,io.BytesIO(content))
   else:
    entry.type=tarfile.SYMTYPE;entry.linkname=link;output.addfile(entry)
  return path
 def run(path,destination):
  destination.mkdir();sys.argv=['extract',str(path),str(destination)];exec(extract,{})
 good=archive('good.tar.gz','ok.txt');run(good,root/'good')
 assert (root/'good'/'ok.txt').read_bytes()==b'fixed fixture'
 original=tarfile.data_filter;del tarfile.data_filter
 try:
  try: run(good,root/'missing')
  except ValueError: pass
  else: raise AssertionError('missing data_filter accepted')
 finally: tarfile.data_filter=original
 bad=archive('bad.tar.gz','../escaped.txt')
 try: run(bad,root/'bad')
 except ValueError: pass
 else: raise AssertionError('traversal accepted')
 assert not (root/'escaped.txt').exists()
 linked=archive('linked.tar.gz','external-link',str(root.parent/'not-owned'))
 try: run(linked,root/'linked')
 except tarfile.FilterError: pass
 else: raise AssertionError('external link accepted')
 print(json.dumps({'ok':True,'python':version,'checks':['real-filter-extract','missing-capability-refused','traversal-refused','external-link-refused']}))
`
 const result=spawnSync(process.env.FLYMIND_PYTHON??(process.platform==='win32'?'python':'python3'),['-c',program,extraction],{encoding:'utf8',windowsHide:true,shell:false,timeout:10000})
 assert.ifError(result.error);assert.equal(result.status,0,result.stderr)
 const report=JSON.parse(result.stdout);assert.equal(report.ok,true);assert.equal(report.checks.length,4)
 console.log('safe extraction verified with Python '+report.python)
})
