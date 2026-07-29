import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    { date: "20260720", folder: "approved-report-20" },
    { date: "20260724", folder: "approved-report-24" },
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
  it("copies every nested report resource to the date-preserving web structure", async () => {
    const fixture = await createFixture();

    const result = await stageStaticAssets(fixture);

    expect(result).toEqual({
      files: 12,
      dates: ["20260720", "20260724"],
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
          "projects/income-forecast/reports/2026/07/24/cities/wuhan/index.html"
        ),
        "utf8"
      )
    ).toContain("Wuhan 20260724");
    expect(
      existsSync(
        resolve(
          fixture.distDir,
          "projects/income-forecast/reports/2026/07/20/assets/icons/trend.svg"
        )
      )
    ).toBe(true);
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
      'window.INCOME_FORECAST_ARCHIVE = [{"date":"20260720","webPath":"/projects/income-forecast/reports/2026/07/20/"},{"date":"20260724","webPath":"/projects/income-forecast/reports/2026/07/24/"}];\n'
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
    for (const day of ["20", "24"]) {
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

  it.each(["index.html", "cities", "assets"])(
    "rejects a report missing required %s",
    async (missing) => {
      const fixture = await createFixture();
      await rm(join(fixture.reportRoot, fixture.entries[1].folder, missing), {
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
      join(fixture.reportRoot, fixture.entries[1].folder, "assets"),
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
