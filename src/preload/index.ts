import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type CompleteDiagnosticInput,
  type CreateGraphInput,
  type OpenLearnGraphApi,
  type RecordLearningEvidenceInput,
  type SaveAssessmentQuestionInput,
  type SaveGraphInput,
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
    startDiagnostic: (graphId: string) => ipcRenderer.invoke(IPC_CHANNELS.diagnosticStart, graphId),
    cancelDiagnostic: (attemptId: string) => ipcRenderer.invoke(IPC_CHANNELS.diagnosticCancel, attemptId),
    completeDiagnostic: (input: CompleteDiagnosticInput) => ipcRenderer.invoke(IPC_CHANNELS.diagnosticComplete, input),
  },
  lifecycle: {
    setUnsavedChanges: (hasUnsavedChanges: boolean) => {
      ipcRenderer.send(IPC_CHANNELS.setUnsavedChanges, hasUnsavedChanges);
    },
  },
};
contextBridge.exposeInMainWorld('openLearnGraph', api);
