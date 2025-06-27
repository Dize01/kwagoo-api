// index.js
const express = require("express");
const { composeImage } = require("./utils/ImageComposer");
const { composeTest } = require("./utils/test");
const { composeDynamic } = require("./utils/DynamicComposer");
const { composeVideo } = require("./utils/VideoComposer");

const PORT = process.env.PORT || 3000;
const app  = express();

app.use(express.json({ limit: "20mb" }));

// ───── /composeimage
app.post("/composeimage", async (req, res) => {
  try {
    const buffer = await composeImage(req.body);     // ✅ await the image Buffer
    res.set("Content-Type", "image/png");              // ✅ Tell Postman it's an image
    res.send(buffer);                                  // ✅ Send it as response
  } catch (err) {
    console.error("🔥  /composeImage error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ───── /composetest
app.post("/composetest", async (req, res) => {
  try {
    const combinedString = composeTest(req.body);
    res.json({ result: combinedString });
  } catch (err) {
    console.error("🔥  /composetest error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ───── /composetest
app.post("/composedynamic", async (req, res) => {
  try {
    const buffer = await composeDynamic(req.body);     // ✅ await the image Buffer
    res.set("Content-Type", "image/png");              // ✅ Tell Postman it's an image
    res.send(buffer);                                  // ✅ Send it as response
  } catch (err) {
    console.error("🔥  /composedynamic error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

app.post("/composevideo", async (req, res) => {
  try {
    const buffer = await composeVideo(req.body);
    res.set("Content-Type", "video/mp4");
    res.send(buffer);
  } catch (err) {
    console.error("🔥  /composevideo error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅  kwagooAPI running at http://localhost:${PORT}`);
});
