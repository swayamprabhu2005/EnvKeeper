export class MergeHelper {
  /**
   * Merges keys from backup into existing local content.
   * Keeps existing local values unchanged, appends new keys from backup.
   */
  public static mergeEnvContents(localContent: string, backupContent: string): string {
    const existingKeys = new Set<string>();
    const localLines = localContent.split(/\r?\n/);

    for (const line of localLines) {
      const match = line.trim().match(/^([A-Za-z_0-9]+)\s*=/);
      if (match && match[1]) {
        existingKeys.add(match[1]);
      }
    }

    const missingLines: string[] = [];
    const backupLines = backupContent.split(/\r?\n/);

    for (const line of backupLines) {
      const match = line.trim().match(/^([A-Za-z_0-9]+)\s*=/);
      if (match && match[1]) {
        if (!existingKeys.has(match[1])) {
          missingLines.push(line);
        }
      }
    }

    if (missingLines.length === 0) {
      return localContent;
    }

    const separator = localContent.endsWith('\n') ? '' : '\n';
    return (
      localContent +
      separator +
      '\n# --- Restored from ENV Keeper Backup ---\n' +
      missingLines.join('\n') +
      '\n'
    );
  }
}
