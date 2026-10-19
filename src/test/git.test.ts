import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { GitService } from '../services/gitService';

describe('GitService URL Normalization Tests', () => {
  test('should normalize HTTPS GitHub URLs', () => {
    const url = 'https://github.com/swayan/my-ai-project.git';
    const normalized = GitService.normalizeGitUrl(url);
    assert.strictEqual(normalized, 'github.com/swayan/my-ai-project');
  });

  test('should normalize SSH GitHub URLs to identical identifier as HTTPS', () => {
    const sshUrl = 'git@github.com:swayan/my-ai-project.git';
    const httpsUrl = 'https://github.com/swayan/my-ai-project.git';

    const normSsh = GitService.normalizeGitUrl(sshUrl);
    const normHttps = GitService.normalizeGitUrl(httpsUrl);

    assert.strictEqual(normSsh, 'github.com/swayan/my-ai-project');
    assert.strictEqual(normSsh, normHttps);
  });

  test('should normalize GitLab and custom Git host URLs', () => {
    const gitlab = 'git@gitlab.com:enterprise/team/service.git';
    const normalized = GitService.normalizeGitUrl(gitlab);
    assert.strictEqual(normalized, 'gitlab.com/enterprise/team/service');
  });

  test('should handle URLs without .git extension and trailing slashes', () => {
    const url = 'https://github.com/user/another-repo/';
    const normalized = GitService.normalizeGitUrl(url);
    assert.strictEqual(normalized, 'github.com/user/another-repo');
  });
});
