import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { VaultService } from './vaultService';

export class KeyManager {
  private static readonly SECRET_KEY = 'envKeeper.masterPassphrase';
  private secrets: vscode.SecretStorage;
  private sessionCachedPassphrase?: string;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
  }

  /**
   * Checks whether a master passphrase is saved in SecretStorage or in session memory.
   */
  public async hasSavedPassphrase(): Promise<boolean> {
    if (this.sessionCachedPassphrase) {
      return true;
    }
    const saved = await this.secrets.get(KeyManager.SECRET_KEY);
    return !!saved;
  }

  /**
   * Retrieves the master passphrase.
   * If not cached or stored, optionally prompts the user.
   */
  public async getPassphrase(promptIfMissing = true): Promise<string | undefined> {
    if (this.sessionCachedPassphrase) {
      return this.sessionCachedPassphrase;
    }

    const saved = await this.secrets.get(KeyManager.SECRET_KEY);
    if (saved) {
      this.sessionCachedPassphrase = saved;
      return saved;
    }

    if (!promptIfMissing) {
      return undefined;
    }

    return this.promptForPassphrase();
  }

  /**
   * Prompts user to enter their master passphrase.
   */
  public async promptForPassphrase(
    promptMessage = 'Enter your ENV Keeper Master Passphrase'
  ): Promise<string | undefined> {
    const input = await vscode.window.showInputBox({
      title: 'ENV Keeper Master Passphrase',
      prompt: promptMessage,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.length < 4) {
          return 'Passphrase must be at least 4 characters long.';
        }
        return null;
      }
    });

    if (input) {
      const config = vscode.workspace.getConfiguration('envKeeper');
      const remember = config.get<boolean>('rememberMasterPassword', true);
      this.sessionCachedPassphrase = input;

      if (remember) {
        await this.secrets.store(KeyManager.SECRET_KEY, input);
      }
    }

    return input;
  }

  /**
   * Setup initial Master Passphrase with option to copy to clipboard for saving in Google Password Manager.
   */
  public async setupNewPassphrase(): Promise<string | undefined> {
    const suggestedKey = this.generateRandomPassphrase();

    const choice = await vscode.window.showQuickPick(
      [
        {
          label: '$(pencil) Create my own Master Passphrase',
          detail: 'Type your own custom passphrase'
        },
        {
          label: '$(wand) Generate a strong random passphrase',
          detail: `e.g. ${suggestedKey}`
        }
      ],
      {
        placeHolder: 'Setup Master Passphrase for ENV Keeper (Two-Level Envelope Encryption)'
      }
    );

    if (!choice) {
      return undefined;
    }

    let chosenPassphrase: string | undefined;

    if (choice.label.includes('Generate')) {
      chosenPassphrase = suggestedKey;
    } else {
      const firstInput = await vscode.window.showInputBox({
        title: 'Create Master Passphrase - ENV Keeper',
        prompt: 'Enter a master passphrase to protect your encrypted vaults',
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value || value.length < 6) {
            return 'For your security, master passphrase must be at least 6 characters.';
          }
          return null;
        }
      });

      if (!firstInput) {
        return undefined;
      }

      const confirmInput = await vscode.window.showInputBox({
        title: 'Confirm Master Passphrase - ENV Keeper',
        prompt: 'Re-enter your master passphrase to confirm',
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (value !== firstInput) {
            return 'Passphrases do not match. Please try again.';
          }
          return null;
        }
      });

      if (!confirmInput) {
        return undefined;
      }

      chosenPassphrase = firstInput;
    }

    const config = vscode.workspace.getConfiguration('envKeeper');
    const remember = config.get<boolean>('rememberMasterPassword', true);

    this.sessionCachedPassphrase = chosenPassphrase;
    if (remember) {
      await this.secrets.store(KeyManager.SECRET_KEY, chosenPassphrase);
    }

    // Offer to copy to clipboard for Google Password Manager / 1Password / Bitwarden
    const action = await vscode.window.showInformationMessage(
      'ENV Keeper: Master Passphrase configured successfully! Recommended: Save it in your Password Manager (Google Password Manager, Bitwarden, etc.).',
      'Copy Passphrase to Clipboard',
      'Dismiss'
    );

    if (action === 'Copy Passphrase to Clipboard') {
      await vscode.env.clipboard.writeText(chosenPassphrase);
      vscode.window.showInformationMessage(
        'Passphrase copied to clipboard! Paste it safely into your password manager.'
      );
    }

    return chosenPassphrase;
  }

  /**
   * Securely changes the Master Passphrase:
   * 1. Requires old passphrase
   * 2. Prompts new passphrase
   * 3. Re-encrypts all project DEKs (Two-Level Encryption)
   * 4. Updates SecretStorage
   */
  public async changeMasterPassphrase(vaultService: VaultService): Promise<boolean> {
    const oldPassphrase = await vscode.window.showInputBox({
      title: 'Change Master Passphrase - Step 1 of 2',
      prompt: 'Enter your CURRENT master passphrase',
      password: true,
      ignoreFocusOut: true
    });

    if (!oldPassphrase) {
      return false;
    }

    // Verify old passphrase
    if (vaultService.hasVerificationToken() && !vaultService.verifyMasterPassphrase(oldPassphrase)) {
      vscode.window.showErrorMessage('ENV Keeper: The current master passphrase you entered is incorrect.');
      return false;
    }

    const newPassphrase = await vscode.window.showInputBox({
      title: 'Change Master Passphrase - Step 2 of 2',
      prompt: 'Enter your NEW master passphrase (min 6 characters)',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.length < 6) {
          return 'Passphrase must be at least 6 characters.';
        }
        if (value === oldPassphrase) {
          return 'New passphrase must be different from the old one.';
        }
        return null;
      }
    });

    if (!newPassphrase) {
      return false;
    }

    const confirmNew = await vscode.window.showInputBox({
      title: 'Confirm New Master Passphrase',
      prompt: 'Re-enter your NEW master passphrase to confirm',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (value !== newPassphrase) {
          return 'Passphrases do not match.';
        }
        return null;
      }
    });

    if (!confirmNew) {
      return false;
    }

    try {
      const result = vaultService.rekeyMasterPassphrase(oldPassphrase, newPassphrase);

      this.sessionCachedPassphrase = newPassphrase;
      const config = vscode.workspace.getConfiguration('envKeeper');
      const remember = config.get<boolean>('rememberMasterPassword', true);
      if (remember) {
        await this.secrets.store(KeyManager.SECRET_KEY, newPassphrase);
      }

      vscode.window.showInformationMessage(
        `🎉 Master Passphrase updated successfully! Re-keyed ${result.updatedCount} project(s) in vault.`
      );
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to update passphrase: ${err.message}`);
      return false;
    }
  }

  /**
   * Generates a random, pronounceable / hyphenated secure passphrase.
   */
  private generateRandomPassphrase(): string {
    const words = [
      'crypto', 'vault', 'shield', 'secure', 'keeper', 'anchor',
      'secret', 'galaxy', 'matrix', 'cipher', 'vector', 'planet',
      'shadow', 'nebula', 'photon', 'atomic', 'aurora', 'beacon'
    ];
    const pick = () => words[crypto.randomInt(0, words.length)];
    const num = crypto.randomInt(100, 999);
    return `${pick()}-${pick()}-${pick()}-${num}`;
  }

  /**
   * Clears the saved passphrase from SecretStorage and memory ("Lock Vault").
   */
  public async clearPassphrase(): Promise<void> {
    this.sessionCachedPassphrase = undefined;
    await this.secrets.delete(KeyManager.SECRET_KEY);
    vscode.window.showInformationMessage(
      'ENV Keeper: Master Passphrase cleared from memory and OS Keychain. Vault is locked.'
    );
  }
}
