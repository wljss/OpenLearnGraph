import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type CreateGraphInput, type OpenLearnGraphApi, type SaveGraphInput } from '../shared/contracts';

const api: OpenLearnGraphApi = {
  graphs: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.graphList),
    create: (input: CreateGraphInput) => ipcRenderer.invoke(IPC_CHANNELS.graphCreate, input),
    load: (graphId: string) => ipcRenderer.invoke(IPC_CHANNELS.graphLoad, graphId),
    save: (input: SaveGraphInput) => ipcRenderer.invoke(IPC_CHANNELS.graphSave, input),
  },
  lifecycle: {
    setUnsavedChanges: (hasUnsavedChanges: boolean) => {
      ipcRenderer.send(IPC_CHANNELS.setUnsavedChanges, hasUnsavedChanges);
    },
  },
};
contextBridge.exposeInMainWorld('openLearnGraph', api);
