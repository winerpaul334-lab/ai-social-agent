const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Website
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Save a memory
async function saveMemory(memory) {
  const { error } = await supabase
    .from("agent_memory")
    .insert({
      memory: memory
    });

  if (error) {
    console.error("Memory save error:", error);
    return false;
  }

  return true;
}

// Get previous memories
async function getMemories() {
  const { data, error } = await supabase
    .from("agent_memory")
    .select("memory, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("Memory read error:", error);
    return [];
  }

  return data || [];
}

// Save generated post
async function savePost(command, post, hashtags, imageIdea) {
  const { error } = await supabase
    .from("posts")
    .insert({
      command,
      post,
      hashtags,
      image_idea: imageIdea
    });

  if (error) {
    console.error("Post save error:", error);
  }
}

// Get previous posts
async function getPreviousPosts() {
  const { data, error } = await supabase
    .from("posts")
    .select("post, hashtags, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Post history error:", error);
    return [];
  }

  return data || [];
}

// AI command
app.post("/command", async (req, res) => {
  const { command } = req.body;

  if (!command) {
    return res.status(400).json({
      success: false,
      error: "Please provide a command."
    });
  }

  try {
    const lowerCommand = command.toLowerCase();

    // --------------------------------
    // REMEMBER COMMAND
    // --------------------------------
    const rememberWords = [
      "remember that",
      "remember this",
      "remember:"
    ];

    const isRememberCommand = rememberWords.some(word =>
      lowerCommand.includes(word)
    );

    if (isRememberCommand) {
      let memory = command;

      for (const word of rememberWords) {
        memory = memory.replace(new RegExp(word, "i"), "").trim();
      }

      const saved = await saveMemory(memory);

      if (!saved) {
        return res.status(500).json({
          success: false,
          error: "I could not save that memory."
        });
      }

      return res.json({
        success: true,
        type: "memory",
        message: "Got it. I saved that to my memory.",
        memory
      });
    }

    // --------------------------------
    // GET MEMORIES
    // --------------------------------
    const memoryWords = [
      "what do you remember",
      "what you remember",
      "show my memories",
      "my memories",
      "what have you remembered"
    ];

    const isMemoryQuestion = memoryWords.some(word =>
      lowerCommand.includes(word)
    );

    const memories = await getMemories();

    if (isMemoryQuestion) {
      return res.json({
        success: true,
        type: "memory",
        memories
      });
    }

    // --------------------------------
    // GET PREVIOUS POSTS
    // --------------------------------
    const previousPosts = await getPreviousPosts();

    const memoryText =
      memories.length > 0
        ? memories
            .map((item, index) => `${index + 1}. ${item.memory}`)
            .join("\n")
        : "No saved memories yet.";

    const postHistoryText =
      previousPosts.length > 0
        ? previousPosts
            .map((item, index) =>
              `${index + 1}. ${item.post}`
            )
            .join("\n")
        : "No previous posts yet.";

    // --------------------------------
    // AI PROMPT
    // --------------------------------
    const prompt = `
You are the AI brain of a professional social media agent.

You must understand normal typed commands and eventually voice commands.

USER COMMAND:
${command}

USER MEMORY:
${memoryText}

PREVIOUS POSTS:
${postHistoryText}

IMPORTANT INSTRUCTIONS:

1. Actually use the USER MEMORY when it is relevant.
2. Do not claim to remember something that is not in USER MEMORY.
3. Avoid repeating previous posts.
4. If the user asks for a social media post, create the actual post.
5. If the user asks for hashtags, provide relevant hashtags.
6. If the user asks for an image, provide a detailed IMAGE_IDEA.
7. If the user asks for current/latest news, do not pretend you know live information. Live web research will be added separately.
8. Follow the user's exact command.
9. Keep content natural, professional and engaging.

Return the answer using exactly these sections when creating a post:

POST:
[actual post]

HASHTAGS:
[hashtags]

IMAGE_IDEA:
[image idea]
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt
    });

    const result = response.text || "";

    // --------------------------------
    // EXTRACT POST INFORMATION
    // --------------------------------
    let postText = result;
    let hashtags = "";
    let imageIdea = "";

    const hashtagMatch = result.match(
      /HASHTAGS:\s*([\s\S]*?)(?=\nIMAGE_IDEA:|$)/i
    );

    const imageMatch = result.match(
      /IMAGE_IDEA:\s*([\s\S]*)$/i
    );

    const postMatch = result.match(
      /POST:\s*([\s\S]*?)(?=\nHASHTAGS:|$)/i
    );

    if (postMatch) {
      postText = postMatch[1].trim();
    }

    if (hashtagMatch) {
      hashtags = hashtagMatch[1].trim();
    }

    if (imageMatch) {
      imageIdea = imageMatch[1].trim();
    }

    // Save the generated post
    await savePost(
      command,
      postText,
      hashtags,
      imageIdea
    );

    res.json({
      success: true,
      command,
      response: result,
      memory_used: memories.length,
      previous_posts_checked: previousPosts.length
    });

  } catch (error) {
    console.error("AI error:", error);

    res.status(500).json({
      success: false,
      error: "AI could not process the command."
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI Social Agent running on port ${PORT}`);
});
