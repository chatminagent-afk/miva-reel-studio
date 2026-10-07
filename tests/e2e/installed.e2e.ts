// Smoke test app yang sudah DIPASANG lewat installer (REEL_E2E_EXE = exe di folder instalasi): jendela terbuka,
// komponen Whisper bawaan terbaca, tidak ada request ke internet.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchApp } from './helpers';

describe.skipIf(!process.env.REEL_E2E_INSTALLED)('app terpasang', () => {
  it('terbuka offline dan komponen lengkap', async () => {
    const work = mkdtempSync(join(tmpdir(), 'reel-installed-'));
    const { app, win } = await launchApp(work);
    const external: string[] = [];
    win.on('request', (r) => {
      if (!/^(file|data|blob|devtools|reel):/.test(r.url())) external.push(r.url());
    });
    try {
      await win.waitForSelector('[data-testid="choose"]', { timeout: 60_000 });
      expect(await win.title()).toBe('MIVA Reel Studio');
      const c = await win.evaluate(() => window.reel.whisperCheck());
      expect(c).toMatchObject({ faster_whisper: '1.2.1', missing_params: [] });
      expect(external).toEqual([]);
    } finally {
      await app.close();
      rmSync(work, { recursive: true, force: true });
    }
  });
});
