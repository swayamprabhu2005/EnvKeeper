import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { ScannerService } from '../services/scannerService';
import { VaultService } from '../services/vaultService';
import { ProjectVaultMeta } from '../types';

export class VaultTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType:
      | 'header'
      | 'current-project'
      | 'current-file'
      | 'project-vault'
      | 'vault-file'
      | 'vault-key'
      | 'info',
    public readonly metadata?: ProjectVaultMeta,
    public readonly extraData?: any
  ) {
    super(label, collapsibleState);
    this.contextValue = itemType;
    this.setupVisuals();
  }

  private setupVisuals() {
    switch (this.itemType) {
      case 'header':
        this.iconPath = new vscode.ThemeIcon('folder');
        break;
      case 'current-project':
        this.iconPath = new vscode.ThemeIcon('repo');
        break;
      case 'current-file':
        this.iconPath = new vscode.ThemeIcon('file-code');
        break;
      case 'project-vault':
        this.iconPath = new vscode.ThemeIcon('shield');
        if (this.metadata) {
          const dateStr = new Date(this.metadata.lastBackedUp).toLocaleDateString();
          this.description = `${this.metadata.fileCount} file(s) - ${dateStr}`;
          this.tooltip = `Project: ${this.metadata.projectName}\nID: ${this.metadata.projectId}\nGit: ${this.metadata.gitRemoteUrl || 'N/A'}\nLast Backup: ${new Date(this.metadata.lastBackedUp).toLocaleString()}`;
        }
        break;
      case 'vault-file':
        this.iconPath = new vscode.ThemeIcon('file-text');
        break;
      case 'vault-key':
        this.iconPath = new vscode.ThemeIcon('key');
        break;
      case 'info':
        this.iconPath = new vscode.ThemeIcon('info');
        break;
    }
  }
}

export class VaultTreeDataProvider
  implements vscode.TreeDataProvider<VaultTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    VaultTreeItem | undefined | null | void
  > = new vscode.EventEmitter<VaultTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    VaultTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(
    private vaultService: VaultService,
    private getWorkspaceRoot: () => string | undefined
  ) {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: VaultTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: VaultTreeItem): Promise<VaultTreeItem[]> {
    if (!element) {
      // Root level: return top categories
      return [
        new VaultTreeItem(
          'Active Workspace',
          vscode.TreeItemCollapsibleState.Expanded,
          'header',
          undefined,
          { section: 'active' }
        ),
        new VaultTreeItem(
          'All Vaulted Projects',
          vscode.TreeItemCollapsibleState.Expanded,
          'header',
          undefined,
          { section: 'all' }
        )
      ];
    }

    if (element.itemType === 'header') {
      const section = element.extraData?.section;
      if (section === 'active') {
        return this.getActiveWorkspaceItems();
      } else if (section === 'all') {
        return this.getAllVaultItems();
      }
    }

    if (element.itemType === 'project-vault' && element.metadata) {
      // Sub-items for a vaulted project: files and keys
      const items: VaultTreeItem[] = [];

      for (const fileMeta of element.metadata.files) {
        const fileItem = new VaultTreeItem(
          fileMeta.relativePath,
          vscode.TreeItemCollapsibleState.Collapsed,
          'vault-file',
          element.metadata,
          { keys: fileMeta.keyNames }
        );
        fileItem.description = `${fileMeta.keyNames.length} key(s)`;
        items.push(fileItem);
      }

      return items;
    }

    if (element.itemType === 'vault-file' && element.extraData?.keys) {
      const keys = element.extraData.keys as string[];
      return keys.map(
        (k) =>
          new VaultTreeItem(
            k,
            vscode.TreeItemCollapsibleState.None,
            'vault-key'
          )
      );
    }

    return [];
  }

  private getActiveWorkspaceItems(): VaultTreeItem[] {
    const root = this.getWorkspaceRoot();
    if (!root) {
      return [
        new VaultTreeItem(
          'No workspace folder open',
          vscode.TreeItemCollapsibleState.None,
          'info'
        )
      ];
    }

    const config = vscode.workspace.getConfiguration('envKeeper');
    const ignored = config.get<string[]>('ignoredDirectories', []);

    const project = GitService.getProjectIdentity(root);
    const localFiles = ScannerService.scanWorkspace(root, ignored);
    const hasBackup = this.vaultService.hasBackup(project.projectId);
    const metadata = hasBackup
      ? this.vaultService.getMetadata(project.projectId)
      : undefined;

    const items: VaultTreeItem[] = [];

    const statusLabel = hasBackup
      ? `Project: ${project.projectName} (Vaulted)`
      : `Project: ${project.projectName} (Not Backed Up)`;

    const projectItem = new VaultTreeItem(
      statusLabel,
      vscode.TreeItemCollapsibleState.None,
      'current-project'
    );
    projectItem.description = project.gitRemoteUrl || project.projectId;
    items.push(projectItem);

    if (localFiles.length === 0) {
      if (hasBackup && metadata) {
        const restoreItem = new VaultTreeItem(
          'Backup Available in Vault! Click to Restore',
          vscode.TreeItemCollapsibleState.None,
          'info'
        );
        restoreItem.command = {
          command: 'envKeeper.restore',
          title: 'Restore .env Files'
        };
        items.push(restoreItem);
      } else {
        items.push(
          new VaultTreeItem(
            'No .env files found in project',
            vscode.TreeItemCollapsibleState.None,
            'info'
          )
        );
      }
    } else {
      for (const file of localFiles) {
        items.push(
          new VaultTreeItem(
            file.relativePath,
            vscode.TreeItemCollapsibleState.None,
            'current-file'
          )
        );
      }
    }

    return items;
  }

  private getAllVaultItems(): VaultTreeItem[] {
    const allBackups = this.vaultService.listAllBackups();
    if (allBackups.length === 0) {
      return [
        new VaultTreeItem(
          'No projects backed up yet',
          vscode.TreeItemCollapsibleState.None,
          'info'
        )
      ];
    }

    return allBackups.map((meta) => {
      return new VaultTreeItem(
        meta.projectName,
        vscode.TreeItemCollapsibleState.Collapsed,
        'project-vault',
        meta
      );
    });
  }
}
