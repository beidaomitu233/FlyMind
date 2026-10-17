import {access,readFile} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
for(const file of ['lib/server/mcp.js','lib/server/runtime.js','lib/src/drawing/engine/drawio/index.js','dist/index.html','bin/flymind.mjs','LICENSE','THIRD_PARTY_NOTICES.md','server.json','mcp.json','plugin.json','docs/INSTALL_AND_USE.md','docs/CODEX_SETUP.md','docs/AI_DRAWING_GUIDE.md','docs/DRAWING_STANDARD.md'])await access(resolve(root,file))
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'))
if(pkg.bin?.flymind!=='bin/flymind.mjs')throw Error('PACKAGE_BIN_MISSING')
console.error('FlyMind tarball inputs present; prepack performs no downloads.')
