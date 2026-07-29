import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

/**
 * @typedef {Object} AssetOptions
 * @property {string} portraitSage
 * @property {string} portraitWarm
 * @property {string} portraitMobile
 * @property {string} portraitReal
 * @property {string} dogSheet
 * @property {string} outDir
 */

const DOG_POSES = ["inspect", "point", "run", "rest"];

/**
 * @param {string} source
 * @param {string} output
 * @param {"webp" | "avif" | "jpeg"} format
 */
async function writePortrait(source, output, format) {
  let image = sharp(source)
    .autoOrient()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    });

  if (format === "webp") {
    image = image.webp({ quality: 88, alphaQuality: 100, smartSubsample: true });
  } else if (format === "avif") {
    image = image.avif({ quality: 60, effort: 6 });
  } else {
    image = image
      .flatten({ background: "#f7f3ea" })
      .jpeg({ quality: 90, progressive: true, chromaSubsampling: "4:4:4" });
  }

  await image.toFile(output);
}

/**
 * @param {AssetOptions} options
 * @returns {Promise<string[]>}
 */
export async function prepareAssets({
  portraitSage,
  portraitWarm,
  portraitMobile,
  portraitReal,
  dogSheet,
  outDir,
}) {
  await mkdir(outDir, { recursive: true });

  const writtenBasenames = [];
  const portraits = [
    {
      source: portraitSage,
      name: "portrait-sage",
      formats: ["webp", "avif", "jpeg"],
    },
    {
      source: portraitWarm,
      name: "portrait-warm",
      formats: ["webp", "avif", "jpeg"],
    },
    {
      source: portraitMobile,
      name: "portrait-mobile",
      formats: ["webp", "jpeg"],
    },
    {
      source: portraitReal,
      name: "portrait-real",
      formats: ["webp", "jpeg"],
    },
  ];

  for (const portrait of portraits) {
    for (const format of portrait.formats) {
      const extension = format === "jpeg" ? "jpg" : format;
      const filename = `${portrait.name}.${extension}`;
      await writePortrait(portrait.source, join(outDir, filename), format);
      writtenBasenames.push(filename);
    }
  }

  const dogMetadata = await sharp(dogSheet).metadata();
  if (!dogMetadata.width || !dogMetadata.height) {
    throw new Error("Unable to read dog sheet dimensions");
  }

  for (const [index, pose] of DOG_POSES.entries()) {
    const left = Math.floor((dogMetadata.width * index) / DOG_POSES.length);
    const right = Math.floor(
      (dogMetadata.width * (index + 1)) / DOG_POSES.length
    );
    const filename = `dog-${pose}.webp`;
    const cell = await sharp(dogSheet)
      .extract({
        left,
        top: 0,
        width: right - left,
        height: dogMetadata.height,
      })
      .png()
      .toBuffer();

    await sharp(cell)
      .trim({
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        threshold: 10,
      })
      .extend({
        top: 1,
        bottom: 1,
        left: 1,
        right: 1,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .resize({
        width: 318,
        height: 318,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 90, alphaQuality: 100, smartSubsample: true })
      .toFile(join(outDir, filename));

    writtenBasenames.push(filename);
  }

  return writtenBasenames;
}

function parseArguments(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${flag ?? "end of command"}`);
    }
    flags.set(flag, value);
  }

  const optionNames = {
    "--portrait-sage": "portraitSage",
    "--portrait-warm": "portraitWarm",
    "--portrait-mobile": "portraitMobile",
    "--portrait-real": "portraitReal",
    "--dog-sheet": "dogSheet",
    "--out-dir": "outDir",
  };
  const options = {};

  for (const [flag, optionName] of Object.entries(optionNames)) {
    const value = flags.get(flag);
    if (!value) {
      throw new Error(`Missing required option ${flag}`);
    }
    options[optionName] = value;
  }

  return options;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  prepareAssets(parseArguments(process.argv.slice(2)))
    .then((outputs) => {
      process.stdout.write(`${outputs.map((output) => basename(output)).join("\n")}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
