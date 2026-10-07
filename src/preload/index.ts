// API yang boleh dipakai UI (renderer). Renderer tidak punya akses Node langsung.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { ExportEvent, ExportRequest } from '../main/export';
import type { AutoEditEvent, AutoEditRequest, OpenedProject } from '../main/projects';
import type { RecentProject, Settings } from '../main/settings';
import type { ProjectDoc } from '../core/doc';
import type { SfxCatalog, SfxFeature } from '../core/types';
import type { VersionInfo } from '../core/versions';

function subscribe<T>(channel: string, cb: (ev: T) => void): () => void {
  const h = (_e: IpcRendererEvent, ev: T) => cb(ev);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

const api = {
  openVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:openVideo'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  probe: (path: string): Promise<{ path: string; duration: number }> => ipcRenderer.invoke('media:probe', path),
  saveVideo: (defaultPath?: string): Promise<string | null> => ipcRenderer.invoke('dialog:saveVideo', defaultPath),
  exportStart: (req: ExportRequest): Promise<number> => ipcRenderer.invoke('export:start', req),
  exportCancel: (): Promise<boolean> => ipcRenderer.invoke('export:cancel'),
  exportDefaultCover: (projDir: string): Promise<{ title: string; t: number }> => ipcRenderer.invoke('export:defaultCover', projDir),
  whisperCheck: (): Promise<{ python: string; faster_whisper: string; ctranslate2: string; cuda_devices: number; missing_params: string[] }> =>
    ipcRenderer.invoke('whisper:check'),
  /** Langganan event export (progress/done/cancelled/error); kembalikan fungsi untuk berhenti. */
  onExportEvent: (cb: (ev: ExportEvent) => void): (() => void) => subscribe('export:event', cb),
  /** Path file yang di-drop dari Explorer (File.path tidak ada lagi di renderer terisolasi). */
  pathForFile: (f: File): string => webUtils.getPathForFile(f),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
  recentProjects: (): Promise<RecentProject[]> => ipcRenderer.invoke('projects:recent'),
  openProject: (dir: string): Promise<OpenedProject> => ipcRenderer.invoke('projects:open', dir),
  saveProject: (doc: Pick<ProjectDoc, 'edit' | 'state'>): Promise<{ saved: string }> => ipcRenderer.invoke('projects:save', doc),
  listVersions: (doc: Pick<ProjectDoc, 'edit' | 'state'>): Promise<{ versions: VersionInfo[]; current: number | null }> => ipcRenderer.invoke('versions:list', doc),
  saveVersion: (doc: Pick<ProjectDoc, 'edit' | 'state'>, label: string): Promise<VersionInfo> => ipcRenderer.invoke('versions:save', doc, label),
  openVersion: (n: number, doc: Pick<ProjectDoc, 'edit' | 'state'>): Promise<OpenedProject> => ipcRenderer.invoke('versions:open', n, doc),
  autoEditStart: (req: AutoEditRequest): Promise<number> => ipcRenderer.invoke('autoedit:start', req),
  autoEditCancel: (): Promise<boolean> => ipcRenderer.invoke('autoedit:cancel'),
  onAutoEditEvent: (cb: (ev: AutoEditEvent) => void): (() => void) => subscribe('autoedit:event', cb),
  renderAssets: (): Promise<{ template: string; fontCss: string }> => ipcRenderer.invoke('render:assets'),
  setPreview: (html: string): Promise<void> => ipcRenderer.invoke('preview:set', html),
  waveform: (): Promise<number[]> => ipcRenderer.invoke('projects:waveform'),
  rebuildProxy: (grade: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('projects:proxy', grade),
  sfxLibrary: (): Promise<{ catalog: SfxCatalog; features: Record<string, SfxFeature>; builtin: boolean }> => ipcRenderer.invoke('sfx:library'),
};

export type ReelApi = typeof api;
contextBridge.exposeInMainWorld('reel', api);
