import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/contracts';
import type { OnboardingService } from '../services/onboardingService';

export function registerOnboardingIpc(service: OnboardingService): void {
  ipcMain.handle(IPC_CHANNELS.onboardingStateGet, () => service.getState());
  ipcMain.handle(IPC_CHANNELS.onboardingStatusUpdate, (_event, input: unknown) => service.updateStatus(input));
  ipcMain.handle(IPC_CHANNELS.onboardingSampleCreate, () => service.createSample());
  ipcMain.handle(IPC_CHANNELS.onboardingSampleDelete, () => service.deleteSample());
}
