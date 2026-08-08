const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Home page
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "AI Social Agent is running 🚀"
  });
});

// AI command system
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
