<p align="center">
  <img src="images/icon.png" width="100" height="100" alt="EnvKeeper Logo" />
</p>

# 📘 EnvKeeper Complete User & Deployment Guide

> **Welcome to EnvKeeper!** This guide walks you through every feature, workflow, and security practice so you can effortlessly manage your environment secrets across all your machines and projects.

---

## 📑 Table of Contents
1. [Installation](#1-installation)
2. [Setting Up Your Master Passphrase](#2-setting-up-your-master-passphrase)
3. [Saving Passphrase in Google Password Manager](#3-saving-passphrase-in-google-password-manager)
4. [The Daily Workflow: 1-Click Backup](#4-the-daily-workflow-1-click-backup)
5. [The Re-Clone Workflow: 1-Click Restore](#5-the-re-clone-workflow-1-click-restore)
6. [Monorepos & Multiple Environment Files](#6-monorepos--multiple-environment-files)
7. [Collision Guard & Visual Diffing](#7-collision-guard--visual-diffing)
8. [Changing Your Master Passphrase (Re-Keying)](#8-changing-your-master-passphrase-re-keying)
9. [Activity Bar Sidebar Explorer](#9-activity-bar-sidebar-explorer)
10. [Configuration & Custom Storage Path](#10-configuration--custom-storage-path)
11. [Publishing to the VS Code Marketplace](#11-publishing-to-the-vs-code-marketplace)
12. [Security & Threat Model](#12-security--threat-model)

---

## 1. Installation

### From VS Code Marketplace
1. Open Visual Studio Code.
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on macOS) to open the Extensions view.
3. Search for **`EnvKeeper: Local Secret Vault`**.
4. Click **Install**.

### Manual VSIX Installation
If you built the extension locally or downloaded the `.vsix`:
```bash
code --install-extension envkeeper-0.1.0.vsix
```
*Or in VS Code: Click `...` in the top right of the Extensions panel -> **Install from VSIX...** -> select `envkeeper-0.1.0.vsix`.*

---

## 2. Setting Up Your Master Passphrase

When you perform your first backup or run `ENV Keeper: Set or Reset Master Passphrase`, EnvKeeper offers two options:

1. **Create my own Master Passphrase**: Enter your own secure passphrase (minimum 6 characters).
2. **Generate a strong random passphrase**: EnvKeeper will create a cryptographically secure, hyphenated passphrase (e.g. `galaxy-shield-beacon-492`).

### OS Keychain Integration
By default, EnvKeeper securely saves your Master Passphrase in your operating system's native credential store:
- **Windows**: Windows Credential Manager
- **macOS**: Apple Keychain Services
- **Linux**: Secret Service API / GNOME Keyring / KWallet

This means you do not have to re-enter your password every time you make a backup or switch branches!

---

## 3. Saving Passphrase in Google Password Manager

To ensure you never lose your Master Passphrase even if you switch laptops:

1. When you configure your passphrase, EnvKeeper displays a notification:
   > *"ENV Keeper: Master Passphrase configured successfully! Recommended: Save it in your Password Manager."*
2. Click **Copy Passphrase to Clipboard**.
3. Open **Google Password Manager** (or Bitwarden, 1Password):
   - Go to [passwords.google.com](https://passwords.google.com) or Chrome Settings -> Autofill and passwords -> Password Manager.
   - Click **+ Add password**.
   - Set Title / App: `VS Code - EnvKeeper`
   - Username: `Your GitHub Username / Email`
   - Password: Paste your copied Master Passphrase (`Ctrl+V`).
   - Save!

Now your Master Passphrase is backed up securely in your Google Account.

---

## 4. The Daily Workflow: 1-Click Backup

1. Open any project in VS Code that contains a `.env` file (e.g. with Gemini, Groq, Stripe, or DB credentials).
2. Look at the bottom-right status bar:
   - You will see: **`$(shield) Backup ENV (1)`**.
3. Click the button.
4. EnvKeeper will:
   - Identify your project's Git Remote URL (`github.com/user/project`).
   - Generate a unique 256-bit Data Encryption Key (DEK).
   - Encrypt each `.env` file using AES-256-GCM.
   - Save the encrypted files in `~/Documents/env-keeper-vault/github.com_user_project/`.
5. The status bar immediately updates to: **`$(check) ENV Protected`**.

---

## 5. The Re-Clone Workflow: 1-Click Restore

Here is the exact pain point EnvKeeper solves:

1. You delete your local project folder to save space.
2. Weeks or months later, you clone the repository from GitHub:
   ```bash
   git clone https://github.com/your-username/your-ai-project.git
   ```
3. Open the folder in VS Code.
4. Notice that `.gitignore` prevented `.env` from being committed, so the folder has no API keys.
5. **EnvKeeper detects the Git remote origin!**
6. The status bar immediately lights up with a warning badge:
   - **`$(cloud-download) Restore ENV`**.
7. Click the button:
   - EnvKeeper retrieves the project's encrypted vault.
   - Decrypts the keys using your Master Passphrase.
   - Writes the `.env` file directly into your workspace.
8. Your Gemini, Groq, and API keys are restored in **less than 2 seconds**!

---

## 6. Monorepos & Multiple Environment Files

In modern full-stack projects, you often have multiple environment files:
```text
my-fullstack-app/
├── .env
├── apps/
│   ├── web/
│   │   └── .env.local
│   └── api/
│       └── .env.production
```

EnvKeeper handles this automatically:
- Scans recursively while ignoring noise (`node_modules`, `.git`, `dist`, `build`, `.next`, `venv`).
- Encrypts each file individually into the vault:
  - `root.env.enc`
  - `apps__web__.env.local.enc`
  - `apps__api__.env.production.enc`
- On restore, relative file paths are strictly preserved!

---

## 7. Collision Guard & Visual Diffing

If you run `Restore` on a project that *already* has a local `.env` file with different content, EnvKeeper protects your work by prompting you with 4 options:

1. **View Diff**: Opens VS Code's native side-by-side Diff editor (`Vault Backup ↔ Local (.env)`) so you can inspect line-by-line differences.
2. **Merge Missing Keys**: Keeps all existing local keys unchanged, and appends any keys present in the vault that are missing locally under a `# --- Restored from ENV Keeper Backup ---` comment block.
3. **Overwrite with Vault**: Replaces the local file with the version from the vault.
4. **Skip**: Leaves the local file untouched.

---

## 8. Changing Your Master Passphrase (Re-Keying)

If you ever wish to rotate your Master Passphrase:

1. Press `Ctrl+Shift+P` -> type `ENV Keeper: Actions Menu`.
2. Select **Manage Master Passphrase** -> **Change Master Passphrase**.
3. Enter your **Current Passphrase**.
4. Enter your **New Passphrase** (twice to confirm).
5. EnvKeeper verifies your identity and re-keys all project vaults instantly.
   - *Technical Note*: Because EnvKeeper uses **Two-Level Envelope Encryption**, changing your password only re-encrypts the tiny 32-byte DEKs. Your `.env` files are never touched, making password rotation instant and safe.

---

## 9. Activity Bar Sidebar Explorer

Click the **EnvKeeper** shield icon in the VS Code Activity Bar (left sidebar):

* **Active Workspace**:
  - Displays project status (Vaulted / Unsaved).
  - Lists all `.env` files discovered in the current project.
  - Quick action buttons to Backup or Restore.
* **All Vaulted Projects**:
  - Lists every repository backed up on this PC.
  - Expand any project to see stored file names and variable keys (`GEMINI_API_KEY`, `GROQ_API_KEY`) without decrypting values.
  - Context menu buttons:
    - `$(cloud-download)` Restore to current workspace.
    - `$(eye)` Preview decrypted keys in a temporary readonly buffer.
    - `$(trash)` Permanently delete a project from the vault.

---

## 10. Configuration & Custom Storage Path

Open Settings (`Ctrl+,`) and search for `envKeeper`:

| Setting | Description |
|---|---|
| `envKeeper.vaultPath` | Change the vault folder from the default `~/Documents/env-keeper-vault` to a custom directory or encrypted external drive. |
| `envKeeper.autoBackupOnSave` | When set to `true`, EnvKeeper automatically updates the vault whenever you press `Ctrl+S` on any `.env` file. |
| `envKeeper.rememberMasterPassword` | When `true`, saves the passphrase in Windows Credential Manager / macOS Keychain. |
| `envKeeper.ignoredDirectories` | Customize list of directory names to exclude during workspace scan. |

---

## 11. Publishing to the VS Code Marketplace

When you are ready to publish:

1. In `package.json`, set `"publisher": "your-publisher-name"` (the same publisher ID you used for *Identity Generator*).
2. Generate an Azure DevOps Personal Access Token (PAT) with `Marketplace (Manage)` scope.
3. Run:
   ```bash
   npx @vscode/vsce login <your-publisher-name>
   npx @vscode/vsce publish
   ```
4. Within minutes, your extension will be live on the VS Code Marketplace!

---

## 12. Security & Threat Model

* **Local-First & Offline**: EnvKeeper runs 100% locally. Zero telemetry, zero analytics, zero network requests. Your API keys never leave your machine.
* **Algorithm**: Standard AES-256-GCM (Galois/Counter Mode) with 128-bit authentication tags that guarantee both confidentiality and cryptographic integrity.
* **Key Derivation**: PBKDF2 using SHA-512 with 100,000 iterations and unique 16-byte cryptographically random salt per project.
* **Tamper Proof**: If any file in your vault is corrupted or edited by an external program, decryption will safely fail rather than injecting corrupted data.

---

*Authored by Swayam Prabhu. Licensed under MIT.*
