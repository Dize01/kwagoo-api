// utils/AudioUploader.js
const fs   = require("fs").promises;
const path = require("path");

async function uploadAudio({ containerId, file }) {
  // 1️⃣ Validate inputs
  if (!containerId) throw new Error("Missing containerId");
  if (!file || !file.originalname || !file.buffer) {
    throw new Error("Missing or invalid audio file upload");
  }

  // 2️⃣ Resolve your app’s temp/containerId folder
  const baseTempDir = path.resolve(__dirname, "..", "temp");
  const containerPath = path.join(baseTempDir, containerId.toString());

  // 3️⃣ Confirm the container directory exists
  try {
    await fs.access(containerPath);
  } catch {
    throw new Error(`Container not found: ${containerPath}`);
  }

  // 4️⃣ Rename the file to "audio" with original extension
  const ext = path.extname(file.originalname);        // e.g., ".mp3"
  const outputFileName = `audio${ext}`;               // → "audio.mp3"
  const outputPath = path.join(containerPath, outputFileName);

  await fs.writeFile(outputPath, file.buffer);        // ✅ This will replace existing file

  // 5️⃣ Return a JSON‐serializable result
  return {
    containerId,
    fileName:  outputFileName,
    savedTo:   outputPath
  };
}

module.exports = { uploadAudio };
