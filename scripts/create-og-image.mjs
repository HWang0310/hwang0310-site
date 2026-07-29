import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(scriptDirectory);
const sourcePath = join(
  projectDirectory,
  "artwork/source/og-social-master.png"
);
const outputPath = join(projectDirectory, "public/og.png");
const target = { width: 1200, height: 630 };

const sourceMetadata = await sharp(sourcePath).metadata();
if (
  !sourceMetadata.width ||
  !sourceMetadata.height ||
  sourceMetadata.width < target.width ||
  sourceMetadata.height < target.height
) {
  throw new Error(
    `OG source must be at least ${target.width}×${target.height}; received ` +
      `${sourceMetadata.width ?? "unknown"}×${sourceMetadata.height ?? "unknown"}`
  );
}

await mkdir(dirname(outputPath), { recursive: true });
await sharp(sourcePath)
  .resize({
    ...target,
    fit: "cover",
    position: "centre",
    withoutEnlargement: true,
  })
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

const outputMetadata = await sharp(outputPath).metadata();
if (
  outputMetadata.width !== target.width ||
  outputMetadata.height !== target.height ||
  outputMetadata.format !== "png"
) {
  throw new Error("OG output did not satisfy the 1200×630 PNG contract");
}

process.stdout.write(
  `Created ${outputPath} from ${sourcePath} at ${target.width}×${target.height}\n`
);
