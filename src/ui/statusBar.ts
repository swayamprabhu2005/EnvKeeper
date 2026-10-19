import * as vscode from 'vscode';
import { GitService, ProjectIdentity } from '../services/gitService';
import { ScannerService } from '../services/scannerService';
import { VaultService } from '../services/vaultService';

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private vaultService: VaultService;

  constructor(vaultService: VaultService) {
    this.vaultService = vaultService;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
  }

  public get item(): vscode.StatusBarItem {
    return this.statusBarItem;
  }

  /**
   * Refreshes the status bar item icon, label, and action based on the workspace state.
   */
  public async refresh(activeWorkspaceRoot?: string): Promise<void> {
    if (!activeWorkspaceRoot) {
      this.statusBarItem.hide();
      return;
    }

    const config = vscode.workspace.getConfiguration('envKeeper');
    const ignored = config.get<string[]>('ignoredDirectories', []);

    const projectIdentity: ProjectIdentity =
      GitService.getProjectIdentity(activeWorkspaceRoot);
    const localEnvFiles = ScannerService.scanWorkspace(
      activeWorkspaceRoot,
      ignored
    );
    const hasVaultBackup = this.vaultService.hasBackup(projectIdentity.projectId);
    const metadata = hasVaultBackup
      ? this.vaultService.getMetadata(projectIdentity.projectId)
      : undefined;

    this.statusBarItem.backgroundColor = undefined;

    if (localEnvFiles.length > 0) {
      if (hasVaultBackup && metadata) {
        // Check if file count or file paths match
        const sameFileCount = metadata.fileCount === localEnvFiles.length;
        if (sameFileCount) {
          this.statusBarItem.text = '$(check) ENV Protected';
          this.statusBarItem.tooltip = `ENV Keeper: ${localEnvFiles.length} env file(s) backed up for ${projectIdentity.projectName}\nLast backup: ${new Date(metadata.lastBackedUp).toLocaleString()}`;
          this.statusBarItem.command = 'envKeeper.quickMenu';
        } else {
          this.statusBarItem.text = `$(shield) Backup ENV (${localEnvFiles.length})`;
          this.statusBarItem.tooltip = `ENV Keeper: Changes detected in env files. Click to update backup.`;
          this.statusBarItem.command = 'envKeeper.backup';
        }
      } else {
        // Local env exists, never backed up yet!
        this.statusBarItem.text = `$(shield) Backup ENV (${localEnvFiles.length})`;
        this.statusBarItem.tooltip = `ENV Keeper: Found ${localEnvFiles.length} env file(s) in project. Click to encrypt and save backup!`;
        this.statusBarItem.command = 'envKeeper.backup';
      }
    } else if (hasVaultBackup && metadata) {
      // Re-cloned project! No local .env, but backup is waiting in vault!
      const totalKeys = metadata.files.reduce((acc, f) => acc + f.keyNames.length, 0);
      this.statusBarItem.text = '$(cloud-download) Restore ENV';
      this.statusBarItem.tooltip = `ENV Keeper: Backup found in vault with ${metadata.fileCount} file(s) (${totalKeys} keys). Click to restore!`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
      this.statusBarItem.command = 'envKeeper.restore';
    } else {
      // No local .env, no backup
      this.statusBarItem.text = '$(shield) ENV Keeper';
      this.statusBarItem.tooltip = `ENV Keeper: No .env files detected in ${projectIdentity.projectName}. Click for options.`;
      this.statusBarItem.command = 'envKeeper.quickMenu';
    }

    this.statusBarItem.show();
  }

  public dispose() {
    this.statusBarItem.dispose();
  }
}
