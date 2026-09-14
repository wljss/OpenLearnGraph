import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/contracts';
import type { GraphService } from '../services/graphService';

export function registerGraphIpc(service: GraphService): void {
  ipcMain.handle(IPC_CHANNELS.graphList, () => service.list());
  ipcMain.handle(IPC_CHANNELS.graphCreate, (_event, input: unknown) => service.create(input));
  ipcMain.handle(IPC_CHANNELS.graphLoad, (_event, graphId: unknown) => service.load(graphId));
  ipcMain.handle(IPC_CHANNELS.graphSave, (_event, input: unknown) => service.save(input));
}
