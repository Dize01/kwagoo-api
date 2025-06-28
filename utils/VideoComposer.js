// VideoComposer.js
const ffmpegPath = require("ffmpeg-static");
const { exec }   = require("child_process");
const util       = require("util");
const fs         = require("fs");
const path       = require("path");

const execAsync = util.promisify(exec);

const TEMP_DIR = path.resolve(__dirname, "../temp");
const OUT_DIR  = path.resolve(__dirname, "../output");
const ensureDir = dir => fs.mkdirSync(dir, { recursive: true });

// Strip base64 data URI prefix
const stripBase64Prefix = str =>
  str.replace(/^data:video\/[a-z]+;base64,?/i, "");

// Escape special characters for drawtext
const escapeFFmpegText = str =>
  str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");

// Split string into words and wrap into lines of maxChars
function wrapText(str, maxChars) {
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

async function composeVideo(payload = {}) {
  const { video, elements = [] } = payload;
  if (!video || !elements.length) {
    throw new Error("Must include base64 `video` and at least one text element");
  }

  ensureDir(TEMP_DIR);
  ensureDir(OUT_DIR);

  const ts      = Date.now();
  const inPath  = path.join(TEMP_DIR, `in_${ts}.mp4`);
  const outPath = path.join(OUT_DIR,  `out_${ts}.mp4`);

  // 1) Save incoming video
  fs.writeFileSync(inPath, Buffer.from(stripBase64Prefix(video), "base64"));

  // 2) Build filter_complex chains
  const chains    = [];
  let   prevLabel = "[0:v]";
  const textFiles = [];

  elements.forEach((el, idx) => {
    if (el.Type !== "Text" || typeof el.Value !== "string") return;

    // common metrics
    const fontSize  = Number.isFinite(el.FontSize) ? el.FontSize : 48;
    const fontColor = el.FontColor   || "white";
    const baseY     = Number.isFinite(el.ypos)     ? el.ypos : 10;
    const maxChars  = Number.isFinite(el.MaxLineLength) ? el.MaxLineLength : 40;
    const align     = (el.align || "left").toLowerCase();

    // wrap into lines
    const lines = wrapText(el.Value, maxChars);

    // resolve per-element font style
    const style    = el.FontStyle || (process.platform === "win32" ? "arial" : "DejaVuSans");
    const fontFileRaw = process.platform === "win32"
      ? `C:/Windows/Fonts/${style}.ttf`
      : `/usr/share/fonts/truetype/dejavu/${style}.ttf`;
    const escFont = fontFileRaw.replace(/\\/g, "\\\\").replace(/:/g, "\\:");

    if (align === "center" || align === "right") {
      // draw each line individually for center/right
      const lineHeight = Math.round(fontSize * 1.2);
      lines.forEach((line, i) => {
        const safeLine = escapeFFmpegText(line);
        const yPos     = baseY + i * lineHeight;
        const xExpr    = align === "center" ? "(w-text_w)/2" : "w-text_w-10";
        const nextLabel = `[v${idx}_${i}]`;

        chains.push(
          `${prevLabel}` +
          `drawtext=fontfile='${escFont}'` +
          `:text='${safeLine}'` +
          `:fontcolor=${fontColor}` +
          `:fontsize=${fontSize}` +
          `:x=${xExpr}` +
          `:y=${yPos}` +
          `${nextLabel}`
        );
        prevLabel = nextLabel;
      });

    } else {
      // left: write all lines to temp .txt and draw as block
      const txtPath = path.join(TEMP_DIR, `txt_${ts}_${idx}.txt`);
      fs.writeFileSync(txtPath, lines.join("\n"), "utf8");
      textFiles.push(txtPath);
      const escTxt = txtPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:");

      const xExpr = "10";
      const nextLabel = `[v${idx}]`;

      chains.push(
        `${prevLabel}` +
        `drawtext=textfile='${escTxt}'` +
        `:fontfile='${escFont}'` +
        `:fontcolor=${fontColor}` +
        `:fontsize=${fontSize}` +
        `:x=${xExpr}` +
        `:y=${baseY}` +
        `${nextLabel}`
      );
      prevLabel = nextLabel;
    }
  });

  // final copy to [out]
  chains.push(`${prevLabel}copy[out]`);
  const filterComplex = chains.join(";");

  // 3) Assemble FFmpeg command
  const cmd = [
    `"${ffmpegPath}" -y`,
    `-i "${inPath}"`,
    `-filter_complex "${filterComplex}"`,
    `-map "[out]"`,
    `-map 0:a?`,
    `-c:v libx264 -crf 23 -preset veryfast`,
    `-c:a aac`,
    `"${outPath}"`
  ].join(" ");

  console.log("▶️ FFmpeg command:\n", cmd);

  // 4) Execute & cleanup
  try {
    const { stderr } = await execAsync(cmd);
    if (stderr) console.error("⚠️ FFmpeg stderr:\n", stderr);

    const buffer = await fs.promises.readFile(outPath);
    await fs.promises.unlink(outPath).catch(() => {});
    return buffer;

  } catch (err) {
    console.error("🔥 FFmpeg failed:", err.stderr || err.message);
    throw err;

  } finally {
    fs.unlink(inPath,    () => {});
    textFiles.forEach(f => fs.unlink(f, () => {}));
  }
}

module.exports = { composeVideo };
