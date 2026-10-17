// Standalone protocol probe; uses an existing Playwright installation, no downloads.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vendor = resolve(root, '../resources/drawio/vendor');
const out = resolve(root, 'output/playwright/drawio-supply');
const modulePath = process.env.DRAWIO_PROBE_PLAYWRIGHT;
if (!modulePath) throw new Error('Set DRAWIO_PROBE_PLAYWRIGHT to the existing playwright/index.mjs absolute path. No dependency is installed by this script.');
const { chromium } = await import(pathToFileURL(modulePath).href);
const xml = '<mxfile><diagram id="probe" name="Probe"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n1" value="本地协议探针" style="rounded=1;whiteSpace=wrap;html=1;fontFamily=Microsoft YaHei;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="180" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';
const host = `<!doctype html><meta charset="utf-8"><style>iframe{width:100%;height:850px;border:0}</style><script>window.events=[];window.addEventListener('message',e=>{if(e.source!==document.querySelector('iframe').contentWindow||e.origin!==location.origin)return;try{window.events.push(JSON.parse(e.data))}catch{}});window.send=m=>document.querySelector('iframe').contentWindow.postMessage(JSON.stringify(m),location.origin);</script><iframe src="/drawio/index.html?embed=1&proto=json&configure=1&offline=1&local=1&lang=en&saveAndExit=0&noSaveBtn=0&noExitBtn=1"></iframe>`;
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.xml': 'application/xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json' };
const misses = [];
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(host); return; }
    if (!name.startsWith('/drawio/')) throw new Error('route');
    const rel = name.slice(8);
    if (rel.split('/').some(p => p.startsWith('.') || ['WEB-INF', 'META-INF'].includes(p))) throw new Error('private');
    const file = resolve(vendor, rel);
    if (!file.startsWith(vendor + sep)) throw new Error('path');
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); res.end(await readFile(file));
  } catch { misses.push(req.url); res.statusCode = 404; res.end('Not found'); }
});
await mkdir(out, { recursive: true });
await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const result = { generatedAt: new Date().toISOString(), origin, headless: true, externalRequestsBlocked: [], requestFailures: [], pageErrors: [], stages: {} };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.DRAWIO_PROBE_BROWSER ? { executablePath: process.env.DRAWIO_PROBE_BROWSER } : {}) });
  result.browser = browser.version();
  result.playwright = JSON.parse(await readFile(resolve(dirname(modulePath), 'package.json'), 'utf8')).version;
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block' });
  await context.route('**/*', route => { const url = route.request().url(); if (url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue(); result.externalRequestsBlocked.push(url); return route.abort(); });
  const page = await context.newPage();
  page.on('pageerror', e => result.pageErrors.push(e.message));
  page.on('requestfailed', r => result.requestFailures.push({ url: r.url(), failure: r.failure()?.errorText }));
  const waitEvent = async (name, from = 0, timeout = 20000) => { await page.waitForFunction(({ name, from }) => window.events.slice(from).some(e => e.event === name), { name, from }, { timeout }); return page.evaluate(({ name, from }) => window.events.slice(from).find(e => e.event === name), { name, from }); };
  const send = m => page.evaluate(m => window.send(m), m);
  await page.goto(origin);
  result.stages.configure = await waitEvent('configure');
  await send({ action: 'configure', config: { defaultFonts: ['Microsoft YaHei'], fontFamily: 'Microsoft YaHei' } });
  result.stages.init = await waitEvent('init');
  await send({ action: 'load', xml, title: 'D01 offline probe', autosave: 1, modified: 'Unsaved', message: 'load-probe' });
  // Verify both the protocol event and visible diagram readiness.
  const loaded = await waitEvent('load');
  const frame = page.frames().find(f => f.url().includes('/drawio/'));
  await frame.getByText('本地协议探针', { exact: true }).first().waitFor({ timeout: 20000 });
  result.stages.load = { visibleText: true, reply: loaded, version: await frame.evaluate(() => window.EditorUi?.VERSION), events: await page.evaluate(() => window.events.map(e => e.event)) };
  await page.screenshot({ path: resolve(out, 'editor-loaded.png'), fullPage: true });
  // Native Save action through the editor's actual UI, without changing the input XML.
  result.editorSnapshot = (await frame.locator('body').innerText()).slice(0, 5000);
  await frame.locator('.geDiagramContainer').click({ position: { x: 400, y: 300 } });
  await page.keyboard.press('Control+s');
  const saved = await waitEvent('save');
  assert.ok(saved.xml?.includes('本地协议探针'), 'Save must preserve the Chinese business label');
  result.stages.save = { keys: Object.keys(saved), xmlHasLabel: saved.xml?.includes('本地协议探针'), xmlBytes: saved.xml?.length, exit: saved.exit };
  await writeFile(resolve(out, 'saved.drawio'), saved.xml);
  const autoFrom = await page.evaluate(() => window.events.length);
  await frame.getByText('本地协议探针', { exact: true }).first().click();
  await page.keyboard.press('ArrowRight');
  const auto = await waitEvent('autosave', autoFrom);
  assert.ok(auto.xml?.includes('本地协议探针'), 'Autosave must contain the Chinese label');
  assert.notEqual(auto.xml, saved.xml, 'Native move must change the saved document');
  result.stages.autosave = { keys: Object.keys(auto), xmlHasLabel: true, xmlChanged: true, xmlBytes: auto.xml.length };
  for (const format of ['svg', 'png', 'xmlsvg', 'xmlpng']) {
    const from = await page.evaluate(() => window.events.length);
    await send({ action: 'export', format, xml: saved.xml, embedImages: true, message: `probe-${format}` });
    const event = await waitEvent('export', from, 25000);
    const data = event.data || '';
    assert.equal(event.message?.message, `probe-${format}`, 'Fixed version wraps the request under event.message');
    assert.ok(data.startsWith(format.endsWith('png') ? 'data:image/png;' : 'data:image/svg+xml;'), 'Export must return the expected image type');
    result.stages[format] = { keys: Object.keys(event), format: event.format, message: event.message, dataPrefix: data.slice(0, 60), dataLength: data.length };
    if (data.startsWith('data:')) { const comma = data.indexOf(','); const raw = data.slice(comma + 1); await writeFile(resolve(out, `export-${format}.${format.endsWith('png') ? 'png' : 'svg'}`), /;base64,/.test(data) ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw))); }
  }
  result.fonts = await frame.evaluate(async () => { await document.fonts.ready; return { ready: document.fonts.status, yahei: document.fonts.check('16px "Microsoft YaHei"'), userAgent: navigator.userAgent }; });
  result.events = await page.evaluate(() => window.events.map(e => ({ ...e, ...(e.xml ? { xml: `[${e.xml.length} chars]` } : {}), ...(e.data ? { data: `[${e.data.length} chars]` } : {}) })));
  result.ok = true;
} catch (e) { result.ok = false; result.error = e.stack; process.exitCode = 1; }
finally { result.misses = misses; await writeFile(resolve(out, 'protocol.json'), JSON.stringify(result, null, 2)); await browser?.close(); server.closeAllConnections(); await new Promise(yes => server.close(yes)); console.log(JSON.stringify({ ok: result.ok, browser: result.browser, stages: Object.keys(result.stages), externalRequestsBlocked: result.externalRequestsBlocked, misses, error: result.error }, null, 2)); }
