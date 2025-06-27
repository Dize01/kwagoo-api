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
    case "9:16":  return "1080x1920";  // 📱 Instagram Stories, Reels, TikTok (portrait)
    case "1:1":   return "1080x1080";  // 🟦 Instagram posts, profile images (square)
    case "4:5":   return "1080x1350";  // 🖼 Instagram portrait feed posts (max height)
    case "16:9":  return "1920x1080";  // 🎥 YouTube, widescreen video (landscape)
    case "2:3":   return "1080x1620";  // 📌 Pinterest pins, mobile screens (portrait)
    case "3:4":   return "1080x1440";  // 🗂 Presentation slides, mobile photos
    case "3:2":   return "1620x1080";  // 📷 DSLR photography, laptops (landscape)
    case "21:9":  return "2520x1080";  // 🖥 Ultrawide monitors, cinematic formats
    case "5:7":   return "1080x1512";  // 🖨 Portrait photography prints
    case "5:4":   return "1350x1080";  // 🖼 Classic photo frames, legacy monitors

    default:
      return /^\d+x\d+$/.test(ratio)
        ? ratio                       // 🧩 Support raw "1080x1600" input
        : "1080x1080";                // 🔁 Fallback to square (1:1)
  }

};

// ╭─────────────────────╮
// │  MAIN ENTRY POINT   │
// ╰─────────────────────╯
async function composeDynamic(payload = {}) {
  const { elements = [], ratio = "1:1" } = payload;

  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error("'elements' must be a non-empty array");
  }

  // ── 1. Prepare workspace ────────────────────────────────────────────────────
  ensureDir(TEMP_DIR);
  ensureDir(OUT_DIR);

  const ts        = Date.now();
  const canvasSz  = getCanvasSize(ratio);
  //const canvasSz  = getCanvasSize("1:1");
  const outputImg = path.join(OUT_DIR, `output_${ts}.png`);
  const tempFiles = [];                                 // for later cleanup

  // ── 2. Build FFmpeg input list & filter_complex ─────────────────────────────
  const inputs  = [`-f lavfi -i "color=c=white:s=${canvasSz}"`]; // [0:v]
  const filters = [];
  let   prev    = "[0:v]";

  console.error("🚫 ratio", ratio);

  elements.forEach((el, idx) => {
    if (el.Type === "Image" && typeof el.Value === "string") {
      const tempName = `img_${ts}_${idx}.png`;
      const tempPath = path.join(TEMP_DIR, tempName);
      fs.writeFileSync(tempPath, Buffer.from(stripDataPrefix(el.Value), "base64"));
      tempFiles.push(tempPath);

      inputs.push(`-i "${tempPath}"`);
      const raw    = `[${inputs.length - 1}:v]`;
      const labelS = `[scl${idx}]`;
      const labelO = `[v${idx}]`;

      let filterChain = null;

      const hasW = Number.isFinite(el.Width);
      const hasH = Number.isFinite(el.Height);
      const canvasHeight = parseInt(canvasSz.split("x")[1], 10);

      if (hasW && hasH) {
        // Scale directly to both
        filterChain = `${raw} scale=${el.Width}:${el.Height} ${labelS}`;
      } else if (hasW && !hasH) {
        // Scale height to maintain aspect, then crop width
        //filterChain = `${raw} scale=-1:${canvasHeight},crop=${el.Width}:ih ${labelS}`;
        filterChain = `${raw} scale=${el.Width}:-1,crop=${el.Width}:ih ${labelS}`;
      } else if (!hasW && hasH) {
        // Scale width to maintain aspect, then crop height
        filterChain = `${raw} scale=iw:-1,crop=iw:${el.Height} ${labelS}`;
      } else {
        // Neither provided: scale to canvas height
        filterChain = `${raw} scale=-1:${canvasHeight} ${labelS}`;
      }

      filters.push(filterChain);

      const x = Number.isFinite(el.xpos) ? el.xpos : 0;
      const y = Number.isFinite(el.ypos) ? el.ypos : 0;

      filters.push(`${prev}${labelS} overlay=${x}:${y} ${labelO}`);
      prev = labelO;
    } else if (el.Type === "Text" && typeof el.Value === "string") {
      const safe = escapeFFmpegText(el.Value);
      const size = Number.isFinite(el.FontSize) ? el.FontSize : 48;
      const x    = Number.isFinite(el.xpos) ? el.xpos : 0;
      const y    = Number.isFinite(el.ypos) ? el.ypos : 0;
      console.error("🚫 el.FontSize", el.FontSize);
      console.error("🚫 size", size);
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
