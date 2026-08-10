import { describe, expect, it, vi } from "vitest";

import {
  ALLOWED_REPORT_MIME_TYPES,
  PRIVATE_REPORT_BUCKET,
  REPORT_FILE_SIZE_LIMIT_BYTES,
  provisionIncomeForecast,
} from "../scripts/provision-income-forecast.mjs";

function storageClient(listBuckets: unknown, overrides: Record<string, unknown> = {}) {
  return {
    storage: {
      listBuckets: vi.fn(async () => listBuckets),
      createBucket: vi.fn(async () => ({ data: { name: PRIVATE_REPORT_BUCKET }, error: null })),
      updateBucket: vi.fn(async () => ({ data: { name: PRIVATE_REPORT_BUCKET }, error: null })),
      ...overrides,
    },
  };
}

describe("private income report bucket provisioning", () => {
  it("creates a private bucket with the 25 MiB and MIME policy", async () => {
    const client = storageClient({ data: [], error: null });
    await provisionIncomeForecast(client);
    expect(client.storage.createBucket).toHaveBeenCalledWith(PRIVATE_REPORT_BUCKET, {
      public: false,
      fileSizeLimit: REPORT_FILE_SIZE_LIMIT_BYTES,
      allowedMimeTypes: ALLOWED_REPORT_MIME_TYPES,
    });
  });

  it("is idempotent for an existing private bucket", async () => {
    const client = storageClient({ data: [{ id: PRIVATE_REPORT_BUCKET, name: PRIVATE_REPORT_BUCKET, public: false, file_size_limit: REPORT_FILE_SIZE_LIMIT_BYTES, allowed_mime_types: ALLOWED_REPORT_MIME_TYPES }], error: null });
    await provisionIncomeForecast(client);
    expect(client.storage.createBucket).not.toHaveBeenCalled();
  });

  it("fails closed instead of making a public bucket private implicitly", async () => {
    const client = storageClient({ data: [{ id: PRIVATE_REPORT_BUCKET, name: PRIVATE_REPORT_BUCKET, public: true }], error: null });
    await expect(provisionIncomeForecast(client)).rejects.toThrow(/公共|私有/);
    expect(client.storage.updateBucket).not.toHaveBeenCalled();
  });

  it("never writes directly to storage system tables", async () => {
    const source = await import("node:fs/promises");
    const file = await source.readFile(new URL("../scripts/provision-income-forecast.mjs", import.meta.url), "utf8");
    expect(file).not.toMatch(/storage\.(?:buckets|objects)/u);
  });
});
