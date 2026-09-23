import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database/database';
import { registerAssessmentIpc } from './ipc/registerAssessmentIpc';
import { registerAiIpc } from './ipc/registerAiIpc';
import { registerCandidateIpc } from './ipc/registerCandidateIpc';
import { registerDocumentIpc } from './ipc/registerDocumentIpc';
import { registerGraphIpc } from './ipc/registerGraphIpc';
import { registerLearningIpc } from './ipc/registerLearningIpc';
import { registerOnboardingIpc } from './ipc/registerOnboardingIpc';
import { registerPracticeIpc } from './ipc/registerPracticeIpc';
import { registerSessionIpc } from './ipc/registerSessionIpc';
import { hasUnsavedChanges, registerLifecycleIpc } from './ipc/registerLifecycleIpc';
import { registerTutorIpc } from './ipc/registerTutorIpc';
import { AssessmentRepository } from './repositories/assessmentRepository';
import { AiGenerationRepository } from './repositories/aiGenerationRepository';
import { CandidateRepository } from './repositories/candidateRepository';
import { DocumentRepository } from './repositories/documentRepository';
import { GraphRepository } from './repositories/graphRepository';
import { LearningRepository } from './repositories/learningRepository';
import { OnboardingRepository } from './repositories/onboardingRepository';
import { PracticeRepository } from './repositories/practiceRepository';
import { SessionRepository } from './repositories/sessionRepository';
import { TutorRepository } from './repositories/tutorRepository';
import { AssessmentService } from './services/assessmentService';
import { AiService } from './services/aiService';
import { CandidateService } from './services/candidateService';
import { DocumentService } from './services/documentService';
import { GraphService } from './services/graphService';
import { LearningService } from './services/learningService';
import { OnboardingService } from './services/onboardingService';
import { PracticeService } from './services/practiceService';
import { SessionService } from './services/sessionService';
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
      message: '当前内容还有尚未保存的更改。',
      detail: '可能包括图谱编辑或正在输入的学习笔记。如果现在退出，这些更改将会丢失。',
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
  const tutorRepository = new TutorRepository(database);
  const sessionRepository = new SessionRepository(database);
  const practiceRepository = new PracticeRepository(database);
  const documentRepository = new DocumentRepository(database);
  const candidateRepository = new CandidateRepository(database, graphRepository);
  const aiGenerationRepository = new AiGenerationRepository(database);
  const onboardingRepository = new OnboardingRepository(database, graphRepository);
  const aiService = new AiService(documentRepository, candidateRepository, aiGenerationRepository, {
    settingsPath: path.join(app.getPath('userData'), 'ai-settings.json'),
    secureStorage: safeStorage,
  });
  registerGraphIpc(new GraphService(graphRepository));
  registerLearningIpc(new LearningService(learningRepository, graphRepository));
  registerAssessmentIpc(new AssessmentService(
    assessmentRepository,
    graphRepository,
    learningRepository,
  ));
  registerTutorIpc(new TutorService(
    tutorRepository,
    graphRepository,
    assessmentRepository,
    sessionRepository,
    practiceRepository,
  ));
  registerSessionIpc(new SessionService(
    sessionRepository,
    graphRepository,
    assessmentRepository,
    tutorRepository,
    practiceRepository,
  ));
  registerPracticeIpc(new PracticeService(
    practiceRepository,
    graphRepository,
    assessmentRepository,
    sessionRepository,
    tutorRepository,
  ));
  registerDocumentIpc(new DocumentService(documentRepository));
  registerCandidateIpc(new CandidateService(candidateRepository));
  registerAiIpc(aiService);
  registerOnboardingIpc(new OnboardingService(onboardingRepository));
  registerLifecycleIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { database?.close(); database = undefined; });
