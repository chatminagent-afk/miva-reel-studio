// Proses utama Electron: jendela app + jembatan IPC ke pipeline (src/core).
// Tidak ada akses jaringan: app harus jalan penuh offline.
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { probeDuration } from '../core/ffmpeg';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0E0E10',
    title: 'MIVA Reel Studio',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

ipcMain.handle('dialog:openVideo', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'mkv'] }] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('media:probe', async (_e, path: string) => ({ path, duration: await probeDuration(path) }));

app.whenReady().then(() => {
  // Blokir semua request keluar dari renderer (offline by design); file lokal dan dev server tetap boleh.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const local = u.startsWith('file:') || u.startsWith('devtools:') || u.startsWith('data:') || u.startsWith('blob:') ||
      (process.env.ELECTRON_RENDERER_URL !== undefined && u.startsWith(process.env.ELECTRON_RENDERER_URL));
    cb({ cancel: !local });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
