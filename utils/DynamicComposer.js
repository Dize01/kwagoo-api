// ────────────────────────────────────────────────────────────────────────────────
// DynamicComposer.js
// Build an image by applying an ordered mix of Image-overlays and Text-overlays
// in **one** FFmpeg pass.  Returns the finished image as a Buffer.
//
// Install deps:  npm i ffmpeg-static
// ────────────────────────────────────────────────────────────────────────────────

const ffmpegPath = require("ffmpeg-static");          // bundled ffmpeg
const { exec }   = require("child_process");
const util       = require("util");
const fs         = require("fs");
const path       = require("path");

const execAsync  = util.promisify(exec);              // promisified exec()

// ╭─────────────────────╮
// │ CONFIG & CONSTANTS  │
// ╰─────────────────────╯
const TEMP_DIR   = path.resolve(__dirname, "../temp");
const OUT_DIR    = path.resolve(__dirname, "../output");

// Choose a cross-platform font file.
const FONT_PATH  = process.platform === "win32"
  ? "C:/Windows/Fonts/arial.ttf"
  : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

// ╭─────────────────────╮
// │ HELPER FUNCTIONS    │
// ╰─────────────────────╯
const ensureDir = dir => fs.mkdirSync(dir, { recursive: true });

const stripDataPrefix = str =>
  str.replace(/^data:image\/[a-z]+;base64,?/i, "");

const escapeFFmpegText = str =>
  str
    .replace(/\\/g, "\\\\")   // backslash first!
    .replace(/'/g,  "\\'")
    .replace(/:/g,  "\\:");

const getCanvasSize = ratio => {
  switch (ratio) {
    case "9:16": return "1080x1920";
    case "1:1":  return "1080x1080";
    case "16:9": return "1920x1080";
    default:
      return /^\d+x\d+$/.test(ratio) ? ratio : "1920x1080";
  }
};

// ╭─────────────────────╮
// │  MAIN ENTRY POINT   │
// ╰─────────────────────╯
async function composeDynamic(payload = {}) {
  const { elements = [], ratio = "16:9" } = payload;

  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error("'elements' must be a non-empty array");
  }

  // ── 1. Prepare workspace ────────────────────────────────────────────────────
  ensureDir(TEMP_DIR);
  ensureDir(OUT_DIR);

  const ts        = Date.now();
  const canvasSz  = getCanvasSize(ratio);
  const outputImg = path.join(OUT_DIR, `output_${ts}.png`);
  const tempFiles = [];                                 // for later cleanup

  // ── 2. Build FFmpeg input list & filter_complex ─────────────────────────────
  const inputs  = [`-f lavfi -i "color=c=black:s=${canvasSz}"`]; // [0:v]
  const filters = [];
  let   prev    = "[0:v]";

  elements.forEach((el, idx) => {
    if (el.Type === "Image" && typeof el.Value === "string") {
      // 2a) Decode Base64 ➜ temp PNG
      const tempName = `img_${ts}_${idx}.png`;
      const tempPath = path.join(TEMP_DIR, tempName);
      fs.writeFileSync(tempPath, Buffer.from(stripDataPrefix(el.Value), "base64"));
      tempFiles.push(tempPath);

      // 2b) Push as next FFmpeg input
      inputs.push(`-i "${tempPath}"`);
      const curr = `[${inputs.length - 1}:v]`;                 // label

      const x = Number.isFinite(el.xpos) ? el.xpos : 0;
      const y = Number.isFinite(el.ypos) ? el.ypos : 0;
      filters.push(
        `${prev}${curr} overlay=${x}:${y} [v${idx}]`
      );
      prev = `[v${idx}]`;

    } else if (el.Type === "Text" && typeof el.Value === "string") {
      const safe = escapeFFmpegText(el.Value);
      const size = Number.isFinite(el.FontSize) ? el.FontSize : 48;
      const x    = Number.isFinite(el.xpos) ? el.xpos : 0;
      const y    = Number.isFinite(el.ypos) ? el.ypos : 0;

      filters.push(
        `${prev} drawtext=` +
        `fontfile='${FONT_PATH}':text='${safe}':` +
        `fontcolor=white:fontsize=${size}:x=${x}:y=${y} [v${idx}]`
      );
      prev = `[v${idx}]`;
    }
  });

  filters.push(`${prev} copy[out]`); // final label

  // ── 3. Assemble & run the FFmpeg command ────────────────────────────────────
  const cmd = [
    `"${ffmpegPath}" -y`,
    ...inputs,
    `-filter_complex "${filters.join(";")}"`,
    "-map [out]",
    "-frames:v 1",                             // ✅ LIMIT to one frame
    `"${outputImg}"`
  ].join(" ");


  console.log("▶️  FFmpeg command:\n", cmd);

  try {
    await execAsync(cmd);                                  // run FFmpeg
    const buffer = await fs.promises.readFile(outputImg);  // read result
    return buffer;
  } finally {
    // ── 4. Best-effort cleanup ───────────────────────────────────────────────
    tempFiles.forEach(f => fs.unlink(f, () => {}));
  }
}

// ╭─────────────────────╮
// │ EXPORTS             │
// ╰─────────────────────╯
module.exports = { composeDynamic };

/* ============================================================================
  EXAMPLE PAYLOAD
  ---------------------------------------------------------------------------
  {
    "ratio": "9:16",
    "elements": [
      { "Type": "Image", "Value": "<base64_1>", "xpos": 0,   "ypos": 0   },
      { "Type": "Image", "Value": "<base64_2>", "xpos": 200, "ypos": 400 },
      { "Type": "Text",  "Value": "Hello",      "xpos": 100, "ypos": 300,
                         "FontSize": 64 }
    ]
  }
============================================================================ */
