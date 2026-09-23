import type { OnboardingChecklistView, OnboardingStateView } from '../../../shared/contracts';

export type OnboardingTaskKey = keyof OnboardingChecklistView;

interface OnboardingGuideProps {
  state: OnboardingStateView;
  welcome: boolean;
  busy: boolean;
  onClose: () => void;
  onChooseManual: () => void;
  onChooseImport: () => void;
  onChooseSample: () => void;
  onDismiss: () => void;
  onFinish: () => void;
  onTaskAction: (task: OnboardingTaskKey) => void;
  onDeleteSample: () => void;
}

const TASKS: Array<{
  key: OnboardingTaskKey;
  title: string;
  description: string;
  action: string;
}> = [
  { key: 'hasGraph', title: '建立学习目标', description: '创建图谱、导入资料，或打开示例。', action: '创建图谱' },
  { key: 'hasConcept', title: '准备学习内容', description: '至少添加一个有名称和描述的概念。', action: '添加概念' },
  { key: 'hasRelationship', title: '表达学习顺序', description: '用先修关系说明应该先学什么。', action: '建立关系' },
  { key: 'hasLearningSession', title: '完成一次主动学习', description: '阅读、主动回忆，再留下自己的总结。', action: '开始学习' },
  { key: 'hasPractice', title: '完成一次形成性练习', description: '立即查看反馈，但不把练习冒充掌握。', action: '开始练习' },
  { key: 'hasDiagnostic', title: '用诊断确认掌握', description: '提交客观作答，让进度有证据可解释。', action: '开始诊断' },
];

function onboardingCompletedCount(checklist: OnboardingChecklistView): number {
  return TASKS.filter((task) => checklist[task.key]).length;
}

export function OnboardingGuide({
  state,
  welcome,
  busy,
  onClose,
  onChooseManual,
  onChooseImport,
  onChooseSample,
  onDismiss,
  onFinish,
  onTaskAction,
  onDeleteSample,
}: OnboardingGuideProps): React.JSX.Element {
  const completedCount = onboardingCompletedCount(state.checklist);
  const nextTask = TASKS.find((task) => !state.checklist[task.key]) ?? null;
  const percent = Math.round((completedCount / TASKS.length) * 100);

  return (
    <div className="onboarding-backdrop" role="presentation">
      <section
        className={`onboarding-dialog ${welcome ? 'onboarding-welcome' : 'onboarding-checklist'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        {welcome ? (
          <>
            <header className="onboarding-welcome-header">
              <span className="onboarding-logo" aria-hidden="true">OL</span>
              <div>
                <small>欢迎使用 OpenLearnGraph</small>
                <h2 id="onboarding-title">把资料变成一条真正可学习的路线</h2>
                <p>知识结构、学习记录和正文默认留在这台设备上。AI 只会在你明确选择范围并确认后使用。</p>
              </div>
            </header>
            <div className="onboarding-start-options">
              <button type="button" disabled={busy} onClick={onChooseImport}>
                <span aria-hidden="true">⇧</span>
                <strong>导入本地资料</strong>
                <p>从 PDF、EPUB、Markdown 或 TXT 开始，先在本机预览正文。</p>
                <em>适合已有书籍或笔记</em>
              </button>
              <button type="button" disabled={busy} onClick={onChooseManual}>
                <span aria-hidden="true">＋</span>
                <strong>手工建立图谱</strong>
                <p>自己命名学习目标，再逐步添加概念和先修关系。</p>
                <em>适合目标已经很明确</em>
              </button>
              <button type="button" disabled={busy} onClick={onChooseSample}>
                <span aria-hidden="true">◎</span>
                <strong>体验完整示例</strong>
                <p>创建一个带内容、关系和题目的机器学习示例，可随时删除。</p>
                <em>最快理解完整学习闭环</em>
              </button>
            </div>
            <footer className="onboarding-welcome-footer">
              <span>不会要求你现在配置 DeepSeek，也不会上传任何文件。</span>
              <button type="button" disabled={busy} onClick={onDismiss}>暂不引导</button>
            </footer>
          </>
        ) : (
          <>
            <header className="onboarding-guide-header">
              <div>
                <small>本机上手指南</small>
                <h2 id="onboarding-title">完成一次真实学习闭环</h2>
                <p>这里记录的是功能使用进度，不是知识掌握度。</p>
              </div>
              <button type="button" aria-label="关闭上手指南" disabled={busy} onClick={onClose}>×</button>
            </header>
            <div className="onboarding-guide-progress">
              <div><strong>{completedCount} / {TASKS.length}</strong><span>项已完成</span></div>
              <div role="progressbar" aria-label="上手任务进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <span style={{ width: `${percent}%` }} />
              </div>
              <b>{percent}%</b>
            </div>
            <div className="onboarding-guide-body">
              <ol className="onboarding-task-list">
                {TASKS.map((task, index) => {
                  const complete = state.checklist[task.key];
                  const current = nextTask?.key === task.key;
                  return (
                    <li key={task.key} className={`${complete ? 'complete' : ''} ${current ? 'current' : ''}`}>
                      <span>{complete ? '✓' : index + 1}</span>
                      <div><strong>{task.title}</strong><p>{task.description}</p></div>
                      {current && <button type="button" disabled={busy} onClick={() => onTaskAction(task.key)}>{task.action}</button>}
                    </li>
                  );
                })}
              </ol>
              <aside className="onboarding-guide-context">
                <span>理解进度</span>
                <h3>{nextTask ? `下一步：${nextTask.title}` : '你已经走通完整流程'}</h3>
                <p>{nextTask
                  ? nextTask.description
                  : '之后可以继续扩充路线；掌握进度仍只由自评或客观诊断证据决定。'}</p>
                <dl>
                  <div><dt>学习</dt><dd>形成理解和总结，不自动宣称掌握</dd></div>
                  <div><dt>练习</dt><dd>提供即时反馈，不替代客观诊断</dd></div>
                  <div><dt>诊断</dt><dd>达到阈值后形成客观掌握结论</dd></div>
                </dl>
                {state.sampleGraphId && (
                  <button className="onboarding-delete-sample" type="button" disabled={busy} onClick={onDeleteSample}>删除示例图谱</button>
                )}
              </aside>
            </div>
            <footer className="onboarding-guide-footer">
              <span>关闭后可从左侧“上手指南”继续。</span>
              <div>
                <button type="button" disabled={busy} onClick={onClose}>稍后继续</button>
                <button className="primary-button" type="button" disabled={busy} onClick={onFinish}>
                  {completedCount === TASKS.length ? '完成引导' : '结束引导'}
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
