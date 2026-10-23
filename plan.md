# ENV Keeper: Enhancement & Bug Fix Plan

This document outlines the diagnosis of current issues, root-cause analyses, architectural enhancements, and an execution roadmap for **ENV Keeper**.

---

## 1. Issue Analysis: Why `.env` Was Not Restored (Critical Bug)

### Context & Symptom
In testing with project `HavenQuill`:
1. Workspace contained `.env` and `.env.example`.
2. Initial backup successfully encrypted both files (`fileCount: 2`).
3. The `.env` file was manually deleted from the project folder to test recovery.
4. Clicking **Restore** displayed: `ENV Keeper: Restored environment files for "HavenQuill". Skipped: .env.example (identical)`, but `.env` did **not** reappear in the project folder.

### Root Cause Diagnosis
1. **`.env.example` Treated as a Secret Environment File:**
   - In `ScannerService.isEnvFilename`, files matching `.env*` include `.env.example`, `.env.sample`, and `.env.template`.
   - When `.env` was deleted, `.env.example` remained in the folder.
   - The scanner saw `localFiles.length = 1` instead of `0`.
2. **Status Bar Misleading Prompt:**
   - `statusBar.ts` only triggers `$(cloud-download) Restore ENV` if `localFiles.length === 0`.
   - Because `localFiles.length === 1` and `metadata.fileCount === 2`, the status bar displayed:
     `$(shield) Backup ENV (1)`!
   - This prompted the user to *backup* the partial workspace rather than notifying them that a vaulted file was missing.
3. **Destructive Metadata Overwrite in `saveProjectBackup`:**
   - When a backup was subsequently triggered (or saved), `saveProjectBackup` completely overwrote `project.meta.json` with only the currently present file (`.env.example`), setting `fileCount: 1`.
   - This wiped `.env` from `project.meta.json`'s index!
   - Note: The encrypted file `root.env.enc` **still exists safely on disk** in `C:\Users\swaya\Documents\env-keeper-vault\github.com_swayamprabhu2005_havenquill\root.env.enc`. It was merely dereferenced from the metadata index.
4. **Restore Skipped Existing Files:**
   - When Restore was invoked, it only read files indexed in `project.meta.json` (which only listed `.env.example`).
   - Because `.env.example` already existed locally with identical content, `DiffService` skipped it, leaving `.env` un-restored.

### Proposed Fixes
* **Exclude Template Files by Default:** Update `ScannerService` to ignore `.example`, `.sample`, `.template`, `.test`, and `.dist` extensions (e.g., `.env.example`, `.env.sample`).
* **Non-Destructive Vault Backup:** When performing backups, merge existing vaulted file entries with new files unless a file is explicitly deleted by the user. If an encrypted `.enc` file exists on disk, preserve its entry in `project.meta.json`.
* **Smart Missing File Detection in Status Bar:** If `vaultFiles.length > localFiles.length`, show a warning status: `$(cloud-download) Restore Missing ENV (1 missing)`.
* **Vault Index Auto-Repair / Orphan Recovery:** When loading a project backup, scan the project vault folder for any `.enc` files (such as `root.env.enc`) that may be missing from `project.meta.json`, automatically re-indexing and restoring them.

---

## 2. Activity Bar Icon vs. Bottom Status Bar Icon

### Clarification
* **Bottom Status Bar Icon (Working As Desired):**
  - Appears at the bottom right next to `Go Live` (e.g., `🛡️ ENV Protected` or `$(cloud-download) Restore ENV`).
  - Provides instant status at a glance and one-click quick actions.
  - This is functioning properly and will be preserved.
* **Left Activity Bar Icon (Sidebar Panel):**
  - In VS Code, the Activity Bar is the primary left sidebar (containing Explorer, Search, Source Control).
  - In `package.json`, `viewsContainers.activitybar[0].icon` is currently set to `"$(shield)"`.
  - In VS Code extension architecture, activity bar container icons **must be file paths to an SVG or PNG image**, not Codicon strings like `"$(shield)"`.
  - While VS Code may display a fallback in some versions, using `"images/icon.png"` (or a dedicated monochromatic SVG) ensures the icon renders crisp and reliable in the sidebar.
  - Clicking this icon opens the **Vault Explorer** panel, allowing users to browse all vaulted projects on their PC, view secret key names without decrypting values, rekey passphrases, and view decrypted previews.

---

## 3. First-Run Setup & Onboarding Guide

### Problem
Currently, the extension silently creates `~/Documents/env-keeper-vault` upon first use without consulting the user, and only asks for a passphrase upon the first manual backup.

### Proposed Implementation
* **First Activation Trigger:** On initial activation (tracked via `context.globalState`):
  - Check if `envKeeper.vaultPath` and the Master Passphrase are configured.
  - If unconfigured, display an interactive onboarding notification:
    `"Welcome to ENV Keeper! Would you like to configure your vault storage path and master passphrase?"`
    - Option 1: `[Quick Setup (Default Documents Vault)]` -> Automatically uses `~/Documents/env-keeper-vault` and launches the passphrase setup prompt.
    - Option 2: `[Custom Vault Folder...]` -> Opens a folder picker dialog to select a cloud-synced folder (Dropbox, Google Drive, OneDrive, or local folder) and saves to `envKeeper.vaultPath`.
    - Option 3: `[Open Settings]` -> Directs user to VS Code Settings for full customization.

---

## 4. Intelligent Change Detection & Save Notifications

### Problem
* Currently, `envKeeper.autoBackupOnSave` defaults to `false`.
* When an `.env` file is edited and saved, no notification appears to inform the user that their workspace diverges from their vault backup.
* Furthermore, the status bar only checks file count (`fileCount === localFiles.length`), ignoring modifications to existing keys.

### Proposed Implementation
* **Content Hash Tracking:**
  - Store a SHA-256 hash of each `.env` file's content in memory or in metadata.
  - On file save (`workspace.onDidSaveTextDocument`):
    - If `autoBackupOnSave` is `true`: automatically re-encrypt and update the vault backup silently.
    - If `autoBackupOnSave` is `false`: detect that content has changed.
      - Update the status bar: `$(sync) Update Vault Backup`.
      - Display an actionable notification:
        `"ENV Keeper: Changes detected in .env for project '<ProjectName>'. Update encrypted vault backup?"`
        - Actions: `[Update Backup]` | `[Always Auto-Backup]` | `[Dismiss]`

---

## 5. Overview of Quick Menu Actions (Status Bar Menu)

When clicking the status bar item (`ENV Protected`), the following quick actions are available:

| Action | Function |
| :--- | :--- |
| **🛡️ Backup Workspace .env Files** | Scans workspace, encrypts all local `.env` files using AES-256-GCM, and updates vault. |
| **☁️ Restore .env Files from Vault** | Decrypts vaulted `.env` files for the active project and writes them to workspace. Supports diff/merge if conflicts exist. |
| **🔑 Manage Master Passphrase** | Options to change master passphrase (re-keys DEKs without re-encrypting files), copy passphrase to clipboard for password managers, or clear credentials. |
| **🔒 Lock Vault** | Clears the cached passphrase from active memory and OS Keychain (Windows Credential Manager). |
| **📁 Open Vault Folder on PC** | Opens Windows File Explorer directly to `C:\Users\<user>\Documents\env-keeper-vault`. |
| **⚙️ Configure Settings** | Opens VS Code Settings filtered to `envKeeper` for configuring paths, auto-backup, and ignore lists. |

---

## 6. Implementation Checklist (Future Step)

- [ ] Update `ScannerService` to ignore template env files (`.env.example`, `.env.sample`, `.env.template`).
- [ ] Refactor `VaultService.saveProjectBackup` to merge/preserve vaulted files rather than overwriting existing indexes.
- [ ] Add orphaned `.enc` file discovery and auto-recovery in `VaultService.loadProjectBackup`.
- [ ] Update `StatusBarManager` to show `Restore Missing ENV` when local files are missing compared to vault.
- [ ] Update `package.json` activity bar icon path to point to a valid image file (`images/icon.png` or `images/shield.svg`).
- [ ] Implement First-Run Setup Wizard (`onboardingService.ts`).
- [ ] Implement file save hash comparison and actionable prompt notification.
- [ ] Verify unit tests and package VSIX for testing.
