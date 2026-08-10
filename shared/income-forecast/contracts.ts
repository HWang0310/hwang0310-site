export const PUBLIC_REPORT_DATES = ["20260720", "20260725"] as const;
export const PRIVATE_STORAGE_SOFT_LIMIT_BYTES = 850 * 1024 * 1024;
export const PRIVATE_STORAGE_HARD_LIMIT_BYTES = 1_000_000_000;

export type AppRole = "user" | "admin" | "root_admin";
export type ReportVisibility = "public" | "private";
export type ReportSummary = {
  date: string;
  webPath: string;
  visibility: ReportVisibility;
  pinned: boolean;
  sizeBytes: number;
  online: boolean;
};
