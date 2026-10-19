export interface EnvFileEntry {
  relativePath: string;
  content: string;
}

export interface EncryptedPayload {
  algorithm: string;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Envelope encryption metadata stored in project.meta.json
 */
export interface ProjectVaultMeta {
  version: number;
  projectId: string;
  projectName: string;
  gitRemoteUrl?: string;
  lastBackedUp: string;
  fileCount: number;
  /**
   * The Data Encryption Key (DEK) for this specific project,
   * encrypted using the user's Master Key Encryption Key (KEK).
   */
  encryptedDek: EncryptedPayload;
  /**
   * Mapping of workspace relative paths to their encrypted vault filename.
   * e.g. { ".env": "root.env.enc", "frontend/.env.local": "frontend_sub.env.local.enc" }
   */
  files: {
    relativePath: string;
    vaultFileName: string;
    keyNames: string[];
    updatedAt: string;
  }[];
}

export interface VaultGlobalConfig {
  version: number;
  vaultPath: string;
  /**
   * Verification token: encrypted known string to verify old passphrase before changing it
   */
  authVerification?: EncryptedPayload;
  createdAt: string;
  updatedAt: string;
}
