import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { CryptoService } from '../services/cryptoService';

describe('CryptoService Two-Level Envelope Encryption Tests', () => {
  const masterPassphrase = 'SuperSecretMasterPassword123!';
  const wrongPassphrase = 'IncorrectPassword456!';

  test('should generate a 256-bit random DEK and encrypt/decrypt it with Master Passphrase', () => {
    const dek = CryptoService.generateDek();
    assert.strictEqual(dek.length, 32);

    const encryptedDek = CryptoService.encryptDek(dek, masterPassphrase);
    assert.strictEqual(encryptedDek.algorithm, 'aes-256-gcm');
    assert.ok(encryptedDek.ciphertext.length > 0);

    const decryptedDek = CryptoService.decryptDek(encryptedDek, masterPassphrase);
    assert.deepStrictEqual(decryptedDek, dek);
  });

  test('should fail DEK decryption if wrong master passphrase is used', () => {
    const dek = CryptoService.generateDek();
    const encryptedDek = CryptoService.encryptDek(dek, masterPassphrase);

    assert.throws(
      () => {
        CryptoService.decryptDek(encryptedDek, wrongPassphrase);
      },
      /Decryption failed/
    );
  });

  test('should perform full two-level envelope encryption roundtrip for .env content', () => {
    const envContent = 'GEMINI_API_KEY=AIzaSyTest123\nGROQ_API_KEY=gsk_test456\nPORT=3000\n';

    // Level 1: Generate project DEK
    const dek = CryptoService.generateDek();
    // Level 2: Encrypt DEK with Master Passphrase
    const encryptedDek = CryptoService.encryptDek(dek, masterPassphrase);

    // Encrypt file content with DEK
    const encryptedFile = CryptoService.encryptContent(envContent, dek);
    assert.strictEqual(encryptedFile.algorithm, 'aes-256-gcm');

    // Decrypt flow:
    // 1. Decrypt DEK using Master Passphrase
    const restoredDek = CryptoService.decryptDek(encryptedDek, masterPassphrase);
    // 2. Decrypt file using restored DEK
    const decryptedContent = CryptoService.decryptContent(encryptedFile, restoredDek);

    assert.strictEqual(decryptedContent, envContent);
  });

  test('should verify master passphrase with verification token', () => {
    const token = CryptoService.createVerificationToken(masterPassphrase);

    assert.strictEqual(CryptoService.verifyMasterPassphrase(token, masterPassphrase), true);
    assert.strictEqual(CryptoService.verifyMasterPassphrase(token, wrongPassphrase), false);
  });

  test('should extract environment variable key names correctly', () => {
    const envContent = `
      # Database settings
      DATABASE_URL=postgresql://localhost:5432/mydb
      # API Keys
      GEMINI_API_KEY=test_gemini
      GROQ_API_KEY=test_groq

      # Port configuration
      PORT=8080
      EMPTY_KEY=
    `;

    const keys = CryptoService.extractKeyNames(envContent);
    assert.deepStrictEqual(keys, [
      'DATABASE_URL',
      'EMPTY_KEY',
      'GEMINI_API_KEY',
      'GROQ_API_KEY',
      'PORT'
    ]);
  });
});
