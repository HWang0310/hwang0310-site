import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSite,
  replaceDirectoryAtomically,
} from "../scripts/build-site.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function createBuildFixture() {
  const projectDir = await mkdtemp(join(tmpdir(), "site-build-"));
  temporaryDirectories.push(projectDir);
  const distDir = join(projectDir, "dist");
  await mkdir(distDir);
  await writeFile(join(distDir, "old-site.txt"), "published version");
  return { projectDir, distDir };
}

async function writeBuiltHomepage(outDir: string) {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "index.html"), "<h1>new complete site</h1>");
}

describe("buildSite", () => {
  it("replaces the official dist only after build and staging complete", async () => {
    const fixture = await createBuildFixture();

    const result = await buildSite({
      ...fixture,
      build: async ({ outDir }) => writeBuiltHomepage(outDir),
      stage: async ({ distDir }) => {
        await mkdir(join(distDir, "assets"), { recursive: true });
        await writeFile(join(distDir, "assets", "paper.pdf"), "paper");
        return { files: 1, dates: ["20260720"] };
      },
    });

    expect(result).toEqual({ files: 1, dates: ["20260720"] });
    expect(readFileSync(join(fixture.distDir, "index.html"), "utf8")).toContain(
      "new complete site"
    );
    expect(readFileSync(join(fixture.distDir, "assets", "paper.pdf"), "utf8")).toBe(
      "paper"
    );
    expect(existsSync(join(fixture.distDir, "old-site.txt"))).toBe(false);
  });

  it("keeps the current dist when the temporary Vite build fails", async () => {
    const fixture = await createBuildFixture();

    await expect(
      buildSite({
        ...fixture,
        build: async ({ outDir }) => {
          await writeBuiltHomepage(outDir);
          throw new Error("injected Vite failure");
        },
        stage: async () => ({ files: 0, dates: [] }),
      })
    ).rejects.toThrow("injected Vite failure");

    expect(readdirSync(fixture.distDir)).toEqual(["old-site.txt"]);
    expect(readFileSync(join(fixture.distDir, "old-site.txt"), "utf8")).toBe(
      "published version"
    );
  });

  it("preserves the primary build error when temporary cleanup also fails", async () => {
    const fixture = await createBuildFixture();
    let caught: unknown;

    try {
      await buildSite({
        ...fixture,
        build: async ({ outDir }) => {
          await writeBuiltHomepage(outDir);
          throw new Error("primary build failure");
        },
        stage: async () => ({ files: 0, dates: [] }),
        cleanup: async () => {
          throw new Error("temporary cleanup failure");
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect(
      (caught as AggregateError).errors.map((error: Error) => error.message)
    ).toEqual(["primary build failure", "temporary cleanup failure"]);
    expect(readdirSync(fixture.distDir)).toEqual(["old-site.txt"]);
  });

  it("keeps the current dist when static staging fails after a complete temporary build", async () => {
    const fixture = await createBuildFixture();

    await expect(
      buildSite({
        ...fixture,
        build: async ({ outDir }) => writeBuiltHomepage(outDir),
        stage: async ({ distDir }) => {
          await writeFile(join(distDir, "partial-static.txt"), "partial");
          throw new Error("injected staging failure");
        },
      })
    ).rejects.toThrow("injected staging failure");

    expect(readdirSync(fixture.distDir)).toEqual(["old-site.txt"]);
  });

  it("keeps the current dist when full-tree privacy validation fails", async () => {
    const fixture = await createBuildFixture();

    await expect(
      buildSite({
        ...fixture,
        build: async ({ outDir }) => {
          await mkdir(outDir, { recursive: true });
          await writeFile(
            join(outDir, "index.html"),
            '<a href="file:///Users/example/private.html">private</a>'
          );
        },
        stage: async () => ({ files: 0, dates: [] }),
      })
    ).rejects.toThrow(/local filesystem path.*index\.html/i);

    expect(readdirSync(fixture.distDir)).toEqual(["old-site.txt"]);
  });

  it("keeps the current dist when the injected top-level install fails", async () => {
    const fixture = await createBuildFixture();
    let renameCalls = 0;

    await expect(
      buildSite({
        ...fixture,
        build: async ({ outDir }) => writeBuiltHomepage(outDir),
        stage: async () => ({ files: 0, dates: [] }),
        swap: ({ stagedDir, targetDir }) =>
          replaceDirectoryAtomically(
            { stagedDir, targetDir },
            {
              rename: async (source, target) => {
                renameCalls += 1;
                if (renameCalls === 2) {
                  throw new Error("injected install rename failure");
                }
                await rename(source, target);
              },
            }
          ),
      })
    ).rejects.toThrow("injected install rename failure");

    expect(readdirSync(fixture.distDir)).toEqual(["old-site.txt"]);
    expect(readFileSync(join(fixture.distDir, "old-site.txt"), "utf8")).toBe(
      "published version"
    );
  });

  it("keeps a committed site successful when build-root cleanup fails", async () => {
    const fixture = await createBuildFixture();
    const cleanupWarnings: string[] = [];

    await expect(
      buildSite({
        ...fixture,
        build: async ({ outDir }) => writeBuiltHomepage(outDir),
        stage: async () => ({ files: 0, dates: [] }),
        cleanup: async () => {
          throw new Error("post-commit build-root cleanup failure");
        },
        onCleanupWarning: (error) =>
          cleanupWarnings.push((error as Error).message),
      })
    ).resolves.toEqual({ files: 0, dates: [] });

    expect(readFileSync(join(fixture.distDir, "index.html"), "utf8")).toContain(
      "new complete site"
    );
    expect(cleanupWarnings).toEqual([
      "post-commit build-root cleanup failure",
    ]);
  });
});

describe("replaceDirectoryAtomically", () => {
  it("keeps the committed new site when backup cleanup partially deletes the old site", async () => {
    const fixture = await createBuildFixture();
    const stagedDir = join(fixture.projectDir, "staged");
    await writeBuiltHomepage(stagedDir);
    const cleanupWarnings: string[] = [];

    await expect(
      replaceDirectoryAtomically(
        { stagedDir, targetDir: fixture.distDir },
        {
          rm: async (path, options) => {
            await rm(join(path, "previous", "old-site.txt"), { force: true });
            throw new Error("injected partial backup cleanup failure");
          },
          onCleanupWarning: (error) =>
            cleanupWarnings.push((error as Error).message),
        }
      )
    ).resolves.toBeUndefined();

    expect(readdirSync(fixture.distDir)).toEqual(["index.html"]);
    expect(readFileSync(join(fixture.distDir, "index.html"), "utf8")).toContain(
      "new complete site"
    );
    expect(cleanupWarnings).toEqual([
      "injected partial backup cleanup failure",
    ]);
  });

  it("aggregates install and restore errors while preserving the backup", async () => {
    const fixture = await createBuildFixture();
    const stagedDir = join(fixture.projectDir, "staged");
    await writeBuiltHomepage(stagedDir);
    let renameCalls = 0;
    let caught: unknown;

    try {
      await replaceDirectoryAtomically(
        { stagedDir, targetDir: fixture.distDir },
        {
          rename: async (source, target) => {
            renameCalls += 1;
            if (renameCalls === 2) {
              throw new Error("injected install failure");
            }
            if (renameCalls === 3) {
              throw new Error("injected restore failure");
            }
            await rename(source, target);
          },
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const messages = (caught as AggregateError).errors.map(
      (error: Error) => error.message
    );
    expect(messages).toEqual([
      "injected install failure",
      "injected restore failure",
    ]);
    const transactionDirectories = readdirSync(fixture.projectDir).filter(
      (name) => name.startsWith(".dist-swap-")
    );
    expect(transactionDirectories).toHaveLength(1);
    expect(
      readFileSync(
        join(
          fixture.projectDir,
          transactionDirectories[0],
          "previous",
          "old-site.txt"
        ),
        "utf8"
      )
    ).toBe("published version");
  });
});
