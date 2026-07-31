import {
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  stageStaticAssets,
} from "./stage-static-assets.mjs";
import {
  replaceDirectoryAtomically,
  reportCleanupWarning,
  validateStaticTree,
} from "./static-tree.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectDir = dirname(scriptDirectory);

export { replaceDirectoryAtomically } from "./static-tree.mjs";

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
 * @typedef {Object} BuildSiteOptions
 * @property {string} [projectDir]
 * @property {string} [distDir]
 * @property {(options: {projectDir: string, outDir: string}) => Promise<void>} [build]
 * @property {(options: object) => Promise<{files: number, dates: string[]}>} [stage]
 * @property {(options: {stagedDir: string, targetDir: string}) => Promise<void>} [swap]
 * @property {typeof rm} [cleanup]
 * @property {(error: unknown, context: string) => void} [onCleanupWarning]
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
  const cleanup = options.cleanup ?? rm;
  const onCleanupWarning =
    options.onCleanupWarning ?? reportCleanupWarning;

  await mkdir(dirname(distDir), { recursive: true });
  const buildRoot = await mkdtemp(join(dirname(distDir), ".build-site-"));
  const stagedDist = join(buildRoot, "dist");
  let primaryError;
  let committed = false;
  let result;

  try {
    await build({ projectDir, outDir: stagedDist });
    result = await stage({
      archiveFile:
        options.archiveFile ?? join(projectDir, "data/report-archive.json"),
      reportRoot:
        options.reportRoot ??
        process.env.INCOME_FORECAST_REPORT_ROOT ??
        join(
          homedir(),
          "Music",
          "收入预估",
          "收入预估2026",
          "收入预估202607"
        ),
      thesisFile:
        options.thesisFile ??
        process.env.HWANG_THESIS_FILE ??
        join(
          homedir(),
          "Pictures",
          "厦大毕业相关",
          "厦大毕业论文（终版）-王昊.pdf"
        ),
      distDir: stagedDist,
    });
    await validateStaticTree(stagedDist);
    await swap({ stagedDir: stagedDist, targetDir: distDir });
    committed = true;
  } catch (error) {
    primaryError = error;
  }

  try {
    await cleanup(buildRoot, { recursive: true, force: true });
  } catch (cleanupError) {
    if (primaryError) {
      primaryError = new AggregateError(
        [primaryError, cleanupError],
        `Site build failed and temporary cleanup also failed: ${buildRoot}`
      );
    } else if (committed) {
      try {
        onCleanupWarning(
          cleanupError,
          `Site committed; temporary cleanup may remain at ${buildRoot}`
        );
      } catch (notificationError) {
        reportCleanupWarning(
          new AggregateError([cleanupError, notificationError]),
          `Site committed; cleanup warning notification failed`
        );
      }
    } else {
      primaryError = cleanupError;
    }
  }

  if (primaryError) throw primaryError;
  return result;
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
