import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export class AiGenerationRepository {
  constructor(private readonly database: DatabaseSync) {}

  start(input: {
    graphId: string;
    documentId: string;
    documentTitle: string;
    model: string;
    sectionPositions: number[];
    sourceCharCount: number;
  }): string {
    const id = randomUUID();
    this.database.prepare(
      `INSERT INTO ai_generation_runs
       (id, graph_id, document_id, document_title, provider, model,
        section_positions_json, source_char_count, status, prompt_tokens,
        completion_tokens, concept_count, relationship_count, error_message,
        created_at, completed_at)
       VALUES (?, ?, ?, ?, 'DEEPSEEK', ?, ?, ?, 'IN_PROGRESS', NULL, NULL, NULL, NULL, NULL, ?, NULL)`,
    ).run(
      id, input.graphId, input.documentId, input.documentTitle, input.model,
      JSON.stringify(input.sectionPositions), input.sourceCharCount, new Date().toISOString(),
    );
    return id;
  }

  succeed(id: string, input: {
    promptTokens: number | null;
    completionTokens: number | null;
    conceptCount: number;
    relationshipCount: number;
  }): void {
    this.database.prepare(
      `UPDATE ai_generation_runs
       SET status = 'SUCCEEDED', prompt_tokens = ?, completion_tokens = ?,
           concept_count = ?, relationship_count = ?, completed_at = ?
       WHERE id = ? AND status = 'IN_PROGRESS'`,
    ).run(
      input.promptTokens, input.completionTokens, input.conceptCount,
      input.relationshipCount, new Date().toISOString(), id,
    );
  }

  fail(id: string, message: string, usage?: {
    promptTokens: number | null;
    completionTokens: number | null;
  }): void {
    this.database.prepare(
      `UPDATE ai_generation_runs
       SET status = 'FAILED', prompt_tokens = ?, completion_tokens = ?,
           error_message = ?, completed_at = ?
       WHERE id = ? AND status = 'IN_PROGRESS'`,
    ).run(
      usage?.promptTokens ?? null,
      usage?.completionTokens ?? null,
      message.slice(0, 1_000),
      new Date().toISOString(),
      id,
    );
  }

  cancel(id: string): void {
    this.finish(id, 'CANCELLED', null);
  }

  private finish(id: string, status: 'FAILED' | 'CANCELLED', message: string | null): void {
    this.database.prepare(
      `UPDATE ai_generation_runs
       SET status = ?, error_message = ?, completed_at = ?
       WHERE id = ? AND status = 'IN_PROGRESS'`,
    ).run(status, message?.slice(0, 1_000) ?? null, new Date().toISOString(), id);
  }
}
