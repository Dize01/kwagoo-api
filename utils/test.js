// Import the path to the statically bundled ffmpeg binary (cross-platform)
const ffmpegPath = require("ffmpeg-static");

// Import Node.js modules for executing shell commands, file handling, and resolving file paths
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

// 🔧 Default fallback text position if not provided in the input
const X_POS = 100;
const Y_POS = 100;

// Main function to compose an image with overlaid text using FFmpeg
function composeTest(payload = {}) {
  return new Promise((resolve, reject) => {
    const { elements = [] } = payload;

    //Get Time
    const now = new Date();
    const nowText = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
    // Example: "20250625_234559"

    // 🔍 Step 1: Validate that `elements` is an array
    if (!Array.isArray(elements)) {
      console.error("🚫 elements is not an array:", elements);
      return reject(new Error("'elements' must be an array"));
    }

    // 🔍 Step 2: Find the first Text element with a valid string `Value`
    const textElement = elements.find(
      el => el.Type === "Text" && typeof el.Value === "string"
    );

    // 🔍 Step 2b: Collect all Image elements with a valid base64 string
    const imageElements = elements.filter(
      el => el.Type === "Image" && typeof el.Value === "string"
    );

    const tempDir = path.resolve(__dirname, "../temp"); // root-level temp folder

    // create the folder once if it doesn’t exist
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);


    const inputImagePaths = []; // keep track of the files we create

    imageElements.forEach((imgEl, idx) => {
      try {
        const base64Data = imgEl.Value;          // raw base-64 (no prefix)
        const filename   = `temp_${nowText}_${idx + 1}.png`;
        const filePath   = path.join(tempDir, filename);

        // write the decoded buffer to disk
        fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));

        inputImagePaths.push(filePath);          // store for later use
        console.log(`🖼️  Saved ${filePath}`);
      } catch (err) {
        console.error(`💥 Failed to write image #${idx + 1}:`, err);
      }
    });


    // ❌ If no valid Text element was found, exit early
    if (!textElement) {
      console.error("🚫 No valid text element found in:", elements);
      return reject(new Error("No valid text element found"));
    }

    // 🧾 Step 3: Define all necessary values
    const text = textElement.Value || "Untitled"; // fallback text
    const fontPath = "C:/Windows/Fonts/arial.ttf"; // font used for drawing text (update for Ubuntu/Mac)
    const defaultBg = path.resolve(__dirname, "default.png"); // background image
    const outputfilename   = `output${nowText}.png`;
    const outputImg = path.resolve(__dirname, "../output/" + outputfilename); // output path

    // 📌 Use x/y positions from the element if provided, otherwise fallback to default
    const xpos = Number.isFinite(textElement.xpos) ? textElement.xpos : X_POS;
    const ypos = Number.isFinite(textElement.ypos) ? textElement.ypos : Y_POS;

    // 🧠 Step 4: Build the FFmpeg command
    const cmd =
      `"${ffmpegPath}" -y -i "${defaultBg}" ` + // input image
      `-vf "drawtext=fontfile='${fontPath}':` + // drawtext filter with font
      `text='${text}':fontcolor=white:fontsize=48:x=${xpos}:y=${ypos}" ` + // text settings
      `"${outputImg}"`; // output image path

    // 🖥️ Log the command for debugging
    console.log("▶️  Running FFmpeg command:\n", cmd);

    // 🚀 Step 5: Execute the FFmpeg command
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error("💥 FFmpeg execution error:", err);
        console.error("📝 FFmpeg stderr:\n", stderr);
        return reject(new Error(`FFmpeg error: ${stderr}`));
      }

      if (stdout) console.log("ℹ️  FFmpeg stdout:\n", stdout);

      // 📥 Step 6: Read the generated output image
      fs.readFile(outputImg, (readErr, buffer) => {
        if (readErr) {
          console.error("💥 Error reading output image:", readErr);
          return reject(readErr);
        }

        // ✅ Success — return the image as a buffer
        console.log(
          "✅ Image generated successfully. Buffer size:",
          buffer.length,
          "bytes"
        );
        resolve(buffer);
      });
    });
  });
}

// Export the function so it can be used in index.js or other routes
module.exports = { composeTest };
