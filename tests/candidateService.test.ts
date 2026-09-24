// @vitest-environment node
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/database/database';
import { CandidateRepository } from '../src/main/repositories/candidateRepository';
import { DocumentRepository } from '../src/main/repositories/documentRepository';
import { GraphRepository } from '../src/main/repositories/graphRepository';
import { CandidateService } from '../src/main/services/candidateService';
import { DocumentService } from '../src/main/services/documentService';

const directories: string[] = [];

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'openlearngraph-candidate-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'data.sqlite3'));
  const graphRepository = new GraphRepository(database);
  const documentRepository = new DocumentRepository(database);
  const documentService = new DocumentService(documentRepository);
  const graph = graphRepository.create('机器学习');
  const filePath = join(directory, 'guide.md');
  const content = '# 基础\n\n线性回归使用损失函数衡量预测误差。梯度下降可以优化损失函数。';
  writeFileSync(filePath, content, 'utf8');
  const preview = await documentService.previewFile(filePath);
  const document = await documentService.confirmImport({
    previewToken: preview.previewToken,
    title: preview.title,
    author: '', publisher: '', language: 'zh-CN', identifier: '',
  });
  const candidateService = new CandidateService(new CandidateRepository(database, graphRepository));
  return { database, graphRepository, documentRepository, candidateService, graph, document };
}

describe('candidate graph review service', () => {
  it('keeps exact source citations, reviews relationships, and applies atomically', async () => {
    const { database, graphRepository, candidateService, graph, document } = await setup();
    const section = database.prepare(
      'SELECT content FROM imported_document_sections WHERE document_id = ? AND position = 0',
    ).get(document.id) as { content: string };
    const firstQuote = '线性回归使用损失函数衡量预测误差';
    const secondQuote = '梯度下降可以优化损失函数';
    const firstStart = section.content.indexOf(firstQuote);
    const secondStart = section.content.indexOf(secondQuote);

    candidateService.createConcept({
      graphId: graph.id,
      documentId: document.id,
      sectionPosition: 0,
      sourceStartOffset: firstStart,
      sourceEndOffset: firstStart + firstQuote.length,
      name: '线性回归',
      description: '用线性函数拟合数据。',
    });
    let workspace = candidateService.createConcept({
      graphId: graph.id,
      documentId: document.id,
      sectionPosition: 0,
      sourceStartOffset: secondStart,
      sourceEndOffset: secondStart + secondQuote.length,
      name: '梯度下降',
      description: '迭代优化方法。',
    });
    expect(workspace.concepts.map((item) => item.sourceQuote)).toEqual(expect.arrayContaining([firstQuote, secondQuote]));
    const first = workspace.concepts.find((item) => item.name === '线性回归') as typeof workspace.concepts[number];
    const second = workspace.concepts.find((item) => item.name === '梯度下降') as typeof workspace.concepts[number];
    expect(first.reviewedAt).toBeNull();
    workspace = candidateService.reviewConcept({ candidateId: first.id, status: 'PENDING' });
    expect(workspace.concepts.find((item) => item.id === first.id)?.reviewedAt).toEqual(expect.any(String));
    workspace = candidateService.createRelationship({
      graphId: graph.id,
      sourceCandidateId: first.id,
      targetCandidateId: second.id,
    });
    expect(workspace).toMatchObject({ pendingConceptCount: 2, pendingRelationshipCount: 1, blockingIssues: [] });
    expect(() => candidateService.createRelationship({
      graphId: graph.id,
      sourceCandidateId: second.id,
      targetCandidateId: first.id,
    })).toThrow('循环');

    const result = candidateService.apply(graph.id);
    expect(result).toMatchObject({ acceptedConceptCount: 2, acceptedRelationshipCount: 1 });
    expect(result.graph.nodes.map((node) => node.name)).toEqual(expect.arrayContaining(['线性回归', '梯度下降']));
    expect(result.graph.edges).toHaveLength(1);
    expect(candidateService.getWorkspace(graph.id).concepts.every((item) => item.status === 'ACCEPTED')).toBe(true);
    expect(graphRepository.load(graph.id)?.nodes).toHaveLength(2);
    database.close();
  });

  it('blocks duplicate names, preserves ignored history, and retains citation snapshots after source deletion', async () => {
    const { database, graphRepository, documentRepository, candidateService, graph, document } = await setup();
    graphRepository.save({
      id: graph.id,
      name: graph.name,
      nodes: [{
        id: '22222222-2222-4222-8222-222222222222',
        name: '线性回归', description: '', position: { x: 0, y: 0 },
      }],
      edges: [],
    });
    const source = '线性回归使用损失函数衡量预测误差';
    let workspace = candidateService.createConcept({
      graphId: graph.id, documentId: document.id, sectionPosition: 0,
      sourceStartOffset: 0, sourceEndOffset: source.length,
      name: ' 线性回归 ', description: '',
    });
    const candidate = workspace.concepts[0];
    expect(candidate.duplicateNodeName).toBe('线性回归');
    expect(workspace.blockingIssues[0]).toContain('重名');
    expect(() => candidateService.apply(graph.id)).toThrow('重名');
    workspace = candidateService.reviewConcept({ candidateId: candidate.id, status: 'IGNORED' });
    expect(workspace.concepts[0]).toMatchObject({ status: 'IGNORED', reviewedAt: expect.any(String) });
    documentRepository.delete(document.id);
    const retained = candidateService.getWorkspace(graph.id).concepts[0];
    expect(retained).toMatchObject({ documentId: null, documentTitle: '基础', status: 'IGNORED' });
    expect(retained.sourceQuote).toHaveLength(source.length);
    database.close();
  });

  it('rejects forged or stale source ranges', async () => {
    const { database, candidateService, graph, document } = await setup();
    expect(() => candidateService.createConcept({
      graphId: graph.id, documentId: document.id, sectionPosition: 0,
      sourceStartOffset: 0, sourceEndOffset: 9_999_999,
      name: '伪造候选', description: '',
    })).toThrow();
    database.close();
  });

  it('can safely restore a relationship that was ignored with a concept', async () => {
    const { database, candidateService, graph, document } = await setup();
    candidateService.createConcept({
      graphId: graph.id, documentId: document.id, sectionPosition: 0,
      sourceStartOffset: 0, sourceEndOffset: 4, name: '线性回归', description: '',
    });
    let workspace = candidateService.createConcept({
      graphId: graph.id, documentId: document.id, sectionPosition: 0,
      sourceStartOffset: 17, sourceEndOffset: 21, name: '梯度下降', description: '',
    });
    const source = workspace.concepts.find((item) => item.name === '线性回归') as typeof workspace.concepts[number];
    const target = workspace.concepts.find((item) => item.name === '梯度下降') as typeof workspace.concepts[number];
    workspace = candidateService.createRelationship({
      graphId: graph.id, sourceCandidateId: source.id, targetCandidateId: target.id,
    });
    expect(workspace.pendingRelationshipCount).toBe(1);
    candidateService.reviewConcept({ candidateId: source.id, status: 'IGNORED' });
    candidateService.reviewConcept({ candidateId: source.id, status: 'PENDING' });
    workspace = candidateService.createRelationship({
      graphId: graph.id, sourceCandidateId: source.id, targetCandidateId: target.id,
    });
    expect(workspace.pendingRelationshipCount).toBe(1);
    expect(workspace.relationships).toHaveLength(1);
    expect(workspace.relationships[0].status).toBe('PENDING');
    database.close();
  });

  it('blocks legacy AI relationships that have no reviewable reason or evidence', async () => {
    const { database, candidateService, graph, document } = await setup();
    candidateService.createConcept({
      graphId: graph.id, documentId: document.id, sectionPosition: 0,
      sourceStartOffset: 0, sourceEndOffset: 4, name: '线性回归', description: '',
    });
    let workspace = candidateService.createConcept({
      graphId: graph.id, documentId: document.id, sectionPosition: 0,
      sourceStartOffset: 17, sourceEndOffset: 21, name: '梯度下降', description: '',
    });
    const source = workspace.concepts.find((item) => item.name === '线性回归') as typeof workspace.concepts[number];
    const target = workspace.concepts.find((item) => item.name === '梯度下降') as typeof workspace.concepts[number];
    workspace = candidateService.createRelationship({
      graphId: graph.id, sourceCandidateId: source.id, targetCandidateId: target.id,
    });
    database.prepare("UPDATE candidate_relationships SET origin = 'AI' WHERE id = ?")
      .run(workspace.relationships[0].id);

    const legacy = candidateService.getWorkspace(graph.id);
    expect(legacy.relationships[0]).toMatchObject({ origin: 'AI', reason: '', evidenceQuote: '' });
    expect(legacy.blockingIssues).toContain('有旧版 AI 学习顺序缺少可核对的原因或原文依据，请移除后重新生成');
    expect(() => candidateService.apply(graph.id)).toThrow('旧版 AI 学习顺序');
    database.close();
  });

  it('uses Unicode code-point offsets for source citations', async () => {
    const { database, candidateService, graph, document } = await setup();
    database.prepare(
      'UPDATE imported_document_sections SET content = ?, char_count = ? WHERE document_id = ? AND position = 0',
    ).run('🧠模型从数据中学习', 8, document.id);
    const workspace = candidateService.createConcept({
      graphId: graph.id,
      documentId: document.id,
      sectionPosition: 0,
      sourceStartOffset: 1,
      sourceEndOffset: 3,
      name: '模型',
      description: '',
    });
    expect(workspace.concepts[0]).toMatchObject({
      sourceStartOffset: 1,
      sourceEndOffset: 3,
      sourceQuote: '模型',
    });
    database.close();
  });
});
