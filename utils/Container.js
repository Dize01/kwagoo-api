// utils/Container.js
const fs = require('fs').promises;
const path = require('path');

async function createContainer(data) {
  // 1️⃣ Generate a unique numeric ID (you can swap this for any ID generator)
  const containerId = Date.now();

  // 2️⃣ Build the path under your app's temp folder:
  //    __dirname === /path/to/your/app/utils
  const baseTempDir = path.resolve(__dirname, '..', 'temp');
  const containerPath = path.join(baseTempDir, containerId.toString());

  // 3️⃣ Ensure the base temp folder exists (in case you haven’t committed it yet)
  await fs.mkdir(baseTempDir, { recursive: true });

  // 4️⃣ Create the specific container directory
  await fs.mkdir(containerPath, { recursive: true });

  // 5️⃣ Return the info (Express will JSON‐stringify this for you)
  return { containerId, containerPath };
}

module.exports = { createContainer };
