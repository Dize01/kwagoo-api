const ffmpegPath = require("ffmpeg-static");
const { exec } = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");

const execAsync = util.promisify(exec);

const TEMP_DIR = path.resolve(__dirname, "../temp");
const OUT_DIR = path.resolve(__dirname, "../output");

const FONT_PATH = process.platform === "win32"
  ? "C:/Windows/Fonts/arial.ttf"
  : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

const ensureDir = dir => fs.mkdirSync(dir, { recursive: true });

const stripBase64Prefix = str =>
  str.replace(/^data:video\/[a-z]+;base64,?/i, "");

const escapeFFmpegText = str =>
  str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");

async function composeVideo(payload = {}) {
  const { video, elements = [] } = payload;

  if (!video || !Array.isArray(elements) || elements.length === 0) {
    throw new Error("Payload must include base64 'video' and text 'elements'");
  }

  ensureDir(TEMP_DIR);
  ensureDir(OUT_DIR);

  const ts = Date.now();
  const videoPath = path.join(TEMP_DIR, `input_${ts}.mp4`);
  const outputPath = path.join(OUT_DIR, `video_${ts}.mp4`);

  fs.writeFileSync(videoPath, Buffer.from(stripBase64Prefix(video), "base64"));

 let filters = "";
 let current = "[0:v]";


  elements.forEach((el, idx) => {
    if (el.Type === "Text" && typeof el.Value === "string") {
      const safe = escapeFFmpegText(el.Value);
      const size = Number.isFinite(el.FontSize) ? el.FontSize : 48;
      const x = Number.isFinite(el.xpos) ? el.xpos : 0;
      const y = Number.isFinite(el.ypos) ? el.ypos : 0;

      filters += `${idx > 0 ? ";" : ""}${current}drawtext=fontfile='${FONT_PATH}':text='${safe}':fontcolor=white:fontsize=${size}:x=${x}:y=${y}[v${idx}]`;
      current = `[v${idx}]`;
    }
  });

  filters += `;${current}copy[out]`; // Only if elements.length > 0


  const cmd = [
    `"${ffmpegPath}" -y`,
    `-i "${videoPath}"`,
    `-filter_complex "${filters}"`,
    `-map "[out]"`,
    `-map 0:a?`,             // Include audio if present
    `-c:v libx264 -crf 23`,  // Reasonable compression
    `-preset veryfast`,
    `-c:a aac`,
    `"${outputPath}"`
  ].join(" ");

  console.log("▶️  FFmpeg command:\n", cmd);

  try {
    await execAsync(cmd);
    const buffer = await fs.promises.readFile(outputPath);
    await fs.promises.unlink(outputPath);
    return buffer;
  } finally {
    fs.unlink(videoPath, () => {});
  }
}

module.exports = { composeVideo };
