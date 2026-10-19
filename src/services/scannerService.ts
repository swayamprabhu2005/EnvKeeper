import * as fs from 'fs';
import * as path from 'path';
import { EnvFileEntry } from '../types';

export class ScannerService {
  private static readonly MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB limit for env files

  /**
   * Checks whether a filename matches the .env pattern.
   * Matches .env, .env.local, .env.production, .env.development, etc.
   */
  public static isEnvFilename(filename: string): boolean {
    const base = path.basename(filename);
    // Matches .env, .env.local, .env.dev, etc., or ends with .env (e.g. staging.env)
    return base === '.env' || base.startsWith('.env.') || base.endsWith('.env');
  }

  /**
   * Recursively scans a workspace directory for all .env* files.
   * Excludes folders in ignoredDirs.
   */
  public static scanWorkspace(
    workspaceRoot: string,
    ignoredDirs: string[] = []
  ): EnvFileEntry[] {
    const defaultIgnored = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
      'out',
      'venv',
      '.venv',
      'env',
      'target',
      'vendor',
      ...ignoredDirs
    ]);

    const results: EnvFileEntry[] = [];
    const queue: string[] = [workspaceRoot];

    while (queue.length > 0) {
      const currentDir = queue.shift()!;
      let entries: fs.Dirent[] = [];

      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        // Skip unreadable directories
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!defaultIgnored.has(entry.name) && !entry.name.startsWith('.')) {
            queue.push(fullPath);
          }
        } else if (entry.isFile() && this.isEnvFilename(entry.name)) {
          try {
            const stats = fs.statSync(fullPath);
            if (stats.size <= this.MAX_FILE_SIZE_BYTES) {
              const content = fs.readFileSync(fullPath, 'utf8');
              const relativePath = path
                .relative(workspaceRoot, fullPath)
                .replace(/\\/g, '/'); // normalize to forward slashes
              results.push({ relativePath, content });
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    }

    // Sort entries alphabetically by relative path
    return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  /**
   * Fast check to see if any .env file exists in the workspace.
   */
  public static hasEnvFiles(
    workspaceRoot: string,
    ignoredDirs: string[] = []
  ): boolean {
    const files = this.scanWorkspace(workspaceRoot, ignoredDirs);
    return files.length > 0;
  }
}
