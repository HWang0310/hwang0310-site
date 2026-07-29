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
});

describe("replaceDirectoryAtomically", () => {
  it("rolls back an installed site when backup cleanup fails", async () => {
    const fixture = await createBuildFixture();
    const stagedDir = join(fixture.projectDir, "staged");
    await writeBuiltHomepage(stagedDir);
    let removeCalls = 0;

    await expect(
      replaceDirectoryAtomically(
        { stagedDir, targetDir: fixture.distDir },
        {
          rm: async (path, options) => {
            removeCalls += 1;
            if (removeCalls === 1) {
              throw new Error("injected backup cleanup failure");
            }
            await rm(path, options);
          },
        }
      )
    ).rejects.toThrow("injected backup cleanup failure");

    expect(readdirSync(fixture.distDir)).toEqual(["old-site.txt"]);
    expect(readFileSync(join(fixture.distDir, "old-site.txt"), "utf8")).toBe(
      "published version"
    );
  });

  it("aggregates cleanup and restore errors while preserving the backup", async () => {
    const fixture = await createBuildFixture();
    const stagedDir = join(fixture.projectDir, "staged");
    await writeBuiltHomepage(stagedDir);
    let renameCalls = 0;
    let removeCalls = 0;
    let caught: unknown;

    try {
      await replaceDirectoryAtomically(
        { stagedDir, targetDir: fixture.distDir },
        {
          rename: async (source, target) => {
            renameCalls += 1;
            if (renameCalls === 3) {
              throw new Error("injected restore failure");
            }
            await rename(source, target);
          },
          rm: async (path, options) => {
            removeCalls += 1;
            if (removeCalls <= 2) {
              throw new Error(
                removeCalls === 1
                  ? "injected backup cleanup failure"
                  : "injected new-target cleanup failure"
              );
            }
            await rm(path, options);
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
      "injected backup cleanup failure",
      "injected new-target cleanup failure",
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
