import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { prepareAssets } from "../scripts/prepare-assets.mjs";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("prepareAssets", () => {
  it("writes every portrait format and all four dog poses", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "asset-pipeline-"));
    temporaryDirectories.push(fixtureDirectory);

    const portrait = join(fixtureDirectory, "portrait.png");
    const dogSheet = join(fixtureDirectory, "dog-sheet.png");
    const outDir = join(fixtureDirectory, "output");

    await sharp({
      create: {
        width: 100,
        height: 160,
        channels: 4,
        background: { r: 151, g: 178, b: 146, alpha: 1 },
      },
    })
      .png()
      .toFile(portrait);

    await sharp({
      create: {
        width: 400,
        height: 100,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(
        [
          { left: 20, background: "#f6d58e" },
          { left: 120, background: "#6eaaa6" },
          { left: 220, background: "#263238" },
          { left: 320, background: "#dfaa67" },
        ].map(({ left, background }) => ({
          input: {
            create: {
              width: 60,
              height: 80,
              channels: 4 as const,
              background,
            },
          },
          left,
          top: 10,
        }))
      )
      .png()
      .toFile(dogSheet);

    const outputs = await prepareAssets({
      portraitSage: portrait,
      portraitWarm: portrait,
      portraitMobile: portrait,
      portraitReal: portrait,
      dogSheet,
      outDir,
    });

    expect(outputs).toEqual(
      expect.arrayContaining([
        "portrait-sage.webp",
        "portrait-sage.avif",
        "portrait-sage.jpg",
        "portrait-warm.webp",
        "portrait-warm.avif",
        "portrait-warm.jpg",
        "portrait-mobile.webp",
        "portrait-mobile.jpg",
        "portrait-real.webp",
        "portrait-real.jpg",
        "dog-inspect.webp",
        "dog-point.webp",
        "dog-run.webp",
        "dog-rest.webp",
      ])
    );

    for (const pose of ["inspect", "point", "run", "rest"]) {
      const metadata = await sharp(join(outDir, `dog-${pose}.webp`)).metadata();
      expect(metadata.hasAlpha).toBe(true);
      expect(metadata.width).toBeLessThanOrEqual(320);
      expect(metadata.height).toBeLessThanOrEqual(320);
    }
  });

  it("reports written basenames when run from the command line", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "asset-pipeline-cli-"));
    temporaryDirectories.push(fixtureDirectory);

    const portrait = join(fixtureDirectory, "portrait.png");
    const dogSheet = join(fixtureDirectory, "dog-sheet.png");
    const outDir = join(fixtureDirectory, "output");

    await sharp({
      create: {
        width: 100,
        height: 160,
        channels: 4,
        background: { r: 151, g: 178, b: 146, alpha: 1 },
      },
    })
      .png()
      .toFile(portrait);

    await sharp({
      create: {
        width: 400,
        height: 100,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(
        [20, 120, 220, 320].map((left) => ({
          input: {
            create: {
              width: 60,
              height: 80,
              channels: 4 as const,
              background: "#f6d58e",
            },
          },
          left,
          top: 10,
        }))
      )
      .png()
      .toFile(dogSheet);

    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/prepare-assets.mjs",
      "--portrait-sage",
      portrait,
      "--portrait-warm",
      portrait,
      "--portrait-mobile",
      portrait,
      "--portrait-real",
      portrait,
      "--dog-sheet",
      dogSheet,
      "--out-dir",
      outDir,
    ]);

    expect(stdout).toContain("portrait-sage.webp");
    expect(stdout).toContain("dog-rest.webp");
  });

  it("keeps oversized dog poses within a 320 pixel square", async () => {
    const fixtureDirectory = await mkdtemp(
      join(tmpdir(), "asset-pipeline-oversized-")
    );
    temporaryDirectories.push(fixtureDirectory);

    const portrait = join(fixtureDirectory, "portrait.png");
    const dogSheet = join(fixtureDirectory, "dog-sheet.png");
    const outDir = join(fixtureDirectory, "output");

    await sharp({
      create: {
        width: 10,
        height: 16,
        channels: 4,
        background: "#97b292",
      },
    })
      .png()
      .toFile(portrait);

    await sharp({
      create: {
        width: 1600,
        height: 400,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(
        [20, 420, 820, 1220].map((left) => ({
          input: {
            create: {
              width: 360,
              height: 360,
              channels: 4 as const,
              background: "#f6d58e",
            },
          },
          left,
          top: 20,
        }))
      )
      .png()
      .toFile(dogSheet);

    await prepareAssets({
      portraitSage: portrait,
      portraitWarm: portrait,
      portraitMobile: portrait,
      portraitReal: portrait,
      dogSheet,
      outDir,
    });

    for (const pose of ["inspect", "point", "run", "rest"]) {
      const metadata = await sharp(join(outDir, `dog-${pose}.webp`)).metadata();
      expect(metadata.width).toBeLessThanOrEqual(320);
      expect(metadata.height).toBeLessThanOrEqual(320);
    }
  });
});
