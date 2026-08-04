import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageStaticAssets } from "../scripts/stage-static-assets.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

function checksum(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "static-staging-"));
  temporaryDirectories.push(root);

  const reportRoot = join(root, "reports");
  const archiveFile = join(root, "report-archive.json");
  const thesisFile = join(root, "original-thesis.pdf");
  const distDir = join(root, "dist");
  const entries = [
    {
      date: "20260720",
      folder: "approved-report-20",
      visibility: "public",
      pinned: true,
    },
    {
      date: "20260724",
      folder: "private-report-24",
      visibility: "private",
      pinned: false,
    },
    {
      date: "20260725",
      folder: "approved-report-25",
      visibility: "public",
      pinned: true,
    },
    {
      date: "20260726",
      folder: "private-report-26",
      visibility: "private",
      pinned: false,
    },
  ];

  await mkdir(reportRoot, { recursive: true });
  await writeFile(archiveFile, JSON.stringify(entries), "utf8");
  await writeFile(thesisFile, Buffer.from("%PDF fixture thesis\0unchanged"));

  for (const entry of entries) {
    const report = join(reportRoot, entry.folder);
    await mkdir(join(report, "cities", "wuhan"), { recursive: true });
    await mkdir(join(report, "assets", "icons"), { recursive: true });
    await writeFile(join(report, "index.html"), `<h1>${entry.date}</h1>`);
    await writeFile(
      join(report, "cities", "wuhan", "index.html"),
      `<p>Wuhan ${entry.date}</p>`
    );
    await writeFile(join(report, "assets", "report.css"), "body{color:#123}");
    await writeFile(
      join(report, "assets", "archive-manifest.js"),
      `window.INCOME_FORECAST_ARCHIVE = [{"date":"${entry.date}","webPath":"/reports/${entry.date}/","localPath":"file:///Users/example/private-report/"}];\n`
    );
    await writeFile(
      join(report, "assets", "icons", "trend.svg"),
      `<svg data-date="${entry.date}"></svg>`
    );
  }

  return { root, reportRoot, archiveFile, thesisFile, distDir, entries };
}

describe("stageStaticAssets", () => {
  it("copies only the public allowlisted reports and never stages private directories", async () => {
    const fixture = await createFixture();

    const result = await stageStaticAssets(fixture);

    expect(result).toEqual({
      files: 12,
      dates: ["20260720", "20260725"],
    });
    expect(
      existsSync(
        resolve(
          fixture.distDir,
          "projects/income-forecast/reports/2026/07/20/index.html"
        )
      )
    ).toBe(true);
    expect(
      readFileSync(
        resolve(
          fixture.distDir,
          "projects/income-forecast/reports/2026/07/25/cities/wuhan/index.html"
        ),
        "utf8"
      )
    ).toContain("Wuhan 20260725");
    expect(
      existsSync(
        resolve(
          fixture.distDir,
          "projects/income-forecast/reports/2026/07/20/assets/icons/trend.svg"
        )
      )
    ).toBe(true);
    expect(
      existsSync(
        resolve(
          fixture.distDir,
          "projects/income-forecast/reports/2026/07/24"
        )
      )
    ).toBe(false);
    expect(
      existsSync(
        resolve(
          fixture.distDir,
          "projects/income-forecast/reports/2026/07/26"
        )
      )
    ).toBe(false);
  });

  it("rejects an archive missing a required public report date", async () => {
    const fixture = await createFixture();
    await writeFile(
      fixture.archiveFile,
      JSON.stringify(
        fixture.entries.filter((entry) => entry.date !== "20260720")
      ),
      "utf8"
    );

    await expect(stageStaticAssets(fixture)).rejects.toThrow(
      "Public report policy requires 20260720 to be public and pinned"
    );
  });

  it("rejects an archive when a required public report is private", async () => {
    const fixture = await createFixture();
    await writeFile(
      fixture.archiveFile,
      JSON.stringify(
        fixture.entries.map((entry) =>
          entry.date === "20260720" ? { ...entry, visibility: "private" } : entry
        )
      ),
      "utf8"
    );

    await expect(stageStaticAssets(fixture)).rejects.toThrow(
      "Public report policy requires 20260720 to be public and pinned"
    );
  });

  it("rejects an archive when a required public report is not pinned", async () => {
    const fixture = await createFixture();
    await writeFile(
      fixture.archiveFile,
      JSON.stringify(
        fixture.entries.map((entry) =>
          entry.date === "20260725" ? { ...entry, pinned: false } : entry
        )
      ),
      "utf8"
    );

    await expect(stageStaticAssets(fixture)).rejects.toThrow(
      "Public report policy requires 20260725 to be public and pinned"
    );
  });

  it("rejects an archive containing an unknown visibility state", async () => {
    const fixture = await createFixture();
    await writeFile(
      fixture.archiveFile,
      JSON.stringify(
        fixture.entries.map((entry) =>
          entry.date === "20260724" ? { ...entry, visibility: "internal" } : entry
        )
      ),
      "utf8"
    );

    await expect(stageStaticAssets(fixture)).rejects.toThrow(
      "Invalid report visibility at archive entry 1"
    );
  });

  it("writes a browser manifest containing only approved dates and web paths", async () => {
    const fixture = await createFixture();

    await stageStaticAssets(fixture);

    const manifest = readFileSync(
      resolve(
        fixture.distDir,
        "projects/income-forecast/archive-manifest.js"
      ),
      "utf8"
    );
    expect(manifest).toBe(
      'window.INCOME_FORECAST_ARCHIVE = [{"date":"20260720","webPath":"/projects/income-forecast/reports/2026/07/20/"},{"date":"20260725","webPath":"/projects/income-forecast/reports/2026/07/25/"}];\n'
    );
    expect(manifest).not.toContain(fixture.root);
    expect(manifest).not.toContain("file:///Users/");
    expect(manifest).not.toContain("approved-report");
    expect(manifest).not.toContain('"folder"');
  });

  it("replaces nested report manifests with the same privacy-safe web manifest", async () => {
    const fixture = await createFixture();

    await stageStaticAssets(fixture);

    const rootManifest = readFileSync(
      resolve(
        fixture.distDir,
        "projects/income-forecast/archive-manifest.js"
      ),
      "utf8"
    );
    for (const day of ["20", "25"]) {
      const reportManifest = readFileSync(
        resolve(
          fixture.distDir,
          `projects/income-forecast/reports/2026/07/${day}/assets/archive-manifest.js`
        ),
        "utf8"
      );
      expect(reportManifest).toBe(rootManifest);
      expect(reportManifest).not.toContain("localPath");
      expect(reportManifest).not.toContain("file:///Users/");
    }
  });

  it("rejects local filesystem paths in non-manifest files across the staged tree", async () => {
    const fixture = await createFixture();
    await writeFile(
      join(
        fixture.reportRoot,
        fixture.entries[0].folder,
        "assets",
        "report.css"
      ),
      "body{background-image:url(file:///Users/example/private.png)}"
    );

    await expect(stageStaticAssets(fixture)).rejects.toThrow(
      /local filesystem path.*report\.css/i
    );
  });

  it("rejects target-side symbolic links instead of writing through them", async () => {
    const fixture = await createFixture();
    const outside = join(fixture.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "sentinel.txt"), "outside stays untouched");
    await mkdir(fixture.distDir);
    await symlink(outside, join(fixture.distDir, "projects"), "dir");

    await expect(stageStaticAssets(fixture)).rejects.toThrow(/symbolic link/i);
    expect(readdirSync(outside)).toEqual(["sentinel.txt"]);
  });

  it.each(["index.html", "cities", "assets"])(
    "rejects a report missing required %s",
    async (missing) => {
      const fixture = await createFixture();
      await rm(join(fixture.reportRoot, fixture.entries[2].folder, missing), {
        recursive: true,
        force: true,
      });

      await expect(stageStaticAssets(fixture)).rejects.toThrow(missing);
    }
  );

  it("prevalidates every report before changing existing staged targets", async () => {
    const fixture = await createFixture();
    const reportsTarget = resolve(
      fixture.distDir,
      "projects/income-forecast/reports"
    );
    const manifestTarget = resolve(
      fixture.distDir,
      "projects/income-forecast/archive-manifest.js"
    );
    const thesisTarget = resolve(
      fixture.distDir,
      "assets/papers/wang-hao-rkdg-thesis.pdf"
    );
    await mkdir(join(reportsTarget, "existing"), { recursive: true });
    await writeFile(join(reportsTarget, "existing", "sentinel.txt"), "keep");
    await writeFile(manifestTarget, "existing manifest", "utf8");
    await mkdir(resolve(fixture.distDir, "assets/papers"), { recursive: true });
    await writeFile(thesisTarget, "existing thesis");
    await rm(
      join(fixture.reportRoot, fixture.entries[2].folder, "assets"),
      { recursive: true, force: true }
    );

    await expect(stageStaticAssets(fixture)).rejects.toThrow("assets");

    expect(
      readFileSync(join(reportsTarget, "existing", "sentinel.txt"), "utf8")
    ).toBe("keep");
    expect(readFileSync(manifestTarget, "utf8")).toBe("existing manifest");
    expect(readFileSync(thesisTarget, "utf8")).toBe("existing thesis");
    expect(readdirSync(reportsTarget)).toEqual(["existing"]);
  });

  it("keeps the supplied output tree intact when copying fails after the first staged report", async () => {
    const fixture = await createFixture();
    const reportsTarget = resolve(
      fixture.distDir,
      "projects/income-forecast/reports"
    );
    const manifestTarget = resolve(
      fixture.distDir,
      "projects/income-forecast/archive-manifest.js"
    );
    const thesisTarget = resolve(
      fixture.distDir,
      "assets/papers/wang-hao-rkdg-thesis.pdf"
    );
    await mkdir(join(reportsTarget, "existing"), { recursive: true });
    await writeFile(join(fixture.distDir, "index.html"), "published homepage");
    await writeFile(join(reportsTarget, "existing", "sentinel.txt"), "keep");
    await writeFile(manifestTarget, "published manifest");
    await mkdir(resolve(fixture.distDir, "assets/papers"), { recursive: true });
    await writeFile(thesisTarget, "published thesis");
    let copiedReports = 0;

    await expect(
      stageStaticAssets(fixture, {
        copyReport: async (source, target, options) => {
          await cp(source, target, options);
          copiedReports += 1;
          if (copiedReports === 1) {
            throw new Error("injected copy failure after first report");
          }
        },
      })
    ).rejects.toThrow("injected copy failure after first report");

    expect(readFileSync(join(fixture.distDir, "index.html"), "utf8")).toBe(
      "published homepage"
    );
    expect(readdirSync(reportsTarget)).toEqual(["existing"]);
    expect(
      readFileSync(join(reportsTarget, "existing", "sentinel.txt"), "utf8")
    ).toBe("keep");
    expect(readFileSync(manifestTarget, "utf8")).toBe("published manifest");
    expect(readFileSync(thesisTarget, "utf8")).toBe("published thesis");
  });

  it("copies the thesis to its stable name without changing any byte", async () => {
    const fixture = await createFixture();
    const original = readFileSync(fixture.thesisFile);

    await stageStaticAssets(fixture);

    const staged = readFileSync(
      resolve(
        fixture.distDir,
        "assets/papers/wang-hao-rkdg-thesis.pdf"
      )
    );
    expect(staged.equals(original)).toBe(true);
    expect(checksum(staged)).toBe(checksum(original));
  });
});
