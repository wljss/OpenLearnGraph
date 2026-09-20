// Windows-only smoke test for the packaged app. Uses isolated user data and
// loopback DevTools ports; no test-only IPC or production backdoor is shipped.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestEpub, createTestPdf } from '../tests/documentFixtures.mjs';

const executable = resolve('out/OpenLearnGraph-win32-x64/OpenLearnGraph.exe');
const timeoutMs = 30_000;

function makeMetadata(preview) {
  return {
    previewToken: preview.previewToken,
    title: preview.title,
    author: preview.author,
    publisher: preview.publisher,
    language: preview.language,
    identifier: preview.identifier,
  };
}

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise((done) => server.close(done));
  return address.port;
}

async function findTarget(port, kind, process) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (process.exitCode !== null) throw new Error(`EXE 提前退出，代码 ${process.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === kind && item.webSocketDebuggerUrl);
      if (target) return target.webSocketDebuggerUrl;
    } catch { /* The inspector is still starting. */ }
    await delay(150);
  }
  throw new Error(`等待 ${kind} 调试目标超时`);
}

class DevTools {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const item of this.pending.values()) item.reject(new Error('调试连接已关闭'));
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveConnection, reject) => {
      socket.addEventListener('open', resolveConnection, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new DevTools(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveResult, reject) => {
      this.pending.set(id, { resolve: resolveResult, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text
        + (result.exceptionDetails.exception?.description ?? ''));
    }
    return result.result.value;
  }

  close() { this.socket.close(); }
}

async function launch(profile) {
  const rendererPort = await freePort();
  const mainPort = await freePort();
  assert.notEqual(rendererPort, mainPort);
  const env = { ...globalThis.process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  const output = [];
  const process = spawn(executable, [
    `--user-data-dir=${profile}`,
    // The sandboxed CI account may not be allowed to initialize the host GPU
    // runtime; rendering itself is not under test here.
    '--disable-gpu',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${rendererPort}`,
    `--inspect=127.0.0.1:${mainPort}`,
  ], { cwd: dirname(executable), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const rememberOutput = (chunk) => {
    output.push(chunk.toString());
    if (output.length > 100) output.shift();
  };
  process.stdout.on('data', rememberOutput);
  process.stderr.on('data', rememberOutput);
  let main;
  let renderer;
  try {
    main = await DevTools.connect(await findTarget(mainPort, 'node', process));
    renderer = await DevTools.connect(await findTarget(rendererPort, 'page', process));
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await renderer.evaluate('Boolean(window.openLearnGraph?.documents)')) break;
      await delay(100);
    }
    assert(await renderer.evaluate('Boolean(window.openLearnGraph?.documents)'), 'preload 资料接口未加载');
    return { process, main, renderer };
  } catch (error) {
    main?.close();
    renderer?.close();
    const exited = process.exitCode !== null
      ? Promise.resolve()
      : new Promise((done) => process.once('exit', done));
    process.kill();
    await Promise.race([exited, delay(5_000)]);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${output.length ? `\nEXE 输出：\n${output.join('')}` : ''}`,
      { cause: error },
    );
  }
}

async function stop(app) {
  if (!app) return;
  if (app.process.exitCode !== null) {
    app.main.close();
    app.renderer.close();
    return;
  }
  try { await app.main.evaluate("process.mainModule.require('electron').app.quit(); true"); }
  catch { app.process.kill(); }
  app.main.close();
  app.renderer.close();
  const exit = new Promise((done) => app.process.once('exit', done));
  await Promise.race([exit, delay(5_000).then(() => app.process.kill())]);
}

function selectFile(app, path) {
  return app.main.evaluate(`process.mainModule.require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(path)}] }); true`);
}

function call(app, expression) {
  return app.renderer.evaluate(`window.openLearnGraph.documents.${expression}`);
}

function apiCall(app, namespace, expression) {
  return app.renderer.evaluate(`window.openLearnGraph.${namespace}.${expression}`);
}

async function waitForUi(app, expression) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await app.renderer.evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`桌面界面未达到预期状态：${expression}`);
}

async function checkFile(app, sample) {
  await selectFile(app, sample.path);
  const preview = await call(app, 'chooseFile()');
  assert.equal(preview.format, sample.format);
  assert.equal(preview.canImport, true, preview.blockedReason ?? '无法导入');
  assert(preview.sections.some((item) => item.content.includes(sample.text)), `${sample.format} 预览缺少预期正文`);
  const imported = await call(app, `confirmImport(${JSON.stringify(makeMetadata(preview))})`);
  const section = await call(app, `getSection(${JSON.stringify(imported.id)}, 0, 0)`);
  assert(section.content.includes(sample.text), `${sample.format} 保存结果缺少预期正文`);
  const duplicate = await call(app, 'chooseFile()');
  assert.equal(duplicate.canImport, false);
  assert.equal(duplicate.duplicateDocumentId, imported.id);
  console.log(`通过：${sample.format} 预览、确认和重复导入拦截`);
  return imported.id;
}

async function main() {
  assert.equal(globalThis.process.platform, 'win32', '此脚本只支持 Windows');
  const root = await mkdtemp(join(tmpdir(), 'openlearngraph-smoke-'));
  const profile = join(root, 'profile');
  let app;
  try {
    const samples = [
      { name: 'paper.pdf', format: 'PDF', data: createTestPdf('Hello PDF extraction'), text: 'Hello PDF extraction' },
      { name: 'book.epub', format: 'EPUB', data: await createTestEpub(), text: '用 机器学习 解决问题' },
      { name: '课程.md', format: 'MARKDOWN', data: '# 课程导论\n\n先建立概念，再连接关系。', text: '先建立概念' },
      { name: '笔记.txt', format: 'TEXT', data: '第一章 初识模型\n\n模型从数据中学习规律。', text: '模型从数据中学习规律' },
    ];
    for (const sample of samples) {
      sample.path = join(root, sample.name);
      await writeFile(sample.path, sample.data);
    }
    const scan = join(root, 'scan.pdf');
    const badEpub = join(root, 'broken.epub');
    const badPdf = join(root, 'broken.pdf');
    const malformedPdf = join(root, 'malformed.pdf');
    await writeFile(scan, createTestPdf());
    await writeFile(badEpub, 'not an epub');
    await writeFile(badPdf, 'not a pdf');
    await writeFile(malformedPdf, '%PDF-1.4\nbroken');
    const longPath = join(root, '长资料.md');
    const longText = Array.from({ length: 70 }, (_, index) => (
      `# 第 ${index + 1} 章\n\n${index === 69 ? `${'前'.repeat(26_000)}独有检索词。` : `这是第 ${index + 1} 章的正文。`}`
    )).join('\n\n');
    await writeFile(longPath, longText);

    app = await launch(profile);
    await selectFile(app, longPath);
    const longPreview = await call(app, 'chooseFile()');
    assert.equal(longPreview.sectionCount, 70);
    const longImported = await call(app, `confirmImport(${JSON.stringify(makeMetadata(longPreview))})`);
    assert.equal((await call(app, `listSections(${JSON.stringify(longImported.id)}, 50)`)).length, 20);
    const longSearch = await call(app, `search(${JSON.stringify(longImported.id)}, '独有检索词')`);
    assert.equal(longSearch.hits[0].position, 69);
    const located = await call(app, `getSection(${JSON.stringify(longImported.id)}, 69, ${longSearch.hits[0].matchOffset - 80})`);
    assert(located.content.includes('独有检索词'));
    console.log('通过：长资料的后续目录、全文分段和搜索定位');
    const ids = [];
    for (const sample of samples) ids.push(await checkFile(app, sample));

    await selectFile(app, scan);
    const scanPreview = await call(app, 'chooseFile()');
    assert.equal(scanPreview.canImport, false);
    assert.match(scanPreview.blockedReason, /OCR/);
    for (const [path, expected] of [[badEpub, 'EPUB 文件损坏'], [badPdf, '不是有效的 PDF'], [malformedPdf, 'PDF 解析失败']]) {
      await selectFile(app, path);
      const result = await app.renderer.evaluate('(async () => { try { await window.openLearnGraph.documents.chooseFile(); return null; } catch (error) { return String(error); } })()');
      assert.match(result, new RegExp(expected));
    }
    console.log('通过：扫描件、损坏 EPUB、损坏 PDF 和伪造 PDF 的反馈');

    const candidateGraph = await apiCall(app, 'graphs', `create(${JSON.stringify({ name: '资料候选图谱' })})`);

    await stop(app);
    app = null;
    app = await launch(profile);
    const list = await call(app, 'list()');
    assert.equal(list.length, samples.length + 1);
    for (let index = 0; index < samples.length; index += 1) {
      const reopened = await call(app, `get(${JSON.stringify(ids[index])})`);
      assert.equal(reopened.format, samples[index].format);
      const section = await call(app, `getSection(${JSON.stringify(ids[index])}, 0, 0)`);
      assert(section.content.includes(samples[index].text));
    }
    assert.equal((await call(app, `search(${JSON.stringify(longImported.id)}, '独有检索词')`)).hits[0].position, 69);
    console.log('通过：重启 EXE 后四种格式仍可读取');
    await waitForUi(app, "Boolean(document.querySelector('.document-library-launch'))");
    await app.renderer.evaluate("document.querySelector('.document-library-launch').click(); true");
    await waitForUi(app, "document.querySelectorAll('.document-list li').length === 5");
    await app.renderer.evaluate("document.querySelector('.document-list li button').click(); true");
    await waitForUi(app, "document.querySelector('.document-reader pre')?.textContent?.includes('模型从数据中学习规律') === true");
    await app.renderer.evaluate(`(() => {
      const input = document.getElementById('document-search-input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '模型');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await waitForUi(app, "document.querySelector('.document-reader-search button')?.disabled === false");
    await app.renderer.evaluate("document.querySelector('.document-reader-search button').click(); true");
    await waitForUi(app, "document.querySelector('.document-search-results')?.textContent?.includes('匹配章节') === true");
    await waitForUi(app, "document.querySelector('.document-reader mark')?.textContent === '模型'");
    console.log('通过：正式界面可打开正文并搜索定位');

    await app.renderer.evaluate(`(() => {
      const mark = document.querySelector('.document-reader mark');
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(mark);
      selection.removeAllRanges();
      selection.addRange(range);
      mark.closest('pre').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    })()`);
    await waitForUi(app, "document.querySelector('.candidate-from-selection')?.textContent?.includes('创建候选概念') === true");
    await app.renderer.evaluate("document.querySelector('.candidate-from-selection').click(); true");
    await waitForUi(app, "Boolean(document.querySelector('.candidate-workspace'))");
    const firstWorkspace = await apiCall(app, 'candidates', `getWorkspace(${JSON.stringify(candidateGraph.id)})`);
    assert.equal(firstWorkspace.pendingConceptCount, 1);
    assert.equal(firstWorkspace.concepts[0].sourceQuote, '模型');
    await app.renderer.evaluate("document.querySelector('[aria-label=\"关闭候选图谱\"]').click(); true");
    await waitForUi(app, "!document.querySelector('.candidate-workspace')");

    const textSection = await call(app, `getSection(${JSON.stringify(ids[3])}, 0, 0)`);
    const quote = '学习规律';
    const sourceCharacters = Array.from(textSection.content);
    const sourceStartOffset = sourceCharacters.join('').indexOf(quote);
    assert(sourceStartOffset >= 0);
    await apiCall(app, 'candidates', `createConcept(${JSON.stringify({
      graphId: candidateGraph.id,
      documentId: ids[3],
      sectionPosition: 0,
      sourceStartOffset,
      sourceEndOffset: sourceStartOffset + Array.from(quote).length,
      name: quote,
      description: '从数据中概括可复用模式。',
    })})`);
    let candidateWorkspace = await apiCall(app, 'candidates', `getWorkspace(${JSON.stringify(candidateGraph.id)})`);
    const modelCandidate = candidateWorkspace.concepts.find((item) => item.name === '模型');
    const patternCandidate = candidateWorkspace.concepts.find((item) => item.name === quote);
    assert(modelCandidate && patternCandidate);
    await apiCall(app, 'candidates', `createRelationship(${JSON.stringify({
      graphId: candidateGraph.id,
      sourceCandidateId: modelCandidate.id,
      targetCandidateId: patternCandidate.id,
    })})`);

    await app.renderer.evaluate("Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '候选图谱').click(); true");
    await waitForUi(app, "document.querySelectorAll('.candidate-card').length === 2 && document.querySelectorAll('.candidate-relation-list li').length === 1");
    await app.renderer.evaluate("Array.from(document.querySelectorAll('.candidate-workspace > footer button')).find((button) => button.textContent.includes('确认写入')).click(); true");
    await waitForUi(app, "Boolean(document.querySelector('[role=alertdialog]'))");
    await app.renderer.evaluate("Array.from(document.querySelectorAll('[role=alertdialog] button')).find((button) => button.textContent.includes('确认写入图谱')).click(); true");
    await waitForUi(app, "document.querySelector('.candidate-workspace > footer')?.textContent?.includes('0 个概念') === true");
    const acceptedGraph = await apiCall(app, 'graphs', `load(${JSON.stringify(candidateGraph.id)})`);
    assert.equal(acceptedGraph.nodes.length, 2);
    assert.equal(acceptedGraph.edges.length, 1);
    candidateWorkspace = await apiCall(app, 'candidates', `getWorkspace(${JSON.stringify(candidateGraph.id)})`);
    assert.equal(candidateWorkspace.pendingConceptCount, 0);
    assert(candidateWorkspace.concepts.every((item) => item.status === 'ACCEPTED'));
    console.log('通过：界面原文选区、候选关系审核与事务写入');

    await stop(app);
    app = null;
    app = await launch(profile);
    const persistedGraph = await apiCall(app, 'graphs', `load(${JSON.stringify(candidateGraph.id)})`);
    const persistedWorkspace = await apiCall(app, 'candidates', `getWorkspace(${JSON.stringify(candidateGraph.id)})`);
    assert.equal(persistedGraph.nodes.length, 2);
    assert.equal(persistedGraph.edges.length, 1);
    assert.equal(persistedWorkspace.concepts.find((item) => item.name === '模型').sourceQuote, '模型');
    assert(persistedWorkspace.concepts.every((item) => item.status === 'ACCEPTED'));
    console.log('通过：重启 EXE 后正式图谱、审核历史和原文快照仍在');
  } finally {
    await stop(app);
    // Delete only the unique directory created by this run, never a user profile.
    assert.equal(dirname(resolve(root)).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert(basename(root).startsWith('openlearngraph-smoke-'));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

await main();
