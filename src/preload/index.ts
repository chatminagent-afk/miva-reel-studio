// API yang boleh dipakai UI (renderer). Renderer tidak punya akses Node langsung.
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  openVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:openVideo'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  probe: (path: string): Promise<{ path: string; duration: number }> => ipcRenderer.invoke('media:probe', path),
};

export type ReelApi = typeof api;
contextBridge.exposeInMainWorld('reel', api);
