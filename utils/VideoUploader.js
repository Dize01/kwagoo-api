// utils/VideoUploader.js
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

  // 4️⃣ Write the uploaded buffer to disk
  const outputPath = path.join(containerPath, file.originalname);
  await fs.writeFile(outputPath, file.buffer);

  // 5️⃣ Return a JSON‐serializable result
  return {
    containerId,
    fileName:  file.originalname,
    savedTo:   outputPath
  };
}

module.exports = { uploadVideo };
