import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { EnvFileEntry } from '../types';

import { MergeHelper } from './mergeHelper';

export class DiffService {
  /**
   * Safely restores an array of EnvFileEntry objects into a workspace directory.
   */
  public static async restoreFiles(
    workspaceRoot: string,
    files: EnvFileEntry[]
  ): Promise<{ restored: string[]; skipped: string[]; merged: string[] }> {
    const restored: string[] = [];
    const skipped: string[] = [];
    const merged: string[] = [];

    for (const file of files) {
      const targetPath = path.join(workspaceRoot, file.relativePath);

      // If file doesn't exist locally, create it directly
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, file.content, 'utf8');
        restored.push(file.relativePath);
        continue;
      }

      // If file exists, check if contents are identical
      const existingContent = fs.readFileSync(targetPath, 'utf8');
      if (existingContent.trim() === file.content.trim()) {
        skipped.push(`${file.relativePath} (identical)`);
        continue;
      }

      // Contents differ! Ask user how to proceed
      const choice = await vscode.window.showWarningMessage(
        `ENV Keeper: "${file.relativePath}" already exists and has different contents.`,
        { modal: true },
        'View Diff',
        'Overwrite with Vault',
        'Merge Missing Keys',
        'Skip'
      );

      if (choice === 'View Diff') {
        // Create temporary file with backup content and open side-by-side diff
        const tmpDir = os.tmpdir();
        const tmpFile = path.join(tmpDir, `vault-${path.basename(file.relativePath)}`);
        fs.writeFileSync(tmpFile, file.content, 'utf8');

        await vscode.commands.executeCommand(
          'vscode.diff',
          vscode.Uri.file(tmpFile),
          vscode.Uri.file(targetPath),
          `Vault Backup ↔ Local (${file.relativePath})`
        );

        // Prompt again after opening diff
        const afterDiffChoice = await vscode.window.showInformationMessage(
          `Reviewing diff for "${file.relativePath}". How would you like to proceed?`,
          'Overwrite with Vault',
          'Merge Missing Keys',
          'Keep Local (Skip)'
        );

        if (afterDiffChoice === 'Overwrite with Vault') {
          fs.writeFileSync(targetPath, file.content, 'utf8');
          restored.push(file.relativePath);
        } else if (afterDiffChoice === 'Merge Missing Keys') {
          const mergedContent = MergeHelper.mergeEnvContents(existingContent, file.content);
          fs.writeFileSync(targetPath, mergedContent, 'utf8');
          merged.push(file.relativePath);
        } else {
          skipped.push(file.relativePath);
        }
      } else if (choice === 'Overwrite with Vault') {
        fs.writeFileSync(targetPath, file.content, 'utf8');
        restored.push(file.relativePath);
      } else if (choice === 'Merge Missing Keys') {
        const mergedContent = MergeHelper.mergeEnvContents(existingContent, file.content);
        fs.writeFileSync(targetPath, mergedContent, 'utf8');
        merged.push(file.relativePath);
      } else {
        skipped.push(file.relativePath);
      }
    }

    return { restored, skipped, merged };
  }

  public static mergeEnvContents(localContent: string, backupContent: string): string {
    return MergeHelper.mergeEnvContents(localContent, backupContent);
  }
}
