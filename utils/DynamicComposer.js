// DynamicComposer.js
// Build an image by applying an ordered mix of Image-overlays and Text-overlays
// in **one** FFmpeg pass. Supports custom sizing, positioning, alignment, wrapping,
// and per-element fonts. Returns the final image as a Buffer.
//
// Install deps: npm install ffmpeg-static
// ────────────────────────────────────────────────────────────────────────────────

const ffmpegPath = require("ffmpeg-static");
const { exec }   = require("child_process");
const util       = require("util");
const fs         = require("fs");
const path       = require("path");

const execAsync  = util.promisify(exec);

const TEMP_DIR  = path.resolve(__dirname, "../temp");
const OUT_DIR   = path.resolve(__dirname, "../output");
const DEFAULT_FONT = process.platform === "win32"
  ? "C:/Windows/Fonts/arial.ttf"
  : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

// Helpers
const ensureDir = dir => fs.mkdirSync(dir, { recursive: true });
const stripDataPrefix = str => str.replace(/^data:image\/[a-z]+;base64,?/i, "");
const escapeFFmpegText = s =>
  s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");

function wrapLines(str, maxChars) {
  const words = str.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = (cur + " " + w).trim();
    if (test.length > maxChars) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur.trim());
  return lines;
}

const getCanvasSize = ratio => {
  switch (ratio) {
    case "9:16": return "1080x1920";
    case "1:1":  return "1080x1080";
    case "4:5":  return "1080x1350";
    case "16:9": return "1920x1080";
    // add more if needed
    default:
      return /^\d+x\d+$/.test(ratio) ? ratio : "1080x1080";
  }
};

async function composeDynamic(payload = {}) {
  const { elements = [], ratio = "1:1" } = payload;
  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error("'elements' must be a non-empty array");
  }

  ensureDir(TEMP_DIR);
  ensureDir(OUT_DIR);

  const ts        = Date.now();
  const canvasSz  = getCanvasSize(ratio);
  const outputImg = path.join(OUT_DIR, `output_${ts}.png`);
  const tempFiles = [];

  // start with blank white canvas
  const inputs = [`-f lavfi -i color=c=white:s=${canvasSz}`];
  const filters = [];
  let prev = "[0:v]";

  elements.forEach((el, idx) => {
    if (el.Type === "Image" && typeof el.Value === "string") {
      // decode and save
      const imgName = `img_${ts}_${idx}.png`;
      const imgPath = path.join(TEMP_DIR, imgName);
      fs.writeFileSync(imgPath, Buffer.from(stripDataPrefix(el.Value), "base64"));
      tempFiles.push(imgPath);

      inputs.push(`-i "${imgPath}"`);
      const raw = `[${inputs.length - 1}:v]`;
      const scaled = `[s${idx}]`;
      const overlaid = `[v${idx}]`;

      // scale/crop
      const hasW = Number.isFinite(el.Width);
      const hasH = Number.isFinite(el.Height);
      const canvasH = parseInt(canvasSz.split("x")[1], 10);
      let chain;
      if (hasW && hasH) {
        chain = `${raw} scale=${el.Width}:${el.Height} ${scaled}`;
      } else if (hasW) {
        chain = `${raw} scale=${el.Width}:-1,crop=${el.Width}:ih ${scaled}`;
      } else if (hasH) {
        chain = `${raw} scale=-1:${el.Height},crop=iw:${el.Height} ${scaled}`;
      } else {
        chain = `${raw} scale=-1:${canvasH} ${scaled}`;
      }
      filters.push(chain);

      // overlay
      const x = Number.isFinite(el.xpos) ? el.xpos : 0;
      const y = Number.isFinite(el.ypos) ? el.ypos : 0;
      filters.push(`${prev}${scaled} overlay=${x}:${y} ${overlaid}`);
      prev = overlaid;

    } else if (el.Type === "Text" && typeof el.Value === "string") {
      // wrapping
      const maxChars = Number.isFinite(el.MaxLineLength) ? el.MaxLineLength : 30;
      const lines = wrapLines(el.Value, maxChars);

      // font
      const style = el.FontStyle || null;
      const fontFile = style
        ? (process.platform === "win32"
            ? `C:/Windows/Fonts/${style}.ttf`
            : `/usr/share/fonts/truetype/dejavu/${style}.ttf`)
        : DEFAULT_FONT;
      const escFont = fontFile.replace(/\\/g, "\\\\").replace(/:/g, "\\:");

      // settings
      const size  = Number.isFinite(el.FontSize) ? el.FontSize : 48;
      const color = el.FontColor || "white";
      const baseY = Number.isFinite(el.ypos) ? el.ypos : 10;
      const align = (el.align || "left").toLowerCase();

      if (align === "center" || align === "right") {
        // draw each line
        const lh = Math.round(size * 1.2);
        lines.forEach((ln, i) => {
          const safe = escapeFFmpegText(ln);
          const yPos = baseY + i * lh;
          const xExpr = align === "center"
            ? "(w-text_w)/2"
            : "w-text_w-10";
          const lbl = `[t${idx}_${i}]`;
          filters.push(
            `${prev} drawtext=` +
            `fontfile='${escFont}':text='${safe}':` +
            `fontcolor=${color}:fontsize=${size}:` +
            `x=${xExpr}:y=${yPos} ${lbl}`
          );
          prev = lbl;
        });
      } else {
        // left‐aligned block
        const txtName = `txt_${ts}_${idx}.txt`;
        const txtPath = path.join(TEMP_DIR, txtName);
        fs.writeFileSync(txtPath, lines.join("\n"), "utf8");
        tempFiles.push(txtPath);
        const escTxt = txtPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:");

        const xExpr = Number.isFinite(el.xpos) ? el.xpos : 10;
        const lbl = `[t${idx}]`;
        filters.push(
          `${prev} drawtext=textfile='${escTxt}':` +
          `fontfile='${escFont}':fontcolor=${color}:` +
          `fontsize=${size}:x=${xExpr}:y=${baseY} ${lbl}`
        );
        prev = lbl;
      }
    }
  });

  // finalize
  filters.push(`${prev} copy[out]`);

  const cmd = [
    `"${ffmpegPath}" -y`,
    ...inputs,
    `-filter_complex "${filters.join(";")}"`,
    "-map [out]",
    "-frames:v 1",
    `"${outputImg}"`
  ].join(" ");

  console.log("▶️ FFmpeg command:", cmd);

try {
  await execAsync(cmd);
  return await fs.promises.readFile(outputImg);
} catch (err) {
  console.error("🔥 FFmpeg execution failed:", err.stderr || err.message || err);
  throw err;
} finally {
  tempFiles.forEach(f => fs.unlink(f, () => {}));
  fs.unlinkSync(outputImg);
}

}

module.exports = { composeDynamic };
