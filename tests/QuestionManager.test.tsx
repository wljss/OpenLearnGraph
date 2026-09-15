import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AssessmentQuestionView, KnowledgeNodeView, OpenLearnGraphApi } from '../src/shared/contracts';
import { QuestionManager } from '../src/renderer/features/assessment/QuestionManager';

const node: KnowledgeNodeView = {
  id: '11111111-1111-4111-8111-111111111111',
  graphId: '22222222-2222-4222-8222-222222222222',
  name: '矩阵乘法',
  description: '',
  position: { x: 0, y: 0 },
  status: 'AVAILABLE',
  learningPhase: 'NOT_STARTED',
  statusReason: '可以开始学习。',
  evidenceCount: 0,
  lastEvidenceAt: null,
  latestEvidenceKind: null,
  latestEvidenceScoreEarned: null,
  latestEvidenceScorePossible: null,
  diagnosticQuestionCount: 0,
};

function installAssessmentApi(overrides: Partial<OpenLearnGraphApi['assessments']> = {}) {
  const assessments = {
    listQuestions: vi.fn().mockResolvedValue([]),
    saveQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    startDiagnostic: vi.fn(),
    cancelDiagnostic: vi.fn(),
    completeDiagnostic: vi.fn(),
    ...overrides,
  };
  window.openLearnGraph = { assessments } as unknown as OpenLearnGraphApi;
  return assessments;
}

describe('QuestionManager', () => {
  it('creates a validated question and updates the concept coverage count', async () => {
    const saved: AssessmentQuestionView = {
      id: '33333333-3333-4333-8333-333333333333',
      nodeId: node.id,
      prompt: '什么时候可以计算 AB？',
      explanation: 'A 的列数必须等于 B 的行数。',
      options: [
        { id: '44444444-4444-4444-8444-444444444444', text: 'A 的列数等于 B 的行数', isCorrect: true },
        { id: '55555555-5555-4555-8555-555555555555', text: 'A 的行数等于 B 的列数', isCorrect: false },
        { id: '66666666-6666-4666-8666-666666666666', text: '两个矩阵形状完全相同', isCorrect: false },
        { id: '77777777-7777-4777-8777-777777777777', text: '任何矩阵都可以', isCorrect: false },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const api = installAssessmentApi({ saveQuestion: vi.fn().mockResolvedValue(saved) });
    const onCount = vi.fn();
    render(<QuestionManager node={node} onClose={vi.fn()} onQuestionCountChange={onCount} onMessage={vi.fn()} />);
    await screen.findByText('还没有题目。先创建第一道单选题。');

    fireEvent.change(screen.getByLabelText('题目'), { target: { value: saved.prompt } });
    saved.options.forEach((option, index) => {
      fireEvent.change(screen.getByLabelText(`选项 ${index + 1}`), { target: { value: option.text } });
    });
    fireEvent.change(screen.getByLabelText('答案解析（可选）'), { target: { value: saved.explanation } });
    fireEvent.click(screen.getByRole('button', { name: '保存诊断题' }));

    await waitFor(() => expect(api.saveQuestion).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: node.id,
      prompt: saved.prompt,
      explanation: saved.explanation,
      options: saved.options.map(({ text, isCorrect }) => ({ text, isCorrect })),
    })));
    expect(onCount).toHaveBeenLastCalledWith(node.id, 1);
    expect(await screen.findByText(saved.prompt)).toBeVisible();
  });

  it('protects an unfinished question when the dialog is closed', async () => {
    installAssessmentApi();
    const onClose = vi.fn();
    render(<QuestionManager node={node} onClose={onClose} onQuestionCountChange={vi.fn()} onMessage={vi.fn()} />);
    await screen.findByText('还没有题目。先创建第一道单选题。');
    fireEvent.change(screen.getByLabelText('题目'), { target: { value: '尚未完成的问题' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭诊断题库' }));
    expect(screen.getByRole('alertdialog', { name: '放弃尚未保存的题目？' })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });
});
