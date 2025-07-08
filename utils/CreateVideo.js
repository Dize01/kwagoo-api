const ffmpegPath = require("ffmpeg-static");
const { exec }   = require("child_process");
const util       = require("util");
const fs         = require("fs");
const path       = require("path");

const execAsync = util.promisify(exec);

const TEMP_DIR = path.resolve(__dirname, "../temp");
const OUT_DIR  = path.resolve(__dirname, "../output");
const ensureDir = dir => fs.mkdirSync(dir, { recursive: true });

const DEFAULT_FONT = process.platform === "win32"
  ? "C:/Windows/Fonts/arial.ttf"
  : "/usr/share/fonts/truetype/msttcorefonts/arial.ttf";

// Escape for FFmpeg drawtext: backslashes, colons, then single quotes
const escapeFFmpegText = s =>
  s.replace(/\\/g, "\\\\")
   .replace(/:/g, "\\:")
   .replace(/'/g, "\\\\'");

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

async function createVideo(payload = {}) {
  const { containerId, elements = [], length } = payload;

  if (!containerId || !elements.length) {
    throw new Error("Payload must include `containerId` and at least one text element");
  }

  const containerPath = path.join(TEMP_DIR, containerId.toString());
  const videoPath = path.join(containerPath, "video.mp4");
  const outputPath = path.join(OUT_DIR, `${containerId}.mp4`);

  // Optional audio
  const audioPath = fs.existsSync(path.join(containerPath, "audio.mp3"))
    ? path.join(containerPath, "audio.mp3")
    : null;

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Missing video file in container: ${videoPath}`);
  }

  ensureDir(OUT_DIR);

  // Build filter chains
  const chains = [`[0:v]scale=1080:1920[scaled]`];
  let prevLabel = "[scaled]";

  elements.forEach((el, idx) => {
    if (el.Type !== "Text" || typeof el.Value !== "string") return;

    const fontSize  = Number.isFinite(el.FontSize) ? el.FontSize : 48;
    const fontColor = el.FontColor || "white";
    const baseY     = Number.isFinite(el.ypos) ? el.ypos : 10;
    const maxChars  = Number.isFinite(el.MaxLineLength) ? el.MaxLineLength : 40;
    const align     = (el.align || "left").toLowerCase();

    const lines = wrapLines(el.Value, maxChars);

    // Resolve font file
    const style    = el.FontStyle || null;
    const fontFile = style
      ? (process.platform === "win32"
          ? `C:/Windows/Fonts/${style}.ttf`
          : `/usr/share/fonts/truetype/msttcorefonts/${style}.ttf`)
      : DEFAULT_FONT;
    const escFont = fontFile.replace(/\\/g, "\\\\").replace(/:/g, "\\:");

    const lineHeight = Math.round(fontSize * 1.2);

    lines.forEach((ln, i) => {
      const safeText = escapeFFmpegText(ln);
      const yPos = baseY + i * lineHeight;

      let xExpr;
      if (align === "center") {
        xExpr = "(w-text_w)/2";
      } else if (align === "right") {
        xExpr = "w-text_w-10";
      } else {
        xExpr = Number.isFinite(el.xpos) ? el.xpos : 10;
      }

      const label = `[t${idx}_${i}]`;
      chains.push(
        `${prevLabel}` +
        `drawtext=fontfile='${escFont}'` +
        `:text='${safeText}'` +
        `:fontcolor=${fontColor}` +
        `:fontsize=${fontSize}` +
        `:x=${xExpr}` +
        `:y=${yPos}` +
        `${label}`
      );
      prevLabel = label;
    });
  });

  // Final pass: label the output stream
  chains.push(`${prevLabel}copy[out]`);

  // Join filter_complex
  const filterComplex = chains.join(";");
  console.log("FILTER_GRAPH:", filterComplex);

  // Build FFmpeg command
  const inputs = [
    ...(audioPath ? ["-stream_loop", "-1"] : []),
    `-i "${videoPath}"`,
    ...(audioPath ? [`-i "${audioPath}"`] : [])
  ];

  const maps = [
    `-map "[out]"`,
    audioPath ? `-map 1:a` : `-map 0:a?`
  ];

  const cmdParts = [
    `"${ffmpegPath}" -y`,
    ...inputs,
    `-filter_complex "${filterComplex}"`,
    ...maps,
    `-c:v libx264 -profile:v baseline -level 3.1 -pix_fmt yuv420p`,
    `-r 30 -crf 23 -preset veryfast`,
    `-c:a aac -b:a 128k -ar 48000`,
    `-movflags +faststart`
  ];

  if (Number.isFinite(length) && length > 0) {
    cmdParts.push(`-t ${length}`);
  } else if (audioPath) {
    // only stop when audio ends if no length specified
    // *remove* -shortest to respect length, use only here if desired
    cmdParts.push(`-shortest`);
  }

  cmdParts.push(`"${outputPath}"`);
  const cmd = cmdParts.join(" ");
  console.log("▶️ FFmpeg command:\n", cmd);

  // Execute and return URL
  try {
    const { stderr } = await execAsync(cmd);
    if (stderr) console.error("⚠️ FFmpeg stderr:\n", stderr);
    return {
      containerId,
      url: `https://api2.kwagoo.com/output/${containerId}.mp4`
    };
  } catch (err) {
    console.error("🔥 FFmpeg failed:", err.stderr || err.message);
    throw err;
  }
}

module.exports = { createVideo };
