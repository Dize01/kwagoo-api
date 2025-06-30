// VideoComposer.js
// Dynamically composes a video with optional text overlays and custom audio track
// using FFmpeg. Accepts base64 `video`, optional base64 `audio`, and an array of
// `elements` (text layers). Returns the final video as a Buffer.
//
// Install deps: npm install ffmpeg-static
// ────────────────────────────────────────────────────────────────────────────────

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

// Strip any data:*;base64, prefix
const stripBase64Prefix = str =>
  str.replace(/^data:.*;base64,?/, "");

// Escape special chars for FFmpeg drawtext
const escapeFFmpegText = s =>
  s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");

// Split text into lines ≤ maxChars
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

async function composeVideo(payload = {}) {
  const { video, audio, elements = [] } = payload;
  if (!video || !elements.length) {
    throw new Error("Payload must include base64 `video` and at least one text element");
  }

  ensureDir(TEMP_DIR);
  ensureDir(OUT_DIR);

  const ts        = Date.now();
  const videoPath = path.join(TEMP_DIR, `input_${ts}.mp4`);
  const audioPath = audio ? path.join(TEMP_DIR, `audio_${ts}.mp3`) : null;
  const outputPath= path.join(OUT_DIR,  `output_${ts}.mp4`);

  const tempFiles = [videoPath];
  const textFiles = [];

  // Write video file
  fs.writeFileSync(videoPath, Buffer.from(stripBase64Prefix(video), "base64"));

  // Write audio file if provided
  if (audio) {
    fs.writeFileSync(audioPath, Buffer.from(stripBase64Prefix(audio), "base64"));
    tempFiles.push(audioPath);
  }

  // Build filter_complex for text overlays
  const chains    = [];
  let   prevLabel = "[0:v]";

  elements.forEach((el, idx) => {
    if (el.Type !== "Text" || typeof el.Value !== "string") return;

    // Text settings
    const fontSize = Number.isFinite(el.FontSize) ? el.FontSize : 48;
    const fontColor= el.FontColor   || "white";
    const baseY    = Number.isFinite(el.ypos)     ? el.ypos     : 10;
    const maxChars = Number.isFinite(el.MaxLineLength) ? el.MaxLineLength : 40;
    const align    = (el.align || "left").toLowerCase();

    // Wrap into lines
    const lines = wrapLines(el.Value, maxChars);

    // Resolve font file
    const style    = el.FontStyle || null;
    const fontFile = style
      ? (process.platform === "win32"
          ? `C:/Windows/Fonts/${style}.ttf`
          : `/usr/share/fonts/truetype/msttcorefonts/${style}.ttf`)
      : DEFAULT_FONT;
    const escFont  = fontFile.replace(/\\/g, "\\\\").replace(/:/g, "\\:");

    const lineHeight = Math.round(fontSize * 1.2);

    // Draw each line separately (center/right/left)
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

  // Final copy to [out]
  chains.push(`${prevLabel}copy[out]`);
  const filterComplex = chains.join(";");

  // Pull desired length (in seconds) from payload
  const { length } = payload;  // e.g. payload.length = 10

  // 3) Assemble inputs and maps
  const inputs = [
    ...(audio ? ["-stream_loop", "-1"] : []),
    `-i "${videoPath}"`,
    ...(audio ? [`-i "${audioPath}"`] : [])
  ];

  const maps = [
    `-map "[out]"`,
    audio ? `-map 1:a` : `-map 0:a?`
  ];

  // 4) Build ffmpeg command in parts
  const cmdParts = [
    `"${ffmpegPath}" -y`,
    ...inputs,
    `-filter_complex "${filterComplex}"`,
    ...maps,
    `-c:v libx264 -crf 30 -preset slow`,
    `-c:a aac`
  ];
      //`-c:v libx264 -crf 23 -preset veryfast`,
      //`-c:v libx264 -crf 30 -preset slow`,
  // if we have an external audio track, stop when it ends
  if (audio) {
    cmdParts.push(`-shortest`);
  }

  // if user specified a length, cut the output to that duration
  if (Number.isFinite(length) && length > 0) {
    cmdParts.push(`-t ${length}`);
  }

  // finally, write to disk
  cmdParts.push(`"${outputPath}"`);

  const cmd = cmdParts.join(" ");
  console.log("▶️ FFmpeg command:\n", cmd);


  // Execute & cleanup
  try {
    const { stderr } = await execAsync(cmd);
    if (stderr) console.error("⚠️ FFmpeg stderr:\n", stderr);

    const buffer = await fs.promises.readFile(outputPath);
    return buffer;

  } catch (err) {
    console.error("🔥 FFmpeg failed:", err.stderr || err.message);
    throw err;

  } finally {
    // remove temp files
    tempFiles.forEach(f => fs.unlinkSync(f));
    textFiles.forEach(f => fs.unlinkSync(f));
    // optionally remove output: 
    fs.unlinkSync(outputPath);
  }
}

module.exports = { composeVideo };
