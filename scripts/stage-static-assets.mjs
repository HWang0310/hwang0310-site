import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  pathExists,
  replaceDirectoryAtomically,
  reportCleanupWarning,
  validateStaticTree,
} from "./static-tree.mjs";
import { PUBLIC_REPORT_DATES } from "../shared/income-forecast/contracts.ts";

export { validateStaticTree } from "./static-tree.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(scriptDirectory);

const defaults = {
  archiveFile: join(projectDirectory, "data/report-archive.json"),
  reportRoot:
    process.env.INCOME_FORECAST_REPORT_ROOT ??
    join(homedir(), "Music", "收入预估", "收入预估2026", "收入预估202607"),
  thesisFile:
    process.env.HWANG_THESIS_FILE ??
    join(
      homedir(),
      "Pictures",
      "厦大毕业相关",
      "厦大毕业论文（终版）-王昊.pdf"
    ),
  distDir: join(projectDirectory, "dist"),
};

const thesisWebPath = "assets/papers/wang-hao-rkdg-thesis.pdf";
const archiveWebDirectory = "projects/income-forecast";
const privatePathMarkers = [
  Buffer.from("/Users/"),
  Buffer.from("file:///Users/"),
];

function isInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent))
  );
}

function webPathForDate(date) {
  const year = date.slice(0, 4);
  const month = date.slice(4, 6);
  const day = date.slice(6, 8);
  return `/projects/income-forecast/reports/${year}/${month}/${day}/`;
}

function validateDate(date) {
  if (!/^\d{8}$/.test(date)) return false;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

async function requireFile(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} is missing: ${path}`);
    }
    throw error;
  }
  if (!metadata.isFile()) {
    throw new Error(`${label} must be a file: ${path}`);
  }
  await access(path, constants.R_OK);
}

async function requireDirectory(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} is missing: ${path}`);
    }
    throw error;
  }
  if (!metadata.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`);
  }
  await access(path, constants.R_OK);
}

async function inventoryDirectory(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = join(current, entry.name);
    const relativePath = relative(root, entryPath);
    const metadata = await lstat(entryPath);

    if (metadata.isSymbolicLink()) {
      throw new Error(
        `Report resources may not contain symbolic links: ${relativePath}`
      );
    }
    if (metadata.isDirectory()) {
      files.push(...(await inventoryDirectory(root, entryPath)));
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error(`Unsupported report resource: ${relativePath}`);
    }
    await access(entryPath, constants.R_OK);
    files.push(relativePath);
  }

  return files;
}

async function readArchive(archiveFile) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(archiveFile, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read report archive ${archiveFile}: ${error.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Report archive must be a non-empty array");
  }

  const seenDates = new Set();
  const entries = parsed.map((entry, index) => {
    const date = entry?.date;
    const folder = entry?.folder;
    const visibility = entry?.visibility;
    const pinned = entry?.pinned;

    if (!validateDate(date)) {
      throw new Error(`Invalid report date at archive entry ${index}`);
    }
    if (
      typeof folder !== "string" ||
      folder.length === 0 ||
      folder === "." ||
      folder === ".." ||
      basename(folder) !== folder
    ) {
      throw new Error(`Invalid report folder at archive entry ${index}`);
    }
    if (seenDates.has(date)) {
      throw new Error(`Duplicate report date in archive: ${date}`);
    }
    if (visibility !== "public" && visibility !== "private") {
      throw new Error(`Invalid report visibility at archive entry ${index}`);
    }
    if (typeof pinned !== "boolean") {
      throw new Error(`Invalid report pinned state at archive entry ${index}`);
    }
    seenDates.add(date);
    return { date, folder, visibility, pinned };
  });

  const entriesByDate = new Map(entries.map((entry) => [entry.date, entry]));
  for (const date of PUBLIC_REPORT_DATES) {
    const entry = entriesByDate.get(date);
    if (!entry || entry.visibility !== "public" || !entry.pinned) {
      throw new Error(`Public report policy requires ${date} to be public and pinned`);
    }
  }

  return entries
    .filter(
      (entry) =>
        entry.visibility === "public" && PUBLIC_REPORT_DATES.includes(entry.date)
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function prevalidateSources({ archiveFile, reportRoot, thesisFile }) {
  const entries = await readArchive(archiveFile);
  const canonicalRoot = await realpath(reportRoot);
  const reports = [];

  for (const entry of entries) {
    const source = resolve(canonicalRoot, entry.folder);
    await requireDirectory(source, `report ${entry.date}`);
    const canonicalSource = await realpath(source);
    if (!isInside(canonicalRoot, canonicalSource)) {
      throw new Error(`Report folder escapes the approved report root: ${entry.folder}`);
    }

    await requireFile(join(canonicalSource, "index.html"), `${entry.date} index.html`);
    await requireDirectory(join(canonicalSource, "cities"), `${entry.date} cities`);
    await requireDirectory(join(canonicalSource, "assets"), `${entry.date} assets`);
    const files = await inventoryDirectory(canonicalSource);
    for (const file of files) {
      if (file === "assets/archive-manifest.js") continue;
      const contents = await readFile(join(canonicalSource, file));
      if (privatePathMarkers.some((marker) => contents.includes(marker))) {
        throw new Error(
          `Local filesystem path found in source report file: ${entry.date}/${file}`
        );
      }
    }
    reports.push({ ...entry, source: canonicalSource, files });
  }

  await requireFile(thesisFile, "thesis");
  return reports.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * @typedef {Object} StaticStagingOptions
 * @property {string} archiveFile
 * @property {string} reportRoot
 * @property {string} thesisFile
 * @property {string} distDir
 */

/**
 * @param {Partial<StaticStagingOptions>} [options]
 * @param {{
 *   copyReport?: typeof cp,
 *   cleanup?: typeof rm,
 *   swap?: typeof replaceDirectoryAtomically,
 *   onCleanupWarning?: (error: unknown, context: string) => void
 * }} [operations]
 * @returns {Promise<{files: number, dates: string[]}>}
 */
export async function stageStaticAssets(options = {}, operations = {}) {
  const resolvedOptions = { ...defaults, ...options };
  const reports = await prevalidateSources(resolvedOptions);
  const distDir = resolve(resolvedOptions.distDir);
  const copyReport = operations.copyReport ?? cp;
  const cleanup = operations.cleanup ?? rm;
  const swap = operations.swap ?? replaceDirectoryAtomically;
  const onCleanupWarning =
    operations.onCleanupWarning ?? reportCleanupWarning;
  await mkdir(dirname(distDir), { recursive: true });
  const hasExistingDist = await pathExists(distDir);
  if (hasExistingDist) {
    await validateStaticTree(distDir);
  }
  const stagingRoot = await mkdtemp(
    join(dirname(distDir), ".stage-static-assets-")
  );
  const stagedDist = join(stagingRoot, "dist");
  let primaryError;
  let committed = false;
  let result;

  try {
    if (hasExistingDist) {
      await cp(distDir, stagedDist, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    } else {
      await mkdir(stagedDist, { recursive: true });
    }

    const manifest = reports.map(({ date }) => ({
      date,
      webPath: webPathForDate(date),
    }));
    const manifestText =
      `window.INCOME_FORECAST_ARCHIVE = ${JSON.stringify(manifest)};\n`;
    const reportsTarget = join(
      stagedDist,
      archiveWebDirectory,
      "reports"
    );
    const manifestTarget = join(
      stagedDist,
      archiveWebDirectory,
      "archive-manifest.js"
    );
    const thesisTarget = join(stagedDist, thesisWebPath);

    await rm(reportsTarget, { recursive: true, force: true });
    await rm(manifestTarget, { force: true });
    await rm(thesisTarget, { force: true });

    for (const report of reports) {
      const stagedReport = join(
        reportsTarget,
        report.date.slice(0, 4),
        report.date.slice(4, 6),
        report.date.slice(6, 8)
      );
      await mkdir(dirname(stagedReport), { recursive: true });
      await copyReport(report.source, stagedReport, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      if (report.files.includes("assets/archive-manifest.js")) {
        await writeFile(
          join(stagedReport, "assets/archive-manifest.js"),
          manifestText,
          "utf8"
        );
      }
    }

    await mkdir(dirname(manifestTarget), { recursive: true });
    await writeFile(manifestTarget, manifestText, "utf8");
    await mkdir(dirname(thesisTarget), { recursive: true });
    await copyFile(resolvedOptions.thesisFile, thesisTarget);
    await validateStaticTree(stagedDist);
    await swap(
      { stagedDir: stagedDist, targetDir: distDir },
      { onCleanupWarning }
    );
    committed = true;
    result = {
      files:
        reports.reduce((total, report) => total + report.files.length, 0) + 2,
      dates: reports.map(({ date }) => date),
    };
  } catch (error) {
    primaryError = error;
  }

  try {
    await cleanup(stagingRoot, { recursive: true, force: true });
  } catch (cleanupError) {
    if (primaryError) {
      primaryError = new AggregateError(
        [primaryError, cleanupError],
        `Static staging failed and temporary cleanup also failed: ${stagingRoot}`
      );
    } else if (committed) {
      try {
        onCleanupWarning(
          cleanupError,
          `Static assets committed; temporary cleanup may remain at ${stagingRoot}`
        );
      } catch (notificationError) {
        reportCleanupWarning(
          new AggregateError([cleanupError, notificationError]),
          `Static assets committed; cleanup warning notification failed`
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
  stageStaticAssets()
    .then(({ files, dates }) => {
      process.stdout.write(
        `Staged ${files} files for report dates: ${dates.join(", ")}\n`
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
