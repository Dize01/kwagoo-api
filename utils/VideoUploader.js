const fs   = require("fs").promises;
const path = require("path");

async function uploadVideo({ containerId, file }) {
  // 1️⃣ Validate inputs
  if (!containerId) throw new Error("Missing containerId");
  if (!file || !file.originalname || !file.buffer) {
    throw new Error("Missing or invalid file upload");
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

  // 4️⃣ Rename the file to "video" with original extension
  const ext = path.extname(file.originalname);        // e.g., ".mp4"
  const outputFileName = `video${ext}`;               // → "video.mp4"
  const outputPath = path.join(containerPath, outputFileName);

  // 5️⃣ Write file and overwrite if it already exists
  await fs.writeFile(outputPath, file.buffer);

  // 6️⃣ Return a JSON‐serializable result
  return {
    containerId,
    fileName:  outputFileName,
    savedTo:   outputPath
  };
}

module.exports = { uploadVideo };
