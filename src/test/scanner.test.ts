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

    // Should ignore non-secret template and sample files
    assert.strictEqual(ScannerService.isEnvFilename('.env.example'), false);
    assert.strictEqual(ScannerService.isEnvFilename('.env.sample'), false);
    assert.strictEqual(ScannerService.isEnvFilename('.env.template'), false);
    assert.strictEqual(ScannerService.isEnvFilename('.env.dist'), false);
    assert.strictEqual(ScannerService.isEnvFilename('.env.bak'), false);
    assert.strictEqual(ScannerService.isEnvFilename('.env.backup'), false);
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

  test('scanWorkspaceDetailed should isolate nested Git repositories and identify them', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'envkeeper-test-subrepo-'));

    try {
      // 1. Root .env
      fs.writeFileSync(path.join(tmpDir, '.env'), 'ROOT=TRUE\n');

      // 2. Normal monorepo package (no .git) -> SHOULD be scanned
      const pkgDir = path.join(tmpDir, 'packages', 'client');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, '.env'), 'CLIENT=TRUE\n');

      // 3. Nested Git repository with .git directory (e.g. interior design) -> SHOULD be isolated
      const subRepoDir = path.join(tmpDir, 'interior design');
      const subRepoGit = path.join(subRepoDir, '.git');
      fs.mkdirSync(subRepoGit, { recursive: true });
      fs.writeFileSync(path.join(subRepoDir, '.env'), 'INTERIOR=TRUE\n');
      const subNested = path.join(subRepoDir, 'backend');
      fs.mkdirSync(subNested, { recursive: true });
      fs.writeFileSync(path.join(subNested, '.env'), 'INTERIOR_BACKEND=TRUE\n');

      // 4. Submodule with .git file -> SHOULD be isolated
      const submoduleDir = path.join(tmpDir, 'submodules', 'shared-lib');
      fs.mkdirSync(submoduleDir, { recursive: true });
      fs.writeFileSync(path.join(submoduleDir, '.git'), 'gitdir: ../../.git/modules/shared-lib\n');
      fs.writeFileSync(path.join(submoduleDir, '.env'), 'SUBMODULE=TRUE\n');

      // Test default: ignoreSubRepositories = true
      const detailed = ScannerService.scanWorkspaceDetailed(tmpDir, [], true);
      const scannedPaths = detailed.files.map((f) => f.relativePath);

      // Only root and regular package files should be present
      assert.deepStrictEqual(scannedPaths, ['.env', 'packages/client/.env']);
      // Both the nested directory and submodule should be reported in skippedSubRepos
      assert.deepStrictEqual(detailed.skippedSubRepos, ['interior design', 'submodules/shared-lib']);

      // Test when ignoreSubRepositories = false
      const allFound = ScannerService.scanWorkspace(tmpDir, [], false);
      const allPaths = allFound.map((f) => f.relativePath);
      assert.ok(allPaths.includes('interior design/.env'));
      assert.ok(allPaths.includes('interior design/backend/.env'));
      assert.ok(allPaths.includes('submodules/shared-lib/.env'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
