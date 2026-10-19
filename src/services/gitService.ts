import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

export interface ProjectIdentity {
  projectId: string;
  projectName: string;
  gitRemoteUrl?: string;
  isGitRepo: boolean;
}

export class GitService {
  /**
   * Normalizes any Git remote URL (SSH, HTTPS, git://) to a canonical project identifier.
   * e.g. "git@github.com:user/repo.git" -> "github.com/user/repo"
   *      "https://github.com/user/repo.git" -> "github.com/user/repo"
   */
  public static normalizeGitUrl(url: string): string {
    let clean = url.trim();
    // Remove trailing .git and trailing slashes
    clean = clean.replace(/\.git\/?$/i, '').replace(/\/+$/, '');
    // Handle SSH format: git@github.com:owner/repo
    const sshMatch = clean.match(/^git@([^:]+):(.+)$/i);
    if (sshMatch) {
      return `${sshMatch[1].toLowerCase()}/${sshMatch[2].replace(/\/+$/, '')}`;
    }
    // Handle standard protocol URLs: https://, ssh://, git://
    try {
      const parsed = new URL(clean);
      const host = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
      return `${host}/${pathname}`;
    } catch {
      // Fallback: strip protocols manually
      clean = clean.replace(/^(https?:\/\/|ssh:\/\/|git:\/\/)/i, '');
      clean = clean.replace(/^[^@]+@/, ''); // remove user@
      clean = clean.replace(/:/, '/');
      return clean.replace(/\/+$/, '').toLowerCase();
    }
  }

  /**
   * Determines the ProjectIdentity for a workspace root folder.
   */
  public static getProjectIdentity(workspaceRoot: string): ProjectIdentity {
    const folderName = path.basename(workspaceRoot);
    const gitRemote = this.findGitRemoteUrl(workspaceRoot);

    if (gitRemote) {
      const canonicalId = this.normalizeGitUrl(gitRemote);
      return {
        projectId: canonicalId,
        projectName: path.basename(canonicalId) || folderName,
        gitRemoteUrl: gitRemote,
        isGitRepo: true
      };
    }

    // Fallback for non-git folders: stable hash of directory path
    const hash = crypto.createHash('sha256').update(path.resolve(workspaceRoot).toLowerCase()).digest('hex').substring(0, 12);
    const fallbackId = `local:${folderName}-${hash}`;
    return {
      projectId: fallbackId,
      projectName: folderName,
      isGitRepo: false
    };
  }

  /**
   * Attempts to discover the remote origin URL using git CLI first, then falls back to .git/config file parsing.
   */
  private static findGitRemoteUrl(workspaceRoot: string): string | undefined {
    // 1. Try git CLI
    try {
      const output = execSync('git config --get remote.origin.url', {
        cwd: workspaceRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        timeout: 2000
      });
      if (output && output.trim()) {
        return output.trim();
      }
    } catch {
      // CLI failed or git not available, try reading .git/config directly
    }

    // 2. Direct file inspection of .git/config
    const gitConfigPath = path.join(workspaceRoot, '.git', 'config');
    if (fs.existsSync(gitConfigPath)) {
      try {
        const content = fs.readFileSync(gitConfigPath, 'utf8');
        const match = content.match(/\[remote\s+"origin"\][^\[]*url\s*=\s*([^\r\n]+)/i);
        if (match && match[1]) {
          return match[1].trim();
        }
      } catch {
        // ignore read error
      }
    }

    return undefined;
  }
}
