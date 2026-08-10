const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve the website
app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Receive AI commands
app.post("/command", (req, res) => {
  const { command } = req.body;

  if (!command) {
    return res.status(400).json({
      error: "Please provide a command."
    });
  }

  res.json({
    success: true,
    command: command,
    message: "Command received successfully.",
    nextStep: "AI processing will be connected here."
  });
});

app.listen(PORT, () => {
  console.log(`AI Social Agent running on port ${PORT}`);
});
