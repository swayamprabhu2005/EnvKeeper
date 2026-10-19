import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { VaultService } from '../services/vaultService';
import { ProjectIdentity } from '../services/gitService';
import { EnvFileEntry } from '../types';

describe('VaultService Per-Project Folder & Re-keying Tests', () => {
  const masterPassphrase = 'MasterPassphrase123!';
  const newPassphrase = 'NewMasterPassphrase789!';

  test('should save and load project backup with envelope encryption in dedicated folder', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));

    try {
      const vault = new VaultService(tmpDir);
      const project: ProjectIdentity = {
        projectId: 'github.com/swayan/ai-demo',
        projectName: 'ai-demo',
        gitRemoteUrl: 'https://github.com/swayan/ai-demo.git',
        isGitRepo: true
      };

      const files: EnvFileEntry[] = [
        {
          relativePath: '.env',
          content: 'GEMINI_API_KEY=AIzaSySecret\nPORT=4000\n'
        },
        {
          relativePath: 'client/.env.local',
          content: 'VITE_API_URL=http://localhost:4000\n'
        }
      ];

      // Save
      const meta = vault.saveProjectBackup(project, files, masterPassphrase);
      assert.strictEqual(meta.fileCount, 2);
      assert.strictEqual(meta.projectName, 'ai-demo');

      // Verify folder and files exist on disk
      const projectDir = vault.getProjectDir(project.projectId);
      assert.ok(fs.existsSync(projectDir));
      assert.ok(fs.existsSync(path.join(projectDir, 'project.meta.json')));
      assert.ok(fs.existsSync(path.join(projectDir, 'root.env.enc')));
      assert.ok(fs.existsSync(path.join(projectDir, 'client__.env.local.enc')));

      // Load & verify
      const loaded = vault.loadProjectBackup(project.projectId, masterPassphrase);
      assert.strictEqual(loaded.files.length, 2);
      assert.strictEqual(loaded.files[0].relativePath, '.env');
      assert.ok(loaded.files[0].content.includes('GEMINI_API_KEY'));
      assert.strictEqual(loaded.files[1].relativePath, 'client/.env.local');

      // Re-key test (Change Master Passphrase)
      const rekeyResult = vault.rekeyMasterPassphrase(masterPassphrase, newPassphrase);
      assert.strictEqual(rekeyResult.updatedCount, 1);

      // Loading with old passphrase should now fail
      assert.throws(() => {
        vault.loadProjectBackup(project.projectId, masterPassphrase);
      });

      // Loading with new passphrase should succeed
      const reloaded = vault.loadProjectBackup(project.projectId, newPassphrase);
      assert.strictEqual(reloaded.files.length, 2);
      assert.ok(reloaded.files[0].content.includes('GEMINI_API_KEY'));

      // Delete test
      const deleted = vault.deleteBackup(project.projectId);
      assert.strictEqual(deleted, true);
      assert.strictEqual(fs.existsSync(projectDir), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
