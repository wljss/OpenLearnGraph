import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type CompleteDiagnosticInput,
  type CreateGraphInput,
  type OpenLearnGraphApi,
  type RecordLearningEvidenceInput,
  type SaveAssessmentQuestionInput,
  type SaveDiagnosticAnswerInput,
  type SaveGraphInput,
  type StartDiagnosticInput,
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
  lifecycle: {
    setUnsavedChanges: (hasUnsavedChanges: boolean) => {
      ipcRenderer.send(IPC_CHANNELS.setUnsavedChanges, hasUnsavedChanges);
    },
  },
};
contextBridge.exposeInMainWorld('openLearnGraph', api);
