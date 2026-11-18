import * as fs from 'fs';
import * as path from 'path';
import { EnvFileEntry } from '../types';

export interface WorkspaceScanResult {
  files: EnvFileEntry[];
  skippedSubRepos: string[];
}

export class ScannerService {
  private static readonly MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB limit for env files

  /**
   * Checks whether a filename matches the .env pattern.
   * Matches .env, .env.local, .env.production, .env.development, etc.
   * Explicitly ignores template/sample/example/backup files (.example, .sample, .template, etc.).
   */
  public static isEnvFilename(filename: string): boolean {
    const base = path.basename(filename).toLowerCase();

    // Ignore non-secret template/sample/backup files
    const ignoredExtensions = [
      '.example',
      '.sample',
      '.template',
      '.dist',
      '.bak',
      '.backup',
      '.default'
    ];
    if (ignoredExtensions.some((ext) => base.endsWith(ext) || base.includes(ext))) {
      return false;
    }

    // Matches .env, .env.local, .env.dev, etc., or ends with .env (e.g. staging.env)
    return base === '.env' || base.startsWith('.env.') || base.endsWith('.env');
  }

  /**
   * Checks whether a directory is a Git repository (has .git directory or submodule .git file).
   */
  public static isGitRepository(dirPath: string): boolean {
    const gitPath = path.join(dirPath, '.git');
    try {
      return fs.existsSync(gitPath);
    } catch {
      return false;
    }
  }

  /**
   * Detailed scan returning both detected env files and any skipped nested Git repositories.
   */
  public static scanWorkspaceDetailed(
    workspaceRoot: string,
    ignoredDirs: string[] = [],
    ignoreSubRepositories: boolean = true
  ): WorkspaceScanResult {
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
    const skippedSubRepos: string[] = [];
    const queue: string[] = [workspaceRoot];
    const resolvedRoot = path.resolve(workspaceRoot);

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
            // Check if this subdirectory is its own Git repository (sub-repo boundary)
            if (
              ignoreSubRepositories &&
              path.resolve(fullPath) !== resolvedRoot &&
              this.isGitRepository(fullPath)
            ) {
              const relSubRepo = path
                .relative(workspaceRoot, fullPath)
                .replace(/\\/g, '/');
              skippedSubRepos.push(relSubRepo);
              continue; // Do not traverse into nested Git repository!
            }

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
    results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    skippedSubRepos.sort((a, b) => a.localeCompare(b));

    return { files: results, skippedSubRepos };
  }

  /**
   * Recursively scans a workspace directory for all .env* files.
   * Excludes folders in ignoredDirs and optionally isolates nested Git repositories.
   */
  public static scanWorkspace(
    workspaceRoot: string,
    ignoredDirs: string[] = [],
    ignoreSubRepositories: boolean = true
  ): EnvFileEntry[] {
    return this.scanWorkspaceDetailed(
      workspaceRoot,
      ignoredDirs,
      ignoreSubRepositories
    ).files;
  }

  /**
   * Fast check to see if any .env file exists in the workspace.
   */
  public static hasEnvFiles(
    workspaceRoot: string,
    ignoredDirs: string[] = [],
    ignoreSubRepositories: boolean = true
  ): boolean {
    const files = this.scanWorkspace(
      workspaceRoot,
      ignoredDirs,
      ignoreSubRepositories
    );
    return files.length > 0;
  }
}
