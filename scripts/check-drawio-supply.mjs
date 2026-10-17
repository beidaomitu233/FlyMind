// Read-only inventory of the existing candidate supply. Never copies vendor assets.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, totalmem, release } from 'node:os';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const supply = resolve(root, '../resources/drawio');
const out = resolve(root, 'output/playwright/drawio-supply');
const sha = b => createHash('sha256').update(b).digest('hex');
async function walk(dir) {
  const rows = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isSymbolicLink()) throw new Error(`Unexpected symlink: ${p}`);
    if (e.isDirectory()) rows.push(...await walk(p));
    else if (e.isFile()) { const b = await readFile(p); rows.push({ path: relative(supply, p).replaceAll('\\', '/'), bytes: b.length, sha256: sha(b) }); }
  }
  return rows;
}
const files = (await walk(supply)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const app = await readFile(resolve(supply, 'vendor/js/app.min.js'), 'utf8');
const groups = {};
for (const f of files) { const k = f.path.startsWith('vendor/') ? f.path.split('/')[1] : '(supply root)'; const g = groups[k] ??= { files: 0, bytes: 0 }; g.files++; g.bytes += f.bytes; }
const report = { generatedAt: new Date().toISOString(), root: supply, node: process.version, platform: process.platform, arch: process.arch,
  machine: { cpu: cpus()[0]?.model.trim(), logicalCpus: cpus().length, totalMemory: totalmem(), osRelease: release() },
  version: /EditorUi\.VERSION="([^"]+)"/.exec(app)?.[1], files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0),
  manifestSha256: sha(files.map(f => `${f.sha256}  ${f.bytes}  ${f.path}\n`).join('')), groups,
  licenses: files.filter(f => /(^|\/)(LICENSE[^/]*|NOTICE[^/]*)$/i.test(f.path)),
  fonts: files.filter(f => /\.(ttf|otf|ttc|woff2?)$/i.test(f.path)),
  critical: files.filter(f => ['LICENSE', 'vendor/index.html', 'vendor/js/bootstrap.js', 'vendor/js/main.js', 'vendor/js/app.min.js', 'vendor/styles/grapheditor.css'].includes(f.path)),
  sourceClaim: 'Historical ../docs/references/SUPPLY_MANIFEST.md claims official jgraph/drawio draw.war, version 31.5.3. Original archive/checksum not retained; provenance not independently authenticated.' };
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'inventory.json'), JSON.stringify({ ...report, entries: files }, null, 2));
await writeFile(resolve(out, 'summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
