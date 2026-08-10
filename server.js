const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Gemini AI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Website
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// AI command
app.post("/command", async (req, res) => {
  const { command } = req.body;

  if (!command) {
    return res.status(400).json({
      error: "Please provide a command."
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: command
    });

    res.json({
      success: true,
      command: command,
      response: response.text
    });

  } catch (error) {
    console.error("Gemini error:", error);

    res.status(500).json({
      success: false,
      error: "AI could not process the command."
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI Social Agent running on port ${PORT}`);
});
