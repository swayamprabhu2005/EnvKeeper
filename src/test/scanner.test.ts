import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScannerService } from '../services/scannerService';
import { MergeHelper } from '../services/mergeHelper';

describe('ScannerService & DiffService Tests', () => {
  test('isEnvFilename should recognize valid env filenames', () => {
    assert.strictEqual(ScannerService.isEnvFilename('.env'), true);
    assert.strictEqual(ScannerService.isEnvFilename('.env.local'), true);
    assert.strictEqual(ScannerService.isEnvFilename('.env.development'), true);
    assert.strictEqual(ScannerService.isEnvFilename('.env.production'), true);
    assert.strictEqual(ScannerService.isEnvFilename('staging.env'), true);

    // Should not match regular files
    assert.strictEqual(ScannerService.isEnvFilename('environment.ts'), false);
    assert.strictEqual(ScannerService.isEnvFilename('.gitignore'), false);
  });

  test('scanWorkspace should find .env files and ignore node_modules', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'envkeeper-test-'));

    try {
      // Create root .env
      fs.writeFileSync(path.join(tmpDir, '.env'), 'KEY1=VAL1\n');

      // Create nested apps/web/.env.local
      const webDir = path.join(tmpDir, 'apps', 'web');
      fs.mkdirSync(webDir, { recursive: true });
      fs.writeFileSync(path.join(webDir, '.env.local'), 'KEY2=VAL2\n');

      // Create ignored folder node_modules/.env (should NOT be detected)
      const nmDir = path.join(tmpDir, 'node_modules', 'some-pkg');
      fs.mkdirSync(nmDir, { recursive: true });
      fs.writeFileSync(path.join(nmDir, '.env'), 'IGNORED=TRUE\n');

      const found = ScannerService.scanWorkspace(tmpDir, []);
      const relPaths = found.map((f) => f.relativePath);

      assert.strictEqual(found.length, 2);
      assert.deepStrictEqual(relPaths, ['.env', 'apps/web/.env.local']);
      assert.ok(!relPaths.some((p) => p.includes('node_modules')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('mergeEnvContents should keep local values and append missing keys', () => {
    const local = 'GEMINI_API_KEY=existing_local_gemini\nPORT=3000\n';
    const backup = 'GEMINI_API_KEY=old_backup_key\nGROQ_API_KEY=gsk_new_groq_key\nPORT=8080\n';

    const merged = MergeHelper.mergeEnvContents(local, backup);

    // Local key should be preserved
    assert.ok(merged.includes('GEMINI_API_KEY=existing_local_gemini'));
    assert.ok(merged.includes('PORT=3000'));
    // Missing key from backup should be added
    assert.ok(merged.includes('GROQ_API_KEY=gsk_new_groq_key'));
  });
});
