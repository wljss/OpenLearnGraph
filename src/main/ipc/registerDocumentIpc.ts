import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { IPC_CHANNELS } from '../../shared/contracts';
import type { DocumentService } from '../services/documentService';

export function registerDocumentIpc(service: DocumentService): void {
  ipcMain.handle(IPC_CHANNELS.documentList, () => service.list());
  ipcMain.handle(IPC_CHANNELS.documentGet, (_event, documentId: unknown) => service.get(documentId));
  ipcMain.handle(IPC_CHANNELS.documentSectionList, (_event, documentId: unknown, offset: unknown) => (
    service.listSections(documentId, offset)
  ));
  ipcMain.handle(IPC_CHANNELS.documentSectionGet, (
    _event, documentId: unknown, position: unknown, offset: unknown,
  ) => service.getSection(documentId, position, offset));
  ipcMain.handle(IPC_CHANNELS.documentSearch, (_event, documentId: unknown, query: unknown) => (
    service.search(documentId, query)
  ));
  ipcMain.handle(IPC_CHANNELS.documentChoose, async (event) => {
    const options: OpenDialogOptions = {
      title: '选择要导入的本地资料',
      properties: ['openFile'],
      filters: [
        { name: '支持的资料', extensions: ['pdf', 'epub', 'md', 'markdown', 'txt'] },
        { name: 'PDF 文档', extensions: ['pdf'] },
        { name: 'EPUB 电子书', extensions: ['epub'] },
        { name: 'Markdown 与文本', extensions: ['md', 'markdown', 'txt'] },
      ],
    };
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return service.previewFile(result.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.documentImportConfirm, (_event, input: unknown) => service.confirmImport(input));
  ipcMain.handle(IPC_CHANNELS.documentPreviewDiscard, (_event, previewToken: unknown) => {
    service.discardPreview(previewToken);
  });
  ipcMain.handle(IPC_CHANNELS.documentDelete, (_event, documentId: unknown) => {
    service.delete(documentId);
  });
}
