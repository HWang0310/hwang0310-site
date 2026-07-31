import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const OUTPUT_FORMATS = ["avif", "webp", "jpeg"];

async function writeFormats(buffer, basenameWithoutExtension, outDir) {
  const outputs = [];

  for (const format of OUTPUT_FORMATS) {
    const extension = format === "jpeg" ? "jpg" : format;
    const filename = `${basenameWithoutExtension}.${extension}`;
    let image = sharp(buffer);

    if (format === "avif") {
      image = image.avif({ quality: 62, effort: 6 });
    } else if (format === "webp") {
      image = image.webp({ quality: 88, smartSubsample: true });
    } else {
      image = image
        .flatten({ background: "#fffdf6" })
        .jpeg({ quality: 90, progressive: true, chromaSubsampling: "4:4:4" });
    }

    await image.toFile(join(outDir, filename));
    outputs.push(filename);
  }

  return outputs;
}

async function cropPage(source, extract, resize) {
  return sharp(source)
    .autoOrient()
    .extract(extract)
    .resize({ ...resize, fit: "inside", withoutEnlargement: false })
    .sharpen({ sigma: 0.45 })
    .png()
    .toBuffer();
}

export async function prepareEditorialAssets({
  mottoImage,
  thesisPage47,
  thesisPage48,
  thesisPage50,
  thesisPage51,
  outDir,
}) {
  await mkdir(outDir, { recursive: true });

  const motto = await sharp(mottoImage)
    .autoOrient()
    .resize({
      width: 1200,
      height: 1500,
      fit: "cover",
      position: "attention",
      withoutEnlargement: false,
    })
    .sharpen({ sigma: 0.35 })
    .png()
    .toBuffer();

  const linearConvergence = await cropPage(
    thesisPage47,
    { left: 175, top: 125, width: 850, height: 995 },
    { width: 1360, height: 1220 }
  );
  const linearSiac = await cropPage(
    thesisPage48,
    { left: 175, top: 140, width: 850, height: 560 },
    { width: 1400, height: 920 }
  );
  const burgersTable = await cropPage(
    thesisPage50,
    { left: 175, top: 320, width: 850, height: 910 },
    { width: 760, height: 780 }
  );
  const burgersCurves = await cropPage(
    thesisPage51,
    { left: 175, top: 180, width: 850, height: 560 },
    { width: 760, height: 780 }
  );
  const burgers = await sharp({
    create: {
      width: 1600,
      height: 840,
      channels: 3,
      background: "#fffdf8",
    },
  })
    .composite([
      { input: burgersTable, left: 20, top: 30, gravity: "northwest" },
      { input: burgersCurves, left: 820, top: 30, gravity: "northwest" },
    ])
    .png()
    .toBuffer();

  const written = [];
  written.push(...(await writeFormats(motto, "motto-mao", outDir)));
  written.push(
    ...(await writeFormats(
      linearConvergence,
      "thesis-linear-convergence",
      outDir
    ))
  );
  written.push(
    ...(await writeFormats(linearSiac, "thesis-linear-siac", outDir))
  );
  written.push(...(await writeFormats(burgers, "thesis-burgers", outDir)));
  return written;
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
    "--motto-image": "mottoImage",
    "--thesis-page-47": "thesisPage47",
    "--thesis-page-48": "thesisPage48",
    "--thesis-page-50": "thesisPage50",
    "--thesis-page-51": "thesisPage51",
    "--out-dir": "outDir",
  };
  const options = {};

  for (const [flag, optionName] of Object.entries(optionNames)) {
    const value = flags.get(flag);
    if (!value) throw new Error(`Missing required option ${flag}`);
    options[optionName] = value;
  }

  return options;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  prepareEditorialAssets(parseArguments(process.argv.slice(2)))
    .then((outputs) => {
      process.stdout.write(`${outputs.map((output) => basename(output)).join("\n")}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
