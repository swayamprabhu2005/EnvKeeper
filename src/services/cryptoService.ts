import * as crypto from 'crypto';
import { EncryptedPayload } from '../types';

export class CryptoService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly KEY_LENGTH = 32; // 256 bits
  private static readonly SALT_LENGTH = 16;
  private static readonly IV_LENGTH = 12; // 96 bits for GCM
  private static readonly PBKDF2_ITERATIONS = 100000;
  private static readonly PBKDF2_DIGEST = 'sha512';
  private static readonly VERIFICATION_MAGIC = 'ENV_KEEPER_AUTH_VERIFICATION_V1';

  /**
   * Derives the Key Encryption Key (KEK) from the user's Master Passphrase.
   */
  public static deriveKek(passphrase: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(
      passphrase,
      salt,
      this.PBKDF2_ITERATIONS,
      this.KEY_LENGTH,
      this.PBKDF2_DIGEST
    );
  }

  /**
   * Generates a new, cryptographically secure 256-bit Data Encryption Key (DEK).
   */
  public static generateDek(): Buffer {
    return crypto.randomBytes(this.KEY_LENGTH);
  }

  /**
   * Encrypts the project Data Encryption Key (DEK) with the Master Key Encryption Key (KEK).
   */
  public static encryptDek(dek: Buffer, masterPassphrase: string): EncryptedPayload {
    const salt = crypto.randomBytes(this.SALT_LENGTH);
    const kek = this.deriveKek(masterPassphrase, salt);
    const iv = crypto.randomBytes(this.IV_LENGTH);

    const cipher = crypto.createCipheriv(this.ALGORITHM, kek, iv);
    const encrypted = Buffer.concat([
      cipher.update(dek),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return {
      algorithm: this.ALGORITHM,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      ciphertext: encrypted.toString('hex')
    };
  }

  /**
   * Decrypts the project Data Encryption Key (DEK) using the Master Passphrase.
   * Throws an error if the passphrase is incorrect or data was tampered with.
   */
  public static decryptDek(encryptedDek: EncryptedPayload, masterPassphrase: string): Buffer {
    const salt = Buffer.from(encryptedDek.salt, 'hex');
    const kek = this.deriveKek(masterPassphrase, salt);
    const iv = Buffer.from(encryptedDek.iv, 'hex');
    const authTag = Buffer.from(encryptedDek.authTag, 'hex');
    const ciphertext = Buffer.from(encryptedDek.ciphertext, 'hex');

    const decipher = crypto.createDecipheriv(this.ALGORITHM, kek, iv);
    decipher.setAuthTag(authTag);

    try {
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]);
    } catch {
      throw new Error(
        'Decryption failed: Incorrect master passphrase or corrupted key vault.'
      );
    }
  }

  /**
   * Encrypts a string (e.g. an .env file content) using the project's Data Encryption Key (DEK).
   */
  public static encryptContent(content: string, dek: Buffer): EncryptedPayload {
    const salt = crypto.randomBytes(this.SALT_LENGTH); // per-file salt
    const iv = crypto.randomBytes(this.IV_LENGTH);

    const cipher = crypto.createCipheriv(this.ALGORITHM, dek, iv);
    const encrypted = Buffer.concat([
      cipher.update(content, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return {
      algorithm: this.ALGORITHM,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      ciphertext: encrypted.toString('hex')
    };
  }

  /**
   * Decrypts an encrypted payload using the project's Data Encryption Key (DEK).
   */
  public static decryptContent(payload: EncryptedPayload, dek: Buffer): string {
    const iv = Buffer.from(payload.iv, 'hex');
    const authTag = Buffer.from(payload.authTag, 'hex');
    const ciphertext = Buffer.from(payload.ciphertext, 'hex');

    const decipher = crypto.createDecipheriv(this.ALGORITHM, dek, iv);
    decipher.setAuthTag(authTag);

    try {
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]);
      return decrypted.toString('utf8');
    } catch {
      throw new Error(
        'Integrity check failed: Corrupted file or invalid project key.'
      );
    }
  }

  /**
   * Creates an authentication verification token encrypted with the master passphrase.
   * Used to quickly test if an old passphrase is correct when changing passphrases.
   */
  public static createVerificationToken(masterPassphrase: string): EncryptedPayload {
    const dummyDek = Buffer.from(this.VERIFICATION_MAGIC, 'utf8');
    return this.encryptDek(dummyDek, masterPassphrase);
  }

  /**
   * Verifies if a given master passphrase is valid against an existing verification token.
   */
  public static verifyMasterPassphrase(token: EncryptedPayload, masterPassphrase: string): boolean {
    try {
      const decrypted = this.decryptDek(token, masterPassphrase);
      return decrypted.toString('utf8') === this.VERIFICATION_MAGIC;
    } catch {
      return false;
    }
  }

  /**
   * Utility to parse variable names (keys only) from an env file content string.
   */
  public static extractKeyNames(envContent: string): string[] {
    const keys: string[] = [];
    const lines = envContent.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const match = line.match(/^([A-Za-z_0-9]+)\s*=/);
      if (match && match[1]) {
        keys.push(match[1]);
      }
    }
    return Array.from(new Set(keys)).sort();
  }
}
