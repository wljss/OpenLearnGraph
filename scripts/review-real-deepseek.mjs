// Windows-only, opt-in acceptance check using the packaged app and the user's
// existing encrypted DeepSeek configuration. It creates pending candidates but
// never applies them to the formal graph.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executable = resolve('out/OpenLearnGraph-win32-x64/OpenLearnGraph.exe');
const sourcePath = resolve('test-data/private/books/AI-Infra-Book.pdf');
const graphName = '真实验收：AI Infra Transformer M7C v2';
const sectionPositions = [32, 33, 34, 35];
const timeoutMs = 30_000;

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

async function launch() {
  const rendererPort = await freePort();
  const mainPort = await freePort();
  const env = { ...globalThis.process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  const output = [];
  const process = spawn(executable, [
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
      if (await renderer.evaluate('Boolean(window.openLearnGraph?.ai)')) break;
      await delay(100);
    }
    assert(await renderer.evaluate('Boolean(window.openLearnGraph?.ai)'), 'preload AI 接口未加载');
    return { process, main, renderer };
  } catch (error) {
    main?.close();
    renderer?.close();
    process.kill();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${output.length ? `\nEXE 输出：\n${output.join('')}` : ''}`,
      { cause: error },
    );
  }
}

async function stop(app) {
  if (!app) return;
  if (app.process.exitCode === null) {
    try { await app.main.evaluate("process.mainModule.require('electron').app.quit(); true"); }
    catch { app.process.kill(); }
  }
  app.main.close();
  app.renderer.close();
  if (app.process.exitCode !== null) return;
  const exited = new Promise((done) => app.process.once('exit', done));
  await Promise.race([exited, delay(5_000).then(() => app.process.kill())]);
}

function apiCall(app, namespace, expression) {
  return app.renderer.evaluate(`window.openLearnGraph.${namespace}.${expression}`);
}

async function waitForUi(app, expression, waitMs = timeoutMs) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (await app.renderer.evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`等待界面状态超时：${expression}`);
}

async function captureCandidateWorkspace(app, graph) {
  const expectedWorkspace = await apiCall(app, 'candidates', `getWorkspace(${JSON.stringify(graph.id)})`);
  await waitForUi(app, "Boolean(document.querySelector('.graph-list'))");
  const graphVisible = await app.renderer.evaluate(`Array.from(document.querySelectorAll('.graph-list-name')).some((item) => item.textContent === ${JSON.stringify(graph.name)})`);
  if (!graphVisible) {
    await app.renderer.send('Page.reload', { ignoreCache: true });
    await waitForUi(app, "Boolean(window.openLearnGraph?.candidates && document.querySelector('.graph-list'))");
  }
  await app.renderer.evaluate(`(() => {
    const item = Array.from(document.querySelectorAll('.graph-list button'))
      .find((button) => button.querySelector('.graph-list-name')?.textContent === ${JSON.stringify(graph.name)});
    if (!item) throw new Error('找不到 M7C 验收图谱');
    item.click();
    return true;
  })()`);
  await waitForUi(app, `document.querySelector('[aria-label="图谱名称"]')?.value === ${JSON.stringify(graph.name)}`);
  await app.renderer.evaluate("document.querySelector('.document-library-launch').click(); true");
  await waitForUi(app, "Boolean(document.querySelector('.document-library'))");
  await app.renderer.evaluate("Array.from(document.querySelectorAll('.document-header-actions button')).find((button) => button.textContent === '学习路线预览').click(); true");
  await waitForUi(app, "Boolean(document.querySelector('.candidate-workspace'))");
  const review = await app.renderer.evaluate(`(() => ({
    concepts: document.querySelectorAll('.candidate-card.candidate-pending').length,
    relationships: document.querySelectorAll('.candidate-relations-section > .candidate-relation-list > li').length,
    explanations: Array.from(document.querySelectorAll('.candidate-relation-explanation p')).map((item) => item.textContent.trim()),
    evidenceCount: document.querySelectorAll('.candidate-relation-evidence').length,
    warningCount: document.querySelectorAll('.candidate-relation-warning').length,
    blockingText: document.querySelector('.candidate-issues')?.textContent?.trim() ?? '',
    applyDisabled: document.querySelector('.candidate-workspace > footer .primary-button')?.disabled ?? true,
  }))()`);
  assert.equal(review.concepts, expectedWorkspace.pendingConceptCount);
  assert.equal(review.relationships, expectedWorkspace.pendingRelationshipCount);
  assert.equal(review.explanations.filter(Boolean).length, expectedWorkspace.pendingRelationshipCount);
  assert.equal(review.evidenceCount, expectedWorkspace.pendingRelationshipCount);
  assert.equal(review.warningCount, 0);
  assert.equal(review.blockingText, '');
  assert.equal(review.applyDisabled, false);
  const screenshot = await app.renderer.send('Page.captureScreenshot', { format: 'png' });
  const screenshotPath = resolve('test-data/private/beginner-review/real-deepseek-m7c-v2-review.png');
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  await app.renderer.evaluate("document.querySelector('.candidate-relations-section').scrollIntoView({ block: 'start' }); true");
  await delay(300);
  const relationshipScreenshot = await app.renderer.send('Page.captureScreenshot', { format: 'png' });
  const relationshipScreenshotPath = resolve('test-data/private/beginner-review/real-deepseek-m7c-v2-relations.png');
  await writeFile(relationshipScreenshotPath, Buffer.from(relationshipScreenshot.data, 'base64'));
  console.log(`界面验收通过：${review.concepts} 个概念、${review.relationships} 条带原因和依据的关系；截图：${screenshotPath}；${relationshipScreenshotPath}`);
}

async function selectFile(app, path) {
  await app.main.evaluate(`process.mainModule.require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(path)}] }); true`);
}

function importMetadata(preview) {
  return {
    previewToken: preview.previewToken,
    title: preview.title,
    author: preview.author,
    publisher: preview.publisher,
    language: preview.language,
    identifier: preview.identifier,
  };
}

async function ensureDocument(app) {
  const documents = await apiCall(app, 'documents', 'list()');
  const existing = documents.find((document) => document.sourceName === basename(sourcePath));
  if (existing) return apiCall(app, 'documents', `get(${JSON.stringify(existing.id)})`);

  await selectFile(app, sourcePath);
  const selection = await apiCall(app, 'documents', 'chooseFiles()');
  const preview = selection?.previews?.[0];
  if (!preview) throw new Error(selection?.failures?.[0]?.message ?? '真实测试资料无法解析');
  if (preview.duplicateDocumentId) {
    return apiCall(app, 'documents', `get(${JSON.stringify(preview.duplicateDocumentId)})`);
  }
  if (!preview.canImport) throw new Error(preview.blockedReason ?? '真实测试资料无法导入');
  return apiCall(app, 'documents', `confirmImport(${JSON.stringify(importMetadata(preview))})`);
}

async function ensureGraph(app) {
  const graphs = await apiCall(app, 'graphs', 'list()');
  const existing = graphs.find((graph) => graph.name === graphName);
  if (existing) return apiCall(app, 'graphs', `load(${JSON.stringify(existing.id)})`);
  return apiCall(app, 'graphs', `create(${JSON.stringify({ name: graphName })})`);
}

async function main() {
  assert.equal(globalThis.process.platform, 'win32', '此脚本只支持 Windows');
  let app;
  try {
    app = await launch();
    if (globalThis.process.argv.includes('--ui-only')) {
      const graph = await ensureGraph(app);
      await captureCandidateWorkspace(app, graph);
      return;
    }
    const settings = await apiCall(app, 'ai', 'getSettings()');
    assert(settings.secureStorageAvailable, '当前 Windows 环境无法安全解密 DeepSeek Key');
    assert(settings.configured, '请先在正式应用的 AI 设置中保存 DeepSeek API Key');

    const connection = await apiCall(app, 'ai', 'testConnection()');
    console.log(`连接通过：${connection.model}，${connection.latencyMs}ms`);

    const document = await ensureDocument(app);
    const graph = await ensureGraph(app);
    const existingWorkspace = await apiCall(app, 'candidates', `getWorkspace(${JSON.stringify(graph.id)})`);
    if (existingWorkspace.pendingConceptCount > 0) {
      throw new Error(`测试图谱已有 ${existingWorkspace.pendingConceptCount} 个待审核候选，请先在应用中处理后再运行`);
    }

    const preview = await apiCall(app, 'ai', `previewCandidateGeneration(${JSON.stringify({
      graphId: graph.id,
      documentId: document.id,
      sectionPositions,
    })})`);
    assert.deepEqual(preview.sections.map((section) => section.position), sectionPositions);
    console.log(`发送范围：${preview.documentTitle}，第 33–36 页，${preview.totalCharCount} 字符，${preview.batchCount} 批`);

    const startedAt = Date.now();
    const result = await apiCall(app, 'ai', `generateCandidates(${JSON.stringify(preview.previewToken)})`);
    const durationMs = Date.now() - startedAt;
    const names = new Map(result.workspace.concepts.map((concept) => [concept.id, concept.name]));
    const report = {
      recordedAt: new Date().toISOString(),
      connection,
      source: {
        documentId: document.id,
        documentTitle: preview.documentTitle,
        sourceName: preview.documentSourceName,
        sectionPositions: preview.sections.map((section) => section.position),
        sectionLabels: preview.sections.map((section) => `${section.heading} · ${section.charCount} 字符`),
        totalCharCount: preview.totalCharCount,
        batchCount: preview.batchCount,
      },
      graph: { id: graph.id, name: graph.name },
      generation: {
        durationMs,
        provider: result.provider,
        model: result.model,
        conceptCount: result.conceptCount,
        relationshipCount: result.relationshipCount,
        batchCount: result.batchCount,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        mergeWarnings: result.mergeWarnings,
        blockingIssues: result.workspace.blockingIssues,
      },
      concepts: result.workspace.concepts.map((concept) => ({
        id: concept.id,
        name: concept.name,
        description: concept.description,
        locator: concept.sourceLocator,
        sourceQuote: concept.sourceQuote,
        sourceQuoteLength: Array.from(concept.sourceQuote).length,
        status: concept.status,
        duplicateNodeName: concept.duplicateNodeName,
      })),
      relationships: result.workspace.relationships.map((relationship) => ({
        source: names.get(relationship.sourceCandidateId) ?? relationship.sourceCandidateId,
        target: names.get(relationship.targetCandidateId) ?? relationship.targetCandidateId,
        reason: relationship.reason,
        origin: relationship.origin,
        locator: relationship.evidenceSourceLocator,
        evidenceQuote: relationship.evidenceQuote,
        evidenceQuoteLength: Array.from(relationship.evidenceQuote).length,
        status: relationship.status,
      })),
    };
    const reportDirectory = resolve('test-data/private/beginner-review');
    await mkdir(reportDirectory, { recursive: true });
    const reportPath = join(reportDirectory, 'real-deepseek-m7c-v2-session.json');
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`生成完成：${result.conceptCount} 个概念，${result.relationshipCount} 条关系，耗时 ${durationMs}ms`);
    console.log(`Token：输入 ${result.promptTokens ?? '未知'}，输出 ${result.completionTokens ?? '未知'}`);
    console.log(`候选保留在图谱“${graph.name}”的审核区，尚未写入正式图谱`);
    console.log(`私有验收记录：${reportPath}`);
    await captureCandidateWorkspace(app, graph);
  } finally {
    await stop(app);
  }
}

await main();
