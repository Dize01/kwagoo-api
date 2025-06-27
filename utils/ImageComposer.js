// ────────────────────────────────────────────────────────────────────────────────
// ImageComposer.js
// This module dynamically composes an image from an array of image/text layers
// using FFmpeg. Layers are applied in order with custom size and position support.
// Returns the final image as a Buffer.
//
// Install dependencies: npm install ffmpeg-static
// ────────────────────────────────────────────────────────────────────────────────

const ffmpegPath = require("ffmpeg-static");          // Path to FFmpeg binary
const { exec }   = require("child_process");
const util       = require("util");
const fs         = require("fs");
const path       = require("path");

const execAsync  = util.promisify(exec);              // Convert exec to Promise-based

// ────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ────────────────────────────────────────────────────────────────────────────────
const TEMP_DIR   = path.resolve(__dirname, "../temp");    // Temporary files directory
const OUT_DIR    = path.resolve(__dirname, "../output");  // Output images directory

// Path to font file (Windows/Mac/Linux compatible)
const FONT_PATH  = process.platform === "win32"
  ? "C:/Windows/Fonts/arial.ttf"
  : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

// ────────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ────────────────────────────────────────────────────────────────────────────────
const ensureDir = dir => fs.mkdirSync(dir, { recursive: true });  // Create folder if missing

const stripDataPrefix = str => str.replace(/^data:image\/[a-z]+;base64,?/i, "");

const escapeFFmpegText = str =>
  str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");

// Maps common ratios to canvas dimensions (width x height)
const getCanvasSize = ratio => {
  switch (ratio) {
    case "9:16":  return "1080x1920";  // Instagram Stories, TikTok
    case "1:1":   return "1080x1080";  // Square posts
    case "4:5":   return "1080x1350";  // Instagram portrait posts
    case "16:9":  return "1920x1080";  // YouTube thumbnail, widescreen
    case "2:3":   return "1080x1620";  // Pinterest pins, mobile screens
    case "3:4":   return "1080x1440";  // Presentations, print
    case "3:2":   return "1620x1080";  // DSLR photography
    case "21:9":  return "2520x1080";  // Ultrawide screen
    case "5:7":   return "1080x1512";  // Portrait prints
    case "5:4":   return "1350x1080";  // Legacy displays
    default:
      return /^\d+x\d+$/.test(ratio)
        ? ratio                         // Custom string like "1080x1600"
        : "1080x1080";                  // Default fallback to square
  }
};

// ────────────────────────────────────────────────────────────────────────────────
// MAIN FUNCTION: Compose an image from dynamic layers
// ────────────────────────────────────────────────────────────────────────────────
async function composeImage(payload = {}) {
  const { elements = [], ratio = "1:1" } = payload;

  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error("'elements' must be a non-empty array");
  }

  // Prepare workspace
  ensureDir(TEMP_DIR);
  ensureDir(OUT_DIR);

  const ts         = Date.now();
  const canvasSz   = getCanvasSize(ratio);
  const outputImg  = path.join(OUT_DIR, `output_${ts}.png`);
  const tempFiles  = [];

  // Create initial canvas background (white)
  const inputs     = [`-f lavfi -i "color=c=white:s=${canvasSz}"`]; // Input 0
  const filters    = [];
  let   prevLabel  = "[0:v]";  // Initial canvas

  // Process each element in order
  elements.forEach((el, idx) => {
    if (el.Type === "Image" && typeof el.Value === "string") {
      // Save base64 image as temp file
      const tempName = `img_${ts}_${idx}.png`;
      const tempPath = path.join(TEMP_DIR, tempName);
      fs.writeFileSync(tempPath, Buffer.from(stripDataPrefix(el.Value), "base64"));
      tempFiles.push(tempPath);

      // Add image as FFmpeg input
      inputs.push(`-i "${tempPath}"`);
      const raw    = `[${inputs.length - 1}:v]`;
      const labelS = `[scl${idx}]`; // scaled image
      const labelO = `[v${idx}]`;   // output after overlay

      // Scaling & cropping logic
      const hasW = Number.isFinite(el.Width);
      const hasH = Number.isFinite(el.Height);
      const canvasHeight = parseInt(canvasSz.split("x")[1], 10);
      let filterChain = null;

      if (hasW && hasH) {
        filterChain = `${raw} scale=${el.Width}:${el.Height} ${labelS}`;
      } else if (hasW && !hasH) {
        filterChain = `${raw} scale=${el.Width}:-1,crop=${el.Width}:ih ${labelS}`;
      } else if (!hasW && hasH) {
        filterChain = `${raw} scale=iw:-1,crop=iw:${el.Height} ${labelS}`;
      } else {
        filterChain = `${raw} scale=-1:${canvasHeight} ${labelS}`;
      }

      filters.push(filterChain);

      const x = Number.isFinite(el.xpos) ? el.xpos : 0;
      const y = Number.isFinite(el.ypos) ? el.ypos : 0;
      filters.push(`${prevLabel}${labelS} overlay=${x}:${y} ${labelO}`);
      prevLabel = labelO;

    } else if (el.Type === "Text" && typeof el.Value === "string") {
      // Safely escape text content
      const safe = escapeFFmpegText(el.Value);
      const size = Number.isFinite(el.FontSize) ? el.FontSize : 48;
      const x    = Number.isFinite(el.xpos) ? el.xpos : 0;
      const y    = Number.isFinite(el.ypos) ? el.ypos : 0;

      // Render text layer
      filters.push(
        `${prevLabel} drawtext=` +
        `fontfile='${FONT_PATH}':text='${safe}':` +
        `fontcolor=white:fontsize=${size}:x=${x}:y=${y} [v${idx}]`
      );
      prevLabel = `[v${idx}]`;
    }
  });

  // Final output label
  filters.push(`${prevLabel} copy[out]`);

  // Build and execute FFmpeg command
  const cmd = [
    `"${ffmpegPath}" -y`,
    ...inputs,
    `-filter_complex "${filters.join(";")}"`,
    "-map [out]",
    "-frames:v 1", // Output a single image
    `"${outputImg}"`
  ].join(" ");

  console.log("▶️  FFmpeg command:\n", cmd);

  try {
    await execAsync(cmd);                                 // Run FFmpeg
    const buffer = await fs.promises.readFile(outputImg); // Read PNG from disk
    //await fs.promises.unlink(outputImg);                  // ✅ Delete after reading
    return buffer;                                         // Return to caller
  } finally {
    // Clean up temp image files (inputs)
    tempFiles.forEach(f => fs.unlink(f, () => {}));
  }

}

// ────────────────────────────────────────────────────────────────────────────────
// EXPORT FUNCTION
// ────────────────────────────────────────────────────────────────────────────────
module.exports = { composeImage };

/* ================================================================================
  EXAMPLE PAYLOAD STRUCTURE:
  {
    "ratio": "9:16",
    "elements": [
      { "Type": "Image", "Value": "<base64_1>", "xpos": 0,   "ypos": 0 },
      { "Type": "Image", "Value": "<base64_2>", "xpos": 200, "ypos": 400 },
      { "Type": "Text",  "Value": "Hello",      "xpos": 100, "ypos": 300, "FontSize": 64 }
    ]
  }
=============================================================================== */



