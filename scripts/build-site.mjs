import {
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  stageStaticAssets,
  validateStaticTree,
} from "./stage-static-assets.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectDir = dirname(scriptDirectory);

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function runViteBuild({ projectDir, outDir }) {
  const { build } = await import("vite");
  await build({
    root: projectDir,
    build: {
      outDir,
      emptyOutDir: true,
    },
  });
}

/**
 * @typedef {Object} SwapOperations
 * @property {typeof rename} [rename]
 * @property {typeof rm} [rm]
 */

/**
 * Replaces one complete directory and restores the prior version on every
 * failed install or backup-cleanup path.
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
  let installed = false;

  try {
    if (await pathExists(resolvedTarget)) {
      await renamePath(resolvedTarget, backupDir);
      hasBackup = true;
    }

    await renamePath(stagedDir, resolvedTarget);
    installed = true;
    await removePath(transactionRoot, { recursive: true, force: true });
  } catch (primaryError) {
    const errors = [primaryError];
    let safeToRemoveTransaction = true;

    if (installed) {
      try {
        await removePath(resolvedTarget, { recursive: true, force: true });
        installed = false;
      } catch (cleanupError) {
        errors.push(cleanupError);
        safeToRemoveTransaction = false;
      }
    }

    if (hasBackup) {
      try {
        await renamePath(backupDir, resolvedTarget);
        hasBackup = false;
      } catch (restoreError) {
        errors.push(restoreError);
        safeToRemoveTransaction = false;
      }
    }

    if (safeToRemoveTransaction) {
      try {
        await removePath(transactionRoot, { recursive: true, force: true });
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
    }

    if (errors.length === 1) throw primaryError;
    throw new AggregateError(
      errors,
      `Unable to replace official dist; recovery backup: ${backupDir}`
    );
  }
}

/**
 * @typedef {Object} BuildSiteOptions
 * @property {string} [projectDir]
 * @property {string} [distDir]
 * @property {(options: {projectDir: string, outDir: string}) => Promise<void>} [build]
 * @property {(options: object) => Promise<{files: number, dates: string[]}>} [stage]
 * @property {(options: {stagedDir: string, targetDir: string}) => Promise<void>} [swap]
 * @property {string} [archiveFile]
 * @property {string} [reportRoot]
 * @property {string} [thesisFile]
 */

/**
 * Builds and validates a complete temporary site before replacing official
 * dist as one top-level directory.
 *
 * @param {BuildSiteOptions} [options]
 */
export async function buildSite(options = {}) {
  const projectDir = resolve(options.projectDir ?? defaultProjectDir);
  const distDir = resolve(options.distDir ?? join(projectDir, "dist"));
  const build = options.build ?? runViteBuild;
  const stage = options.stage ?? stageStaticAssets;
  const swap = options.swap ?? replaceDirectoryAtomically;

  await mkdir(dirname(distDir), { recursive: true });
  const buildRoot = await mkdtemp(join(dirname(distDir), ".build-site-"));
  const stagedDist = join(buildRoot, "dist");

  try {
    await build({ projectDir, outDir: stagedDist });
    const result = await stage({
      archiveFile:
        options.archiveFile ?? join(projectDir, "data/report-archive.json"),
      reportRoot:
        options.reportRoot ??
        "/Users/hwang/Music/收入预估/收入预估2026/收入预估202607",
      thesisFile:
        options.thesisFile ??
        "/Users/hwang/Pictures/厦大毕业相关/厦大毕业论文（终版）-王昊.pdf",
      distDir: stagedDist,
    });
    await validateStaticTree(stagedDist);
    await swap({ stagedDir: stagedDist, targetDir: distDir });
    return result;
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  buildSite()
    .then(({ files, dates }) => {
      process.stdout.write(
        `Built site and staged ${files} files for report dates: ${dates.join(", ")}\n`
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
