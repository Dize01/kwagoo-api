// index.js
const path = require("path"); // make sure this is already at the top
const express = require("express");
const multer  = require("multer");
const { composeImage }   = require("./utils/ImageComposer");
const { composeTest }    = require("./utils/test");
const { composeDynamic } = require("./utils/DynamicComposer");
const { composeVideo }   = require("./utils/VideoComposer");
const { createContainer }= require("./utils/Container");
const { uploadVideo }    = require("./utils/VideoUploader");
const { uploadAudio }    = require("./utils/AudioUploader");
const { createVideo }    = require("./utils/CreateVideo");


const PORT = process.env.PORT || 4000;
const app  = express();

// ✅ Make output folder publicly accessible
app.use("/output", express.static(path.join(__dirname, "output")));


// keep JSON parser for your other endpoints
app.use(express.json({ limit: "20mb" }));

// configure multer to store file in memory
const upload = multer({ storage: multer.memoryStorage() });

// ───── /composeimage
app.post("/composeimage", async (req, res) => {
  try {
    const buffer = await composeImage(req.body);
    res.type("png").send(buffer);
  } catch (err) {
    console.error("🔥 /composeImage error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ───── /composetest
app.post("/composetest", async (req, res) => {
  try {
    const combinedString = composeTest(req.body);
    res.json({ result: combinedString });
  } catch (err) {
    console.error("🔥 /composetest error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ───── /composedynamic
app.post("/composedynamic", async (req, res) => {
  try {
    const buffer = await composeDynamic(req.body);
    res.set("Content-Type", "image/png");              // ✅ Tell Postman it's an image
    res.send(buffer);  ;   
  } catch (err) {
    console.error("🔥 /composedynamic error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ───── /composevideo
app.post("/composevideo", async (req, res) => {
  try {
    const buffer = await composeVideo(req.body);
    res.set("Content-Type", "video/mp4");
    res.send(buffer);
  } catch (err) {
    console.error("🔥 /composevideo error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ───── /createcontainer
app.post("/createcontainer", async (req, res) => {
  try {
    const result = await createContainer(req.body);
    res.json(result);
  } catch (err) {
    console.error("🔥 /createContainer error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ───── /uploadvideo  ← multer middleware applied here
app.post(
  "/uploadvideo",
  upload.single("video"),      // look for form-field “video”
  async (req, res) => {
    try {
      // containerId from a text field, file buffer from multer
      const result = await uploadVideo({
        containerId: req.body.containerId,
        file:        req.file
      });
      res.json(result);
    } catch (err) {
      console.error("🔥 /uploadVideo error:", err.message);
      res.status(400).json({ error: err.message });
    }
  }
);

// ───── /uploadaudio  ← multer middleware applied here
app.post(
  "/uploadaudio",
  upload.single("audio"),      // look for form-field “audio”
  async (req, res) => {
    try {
      // containerId from a text field, file buffer from multer
      const result = await uploadAudio({
        containerId: req.body.containerId,
        file:        req.file
      });
      res.json(result);
    } catch (err) {
      console.error("🔥 /uploadaudio error:", err.message);
      res.status(400).json({ error: err.message });
    }
  }
);

// ───── /createvideo
app.post("/createvideo", async (req, res) => {
  try {
    //const buffer = await createVideo(req.body);
    //res.set("Content-Type", "video/mp4");
    //res.send(buffer);
    const result = await createVideo(req.body);
    res.json(result); // now sending JSON instead of binary video
  } catch (err) {
    console.error("🔥 /createvideo error:", err.message);
    res.status(400).json({ error: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`✅  kwagooAPI running at http://localhost:${PORT}`);
});
