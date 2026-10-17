// D01 read-only data inventory. No DiagramStore/init/migration imports.
// Raw reports and SQLite copies stay under the ignored output/playwright tree.
import Database from 'better-sqlite3'
import { readFile, writeFile, mkdir, readdir, stat, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { register } from 'tsx/esm/api'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha = value => createHash('sha256').update(value).digest('hex')
const json = value => JSON.stringify(value, null, 2) + '\n'
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const git = (...args) => execFileSync('git', ['-c', 'core.safecrlf=false', ...args], { cwd: root, encoding: 'utf8' }).trimEnd()
const fixtureRoot = join(root, 'tests/fixtures/drawio-baseline')
register()
const { validateContent } = await import('../src/drawing/core/layers.ts')
const { inspectDrawing } = await import('../src/drawing/core/drawing-quality.ts')

function structure(c) {
  return {
    kind: c.kind, nodes: c.nodes.length, edges: c.edges.length,
    roles: (c.lanes || []).map(x => [x.id, x.label]),
    phases: (c.phases || []).map(x => [x.id, x.label]),
    groups: (c.groups || []).map(x => [x.id, x.label]),
    ownership: c.nodes.map(x => [x.id, x.kind, x.laneId || null, x.phaseId || null, x.groupId || null, x.parentId || null]),
    relationships: c.edges.map(x => [x.id, x.source, x.target, x.kind || 'flow', x.label || null]),
    parentRelationships: c.nodes.filter(x => x.parentId).map(x => [x.parentId, x.id]),
  }
}

async function fixtures() {
  const manifest = await readJson(join(fixtureRoot, 'manifest.json'))
  const results = []
  for (const sample of manifest.samples) {
    const content = await readJson(join(fixtureRoot, sample.file))
    validateContent(content)
    assert.deepEqual(structure(content), sample.expected, `${sample.file}: baseline relationship drift`)
    assert.equal(sha(JSON.stringify(content)), sample.sha256, `${sample.file}: content drift`)
    const quality = inspectDrawing(content)
    assert.deepEqual({ standardVersion: quality.standardVersion, passed: quality.passed, score: quality.score,
      issues: quality.issues.map(x => [x.code, x.severity, x.nodeId || null]) }, sample.expectedQuality, `${sample.file}: quality baseline drift`)
    results.push({ file: sample.file, ...structure(content), quality })
  }
  return results
}

function snapshot(db) {
  return db.transaction(() => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x => x.name)
    const counts = Object.fromEntries(tables.map(name => [name, db.prepare(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`).get().n]))
    const diagrams = db.prepare('SELECT * FROM diagrams ORDER BY id').all()
    const versions = db.prepare('SELECT * FROM diagram_versions ORDER BY diagram_id,revision').all()
    const groups = db.prepare('SELECT * FROM workspace_groups ORDER BY id').all()
    const tombstones = db.prepare('SELECT * FROM diagram_tombstones ORDER BY id').all()
    const metadata = db.prepare('SELECT * FROM metadata ORDER BY key').all()
    const dataHash = sha(JSON.stringify({ diagrams, versions, groups, tombstones, metadata }))
    const issues = []
    const records = diagrams.map(row => {
      const doc = JSON.parse(row.document), content = doc.content || doc
      const history = versions.filter(x => x.diagram_id === row.id)
      const current = history.find(x => x.revision === row.revision)
      if (!current || current.document !== row.document) issues.push({ id: row.id, issue: 'current-history-mismatch' })
      if (row.created_at !== doc.createdAt) issues.push({ id: row.id, issue: 'created-at-mismatch' })
      if (row.saved_at !== doc.updatedAt) issues.push({ id: row.id, issue: 'saved-updated-at-mismatch' })
      if (![row.created_at, row.saved_at, doc.createdAt, doc.updatedAt].every(x => Number.isSafeInteger(x) && x > 0)) issues.push({ id: row.id, issue: 'invalid-time' })
      if (row.revision < 1 || !Number.isInteger(row.revision)) issues.push({ id: row.id, issue: 'invalid-revision' })
      return { id: row.id, kind: content.kind, schemaVersion: doc.schemaVersion, revision: row.revision, createdAt: row.created_at, updatedAt: doc.updatedAt, savedAt: row.saved_at, workspaceGroupId: row.workspace_group_id, deletedAt: row.deleted_at, historyCount: history.length, nodes: content.nodes.length, edges: content.edges.length }
    })
    return { counts, dataHash, records, groups, tombstones, metadata, issues,
      sqliteVersion: db.prepare('SELECT sqlite_version() AS version').get().version,
      active: diagrams.filter(x => x.deleted_at === null).length,
      deleted: diagrams.filter(x => x.deleted_at !== null).length,
      groupedActive: diagrams.filter(x => x.deleted_at === null && x.workspace_group_id !== null).length,
      integrity: db.pragma('integrity_check'), foreignKeys: db.pragma('foreign_key_check') }
  })()
}

async function fileState(path) {
  try { const s = await stat(path); return { size: s.size, mtimeMs: s.mtimeMs, sha256: sha(await readFile(path)) } }
  catch (e) { if (e.code === 'ENOENT') return null; throw e }
}
async function artifactInventory(dir) {
  const files = []
  async function walk(base, prefix = '') {
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const relative = prefix + entry.name, path = join(base, entry.name)
      if (entry.isDirectory()) await walk(path, relative + '/')
      else if (entry.isFile()) files.push({ path: relative, ...(await fileState(path)) })
    }
  }
  try { await walk(dir) } catch (e) { if (e.code !== 'ENOENT') throw e }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

const samples = await fixtures()
if (process.argv.includes('--fixtures-only')) {
  console.log(json({ ok: true, samples: samples.map(x => ({ file: x.file, kind: x.kind, nodes: x.nodes, edges: x.edges, quality: x.quality })) }))
} else {
  const source = join(root, 'data/flymind.sqlite')
  await access(source) // Never create a missing production database.
  const output = join(root, 'output/playwright/drawio-data-baseline', new Date().toISOString().replaceAll(':', '-'))
  assert.match(git('check-ignore', '--', output), /output/)
  await mkdir(output, { recursive: true })
  const before = await Promise.all(['', '-wal', '-shm'].map(suffix => fileState(source + suffix)))
  const status = git('status', '--porcelain=v1', '--untracked-files=all')
  const pkg = await readJson(join(root, 'package.json'))
  const installed = Object.fromEntries(await Promise.all(['@modelcontextprotocol/sdk', 'better-sqlite3'].map(async name => [name, (await readJson(join(root, 'node_modules', name, 'package.json'))).version])))
  const db = new Database(source, { readonly: true, fileMustExist: true })
  let liveBefore, liveAfter
  const backupPath = join(output, 'online-backup.sqlite')
  try { liveBefore = snapshot(db); await db.backup(backupPath); liveAfter = snapshot(db) } finally { db.close() }
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true })
  let copied
  const restoredPath = join(output, 'restored.sqlite')
  try { copied = snapshot(backup); await backup.backup(restoredPath) } finally { backup.close() }
  const restored = new Database(restoredPath, { readonly: true, fileMustExist: true })
  let recovered
  try { recovered = snapshot(restored) } finally { restored.close() }
  const after = await Promise.all(['', '-wal', '-shm'].map(suffix => fileState(source + suffix)))
  const checks = { sourceStable: liveBefore.dataHash === liveAfter.dataHash,
    backupMatchesSource: copied.dataHash === liveAfter.dataHash,
    restoreMatchesBackup: recovered.dataHash === copied.dataHash,
    sourceMainFileUnchanged: JSON.stringify(before[0]) === JSON.stringify(after[0]),
    backupIntegrity: copied.integrity.every(x => Object.values(x)[0] === 'ok'),
    restoreIntegrity: recovered.integrity.every(x => Object.values(x)[0] === 'ok'),
    noForeignKeyViolations: !copied.foreignKeys.length && !recovered.foreignKeys.length }
  const artifacts = await artifactInventory(join(root, 'data/artifacts'))
  const report = { generatedAt: new Date().toISOString(), node: process.version, sqlite: copied.sqliteVersion,
    appVersion: pkg.version, installed, source, output, head: git('rev-parse', 'HEAD'),
    gitStatus: status.split('\n'), gitStatusCount: status.split('\n').filter(Boolean).length,
    gitNumstat: git('diff', '--numstat'), before, after, checks,
    live: liveAfter, backup: copied, restored: recovered,
    backupFile: await fileState(backupPath), restoredFile: await fileState(restoredPath),
    artifacts: { count: artifacts.length, bytes: artifacts.reduce((n, x) => n + x.size, 0), files: artifacts, copied: false }, samples }
  await writeFile(join(output, 'report.json'), json(report))
  console.log(json({ output, checks, counts: copied.counts, active: copied.active, deleted: copied.deleted, groupedActive: copied.groupedActive, issues: copied.issues.length, samples: samples.map(x => ({ file: x.file, nodes: x.nodes, edges: x.edges })), artifacts: { count: artifacts.length, bytes: report.artifacts.bytes } }))
  assert.ok(Object.values(checks).every(Boolean), 'Backup verification failed; inspect the ignored report')
}
