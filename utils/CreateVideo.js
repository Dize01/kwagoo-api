// utils/CreateVideo.js
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

// Improved escape function for FFmpeg drawtext
/*const escapeFFmpegText = s => {
  if (!s) return '';
  return String(s)
    .replace(/\\/g, '\\\\')     // escape backslashes first
    .replace(/'/g, "'\\\\\\''") // escape single quotes by wrapping in escaped quotes
    .replace(/%/g, '%%')        // escape percent signs
    .replace(/:/g, '\\:');      // escape colons
};*/

// Improved escape function for FFmpeg drawtext
const escapeFFmpegText = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '')     // escape backslashes first
    .replace(/:/g, '')       // escape colons
    .replace(/'/g, '')     // escape single quotes correctly
    .replace(/%/g, '')       // escape percent signs
    .replace(/"/g, '')       // escape double quotes
    .replace(/[“”]/g, '')      // replace curly quotes
    .replace(/[‘’]/g, "");     // replace curly apostrophes
};

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


  const audioPath = fs.existsSync(path.join(containerPath, "audio.mp3"))
    ? path.join(containerPath, "audio.mp3")
    : null;

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Missing video file in container: ${videoPath}`);
  }

  ensureDir(OUT_DIR);

  const chains = [`[0:v]scale=1080:1920[scaled]`]; // exact 9:16
  let prevLabel = "[scaled]";


  elements.forEach((el, idx) => {
    // Validate text elements
    elements.forEach(el => {
      if (el.Type === "Text" && typeof el.Value !== "string") {
        throw new Error(`Invalid text element value: ${el.Value}`);
      }
    });

    const fontSize  = Number.isFinite(el.FontSize) ? el.FontSize : 48;
    const fontColor = el.FontColor || "white";
    const baseY     = Number.isFinite(el.ypos) ? el.ypos : 10;
    const maxChars  = Number.isFinite(el.MaxLineLength) ? el.MaxLineLength : 40;
    const align     = (el.align || "left").toLowerCase();

    const lines = wrapLines(el.Value, maxChars);

    const style    = el.FontStyle || null;
    const fontFile = style
      ? (process.platform === "win32"
          ? `C:/Windows/Fonts/${style}.ttf`
          : `/usr/share/fonts/truetype/msttcorefonts/${style}.ttf`)
      : DEFAULT_FONT;
    const escFont  = fontFile.replace(/\\/g, "\\\\").replace(/:/g, "\\:");

    const lineHeight = Math.round(fontSize * 1.2);

    lines.forEach((ln, i) => {
      const safeText = escapeFFmpegText(ln);
      const yPos     = baseY + i * lineHeight;

      let xExpr;
      if (align === "center") {
        xExpr = "(w-text_w)/2";
      } else if (align === "right") {
        xExpr = "w-text_w-10";
      } else {
        xExpr = Number.isFinite(el.xpos) ? el.xpos : 10;
      }

      const label = `[t${idx}_${i}]`;
      // In the drawtext command construction:
      chains.push(
        `${prevLabel}` +
        `drawtext=fontfile='${escFont}'` +
        `:text='${safeText}'` +  // This is now properly escaped
        `:fontcolor=${fontColor}` +
        `:fontsize=${fontSize}` +
        `:x=${xExpr}` +
        `:y=${yPos}` +
        `${label}`
      );
      prevLabel = label;
    });
  });

  chains.push(`${prevLabel}copy[out]`);
  const filterComplex = chains.join(";");

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
    `-c:v libx264 -profile:v baseline -level 3.1 -pix_fmt yuv420p`, // <– required pixel format
    `-r 30`,                      // frame rate
    `-crf 23 -preset veryfast`,
    `-c:a aac -b:a 128k -ar 48000`,
    `-movflags +faststart`
  ];



  if (Number.isFinite(length) && length > 0) {
    cmdParts.push(`-t ${length}`);
  } else if (audioPath) {
    cmdParts.push(`-shortest`);
  }


  cmdParts.push(`"${outputPath}"`);
  const cmd = cmdParts.join(" ");
  console.log("▶️ FFmpeg command:\n", cmd);

  try {
    const { stderr } = await execAsync(cmd);
    if (stderr) console.error("⚠️ FFmpeg stderr:\n", stderr);
    return {
      containerId,
      url: `https://api2.kwagoo.com/output/${containerId}.mp4`
    };

    //const buffer = await fs.promises.readFile(outputPath);
    //return buffer;
  } catch (err) {
    console.error("🔥 FFmpeg failed:", err.stderr || err.message);
    throw err;
  } finally {
    try {
      //await fs.promises.unlink(outputPath);
    } catch {}
  }
}

module.exports = { createVideo };
