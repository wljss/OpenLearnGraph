import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database/database';
import { registerGraphIpc } from './ipc/registerGraphIpc';
import { GraphRepository } from './repositories/graphRepository';
import { GraphService } from './services/graphService';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let database: DatabaseSync | undefined;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640,
    backgroundColor: '#f4f6f8', title: 'OpenLearnGraph',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
}

void app.whenReady().then(() => {
  database = openDatabase(path.join(app.getPath('userData'), 'openlearngraph.sqlite3'));
  registerGraphIpc(new GraphService(new GraphRepository(database)));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { database?.close(); database = undefined; });
