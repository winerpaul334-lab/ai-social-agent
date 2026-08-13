const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==========================================
// GEMINI
// ==========================================

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// ==========================================
// SUPABASE
// ==========================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY
);

const IMAGE_BUCKET = "generated-images";

// ==========================================
// WEBSITE
// ==========================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ==========================================
// MEMORY
// ==========================================

async function saveMemory(memory) {
  const { error } = await supabase
    .from("agent_memory")
    .insert({ memory });

  if (error) {
    console.error("Memory save error:", error);
    return false;
  }

  return true;
}

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

// ==========================================
// POSTS
// ==========================================

async function savePost(
  command,
  post,
  hashtags,
  imageIdea
) {
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

// ==========================================
// TAVILY WEB SEARCH
// ==========================================

async function webSearch(query) {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    console.error("TAVILY_API_KEY is missing.");

    return {
      success: false,
      answer: "",
      results: []
    };
  }

  try {
    const response = await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: "advanced",
          topic: "news",
          max_results: 6,
          include_answer: true,
          include_raw_content: false,
          include_images: false
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        "Tavily error:",
        response.status,
        errorText
      );

      return {
        success: false,
        answer: "",
        results: []
      };
    }

    const data = await response.json();

    return {
      success: true,
      answer: data.answer || "",
      results: data.results || []
    };

  } catch (error) {
    console.error(
      "Tavily request error:",
      error
    );

    return {
      success: false,
      answer: "",
      results: []
    };
  }
}

// ==========================================
// SAVE RESEARCH
// ==========================================

async function saveResearch(query, results) {
  const { error } = await supabase
    .from("research")
    .insert({
      query,
      results: JSON.stringify(results)
    });

  if (error) {
    console.error(
      "Research save error:",
      error
    );
  }
}

// ==========================================
// RESEARCH DETECTION
// ==========================================

function needsWebResearch(command) {
  const words = [
    "latest",
    "current",
    "today",
    "news",
    "recent",
    "research",
    "search the web",
    "search online",
    "find out",
    "what is happening",
    "trending",
    "this week",
    "this month",
    "breaking",
    "update",
    "updates"
  ];

  const text = command.toLowerCase();

  return words.some(word =>
    text.includes(word)
  );
}

// ==========================================
// CLEAN SEARCH RESULTS
// ==========================================

function cleanSearchResults(results) {
  return results
    .filter(item => {
      return (
        item &&
        item.title &&
        item.url &&
        item.content
      );
    })
    .map(item => ({
      title: item.title,
      url: item.url,
      content: item.content
    }));
}

// ==========================================
// RESEARCH TEXT
// ==========================================

function buildResearchText(
  answer,
  results
) {
  if (!results.length) {
    return `
No usable web research was returned.

Do not make current-event claims.
`;
  }

  const sourceText = results
    .map(
      (item, index) => `
SOURCE ${index + 1}

TITLE:
${item.title}

URL:
${item.url}

CONTENT:
${item.content}
`
    )
    .join("\n");

  return `
TAVILY SUMMARY:
${answer || "No summary returned."}

VERIFIED SEARCH MATERIAL:

${sourceText}
`;
}

// ==========================================
// REAL IMAGE GENERATION
// ==========================================

async function generateImage(imageIdea) {
  console.log(
    "🎨 Starting real image generation..."
  );

  if (!process.env.GEMINI_API_KEY) {
    console.error(
      "❌ GEMINI_API_KEY is missing."
    );

    return null;
  }

  try {
    const prompt = `
Create a professional image for a social media post.

Image concept:
${imageIdea}

Requirements:
- Professional
- Modern
- High quality
- Clean composition
- Visually engaging
- Suitable for X/Twitter
- Landscape 16:9 composition
- No watermark
- No unnecessary text
`;

    const response =
      await ai.models.generateContent({
        model: "gemini-2.0-flash-exp",
        contents: prompt,
        config: {
          responseModalities: [
            "TEXT",
            "IMAGE"
          ]
        }
      });

    const parts =
      response.candidates?.[0]
        ?.content?.parts || [];

    const imagePart =
      parts.find(
        part =>
          part.inlineData &&
          part.inlineData.data
      );

    if (!imagePart) {
      console.error(
        "❌ Gemini did not return an image."
      );

      return null;
    }

    const imageBuffer =
      Buffer.from(
        imagePart.inlineData.data,
        "base64"
      );

    const fileName =
      `ai-social-${Date.now()}.png`;

    console.log(
      "☁️ Uploading image to Supabase..."
    );

    const { error } =
      await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(
          fileName,
          imageBuffer,
          {
            contentType: "image/png",
            cacheControl: "31536000",
            upsert: false
          }
        );

    if (error) {
      console.error(
        "❌ Supabase image upload error:",
        error
      );

      return null;
    }

    const { data } =
      supabase.storage
        .from(IMAGE_BUCKET)
        .getPublicUrl(fileName);

    if (!data?.publicUrl) {
      console.error(
        "❌ Could not create public image URL."
      );

      return null;
    }

    console.log(
      "✅ REAL IMAGE GENERATED:"
    );

    console.log(data.publicUrl);

    return data.publicUrl;

  } catch (error) {
    console.error(
      "❌ IMAGE GENERATION ERROR:"
    );

    console.error(error);

    return null;
  }
}

// ==========================================
// COMMAND
// ==========================================

app.post("/command", async (req, res) => {
  const { command } = req.body;

  if (!command) {
    return res.status(400).json({
      success: false,
      error: "Please provide a command."
    });
  }

  try {
    const lowerCommand =
      command.toLowerCase();

    // ======================================
    // REMEMBER
    // ======================================

    const rememberWords = [
      "remember that",
      "remember this",
      "remember:"
    ];

    const isRememberCommand =
      rememberWords.some(word =>
        lowerCommand.includes(word)
      );

    if (isRememberCommand) {
      let memory = command;

      for (const word of rememberWords) {
        memory = memory
          .replace(
            new RegExp(word, "i"),
            ""
          )
          .trim();
      }

      const saved =
        await saveMemory(memory);

      if (!saved) {
        return res.status(500).json({
          success: false,
          error:
            "I could not save that memory."
        });
      }

      return res.json({
        success: true,
        type: "memory",
        message:
          "Got it. I saved that to my memory.",
        memory
      });
    }

    // ======================================
    // MEMORY QUESTION
    // ======================================

    const memoryWords = [
      "what do you remember",
      "what you remember",
      "show my memories",
      "my memories",
      "what have you remembered"
    ];

    const isMemoryQuestion =
      memoryWords.some(word =>
        lowerCommand.includes(word)
      );

    const memories =
      await getMemories();

    if (isMemoryQuestion) {
      return res.json({
        success: true,
        type: "memory",
        memories
      });
    }

    // ======================================
    // PREVIOUS POSTS
    // ======================================

    const previousPosts =
      await getPreviousPosts();

    const memoryText =
      memories.length
        ? memories
            .map(
              (item, index) =>
                `${index + 1}. ${item.memory}`
            )
            .join("\n")
        : "No saved memories yet.";

    const postHistoryText =
      previousPosts.length
        ? previousPosts
            .map(
              (item, index) =>
                `${index + 1}. ${item.post}`
            )
            .join("\n\n")
        : "No previous posts yet.";

    // ======================================
    // WEB RESEARCH
    // ======================================

    let researchText =
      "No web research was requested.";

    let researchSources = [];

    const shouldSearch =
      needsWebResearch(command);

    if (shouldSearch) {
      console.log(
        "🔎 Starting Tavily research..."
      );

      const search =
        await webSearch(command);

      if (search.success) {
        const cleanResults =
          cleanSearchResults(
            search.results
          );

        researchSources =
          cleanResults;

        researchText =
          buildResearchText(
            search.answer,
            cleanResults
          );

        if (cleanResults.length) {
          await saveResearch(
            command,
            cleanResults
          );
        }

      } else {
        researchText = `
Tavily research failed.

Do not invent current information.
Do not pretend research was successful.
`;
      }
    }

    // ======================================
    // GEMINI POST PROMPT
    // ======================================

    const prompt = `
You are the AI brain of a professional
production-oriented social media agent.

USER COMMAND:
${command}

USER MEMORY:
${memoryText}

PREVIOUS POSTS:
${postHistoryText}

WEB RESEARCH:
${researchText}

RULES:

1. Use USER MEMORY when relevant.
2. Never invent memories.
3. Avoid repeating previous posts.
4. Use web research for current claims.
5. Never invent current news.
6. Never invent numbers.
7. Never invent dates.
8. Never invent URLs.
9. Prefer recent reliable sources.
10. Write naturally.
11. Keep content professional.
12. Make it engaging.
13. Follow the user's command exactly.
14. Create a useful IMAGE_IDEA for every
social media post.

When creating a social media post,
return exactly:

POST:
[actual post]

HASHTAGS:
[relevant hashtags]

IMAGE_IDEA:
[detailed visual description]

SOURCES:
[URLs if web research was used]
`;

    const response =
      await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt
      });

    const result =
      response.text || "";

    // ======================================
    // EXTRACT POST
    // ======================================

    let postText = result;
    let hashtags = "";
    let imageIdea = "";

    const postMatch =
      result.match(
        /POST:\s*([\s\S]*?)(?=\nHASHTAGS:|$)/i
      );

    const hashtagMatch =
      result.match(
        /HASHTAGS:\s*([\s\S]*?)(?=\nIMAGE_IDEA:|$)/i
      );

    const imageMatch =
      result.match(
        /IMAGE_IDEA:\s*([\s\S]*?)(?=\nSOURCES:|$)/i
      );

    if (postMatch) {
      postText =
        postMatch[1].trim();
    }

    if (hashtagMatch) {
      hashtags =
        hashtagMatch[1].trim();
    }

    if (imageMatch) {
      imageIdea =
        imageMatch[1].trim();
    }

    // ======================================
    // GENERATE REAL IMAGE
    // ======================================

    let imageUrl = null;

    if (imageIdea) {
      imageUrl =
        await generateImage(
          imageIdea
        );
    }

    // ======================================
    // SAVE POST
    // ======================================

    await savePost(
      command,
      postText,
      hashtags,
      imageIdea
    );

    // ======================================
    // RETURN RESULT
    // ======================================

    return res.json({
      success: true,

      command,

      response: result,

      post: postText,

      hashtags,

      image_idea: imageIdea,

      image_generated:
        Boolean(imageUrl),

      image_url:
        imageUrl,

      memory_used:
        memories.length,

      previous_posts_checked:
        previousPosts.length,

      web_research_used:
        shouldSearch,

      research_sources:
        researchSources.length
    });

  } catch (error) {
    console.error(
      "❌ AI error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "AI could not process the command."
    });
  }
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log(
    `AI Social Agent running on port ${PORT}`
  );
});
