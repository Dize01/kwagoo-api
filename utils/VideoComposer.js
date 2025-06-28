// VideoComposer.js
const ffmpegPath = require("ffmpeg-static");
const { exec }   = require("child_process");
const util       = require("util");
const fs         = require("fs");
const path       = require("path");

const execAsync  = util.promisify(exec);

const TEMP_DIR   = path.resolve(__dirname, "../temp");
const OUT_DIR    = path.resolve(__dirname, "../output");

// Ensure directories exist
const ensureDir = dir => fs.mkdirSync(dir, { recursive: true });

// Strip the data URI prefix from a base64 video string
const stripBase64Prefix = str =>
  str.replace(/^data:video\/[a-z]+;base64,?/i, "");

// Escape characters that would confuse FFmpeg's drawtext
const escapeFFmpegText = str =>
  str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");

// MAIN: Compose video with text overlays
async function composeVideo(payload = {}) {
  const { video, elements = [] } = payload;

  if (!video || !Array.isArray(elements) || !elements.length) {
    throw new Error("Payload must include base64 'video' and non-empty 'elements'");
  }

  ensureDir(TEMP_DIR);
  ensureDir(OUT_DIR);

  const ts         = Date.now();
  const videoPath  = path.join(TEMP_DIR, `input_${ts}.mp4`);
  const outputPath = path.join(OUT_DIR,  `video_${ts}.mp4`);

  // Write uploaded video to disk
  fs.writeFileSync(videoPath, Buffer.from(stripBase64Prefix(video), "base64"));

  // Build filter chains
  const filterChains = [];
  let currentLabel = "[0:v]";

  elements.forEach((el, idx) => {
    if (el.Type !== "Text" || typeof el.Value !== "string") return;

    // Sanitize text and position
    const safeText = escapeFFmpegText(el.Value);
    const fontSize = Number.isFinite(el.FontSize) ? el.FontSize : 48;
    const posX     = Number.isFinite(el.xpos)     ? el.xpos     : 0;
    const posY     = Number.isFinite(el.ypos)     ? el.ypos     : 0;

    // Determine font style/name
    const style    = el.FontStyle || (process.platform === "win32" ? "arial" : "DejaVuSans");
    const fontFile = process.platform === "win32"
      ? `C:/Windows/Fonts/${style}.ttf`
      : `/usr/share/fonts/truetype/dejavu/${style}.ttf`;

    // Escape for FFmpeg
    const escapedFontFile = fontFile
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:");

    // Use file if found, else rely on Fontconfig name lookup
    const fontSpec = fs.existsSync(fontFile)
      ? `fontfile='${escapedFontFile}'`
      : `font='${style}'`;

    // Next label
    const nextLabel = `[v${idx}]`;

    // Append drawtext filter
    filterChains.push(
      `${currentLabel}drawtext=${fontSpec}` +
      `:text='${safeText}'` +
      `:fontcolor=white` +
      `:fontsize=${fontSize}` +
      `:x=${posX}` +
      `:y=${posY}` +
      `${nextLabel}`
    );

    currentLabel = nextLabel;
  });

  // Final copy to [out]
  filterChains.push(`${currentLabel}copy[out]`);

  const filterComplex = filterChains.join(";");

  const cmd = [
    `"${ffmpegPath}" -y`,
    `-i "${videoPath}"`,
    `-filter_complex "${filterComplex}"`,
    `-map "[out]"`,
    `-map 0:a?`,                   // include audio if present
    `-c:v libx264 -crf 23 -preset veryfast`,
    `-c:a aac`,
    `"${outputPath}"`
  ].join(" ");

  console.log("▶️  FFmpeg command:\n", cmd);

  try {
    // Run FFmpeg and capture stderr for debugging
    const { stderr } = await execAsync(cmd);
    if (stderr) console.error("⚠️ FFmpeg stderr:\n", stderr);

    // Read and return the output video
    const buffer = await fs.promises.readFile(outputPath);
    await fs.promises.unlink(outputPath).catch(() => {}); // cleanup
    return buffer;

  } catch (err) {
    console.error("🔥 FFmpeg failed:", err.stderr || err.message || err);
    throw err;

  } finally {
    // Always remove the input video
    fs.unlink(videoPath, () => {});
  }
}

module.exports = { composeVideo };
