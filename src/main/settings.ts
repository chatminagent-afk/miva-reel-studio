// Pengaturan app (userData/settings.json) dan daftar proyek terakhir (userData/recent.json).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

export interface Settings {
  /** folder induk proyek baru */
  projectsRoot: string;
  /** folder export default */
  exportDir: string;
  /** kamus koreksi salah dengar Whisper -> edit.json "fix" setiap Auto Edit */
  fix: Record<string, string>;
  /** nama/merek yang diprioritaskan jadi kata kunci */
  names: string[];
  keywordMode: 'rules' | 'llm' | 'claude';
  /** pilihan Import terakhir */
  importDefaults: { autoEdit: boolean; speed: boolean; grade: 'natural' | 'warm' | 'lift' };
  exportDefaults: {
    resolution: '1080p' | '2k' | '4k';
    fps: 30 | 60;
    codec: 'h264' | 'hevc';
    quality: 'recommended' | 'higher';
    cover: boolean;
    waCopy: boolean;
    openFolder: boolean;
  };
  /** perangkat Whisper: auto (GPU kalau ada) | cpu */
  whisperDevice: 'auto' | 'cpu';
}

export interface RecentProject {
  dir: string;
  name: string;
  opened: string;
}

const file = (n: string) => join(app.getPath('userData'), n);

function readJson<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? { ...fallback, ...(JSON.parse(readFileSync(path, 'utf-8')) as T) } : fallback;
  } catch {
    return fallback; // file rusak: pakai default, jangan crash app
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2));
  renameSync(`${path}.tmp`, path);
}

export function defaultSettings(): Settings {
  const docs = app.getPath('documents');
  return {
    projectsRoot: join(docs, 'MIVA Reel Studio'),
    exportDir: join(docs, 'MIVA Reel Studio', 'Exports'),
    // salah dengar yang sudah ditemukan di skill /reel-edit
    fix: { cloud: 'Claude', Gepkart: 'CapCut', 'Gap Card': 'CapCut', donton: 'nonton' },
    names: ['CapCut', 'Claude', 'MIVA'],
    keywordMode: 'rules',
    importDefaults: { autoEdit: true, speed: true, grade: 'natural' },
    exportDefaults: { resolution: '1080p', fps: 30, codec: 'h264', quality: 'recommended', cover: true, waCopy: false, openFolder: true },
    whisperDevice: 'auto',
  };
}

export function getSettings(): Settings {
  const d = defaultSettings();
  const s = readJson<Settings>(file('settings.json'), d);
  return { ...d, ...s, importDefaults: { ...d.importDefaults, ...s.importDefaults }, exportDefaults: { ...d.exportDefaults, ...s.exportDefaults } };
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  writeJson(file('settings.json'), next);
  return next;
}

export function recentProjects(): RecentProject[] {
  const list = readJson<{ items: RecentProject[] }>(file('recent.json'), { items: [] }).items;
  return list.filter((p) => existsSync(join(p.dir, '.reel', 'state.json')));
}

export function touchRecent(dir: string, name: string): void {
  const items = [{ dir, name, opened: new Date().toISOString() }, ...recentProjects().filter((p) => p.dir !== dir)].slice(0, 20);
  writeJson(file('recent.json'), { items });
}
