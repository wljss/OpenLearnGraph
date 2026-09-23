// Windows-only smoke test for the packaged app. Uses isolated user data and
// loopback DevTools ports; no test-only IPC or production backdoor is shipped.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

function selectFiles(app, paths) {
  return app.main.evaluate(`process.mainModule.require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ${JSON.stringify(paths)} }); true`);
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

async function waitForUiUntil(app, expression, waitMs) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (await app.renderer.evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`桌面界面未在 ${waitMs}ms 内达到预期状态：${expression}`);
}

async function captureScreenshot(app, path) {
  const screenshot = await app.renderer.send('Page.captureScreenshot', { format: 'png' });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(screenshot.data, 'base64'));
}

async function reviewPrivateBooks(app) {
  const bookPaths = [
    resolve('test-data/private/books/AI-Agents-in-Depth-zh-CN.pdf'),
    resolve('test-data/private/books/AI-Infra-Book.pdf'),
  ];
  const reviewDirectory = resolve('test-data/private/beginner-review');
  const report = {
    recordedAt: new Date().toISOString(),
    books: bookPaths.map((path) => basename(path)),
    steps: [],
  };

  await app.renderer.evaluate("document.querySelector('.document-library-launch').click(); true");
  await waitForUi(app, "Boolean(document.querySelector('.document-library-home'))");
  report.steps.push({ step: 'open-library', result: 'ok' });

  await selectFiles(app, bookPaths);
  const parseStartedAt = Date.now();
  await app.renderer.evaluate("Array.from(document.querySelectorAll('.document-library-home button')).find((button) => button.textContent.includes('选择本地资料')).click(); true");
  await waitForUiUntil(app, "Boolean(document.querySelector('.document-review')) && !document.querySelector('.document-review-footer button.primary-button')?.disabled", 180_000);
  const parseDurationMs = Date.now() - parseStartedAt;
  const firstPreview = await app.renderer.evaluate(`(() => ({
    title: document.querySelector('.document-metadata-editor input')?.value ?? '',
    summary: document.querySelector('.document-summary-bar')?.innerText ?? '',
    warnings: document.querySelector('.document-warnings')?.innerText ?? '',
    batch: document.querySelector('.document-review-footer')?.innerText ?? '',
    headings: Array.from(document.querySelectorAll('.document-reader aside li span')).slice(0, 8).map((item) => item.textContent ?? ''),
  }))()`);
  await captureScreenshot(app, join(reviewDirectory, '01-first-book-preview.png'));
  report.steps.push({ step: 'parse-two-books', result: 'ok', durationMs: parseDurationMs, firstPreview });

  const firstSaveStartedAt = Date.now();
  await app.renderer.evaluate("document.querySelector('.document-review-footer button.primary-button').click(); true");
  await waitForUiUntil(app, "document.querySelector('.document-library-header p')?.textContent?.includes('批量预览 2 / 2') === true && !document.querySelector('.document-review-footer button.primary-button')?.disabled", 120_000);
  const secondPreview = await app.renderer.evaluate(`(() => ({
    title: document.querySelector('.document-metadata-editor input')?.value ?? '',
    summary: document.querySelector('.document-summary-bar')?.innerText ?? '',
    warnings: document.querySelector('.document-warnings')?.innerText ?? '',
    batch: document.querySelector('.document-review-footer')?.innerText ?? '',
    headings: Array.from(document.querySelectorAll('.document-reader aside li span')).slice(0, 8).map((item) => item.textContent ?? ''),
  }))()`);
  await captureScreenshot(app, join(reviewDirectory, '02-second-book-preview.png'));
  report.steps.push({
    step: 'confirm-first-book', result: 'ok', durationMs: Date.now() - firstSaveStartedAt, secondPreview,
  });

  const secondSaveStartedAt = Date.now();
  await app.renderer.evaluate("document.querySelector('.document-review-footer button.primary-button').click(); true");
  await waitForUiUntil(app, "Boolean(document.querySelector('.document-full-reader')) && !document.querySelector('.document-metadata-editor')", 120_000);
  const imported = await call(app, 'list()');
  const extractionQuality = [];
  for (const document of imported) {
    const sections = [];
    for (let offset = 0; offset < document.sectionCount; offset += 50) {
      sections.push(...await call(app, `listSections(${JSON.stringify(document.id)}, ${offset})`));
    }
    const counts = sections.map((section) => section.charCount);
    const searchTerm = document.sourceName.includes('Infra') ? 'Transformer' : 'Agent';
    const searchResult = await call(app, `search(${JSON.stringify(document.id)}, ${JSON.stringify(searchTerm)})`);
    extractionQuality.push({
      sourceName: document.sourceName,
      genericPageHeadings: sections.every((section) => /^第 \d+ 页$/.test(section.heading)),
      shortPageCount: counts.filter((count) => count < 200).length,
      averageCharactersPerPage: Math.round(counts.reduce((total, count) => total + count, 0) / counts.length),
      minimumCharactersPerPage: Math.min(...counts),
      maximumCharactersPerPage: Math.max(...counts),
      searchTerm,
      searchHitCount: searchResult.hits.length,
      searchHasMore: searchResult.hasMore,
      searchHitPositions: searchResult.hits.slice(0, 10).map((hit) => hit.position),
    });
  }
  report.steps.push({
    step: 'confirm-second-book', result: 'ok', durationMs: Date.now() - secondSaveStartedAt,
    imported: imported.map((document) => ({
      id: document.id,
      sourceName: document.sourceName,
      title: document.title,
      author: document.author,
      format: document.format,
      sectionCount: document.sectionCount,
      characterCount: document.charCount,
      warningCount: document.warningCount,
    })),
    extractionQuality,
  });
  await captureScreenshot(app, join(reviewDirectory, '03-final-book-after-import.png'));
  await app.renderer.evaluate("Array.from(document.querySelectorAll('.document-header-actions button')).find((button) => button.textContent === '返回资料库').click(); true");
  await waitForUiUntil(app, "document.querySelectorAll('.document-list li').length === 2", 60_000);
  await captureScreenshot(app, join(reviewDirectory, '03-library-after-import.png'));

  await app.renderer.evaluate("document.querySelector('.document-list li button').click(); true");
  await waitForUiUntil(app, "Boolean(document.querySelector('.document-full-reader pre'))", 60_000);
  await captureScreenshot(app, join(reviewDirectory, '04-reader-first-open.png'));
  const readerState = await app.renderer.evaluate(`(() => ({
    header: document.querySelector('.document-full-reader article header')?.innerText ?? '',
    directory: document.querySelector('.document-full-reader aside')?.innerText ?? '',
    aiAction: document.querySelector('.ai-generate-section')?.textContent ?? '',
  }))()`);
  report.steps.push({ step: 'open-reader', result: 'ok', readerState });

  await app.renderer.evaluate(`(() => {
    const input = document.getElementById('document-search-input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Transformer');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitForUi(app, "document.querySelector('.document-reader-search button')?.disabled === false");
  await app.renderer.evaluate("document.querySelector('.document-reader-search button').click(); true");
  await waitForUiUntil(app, "Boolean(document.querySelector('.document-search-results'))", 60_000);
  await captureScreenshot(app, join(reviewDirectory, '04b-reader-search-results.png'));
  report.steps.push({
    step: 'search-book', result: 'ok', query: 'Transformer',
    summary: await app.renderer.evaluate("document.querySelector('.document-search-results strong')?.textContent ?? ''"),
  });

  await app.renderer.evaluate("document.querySelector('.ai-generate-section').click(); true");
  await waitForUi(app, "Boolean(document.querySelector('.ai-settings-dialog'))");
  await captureScreenshot(app, join(reviewDirectory, '05-ai-settings-interruption.png'));
  report.steps.push({
    step: 'request-ai-without-settings', result: 'settings-required',
    message: await app.renderer.evaluate("document.querySelector('.notice')?.textContent ?? ''"),
  });
  await app.renderer.evaluate("document.querySelector('[aria-label=\"关闭 AI 设置\"]').click(); true");
  await waitForUi(app, "!document.querySelector('.ai-settings-dialog')");

  await apiCall(app, 'ai', `saveSettings(${JSON.stringify({
    model: 'deepseek-flash', apiKey: 'sk-private-review-placeholder',
  })})`);
  await app.renderer.evaluate("document.querySelector('.ai-generate-section').click(); true");
  await waitForUiUntil(app, "Boolean(document.querySelector('.ai-scope-dialog'))", 60_000);
  await captureScreenshot(app, join(reviewDirectory, '06-ai-scope-empty-graph.png'));
  report.steps.push({
    step: 'open-ai-scope', result: 'ok',
    details: await app.renderer.evaluate(`(() => ({
      needsGraph: Boolean(document.querySelector('.ai-new-graph')),
      sectionOptionCount: document.querySelectorAll('#ai-range-start option').length,
      range: document.querySelector('.ai-range-summary span:nth-child(1) strong')?.textContent ?? '',
      characters: document.querySelector('.ai-range-summary span:nth-child(2) strong')?.textContent ?? '',
      batches: document.querySelector('.ai-range-summary span:nth-child(3) strong')?.textContent ?? '',
      privacyNotice: document.querySelector('.ai-privacy-note strong')?.textContent ?? '',
    }))()`),
  });

  await app.renderer.evaluate(`(() => {
    const input = document.getElementById('ai-new-graph-name');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'AI Agent 学习路线');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitForUi(app, "Array.from(document.querySelectorAll('.ai-new-graph button')).some((button) => !button.disabled)");
  await app.renderer.evaluate("document.querySelector('.ai-new-graph button').click(); true");
  await waitForUiUntil(app, "Boolean(document.querySelector('#ai-target-graph')?.value) && !document.querySelector('.ai-new-graph')", 60_000);
  await app.renderer.evaluate("document.querySelector('.ai-scope-dialog > footer .primary-button').click(); true");
  await waitForUiUntil(app, "Boolean(document.querySelector('.ai-generation-dialog'))", 60_000);
  await captureScreenshot(app, join(reviewDirectory, '07-deepseek-send-confirmation.png'));
  report.steps.push({
    step: 'reach-send-confirmation', result: 'stopped-before-upload',
    details: await app.renderer.evaluate(`(() => ({
      targetGraph: document.querySelector('.ai-upload-summary span:nth-child(1) strong')?.textContent ?? '',
      document: document.querySelector('.ai-upload-summary span:nth-child(2) strong')?.textContent ?? '',
      model: document.querySelector('.ai-upload-summary span:nth-child(3) strong')?.textContent ?? '',
      range: document.querySelector('.ai-upload-summary span:nth-child(4) strong')?.textContent ?? '',
      requiresConsent: Boolean(document.querySelector('.ai-consent input[type=checkbox]')),
      sendDisabled: document.querySelector('.ai-generation-dialog .primary-button')?.disabled ?? false,
    }))()`),
  });
  await app.renderer.evaluate("Array.from(document.querySelectorAll('.ai-generation-dialog button')).find((button) => button.textContent === '暂不发送').click(); true");
  await waitForUi(app, "!document.querySelector('.ai-generation-dialog')");
  await apiCall(app, 'ai', 'clearApiKey()');

  await mkdir(reviewDirectory, { recursive: true });
  const reportPath = join(reviewDirectory, 'session.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`通过：两本真实书的初学者导入流程已走到 DeepSeek 发送确认前（${parseDurationMs}ms）`);
  console.log(`体验记录：${reportPath}`);
}

async function checkFile(app, sample) {
  await selectFile(app, sample.path);
  const preview = (await call(app, 'chooseFiles()')).previews[0];
  assert.equal(preview.format, sample.format);
  assert.equal(preview.canImport, true, preview.blockedReason ?? '无法导入');
  assert(preview.sections.some((item) => item.content.includes(sample.text)), `${sample.format} 预览缺少预期正文`);
  const imported = await call(app, `confirmImport(${JSON.stringify(makeMetadata(preview))})`);
  const section = await call(app, `getSection(${JSON.stringify(imported.id)}, 0, 0)`);
  assert(section.content.includes(sample.text), `${sample.format} 保存结果缺少预期正文`);
  const duplicate = (await call(app, 'chooseFiles()')).previews[0];
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
      { name: '笔记.txt', format: 'TEXT', data: '第一章 初识模型\n\n模型从数据中学习规律，并通过损失函数评估预测误差。', text: '模型从数据中学习规律' },
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
    await waitForUi(app, "Boolean(document.querySelector('.onboarding-welcome'))");
    assert(await app.renderer.evaluate("document.querySelector('.onboarding-welcome')?.textContent?.includes('不会要求你现在配置 DeepSeek') === true"));
    assert.equal(await app.renderer.evaluate("Boolean(document.querySelector('.onboarding-welcome input[type=password]'))"), false);
    if (globalThis.process.argv.includes('--screenshot')) {
      const screenshot = await app.renderer.send('Page.captureScreenshot', { format: 'png' });
      const screenshotDirectory = resolve('test-data/private');
      await mkdir(screenshotDirectory, { recursive: true });
      await writeFile(join(screenshotDirectory, 'smoke-onboarding.png'), Buffer.from(screenshot.data, 'base64'));
    }
    await app.renderer.evaluate("Array.from(document.querySelectorAll('.onboarding-start-options button')).find((button) => button.textContent.includes('体验完整示例')).click(); true");
    await waitForUi(app, "document.querySelector('.graph-name')?.value === '示例：机器学习入门' && document.querySelectorAll('.react-flow__node').length === 3");
    assert(await app.renderer.evaluate("document.querySelector('.graph-list-title')?.textContent?.includes('示例') === true"));
    await app.renderer.evaluate("document.querySelector('.onboarding-launch').click(); true");
    await waitForUi(app, "Boolean(document.querySelector('.onboarding-checklist'))");
    assert.equal(await app.renderer.evaluate("document.querySelector('[aria-label=\"上手任务进度\"]')?.getAttribute('aria-valuenow')"), '50');
    await app.renderer.evaluate("document.querySelector('.onboarding-delete-sample').click(); true");
    await waitForUi(app, "Boolean(document.querySelector('[role=alertdialog]'))");
    await app.renderer.evaluate("Array.from(document.querySelectorAll('[role=alertdialog] button')).find((button) => button.textContent.includes('删除示例图谱')).click(); true");
    await waitForUi(app, "!document.querySelector('.graph-name') && !document.querySelector('[role=alertdialog]')");
    assert.equal((await apiCall(app, 'graphs', 'list()')).length, 0);
    console.log('通过：首次欢迎、示例体验、任务进度和示例安全删除');

    if (globalThis.process.argv.includes('--review-private-books')) {
      await reviewPrivateBooks(app);
      return;
    }

    await selectFiles(app, [samples[2].path, samples[3].path]);
    const batchSelection = await call(app, 'chooseFiles()');
    assert.equal(batchSelection.previews.length, 2);
    assert.equal(batchSelection.failures.length, 0);
    const batchImports = [];
    for (const preview of batchSelection.previews) {
      batchImports.push(await call(app, `confirmImport(${JSON.stringify(makeMetadata(preview))})`));
    }
    for (const imported of batchImports) await call(app, `delete(${JSON.stringify(imported.id)})`);
    console.log('通过：一次选择两份资料后均完成解析、预览和确认');

    await selectFiles(app, [samples[2].path, badPdf]);
    const partialSelection = await call(app, 'chooseFiles()');
    assert.equal(partialSelection.previews.length, 1);
    assert.equal(partialSelection.failures.length, 1);
    assert.match(partialSelection.failures[0].message, /不是有效的 PDF/);
    await call(app, `discardPreview(${JSON.stringify(partialSelection.previews[0].previewToken)})`);
    console.log('通过：批量选择中单个文件失败不会阻止其他资料预览');

    await selectFile(app, longPath);
    const longPreview = (await call(app, 'chooseFiles()')).previews[0];
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
    const scanPreview = (await call(app, 'chooseFiles()')).previews[0];
    assert.equal(scanPreview.canImport, false);
    assert.match(scanPreview.blockedReason, /OCR/);
    for (const [path, expected] of [[badEpub, 'EPUB 文件损坏'], [badPdf, '不是有效的 PDF'], [malformedPdf, 'PDF 解析失败']]) {
      await selectFile(app, path);
      const selection = await call(app, 'chooseFiles()');
      const result = selection.failures[0]?.message ?? '';
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

    await app.renderer.evaluate("Array.from(document.querySelectorAll('.document-header-actions button')).find((button) => button.textContent === 'AI 设置').click(); true");
    await waitForUi(app, "Boolean(document.querySelector('.ai-settings-dialog'))");
    assert(await app.renderer.evaluate(`(() => {
      const dialog = document.querySelector('.ai-settings-dialog');
      const rect = dialog.getBoundingClientRect();
      const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.width > 400 && rect.height > 200 && dialog.contains(topElement)
        && Number(getComputedStyle(dialog.parentElement).zIndex) > Number(getComputedStyle(document.querySelector('.assessment-backdrop')).zIndex);
    })()`), 'AI 设置对话框没有显示在资料库上方');
    await app.renderer.evaluate("document.querySelector('[aria-label=\"关闭 AI 设置\"]').click(); true");
    await waitForUi(app, "!document.querySelector('.ai-settings-dialog')");
    console.log('通过：AI 设置对话框完整显示在资料库上方');

    const savedAiSettings = await apiCall(app, 'ai', `saveSettings(${JSON.stringify({
      model: 'deepseek-flash', apiKey: 'sk-packaged-smoke-only',
    })})`);
    assert.equal(savedAiSettings.configured, true);
    assert.equal(savedAiSettings.secureStorageAvailable, true);
    await waitForUi(app, "document.querySelector('.ai-generate-section')?.disabled === false");
    await app.renderer.evaluate("document.querySelector('.ai-generate-section').click(); true");
    await waitForUi(app, "Boolean(document.querySelector('.ai-scope-dialog') || document.querySelector('.document-reader-error'))");
    const aiScopeError = await app.renderer.evaluate("document.querySelector('.document-reader-error')?.textContent ?? ''");
    assert(await app.renderer.evaluate("Boolean(document.querySelector('.ai-scope-dialog'))"), aiScopeError);
    assert(await app.renderer.evaluate("document.querySelector('.ai-scope-dialog')?.textContent?.includes('现在还不会发送任何正文') === true"));
    assert(await app.renderer.evaluate("Boolean(document.querySelector('#ai-target-graph')?.value)"));
    await app.renderer.evaluate("document.querySelector('.ai-scope-dialog > footer .primary-button').click(); true");
    await waitForUi(app, "Boolean(document.querySelector('.ai-generation-dialog') || document.querySelector('.document-reader-error'))");
    const aiPreviewError = await app.renderer.evaluate("document.querySelector('.document-reader-error')?.textContent ?? ''");
    assert(await app.renderer.evaluate("Boolean(document.querySelector('.ai-generation-dialog'))"), aiPreviewError);
    assert(await app.renderer.evaluate("document.querySelector('.ai-generation-dialog')?.textContent?.includes('这一步会把上述正文发送给 DeepSeek') === true"));
    assert(await app.renderer.evaluate("document.querySelector('.ai-generation-dialog .primary-button')?.disabled === true"));
    await app.renderer.evaluate("Array.from(document.querySelectorAll('.ai-generation-dialog button')).find((button) => button.textContent === '暂不发送').click(); true");
    await waitForUi(app, "!document.querySelector('.ai-generation-dialog')");
    assert.equal((await apiCall(app, 'ai', 'clearApiKey()')).configured, false);
    console.log('通过：正式 EXE 可安全保存密钥并在上传前展示确认范围');

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
    await waitForUi(app, "document.querySelector('.candidate-from-selection')?.textContent?.includes('加入路线预览') === true");
    await app.renderer.evaluate("document.querySelector('.candidate-from-selection').click(); true");
    await waitForUi(app, "Boolean(document.querySelector('.candidate-workspace'))");
    const firstWorkspace = await apiCall(app, 'candidates', `getWorkspace(${JSON.stringify(candidateGraph.id)})`);
    assert.equal(firstWorkspace.pendingConceptCount, 1);
    assert.equal(firstWorkspace.concepts[0].sourceQuote, '模型');
    await app.renderer.evaluate("document.querySelector('[aria-label=\"关闭学习路线预览\"]').click(); true");
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

    await app.renderer.evaluate("Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '学习路线预览').click(); true");
    await waitForUi(app, "document.querySelectorAll('.candidate-card').length === 2 && document.querySelectorAll('.candidate-relation-list li').length === 1");
    await app.renderer.evaluate("Array.from(document.querySelectorAll('.candidate-workspace > footer button')).find((button) => button.textContent.includes('加入')).click(); true");
    await waitForUi(app, "Boolean(document.querySelector('[role=alertdialog]'))");
    await app.renderer.evaluate("Array.from(document.querySelectorAll('[role=alertdialog] button')).find((button) => button.textContent.includes('加入学习路线')).click(); true");
    await waitForUi(app, "document.querySelector('.candidate-workspace > footer')?.textContent?.includes('没有待加入内容') === true");
    const acceptedGraph = await apiCall(app, 'graphs', `load(${JSON.stringify(candidateGraph.id)})`);
    assert.equal(acceptedGraph.nodes.length, 2);
    assert.equal(acceptedGraph.edges.length, 1);
    candidateWorkspace = await apiCall(app, 'candidates', `getWorkspace(${JSON.stringify(candidateGraph.id)})`);
    assert.equal(candidateWorkspace.pendingConceptCount, 0);
    assert(candidateWorkspace.concepts.every((item) => item.status === 'ACCEPTED'));
    console.log('通过：界面原文选区、候选关系审核与事务写入');

    await app.renderer.evaluate("Array.from(document.querySelectorAll('.candidate-workspace > footer button')).find((button) => button.textContent.includes('完成，返回图谱')).click(); true");
    await waitForUi(app, "!document.querySelector('.candidate-workspace')");
    await app.renderer.evaluate("document.querySelector('[aria-label=\"关闭资料库\"]').click(); true");
    await waitForUi(app, "Boolean(document.querySelector('.graph-progress-overview'))");
    assert(await app.renderer.evaluate("document.querySelector('.graph-progress-overview')?.textContent?.includes('0 / 2 个概念已掌握') === true"));
    assert(await app.renderer.evaluate("document.querySelector('.graph-progress-overview')?.textContent?.includes('题库覆盖，不计入进度') === true"));
    assert.equal(await app.renderer.evaluate("document.querySelector('[aria-label=\"图谱学习进度\"]')?.getAttribute('aria-valuenow')"), '0');
    console.log('通过：主界面与侧栏按 Evidence 口径展示图谱学习进度');
    if (globalThis.process.argv.includes('--screenshot')) {
      const screenshot = await app.renderer.send('Page.captureScreenshot', { format: 'png' });
      const screenshotDirectory = resolve('test-data/private');
      const screenshotPath = join(screenshotDirectory, 'smoke-progress.png');
      await mkdir(screenshotDirectory, { recursive: true });
      await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
      console.log(`截图：${screenshotPath}`);
    }

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
