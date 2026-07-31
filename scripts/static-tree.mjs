import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const privatePathMarkers = [
  Buffer.from("/Users/"),
  Buffer.from("file:///Users/"),
];

export async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Rejects symbolic links and local filesystem paths anywhere in a staged site.
 *
 * @param {string} root
 */
export async function validateStaticTree(root) {
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory()) {
    throw new Error(`Staged site must be a directory: ${root}`);
  }

  async function validateDirectory(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      const relativePath = relative(root, entryPath);
      const metadata = await lstat(entryPath);

      if (metadata.isSymbolicLink()) {
        throw new Error(`Symbolic link found in staged site: ${relativePath}`);
      }
      if (metadata.isDirectory()) {
        await validateDirectory(entryPath);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error(`Unsupported staged site resource: ${relativePath}`);
      }

      const contents = await readFile(entryPath);
      if (privatePathMarkers.some((marker) => contents.includes(marker))) {
        throw new Error(
          `Local filesystem path found in staged site file: ${relativePath}`
        );
      }
    }
  }

  await validateDirectory(root);
}

export function reportCleanupWarning(error, context) {
  const message = error instanceof Error ? error.message : String(error);
  process.emitWarning(`${context}: ${message}`, {
    code: "STATIC_CLEANUP_FAILED",
  });
}

function notifyCleanupWarning(notify, error, context) {
  try {
    notify(error, context);
  } catch (notificationError) {
    reportCleanupWarning(
      new AggregateError([error, notificationError], context),
      context
    );
  }
}

/**
 * @typedef {Object} SwapOperations
 * @property {typeof rename} [rename]
 * @property {typeof rm} [rm]
 * @property {(error: unknown, context: string) => void} [onCleanupWarning]
 */

/**
 * Replaces a directory as one commit. Failures before the staged directory is
 * installed restore the old directory. Cleanup failures after install retain
 * the complete new directory and are warnings, never rollback triggers.
 *
 * @param {{stagedDir: string, targetDir: string}} paths
 * @param {SwapOperations} [operations]
 */
export async function replaceDirectoryAtomically(
  { stagedDir, targetDir },
  operations = {}
) {
  const renamePath = operations.rename ?? rename;
  const removePath = operations.rm ?? rm;
  const onCleanupWarning =
    operations.onCleanupWarning ?? reportCleanupWarning;
  const resolvedTarget = resolve(targetDir);
  const targetParent = dirname(resolvedTarget);

  await validateStaticTree(stagedDir);
  await mkdir(targetParent, { recursive: true });

  if (await pathExists(resolvedTarget)) {
    const targetMetadata = await lstat(resolvedTarget);
    if (targetMetadata.isSymbolicLink()) {
      throw new Error(`Official dist must not be a symbolic link: ${resolvedTarget}`);
    }
    if (!targetMetadata.isDirectory()) {
      throw new Error(`Official dist must be a directory: ${resolvedTarget}`);
    }
  }

  const transactionRoot = await mkdtemp(join(targetParent, ".dist-swap-"));
  const backupDir = join(transactionRoot, "previous");
  let hasBackup = false;

  try {
    if (await pathExists(resolvedTarget)) {
      await renamePath(resolvedTarget, backupDir);
      hasBackup = true;
    }
    await renamePath(stagedDir, resolvedTarget);
  } catch (primaryError) {
    const errors = [primaryError];
    let restored = !hasBackup;

    if (hasBackup) {
      try {
        await renamePath(backupDir, resolvedTarget);
        hasBackup = false;
        restored = true;
      } catch (restoreError) {
        errors.push(restoreError);
      }
    }

    if (restored) {
      try {
        await removePath(transactionRoot, { recursive: true, force: true });
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
    }

    if (errors.length === 1) throw primaryError;
    throw new AggregateError(
      errors,
      `Unable to install directory; recovery backup: ${backupDir}`
    );
  }

  try {
    await removePath(transactionRoot, { recursive: true, force: true });
  } catch (cleanupError) {
    notifyCleanupWarning(
      onCleanupWarning,
      cleanupError,
      `Committed directory; cleanup may remain at ${transactionRoot}`
    );
  }
}
