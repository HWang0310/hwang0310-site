import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
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

async function pathExists(path) {
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
  await requireDirectory(root, "staged site");

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
  if (await pathExists(distDir)) {
    await validateStaticTree(distDir);
  } else {
    await mkdir(distDir, { recursive: true });
  }

  const manifest = reports.map(({ date }) => ({
    date,
    webPath: webPathForDate(date),
  }));
  const manifestText =
    `window.INCOME_FORECAST_ARCHIVE = ${JSON.stringify(manifest)};\n`;
  const reportsTarget = join(distDir, archiveWebDirectory, "reports");
  const manifestTarget = join(
    distDir,
    archiveWebDirectory,
    "archive-manifest.js"
  );
  const thesisTarget = join(distDir, thesisWebPath);

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

  await mkdir(dirname(manifestTarget), { recursive: true });
  await writeFile(manifestTarget, manifestText, "utf8");
  await mkdir(dirname(thesisTarget), { recursive: true });
  await copyFile(resolvedOptions.thesisFile, thesisTarget);
  await validateStaticTree(distDir);

  return {
    files:
      reports.reduce((total, report) => total + report.files.length, 0) + 2,
    dates: reports.map(({ date }) => date),
  };
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
