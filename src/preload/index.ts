import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type CompleteDiagnosticInput,
  type CompleteLearningSessionInput,
  type CreateGraphInput,
  type OpenLearnGraphApi,
  type RecordLearningEvidenceInput,
  type RespondTutorDecisionInput,
  type SavePracticeAnswerInput,
  type SaveAssessmentQuestionInput,
  type SaveDiagnosticAnswerInput,
  type SaveGraphInput,
  type SaveLearningSessionDraftInput,
  type StartLearningSessionInput,
  type StartDiagnosticInput,
  type StartPracticeInput,
} from '../shared/contracts';

const api: OpenLearnGraphApi = {
  graphs: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.graphList),
    create: (input: CreateGraphInput) => ipcRenderer.invoke(IPC_CHANNELS.graphCreate, input),
    load: (graphId: string) => ipcRenderer.invoke(IPC_CHANNELS.graphLoad, graphId),
    save: (input: SaveGraphInput) => ipcRenderer.invoke(IPC_CHANNELS.graphSave, input),
  },
  learning: {
    listEvidence: (nodeId: string) => ipcRenderer.invoke(IPC_CHANNELS.learningEvidenceList, nodeId),
    recordEvidence: (input: RecordLearningEvidenceInput) => ipcRenderer.invoke(IPC_CHANNELS.learningEvidenceRecord, input),
  },
  assessments: {
    listQuestions: (nodeId: string) => ipcRenderer.invoke(IPC_CHANNELS.assessmentQuestionList, nodeId),
    saveQuestion: (input: SaveAssessmentQuestionInput) => ipcRenderer.invoke(IPC_CHANNELS.assessmentQuestionSave, input),
    deleteQuestion: (questionId: string) => ipcRenderer.invoke(IPC_CHANNELS.assessmentQuestionDelete, questionId),
    listDiagnosticAttempts: (graphId: string) => ipcRenderer.invoke(IPC_CHANNELS.diagnosticAttemptList, graphId),
    startDiagnostic: (input: StartDiagnosticInput) => ipcRenderer.invoke(IPC_CHANNELS.diagnosticStart, input),
    resumeDiagnostic: (attemptId: string) => ipcRenderer.invoke(IPC_CHANNELS.diagnosticResume, attemptId),
    saveDiagnosticAnswer: (input: SaveDiagnosticAnswerInput) => ipcRenderer.invoke(IPC_CHANNELS.diagnosticAnswerSave, input),
    cancelDiagnostic: (attemptId: string) => ipcRenderer.invoke(IPC_CHANNELS.diagnosticCancel, attemptId),
    getDiagnosticResult: (attemptId: string) => ipcRenderer.invoke(IPC_CHANNELS.diagnosticResultGet, attemptId),
    completeDiagnostic: (input: CompleteDiagnosticInput) => ipcRenderer.invoke(IPC_CHANNELS.diagnosticComplete, input),
  },
  tutor: {
    getRecommendation: (graphId: string) => ipcRenderer.invoke(IPC_CHANNELS.tutorRecommendationGet, graphId),
    listDecisions: (graphId: string) => ipcRenderer.invoke(IPC_CHANNELS.tutorDecisionList, graphId),
    respondDecision: (input: RespondTutorDecisionInput) => ipcRenderer.invoke(IPC_CHANNELS.tutorDecisionRespond, input),
  },
  sessions: {
    list: (graphId: string) => ipcRenderer.invoke(IPC_CHANNELS.learningSessionList, graphId),
    getActive: (graphId: string) => ipcRenderer.invoke(IPC_CHANNELS.learningSessionActiveGet, graphId),
    get: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.learningSessionGet, sessionId),
    start: (input: StartLearningSessionInput) => ipcRenderer.invoke(IPC_CHANNELS.learningSessionStart, input),
    saveDraft: (input: SaveLearningSessionDraftInput) => ipcRenderer.invoke(IPC_CHANNELS.learningSessionDraftSave, input),
    complete: (input: CompleteLearningSessionInput) => ipcRenderer.invoke(IPC_CHANNELS.learningSessionComplete, input),
    cancel: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.learningSessionCancel, sessionId),
  },
  practice: {
    list: (graphId: string) => ipcRenderer.invoke(IPC_CHANNELS.practiceAttemptList, graphId),
    getActive: (graphId: string) => ipcRenderer.invoke(IPC_CHANNELS.practiceAttemptActiveGet, graphId),
    get: (attemptId: string) => ipcRenderer.invoke(IPC_CHANNELS.practiceAttemptGet, attemptId),
    start: (input: StartPracticeInput) => ipcRenderer.invoke(IPC_CHANNELS.practiceAttemptStart, input),
    saveAnswer: (input: SavePracticeAnswerInput) => ipcRenderer.invoke(IPC_CHANNELS.practiceAnswerSave, input),
    complete: (attemptId: string) => ipcRenderer.invoke(IPC_CHANNELS.practiceAttemptComplete, attemptId),
    cancel: (attemptId: string) => ipcRenderer.invoke(IPC_CHANNELS.practiceAttemptCancel, attemptId),
  },
  lifecycle: {
    setUnsavedChanges: (hasUnsavedChanges: boolean) => {
      ipcRenderer.send(IPC_CHANNELS.setUnsavedChanges, hasUnsavedChanges);
    },
  },
};
contextBridge.exposeInMainWorld('openLearnGraph', api);
