import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { prepareEditorialAssets } from "../scripts/prepare-editorial-assets.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("prepareEditorialAssets", () => {
  it("writes three web formats for the motto and thesis exhibits", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "editorial-assets-"));
    temporaryDirectories.push(fixtureDirectory);
    const portrait = join(fixtureDirectory, "motto.jpg");
    const thesis = join(fixtureDirectory, "thesis.png");
    const outDir = join(fixtureDirectory, "out");

    await sharp({
      create: {
        width: 827,
        height: 1456,
        channels: 3,
        background: "#b11c22",
      },
    })
      .jpeg()
      .toFile(portrait);
    await sharp({
      create: {
        width: 1191,
        height: 1684,
        channels: 3,
        background: "#fffef8",
      },
    })
      .png()
      .toFile(thesis);

    const outputs = await prepareEditorialAssets({
      mottoImage: portrait,
      thesisPage47: thesis,
      thesisPage48: thesis,
      thesisPage50: thesis,
      thesisPage51: thesis,
      outDir,
    });

    for (const basename of [
      "motto-mao",
      "thesis-linear-convergence",
      "thesis-linear-siac",
      "thesis-burgers",
    ]) {
      for (const extension of ["avif", "webp", "jpg"]) {
        expect(outputs).toContain(`${basename}.${extension}`);
        const metadata = await sharp(
          join(outDir, `${basename}.${extension}`)
        ).metadata();
        expect(metadata.width).toBeGreaterThanOrEqual(600);
        expect(metadata.width).toBeLessThanOrEqual(1600);
        expect(metadata.height).toBeGreaterThanOrEqual(360);
        expect(metadata.height).toBeLessThanOrEqual(1600);
      }
    }
  });
});
