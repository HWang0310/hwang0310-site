import { HttpError } from "./http";

/** The narrow Storage surface used by administrative report cleanup. */
export type ReportStorageAdapter = Readonly<{
  list(
    path: string,
    options: Readonly<{ limit: number; offset: number }>,
  ): Promise<{ data: ReportStorageEntry[] | null; error: unknown | null }>;
  remove(paths: string[]): Promise<{ data: unknown; error: unknown | null }>;
}>;

export type ReportStorageEntry = Readonly<{
  name: string;
  /** Supabase Storage returns null for a folder and a non-null id for a file. */
  id: string | null;
}>;

type ReportStorageTarget = Readonly<{
  reportDate: string;
  storagePrefix: string | null;
}>;

const LIST_PAGE_SIZE = 1_000;
// Supabase Storage accepts large remove requests, but keeping this bound below
// the service's practical request limit means a failed delete never leaves us
// halfway through a report. We enumerate the complete tree before deleting.
const MAX_DELETABLE_FILES = 1_000;
const MAX_PREFIX_LENGTH = 512;
const MAX_ENTRY_NAME_LENGTH = 512;
const MAX_LISTED_ENTRIES = 100_000;

function unavailable(): never {
  throw new HttpError(503, "管理服务暂不可用");
}

function isCalendarDate(date: string): boolean {
  if (!/^\d{8}$/u.test(date)) return false;
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

/**
 * Validate the persisted prefix before it is ever passed to Storage.
 *
 * A report may own its date directory or a versioned child below that
 * directory. Both are safe as long as the date component is bound to the
 * database report date and every component is an ordinary path segment.
 */
export function validateReportStoragePrefix(
  reportDate: string,
  storagePrefix: string | null,
): string | null {
  if (storagePrefix === null) return null;
  if (!isCalendarDate(reportDate)) unavailable();
  if (
    storagePrefix.length === 0 ||
    storagePrefix.length > MAX_PREFIX_LENGTH ||
    storagePrefix.includes("\\") ||
    storagePrefix.includes("..") ||
    /[\u0000-\u001f\u007f]/u.test(storagePrefix)
  ) unavailable();

  const expected = `reports/${reportDate.slice(0, 4)}/${reportDate.slice(4, 6)}/${reportDate.slice(6, 8)}/`;
  if (!storagePrefix.startsWith(expected) || !storagePrefix.endsWith("/")) unavailable();

  const components = storagePrefix.split("/");
  if (components.at(-1) !== "") unavailable();
  for (const component of components.slice(0, -1)) {
    if (
      component.length === 0 ||
      component === "." ||
      component === ".." ||
      component.length > MAX_ENTRY_NAME_LENGTH
    ) unavailable();
  }
  return storagePrefix;
}

function validateEntryName(name: unknown): asserts name is string {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > MAX_ENTRY_NAME_LENGTH ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) unavailable();
}

/**
 * Recursively enumerate a report prefix and remove its files in one bounded
 * operation. Listing/removal failures intentionally abort before metadata is
 * changed by the caller.
 */
export async function removeReportStorageObjects(
  report: ReportStorageTarget,
  storage: ReportStorageAdapter,
): Promise<void> {
  const prefix = validateReportStoragePrefix(report.reportDate, report.storagePrefix);
  if (prefix === null) return;

  const pendingDirectories: string[] = [prefix];
  const files: string[] = [];
  let listedEntries = 0;

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.shift();
    if (directory === undefined) break;
    let offset = 0;
    while (true) {
      let response: Awaited<ReturnType<ReportStorageAdapter["list"]>>;
      try {
        response = await storage.list(directory, { limit: LIST_PAGE_SIZE, offset });
      } catch {
        unavailable();
      }
      if (response.error !== null || !Array.isArray(response.data)) unavailable();
      const entries = response.data;
      if (entries.length === 0) break;
      listedEntries += entries.length;
      if (listedEntries > MAX_LISTED_ENTRIES) unavailable();

      for (const entry of entries) {
        validateEntryName(entry?.name);
        const objectPath = `${directory}${entry.name}`;
        if (entry.id === null) {
          pendingDirectories.push(`${objectPath}/`);
        } else {
          files.push(objectPath);
        }
      }

      if (entries.length < LIST_PAGE_SIZE) break;
      offset += entries.length;
    }
  }

  // Do not partially delete a report. Storage does not expose a transaction
  // across multiple remove calls, so refuse an unusually large report before
  // the first mutation and perform one bounded remove operation.
  if (files.length > MAX_DELETABLE_FILES) unavailable();
  if (files.length === 0) return;
  try {
    const response = await storage.remove(files);
    if (response.error !== null) unavailable();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    unavailable();
  }
}
