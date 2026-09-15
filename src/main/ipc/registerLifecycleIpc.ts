import { ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS, unsavedChangesInputSchema } from '../../shared/contracts';

const webContentsWithUnsavedChanges = new WeakSet<WebContents>();

export function registerLifecycleIpc(): void {
  ipcMain.on(IPC_CHANNELS.setUnsavedChanges, (event, untrustedInput: unknown) => {
    const result = unsavedChangesInputSchema.safeParse(untrustedInput);
    if (!result.success) return;

    if (result.data) webContentsWithUnsavedChanges.add(event.sender);
    else webContentsWithUnsavedChanges.delete(event.sender);
  });
}

export function hasUnsavedChanges(webContents: WebContents): boolean {
  return webContentsWithUnsavedChanges.has(webContents);
}
