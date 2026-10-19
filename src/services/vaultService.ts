import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  EnvFileEntry,
  ProjectVaultMeta,
  VaultGlobalConfig
} from '../types';
import { CryptoService } from './cryptoService';
import { ProjectIdentity } from './gitService';

export class VaultService {
  private customVaultPath?: string;

  constructor(customVaultPath?: string) {
    this.customVaultPath = customVaultPath;
  }

  public setCustomVaultPath(newPath?: string) {
    this.customVaultPath = newPath;
  }

  /**
   * Returns the directory where the central encrypted vault lives.
   * Defaults to ~/Documents/env-keeper-vault/
   */
  public getVaultDirectory(): string {
    if (this.customVaultPath && this.customVaultPath.trim()) {
      return path.resolve(this.customVaultPath.trim());
    }
    return path.join(os.homedir(), 'Documents', 'env-keeper-vault');
  }

  public ensureVaultDir(): string {
    const dir = this.getVaultDirectory();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Generates a safe, clean folder name for a project from its ID.
   * e.g. "github.com/user/my-repo" -> "github.com_user_my-repo"
   */
  public static getSafeFolderName(projectId: string): string {
    return projectId
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '-')
      .toLowerCase();
  }

  /**
   * Converts a workspace relative path (e.g. "frontend/.env.local" or ".env")
   * to a safe filename inside the project vault folder (e.g. "frontend_sub.env.local.enc").
   */
  public static toVaultFileName(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (normalized === '.env') {
      return 'root.env.enc';
    }
    const safe = normalized.replace(/\//g, '__');
    return `${safe}.enc`;
  }

  public getProjectDir(projectId: string): string {
    const safeFolder = VaultService.getSafeFolderName(projectId);
    return path.join(this.ensureVaultDir(), safeFolder);
  }

  private getProjectMetaFile(projectId: string): string {
    return path.join(this.getProjectDir(projectId), 'project.meta.json');
  }

  private getGlobalConfigFile(): string {
    return path.join(this.ensureVaultDir(), 'vault.config.json');
  }

  /**
   * Loads global vault config (verification token, etc.).
   */
  public loadGlobalConfig(): VaultGlobalConfig {
    const configFile = this.getGlobalConfigFile();
    if (fs.existsSync(configFile)) {
      try {
        const raw = fs.readFileSync(configFile, 'utf8');
        return JSON.parse(raw) as VaultGlobalConfig;
      } catch {
        // Fallback
      }
    }
    return {
      version: 1,
      vaultPath: this.getVaultDirectory(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Saves or updates the global vault config.
   */
  public saveGlobalConfig(config: VaultGlobalConfig) {
    this.ensureVaultDir();
    const configFile = this.getGlobalConfigFile();
    config.updatedAt = new Date().toISOString();
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
  }

  /**
   * Checks if an authentication verification token exists in global config.
   */
  public hasVerificationToken(): boolean {
    const config = this.loadGlobalConfig();
    return !!config.authVerification;
  }

  /**
   * Verifies the given master passphrase against the global verification token.
   */
  public verifyMasterPassphrase(passphrase: string): boolean {
    const config = this.loadGlobalConfig();
    if (!config.authVerification) {
      return true; // No token set yet
    }
    return CryptoService.verifyMasterPassphrase(config.authVerification, passphrase);
  }

  /**
   * Updates or sets the verification token using the master passphrase.
   */
  public setVerificationToken(masterPassphrase: string) {
    const config = this.loadGlobalConfig();
    config.authVerification = CryptoService.createVerificationToken(masterPassphrase);
    this.saveGlobalConfig(config);
  }

  /**
   * Checks if a backup exists for a given project identifier.
   */
  public hasBackup(projectId: string): boolean {
    const metaFile = this.getProjectMetaFile(projectId);
    return fs.existsSync(metaFile);
  }

  /**
   * Retrieves metadata for a project backup without needing the decryption password.
   */
  public getMetadata(projectId: string): ProjectVaultMeta | undefined {
    const metaFile = this.getProjectMetaFile(projectId);
    if (!fs.existsSync(metaFile)) {
      return undefined;
    }
    try {
      const raw = fs.readFileSync(metaFile, 'utf8');
      return JSON.parse(raw) as ProjectVaultMeta;
    } catch {
      return undefined;
    }
  }

  /**
   * Lists metadata for all backed-up projects on this machine.
   */
  public listAllBackups(): ProjectVaultMeta[] {
    const vaultDir = this.ensureVaultDir();
    const results: ProjectVaultMeta[] = [];

    try {
      const entries = fs.readdirSync(vaultDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metaPath = path.join(vaultDir, entry.name, 'project.meta.json');
          if (fs.existsSync(metaPath)) {
            try {
              const raw = fs.readFileSync(metaPath, 'utf8');
              const meta = JSON.parse(raw) as ProjectVaultMeta;
              results.push(meta);
            } catch {
              // ignore invalid meta
            }
          }
        }
      }
    } catch {
      // ignore readdir errors
    }

    // Sort newest first
    return results.sort(
      (a, b) =>
        new Date(b.lastBackedUp).getTime() - new Date(a.lastBackedUp).getTime()
    );
  }

  /**
   * Encrypts and saves environment files for a project using 2-Level Envelope Encryption.
   * Stores files inside env-keeper-vault/<project-folder>/
   */
  public saveProjectBackup(
    project: ProjectIdentity,
    files: EnvFileEntry[],
    masterPassphrase: string
  ): ProjectVaultMeta {
    const projectDir = this.getProjectDir(project.projectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    // 1. Get or generate project Data Encryption Key (DEK)
    let dek: Buffer;
    const existingMeta = this.getMetadata(project.projectId);
    if (existingMeta && existingMeta.encryptedDek) {
      try {
        dek = CryptoService.decryptDek(existingMeta.encryptedDek, masterPassphrase);
      } catch {
        dek = CryptoService.generateDek();
      }
    } else {
      dek = CryptoService.generateDek();
    }

    // 2. Encrypt DEK with user's Master Passphrase (KEK)
    const encryptedDek = CryptoService.encryptDek(dek, masterPassphrase);

    // 3. Encrypt each .env file with the DEK and write to disk
    const fileMetaList: ProjectVaultMeta['files'] = [];

    for (const file of files) {
      const vaultFileName = VaultService.toVaultFileName(file.relativePath);
      const encryptedPayload = CryptoService.encryptContent(file.content, dek);
      const filePath = path.join(projectDir, vaultFileName);

      fs.writeFileSync(filePath, JSON.stringify(encryptedPayload, null, 2), 'utf8');

      fileMetaList.push({
        relativePath: file.relativePath,
        vaultFileName,
        keyNames: CryptoService.extractKeyNames(file.content),
        updatedAt: new Date().toISOString()
      });
    }

    // 4. Save project.meta.json
    const meta: ProjectVaultMeta = {
      version: 2,
      projectId: project.projectId,
      projectName: project.projectName,
      gitRemoteUrl: project.gitRemoteUrl,
      lastBackedUp: new Date().toISOString(),
      fileCount: files.length,
      encryptedDek,
      files: fileMetaList
    };

    const metaFile = this.getProjectMetaFile(project.projectId);
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');

    // Update global verification token if not set
    if (!this.hasVerificationToken()) {
      this.setVerificationToken(masterPassphrase);
    }

    return meta;
  }

  /**
   * Decrypts and retrieves environment files for a project from the vault.
   */
  public loadProjectBackup(
    projectId: string,
    masterPassphrase: string
  ): { metadata: ProjectVaultMeta; files: EnvFileEntry[] } {
    const meta = this.getMetadata(projectId);
    if (!meta) {
      throw new Error(`No backup found in vault for project "${projectId}".`);
    }

    const projectDir = this.getProjectDir(projectId);

    // 1. Decrypt project DEK using Master Passphrase
    const dek = CryptoService.decryptDek(meta.encryptedDek, masterPassphrase);

    // 2. Decrypt each file using the DEK
    const files: EnvFileEntry[] = [];
    for (const fileMeta of meta.files) {
      const filePath = path.join(projectDir, fileMeta.vaultFileName);
      if (fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const payload = JSON.parse(raw);
          const content = CryptoService.decryptContent(payload, dek);
          files.push({
            relativePath: fileMeta.relativePath,
            content
          });
        } catch {
          // ignore corrupted single file
        }
      }
    }

    return { metadata: meta, files };
  }

  /**
   * Changes the Master Passphrase by re-encrypting only the project DEKs (Two-Level Encryption).
   * Does NOT need to touch or re-encrypt the individual .env files!
   */
  public rekeyMasterPassphrase(
    oldPassphrase: string,
    newPassphrase: string
  ): { updatedCount: number } {
    // 1. Verify old passphrase
    if (!this.verifyMasterPassphrase(oldPassphrase)) {
      throw new Error('Current master passphrase is incorrect.');
    }

    const allProjects = this.listAllBackups();
    let updatedCount = 0;

    for (const meta of allProjects) {
      try {
        // Decrypt DEK with old passphrase
        const dek = CryptoService.decryptDek(meta.encryptedDek, oldPassphrase);
        // Re-encrypt DEK with new passphrase
        const newEncryptedDek = CryptoService.encryptDek(dek, newPassphrase);

        meta.encryptedDek = newEncryptedDek;
        const metaFile = this.getProjectMetaFile(meta.projectId);
        fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
        updatedCount++;
      } catch {
        // skip failed
      }
    }

    // Update global verification token
    this.setVerificationToken(newPassphrase);

    return { updatedCount };
  }

  /**
   * Deletes a project from the central vault directory.
   */
  public deleteBackup(projectId: string): boolean {
    const projectDir = this.getProjectDir(projectId);
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      return true;
    }
    return false;
  }
}
