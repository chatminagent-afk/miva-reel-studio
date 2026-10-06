// API yang boleh dipakai UI (renderer). Renderer tidak punya akses Node langsung.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ExportEvent, ExportRequest } from '../main/export';

const api = {
  openVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:openVideo'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  probe: (path: string): Promise<{ path: string; duration: number }> => ipcRenderer.invoke('media:probe', path),
  saveVideo: (defaultPath?: string): Promise<string | null> => ipcRenderer.invoke('dialog:saveVideo', defaultPath),
  exportStart: (req: ExportRequest): Promise<number> => ipcRenderer.invoke('export:start', req),
  exportCancel: (): Promise<boolean> => ipcRenderer.invoke('export:cancel'),
  /** Langganan event export (progress/done/cancelled/error); kembalikan fungsi untuk berhenti. */
  onExportEvent: (cb: (ev: ExportEvent) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, ev: ExportEvent) => cb(ev);
    ipcRenderer.on('export:event', h);
    return () => ipcRenderer.removeListener('export:event', h);
  },
};

export type ReelApi = typeof api;
contextBridge.exposeInMainWorld('reel', api);
