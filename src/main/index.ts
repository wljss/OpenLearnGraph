import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database/database';
import { registerAssessmentIpc } from './ipc/registerAssessmentIpc';
import { registerGraphIpc } from './ipc/registerGraphIpc';
import { registerLearningIpc } from './ipc/registerLearningIpc';
import { hasUnsavedChanges, registerLifecycleIpc } from './ipc/registerLifecycleIpc';
import { registerTutorIpc } from './ipc/registerTutorIpc';
import { AssessmentRepository } from './repositories/assessmentRepository';
import { GraphRepository } from './repositories/graphRepository';
import { LearningRepository } from './repositories/learningRepository';
import { TutorRepository } from './repositories/tutorRepository';
import { AssessmentService } from './services/assessmentService';
import { GraphService } from './services/graphService';
import { LearningService } from './services/learningService';
import { TutorService } from './services/tutorService';

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
  let allowClose = false;
  window.on('close', (event) => {
    if (allowClose || !hasUnsavedChanges(window.webContents)) return;

    event.preventDefault();
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      title: '有尚未保存的更改',
      message: '当前知识图谱还有尚未保存的更改。',
      detail: '如果现在退出，这些更改将会丢失。',
      buttons: ['继续编辑', '放弃更改并退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice === 1) {
      allowClose = true;
      window.close();
    }
  });
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
  const graphRepository = new GraphRepository(database);
  const learningRepository = new LearningRepository(database);
  const assessmentRepository = new AssessmentRepository(database);
  registerGraphIpc(new GraphService(graphRepository));
  registerLearningIpc(new LearningService(learningRepository, graphRepository));
  registerAssessmentIpc(new AssessmentService(
    assessmentRepository,
    graphRepository,
    learningRepository,
  ));
  registerTutorIpc(new TutorService(
    new TutorRepository(database),
    graphRepository,
    assessmentRepository,
  ));
  registerLifecycleIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { database?.close(); database = undefined; });
