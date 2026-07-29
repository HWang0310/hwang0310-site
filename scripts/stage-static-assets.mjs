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
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(scriptDirectory);

const defaults = {
  archiveFile: join(projectDirectory, "data/report-archive.json"),
  reportRoot:
    "/Users/hwang/Music/收入预估/收入预估2026/收入预估202607",
  thesisFile:
    "/Users/hwang/Pictures/厦大毕业相关/厦大毕业论文（终版）-王昊.pdf",
  distDir: join(projectDirectory, "dist"),
};

const thesisWebPath = "assets/papers/wang-hao-rkdg-thesis.pdf";
const archiveWebDirectory = "projects/income-forecast";

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
  return parsed.map((entry, index) => {
    const date = entry?.date;
    const folder = entry?.folder;

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
    seenDates.add(date);
    return { date, folder };
  });
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
    reports.push({ ...entry, source: canonicalSource, files });
  }

  await requireFile(thesisFile, "thesis");
  return reports.sort((a, b) => a.date.localeCompare(b.date));
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function replaceTargets(replacements, backupRoot) {
  const backups = [];
  const installed = [];

  try {
    for (const [index, replacement] of replacements.entries()) {
      await mkdir(dirname(replacement.target), { recursive: true });
      if (await pathExists(replacement.target)) {
        const backup = join(backupRoot, String(index));
        await mkdir(dirname(backup), { recursive: true });
        await rename(replacement.target, backup);
        backups.push({ target: replacement.target, backup });
      }
    }

    for (const replacement of replacements) {
      await rename(replacement.staged, replacement.target);
      installed.push(replacement.target);
    }
  } catch (error) {
    await Promise.all(
      installed.map((target) => rm(target, { recursive: true, force: true }))
    );
    for (const { target, backup } of backups.reverse()) {
      await rename(backup, target);
    }
    throw error;
  }
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
 * @returns {Promise<{files: number, dates: string[]}>}
 */
export async function stageStaticAssets(options = {}) {
  const resolvedOptions = { ...defaults, ...options };
  const reports = await prevalidateSources(resolvedOptions);
  const distDir = resolve(resolvedOptions.distDir);
  await mkdir(dirname(distDir), { recursive: true });
  const stagingRoot = await mkdtemp(
    join(dirname(distDir), ".stage-static-assets-")
  );
  const stagedDist = join(stagingRoot, "next");
  const backupRoot = join(stagingRoot, "backup");

  try {
    const manifest = reports.map(({ date }) => ({
      date,
      webPath: webPathForDate(date),
    }));
    const manifestText =
      `window.INCOME_FORECAST_ARCHIVE = ${JSON.stringify(manifest)};\n`;

    for (const report of reports) {
      const stagedReport = join(
        stagedDist,
        archiveWebDirectory,
        "reports",
        report.date.slice(0, 4),
        report.date.slice(4, 6),
        report.date.slice(6, 8)
      );
      await mkdir(dirname(stagedReport), { recursive: true });
      await cp(report.source, stagedReport, {
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

    const stagedManifest = join(
      stagedDist,
      archiveWebDirectory,
      "archive-manifest.js"
    );
    await mkdir(dirname(stagedManifest), { recursive: true });
    await writeFile(stagedManifest, manifestText, "utf8");

    const stagedThesis = join(stagedDist, thesisWebPath);
    await mkdir(dirname(stagedThesis), { recursive: true });
    await copyFile(resolvedOptions.thesisFile, stagedThesis);

    await replaceTargets(
      [
        {
          staged: join(stagedDist, archiveWebDirectory, "reports"),
          target: join(distDir, archiveWebDirectory, "reports"),
        },
        {
          staged: stagedManifest,
          target: join(distDir, archiveWebDirectory, "archive-manifest.js"),
        },
        {
          staged: stagedThesis,
          target: join(distDir, thesisWebPath),
        },
      ],
      backupRoot
    );

    return {
      files:
        reports.reduce((total, report) => total + report.files.length, 0) + 2,
      dates: reports.map(({ date }) => date),
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
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
