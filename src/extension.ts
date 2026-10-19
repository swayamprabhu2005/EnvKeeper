import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from './services/gitService';
import { ScannerService } from './services/scannerService';
import { VaultService } from './services/vaultService';
import { KeyManager } from './services/keyManager';
import { DiffService } from './services/diffService';
import { StatusBarManager } from './ui/statusBar';
import { VaultTreeDataProvider, VaultTreeItem } from './ui/treeView';

export function activate(context: vscode.ExtensionContext) {
  // Initialize services
  const config = vscode.workspace.getConfiguration('envKeeper');
  const customVaultPath = config.get<string>('vaultPath');
  const vaultService = new VaultService(customVaultPath);
  const keyManager = new KeyManager(context);
  const statusBarManager = new StatusBarManager(vaultService);

  const getWorkspaceRoot = (): string | undefined => {
    return vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;
  };

  // Tree View
  const treeDataProvider = new VaultTreeDataProvider(
    vaultService,
    getWorkspaceRoot
  );
  vscode.window.registerTreeDataProvider(
    'envKeeper.vaultView',
    treeDataProvider
  );

  // Status Bar update helper
  const updateUi = async () => {
    const root = getWorkspaceRoot();
    await statusBarManager.refresh(root);
    treeDataProvider.refresh();
  };

  // Helper to ensure vault directory is chosen
  const ensureVaultConfigured = async (): Promise<boolean> => {
    const currentPath = vaultService.getVaultDirectory();
    const configSetting = vscode.workspace
      .getConfiguration('envKeeper')
      .get<string>('vaultPath');

    // If never explicitly chosen, confirm default
    if (!configSetting) {
      vaultService.ensureVaultDir();
    }
    return true;
  };

  // 1. Command: Backup
  const backupCommand = vscode.commands.registerCommand(
    'envKeeper.backup',
    async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage(
          'ENV Keeper: Please open a workspace folder first.'
        );
        return;
      }

      await ensureVaultConfigured();

      const ignored = vscode.workspace
        .getConfiguration('envKeeper')
        .get<string[]>('ignoredDirectories', []);
      const localFiles = ScannerService.scanWorkspace(root, ignored);

      if (localFiles.length === 0) {
        vscode.window.showInformationMessage(
          'ENV Keeper: No .env files found in the current workspace.'
        );
        return;
      }

      // Check for passphrase
      let passphrase = await keyManager.getPassphrase(false);
      if (!passphrase) {
        const hasSaved = await keyManager.hasSavedPassphrase();
        if (hasSaved) {
          passphrase = await keyManager.promptForPassphrase(
            'Enter your master passphrase to encrypt and save your backup'
          );
        } else {
          passphrase = await keyManager.setupNewPassphrase();
        }
      }

      if (!passphrase) {
        vscode.window.showWarningMessage(
          'ENV Keeper: Backup cancelled (passphrase required).'
        );
        return;
      }

      const project = GitService.getProjectIdentity(root);

      try {
        const meta = vaultService.saveProjectBackup(
          project,
          localFiles,
          passphrase
        );
        await updateUi();

        vscode.window.showInformationMessage(
          `🛡️ ENV Keeper: Successfully backed up & encrypted ${meta.fileCount} file(s) for "${meta.projectName}" inside env-keeper-vault!`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `ENV Keeper: Backup failed: ${err.message}`
        );
      }
    }
  );

  // 2. Command: Restore
  const restoreCommand = vscode.commands.registerCommand(
    'envKeeper.restore',
    async (item?: VaultTreeItem) => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage(
          'ENV Keeper: Please open a workspace folder to restore environment keys.'
        );
        return;
      }

      const currentProject = GitService.getProjectIdentity(root);
      const targetProjectId = item?.metadata
        ? item.metadata.projectId
        : currentProject.projectId;

      if (!vaultService.hasBackup(targetProjectId)) {
        vscode.window.showWarningMessage(
          `ENV Keeper: No backup found in vault for "${targetProjectId}".`
        );
        return;
      }

      // Need passphrase to decrypt
      let passphrase = await keyManager.getPassphrase(false);
      if (!passphrase) {
        passphrase = await keyManager.promptForPassphrase(
          'Enter your master passphrase to decrypt and restore keys'
        );
      }

      if (!passphrase) {
        return;
      }

      try {
        const { metadata, files } = vaultService.loadProjectBackup(
          targetProjectId,
          passphrase
        );

        const result = await DiffService.restoreFiles(root, files);
        await updateUi();

        const summaryParts = [];
        if (result.restored.length > 0) {
          summaryParts.push(`Restored: ${result.restored.join(', ')}`);
        }
        if (result.merged.length > 0) {
          summaryParts.push(`Merged: ${result.merged.join(', ')}`);
        }
        if (result.skipped.length > 0) {
          summaryParts.push(`Skipped: ${result.skipped.join(', ')}`);
        }

        vscode.window.showInformationMessage(
          `🎉 ENV Keeper: Restored environment files for "${metadata.projectName}". ${summaryParts.join(' | ')}`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `ENV Keeper: Restore failed: ${err.message}`
        );
      }
    }
  );

  // 3. Command: Quick Menu
  const quickMenuCommand = vscode.commands.registerCommand(
    'envKeeper.quickMenu',
    async () => {
      const root = getWorkspaceRoot();
      const project = root ? GitService.getProjectIdentity(root) : undefined;
      const ignored = vscode.workspace
        .getConfiguration('envKeeper')
        .get<string[]>('ignoredDirectories', []);
      const localFiles = root
        ? ScannerService.scanWorkspace(root, ignored)
        : [];
      const hasBackup = project
        ? vaultService.hasBackup(project.projectId)
        : false;

      const items: vscode.QuickPickItem[] = [];

      if (root) {
        items.push({
          label: '$(shield) Backup Workspace .env Files',
          description: `${localFiles.length} local file(s) found`,
          detail: 'Encrypts and stores local environment files into env-keeper-vault'
        });

        if (hasBackup) {
          items.push({
            label: '$(cloud-download) Restore .env Files from Vault',
            description: `Project: ${project?.projectName}`,
            detail: 'Decrypts and writes environment files into workspace'
          });
        }
      }

      items.push({
        label: '$(key) Manage Master Passphrase',
        description: 'Change passphrase (with old password check) or copy to Password Manager'
      });

      items.push({
        label: '$(lock) Lock Vault',
        description: 'Clear cached passphrase from memory and OS Keychain'
      });

      items.push({
        label: '$(folder) Open Vault Folder on PC',
        description: vaultService.getVaultDirectory()
      });

      items.push({
        label: '$(gear) Configure Settings',
        description: 'Change vault location or auto-backup preferences'
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'ENV Keeper - Secret Vault Actions'
      });

      if (!selected) {
        return;
      }

      if (selected.label.includes('Backup Workspace')) {
        await vscode.commands.executeCommand('envKeeper.backup');
      } else if (selected.label.includes('Restore .env Files')) {
        await vscode.commands.executeCommand('envKeeper.restore');
      } else if (selected.label.includes('Manage Master Passphrase')) {
        await vscode.commands.executeCommand('envKeeper.manageMasterKey');
      } else if (selected.label.includes('Lock Vault')) {
        await vscode.commands.executeCommand('envKeeper.lockVault');
      } else if (selected.label.includes('Open Vault Folder')) {
        const vaultDir = vaultService.getVaultDirectory();
        await vscode.env.openExternal(vscode.Uri.file(vaultDir));
      } else if (selected.label.includes('Configure Settings')) {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'envKeeper'
        );
      }
    }
  );

  // 4. Command: Manage Master Key (Change / Copy / Reset)
  const manageKeyCommand = vscode.commands.registerCommand(
    'envKeeper.manageMasterKey',
    async () => {
      const hasSaved = await keyManager.hasSavedPassphrase();

      if (!hasSaved) {
        await keyManager.setupNewPassphrase();
        return;
      }

      const action = await vscode.window.showQuickPick(
        [
          {
            label: '$(sync) Change Master Passphrase',
            detail: 'Requires entering your old passphrase; automatically re-encrypts all project keys'
          },
          {
            label: '$(clippy) Copy Passphrase to Clipboard',
            detail: 'Save your passphrase into Google Password Manager, 1Password, or Bitwarden'
          },
          {
            label: '$(trash) Reset / Clear Passphrase',
            detail: 'Locks vault and clears remembered credentials from OS Keychain'
          }
        ],
        { placeHolder: 'Master Passphrase Management - ENV Keeper' }
      );

      if (!action) {
        return;
      }

      if (action.label.includes('Change Master Passphrase')) {
        await keyManager.changeMasterPassphrase(vaultService);
      } else if (action.label.includes('Copy Passphrase')) {
        const pass = await keyManager.getPassphrase(true);
        if (pass) {
          await vscode.env.clipboard.writeText(pass);
          vscode.window.showInformationMessage(
            'Master Passphrase copied to clipboard! Paste it safely into your Google Password Manager or password vault.'
          );
        }
      } else if (action.label.includes('Reset / Clear')) {
        await keyManager.clearPassphrase();
      }
    }
  );

  // 5. Command: Lock Vault
  const lockVaultCommand = vscode.commands.registerCommand(
    'envKeeper.lockVault',
    async () => {
      await keyManager.clearPassphrase();
    }
  );

  // 6. Command: Refresh View
  const refreshCommand = vscode.commands.registerCommand(
    'envKeeper.refreshView',
    async () => {
      await updateUi();
    }
  );

  // 7. Command: Delete Project Vault
  const deleteVaultCommand = vscode.commands.registerCommand(
    'envKeeper.deleteProjectVault',
    async (item?: VaultTreeItem) => {
      if (!item || !item.metadata) {
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to permanently delete the backup for "${item.metadata.projectName}" from the vault?`,
        { modal: true },
        'Delete'
      );

      if (confirm === 'Delete') {
        vaultService.deleteBackup(item.metadata.projectId);
        await updateUi();
        vscode.window.showInformationMessage(
          `ENV Keeper: Deleted backup for "${item.metadata.projectName}".`
        );
      }
    }
  );

  // 8. Command: Reveal Encrypted Keys
  const revealKeysCommand = vscode.commands.registerCommand(
    'envKeeper.revealKeys',
    async (item?: VaultTreeItem) => {
      if (!item || !item.metadata) {
        return;
      }

      let passphrase = await keyManager.getPassphrase(false);
      if (!passphrase) {
        passphrase = await keyManager.promptForPassphrase(
          `Enter master passphrase to view keys for "${item.metadata.projectName}"`
        );
      }

      if (!passphrase) {
        return;
      }

      try {
        const { files } = vaultService.loadProjectBackup(
          item.metadata.projectId,
          passphrase
        );

        const contentLines: string[] = [
          `# ========================================================`,
          `# ENV Keeper - Decrypted Vault Preview`,
          `# Project: ${item.metadata.projectName}`,
          `# Project ID: ${item.metadata.projectId}`,
          `# Backed Up: ${new Date(item.metadata.lastBackedUp).toLocaleString()}`,
          `# ========================================================\n`
        ];

        for (const file of files) {
          contentLines.push(
            `# File: ${file.relativePath}`,
            file.content,
            `\n# --------------------------------------------------------\n`
          );
        }

        const doc = await vscode.workspace.openTextDocument({
          content: contentLines.join('\n'),
          language: 'dotenv'
        });

        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `ENV Keeper: Failed to reveal keys: ${err.message}`
        );
      }
    }
  );

  // Event Listeners
  context.subscriptions.push(
    backupCommand,
    restoreCommand,
    quickMenuCommand,
    manageKeyCommand,
    lockVaultCommand,
    refreshCommand,
    deleteVaultCommand,
    revealKeysCommand,
    statusBarManager
  );

  // Watch for active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateUi();
    })
  );

  // Watch for workspace folders change
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      updateUi();
    })
  );

  // Watch for document saves (for auto-backup and status bar update)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const fileName = path.basename(doc.fileName);
      if (ScannerService.isEnvFilename(fileName)) {
        const autoBackup = vscode.workspace
          .getConfiguration('envKeeper')
          .get<boolean>('autoBackupOnSave', false);

        if (autoBackup) {
          const passphrase = await keyManager.getPassphrase(false);
          if (passphrase) {
            await vscode.commands.executeCommand('envKeeper.backup');
          }
        }
        await updateUi();
      }
    })
  );

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('envKeeper')) {
        const newPath = vscode.workspace
          .getConfiguration('envKeeper')
          .get<string>('vaultPath');
        vaultService.setCustomVaultPath(newPath);
        updateUi();
      }
    })
  );

  // Initial update
  updateUi();
}

export function deactivate() {}
