// @vitest-environment node
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/main/database/database';
import { CandidateRepository } from '../src/main/repositories/candidateRepository';
import { AiGenerationRepository } from '../src/main/repositories/aiGenerationRepository';
import { DocumentRepository } from '../src/main/repositories/documentRepository';
import { GraphRepository } from '../src/main/repositories/graphRepository';
import { AiService, type SecureStorageAdapter } from '../src/main/services/aiService';
import { DocumentService } from '../src/main/services/documentService';

const directories: string[] = [];

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

const secureStorage: SecureStorageAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
};

async function setup(fetchImpl: typeof fetch) {
  const directory = mkdtempSync(join(tmpdir(), 'openlearngraph-ai-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'data.sqlite3'));
  const graphRepository = new GraphRepository(database);
  const documentRepository = new DocumentRepository(database);
  const candidateRepository = new CandidateRepository(database, graphRepository);
  const graph = graphRepository.create('AI 学习');
  const filePath = join(directory, 'source.md');
  writeFileSync(filePath, '# 基础\n\n线性回归使用损失函数衡量预测误差。梯度下降通过迭代优化损失函数。', 'utf8');
  const documentService = new DocumentService(documentRepository);
  const preview = await documentService.previewFile(filePath);
  const document = await documentService.confirmImport({
    previewToken: preview.previewToken,
    title: preview.title,
    author: '', publisher: '', language: 'zh-CN', identifier: '',
  });
  const settingsPath = join(directory, 'settings', 'ai-settings.json');
  const service = new AiService(documentRepository, candidateRepository, new AiGenerationRepository(database), {
    settingsPath,
    secureStorage,
    fetchImpl,
  });
  return { database, graph, document, settingsPath, service, candidateRepository };
}

function generatedResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          concepts: [
            {
              key: 'linear_regression', name: '线性回归', description: '用线性函数拟合数据。',
              evidence: { sectionPosition: 0, quote: '线性回归使用损失函数衡量预测误差' },
            },
            {
              key: 'gradient_descent', name: '梯度下降', description: '迭代优化方法。',
              evidence: { sectionPosition: 0, quote: '梯度下降通过迭代优化损失函数' },
            },
          ],
          relationships: [{ sourceKey: 'linear_regression', targetKey: 'gradient_descent' }],
        }),
      },
    }],
    usage: { prompt_tokens: 321, completion_tokens: 87 },
    ...overrides,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('AiService', () => {
  it('encrypts the API key locally and tests the selected model without exposing the key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      object: 'list', data: [{ id: 'deepseek-flash', object: 'model', owned_by: 'deepseek' }],
    }), { status: 200 }));
    const { database, service, settingsPath } = await setup(fetchMock);
    expect(service.getSettings()).toMatchObject({ configured: false, model: 'deepseek-flash' });
    const saved = service.saveSettings({ model: 'deepseek-flash', apiKey: 'sk-secret-value' });
    expect(saved).toMatchObject({ configured: true, secureStorageAvailable: true });
    expect(readFileSync(settingsPath, 'utf8')).not.toContain('sk-secret-value');
    await expect(service.testConnection()).resolves.toMatchObject({ ok: true, model: 'deepseek-flash' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/models', expect.objectContaining({
      headers: { Authorization: 'Bearer sk-secret-value' },
    }));
    database.close();
  });

  it('requires an explicit source preview, verifies exact quotes, and creates only review candidates', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(generatedResponse());
    const { database, service, graph, document, candidateRepository } = await setup(fetchMock);
    service.saveSettings({ model: 'deepseek-flash', apiKey: 'sk-secret-value' });
    const preview = service.previewCandidateGeneration({
      graphId: graph.id,
      documentId: document.id,
      sectionPositions: [0],
    });
    expect(preview).toMatchObject({ documentId: document.id, model: 'deepseek-flash' });
    expect(preview.totalCharCount).toBeGreaterThan(20);
    const result = await service.generateCandidates(preview.previewToken);
    expect(result).toMatchObject({ conceptCount: 2, relationshipCount: 1, promptTokens: 321, completionTokens: 87 });
    expect(result.workspace.concepts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '线性回归', sourceQuote: '线性回归使用损失函数衡量预测误差', origin: 'AI', sourceModel: 'deepseek-flash', status: 'PENDING' }),
      expect.objectContaining({ name: '梯度下降', origin: 'AI', status: 'PENDING' }),
    ]));
    expect(result.workspace.relationships[0]).toMatchObject({ status: 'PENDING', relationship: 'PREREQUISITE' });
    expect(candidateRepository.workspace(graph.id).pendingConceptCount).toBe(2);
    expect(database.prepare(
      'SELECT status, model, prompt_tokens, completion_tokens, concept_count, relationship_count FROM ai_generation_runs',
    ).get()).toMatchObject({
      status: 'SUCCEEDED', model: 'deepseek-flash', prompt_tokens: 321,
      completion_tokens: 87, concept_count: 2, relationship_count: 1,
    });
    const request = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;
    expect(request).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, response_format: { type: 'json_object' } });
    expect(JSON.stringify(request)).toContain('线性回归');
    database.close();
  });

  it('rejects hallucinated citations without leaving partial candidates', async () => {
    const badResponse = generatedResponse({
      choices: [{
        finish_reason: 'stop',
        message: { content: JSON.stringify({
          concepts: [{
            key: 'fake', name: '伪造概念', description: '',
            evidence: { sectionPosition: 0, quote: '这句话并不存在于原文中' },
          }],
          relationships: [],
        }) },
      }],
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(badResponse);
    const { database, service, graph, document, candidateRepository } = await setup(fetchMock);
    service.saveSettings({ model: 'deepseek-flash', apiKey: 'sk-secret-value' });
    const preview = service.previewCandidateGeneration({ graphId: graph.id, documentId: document.id, sectionPositions: [0] });
    await expect(service.generateCandidates(preview.previewToken)).rejects.toThrow('无法在原文中找到');
    expect(candidateRepository.workspace(graph.id).concepts).toHaveLength(0);
    expect(database.prepare('SELECT status FROM ai_generation_runs').get()).toMatchObject({ status: 'FAILED' });
    database.close();
  });

  it('maps authentication failures and supports cancellation', async () => {
    const unauthorized = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
    const first = await setup(unauthorized);
    first.service.saveSettings({ model: 'deepseek-flash', apiKey: 'sk-invalid' });
    await expect(first.service.testConnection()).rejects.toThrow('API Key 无效');
    first.database.close();

    const pendingFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const second = await setup(pendingFetch);
    second.service.saveSettings({ model: 'deepseek-flash', apiKey: 'sk-secret-value' });
    const preview = second.service.previewCandidateGeneration({
      graphId: second.graph.id, documentId: second.document.id, sectionPositions: [0],
    });
    const generating = second.service.generateCandidates(preview.previewToken);
    second.service.cancelCandidateGeneration(preview.previewToken);
    await expect(generating).rejects.toThrow('已取消');
    expect(second.database.prepare('SELECT status FROM ai_generation_runs').get()).toMatchObject({ status: 'CANCELLED' });
    second.database.close();
  });
});
