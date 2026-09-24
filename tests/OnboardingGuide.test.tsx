import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OnboardingStateView } from '../src/shared/contracts';
import { OnboardingGuide } from '../src/renderer/features/onboarding/OnboardingGuide';

const state: OnboardingStateView = {
  status: 'IN_PROGRESS',
  sampleGraphId: null,
  checklist: {
    hasGraph: true,
    hasConcept: true,
    hasRelationship: false,
    hasLearningSession: false,
    hasPractice: false,
    hasDiagnostic: false,
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderGuide(welcome: boolean, overrides: Partial<React.ComponentProps<typeof OnboardingGuide>> = {}) {
  const props: React.ComponentProps<typeof OnboardingGuide> = {
    state,
    welcome,
    busy: false,
    onClose: vi.fn(),
    onChooseManual: vi.fn(),
    onChooseImport: vi.fn(),
    onChooseSample: vi.fn(),
    onDismiss: vi.fn(),
    onReplayWelcome: vi.fn(),
    onReturnToChecklist: vi.fn(),
    onFinish: vi.fn(),
    onTaskAction: vi.fn(),
    onDeleteSample: vi.fn(),
    ...overrides,
  };
  render(<OnboardingGuide {...props} />);
  return props;
}

describe('OnboardingGuide', () => {
  it('offers three clear first-run paths without requesting an AI key', () => {
    const props = renderGuide(true, { state: { ...state, status: 'NOT_STARTED' } });
    expect(screen.getByRole('heading', { name: '把资料变成一条真正可学习的路线' })).toBeVisible();
    expect(screen.getByRole('button', { name: /导入本地资料/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /手工建立图谱/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /体验完整示例/ })).toBeVisible();
    expect(screen.getByText(/不会要求你现在配置 DeepSeek/)).toBeVisible();
    expect(screen.queryByPlaceholderText('输入 API Key')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /体验完整示例/ }));
    expect(props.onChooseSample).toHaveBeenCalledOnce();
  });

  it('shows the first incomplete real task and explains evidence semantics', () => {
    const props = renderGuide(false);
    expect(screen.getByRole('progressbar', { name: '上手任务进度' })).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByText('下一步：表达学习顺序')).toBeVisible();
    expect(screen.getByText('提供即时反馈，不替代客观诊断')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '建立关系' }));
    expect(props.onTaskAction).toHaveBeenCalledWith('hasRelationship');
  });

  it('only exposes sample deletion when a sample graph exists', () => {
    const onDeleteSample = vi.fn();
    renderGuide(false, { state: { ...state, sampleGraphId: crypto.randomUUID() }, onDeleteSample });
    fireEvent.click(screen.getByRole('button', { name: '删除示例图谱' }));
    expect(onDeleteSample).toHaveBeenCalledOnce();
  });

  it('replays the quick introduction without offering to dismiss an existing guide', () => {
    const onReplayWelcome = vi.fn();
    const checklist = renderGuide(false, { onReplayWelcome });
    fireEvent.click(screen.getByRole('button', { name: '重新查看快速介绍' }));
    expect(checklist.onReplayWelcome).toHaveBeenCalledOnce();

    const onReturnToChecklist = vi.fn();
    renderGuide(true, { onReturnToChecklist });
    expect(screen.getByText(/不会重置任务、图谱、学习记录或掌握进度/)).toBeVisible();
    expect(screen.queryByRole('button', { name: '暂不引导' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回任务指南' }));
    expect(onReturnToChecklist).toHaveBeenCalledOnce();
  });

  it('opens the existing sample instead of suggesting a duplicate', () => {
    const onChooseSample = vi.fn();
    renderGuide(false, {
      state: { ...state, sampleGraphId: crypto.randomUUID() },
      onChooseSample,
    });
    fireEvent.click(screen.getByRole('button', { name: '打开示例图谱' }));
    expect(onChooseSample).toHaveBeenCalledOnce();
  });
});
