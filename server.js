const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// BASIC SETUP
// =====================================================

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname)));

// =====================================================
// ENVIRONMENT
// =====================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY;

const POLLINATIONS_API_KEY =
  process.env.POLLINATIONS_API_KEY;

const IMAGE_BUCKET = "generated-images";

// =====================================================
// CHECK ENVIRONMENT
// =====================================================

console.log("======================================");
console.log("AI SOCIAL AGENT STARTING");
console.log("======================================");
console.log(
  "GEMINI_API_KEY:",
  GEMINI_API_KEY ? "OK" : "MISSING"
);
console.log(
  "SUPABASE_URL:",
  SUPABASE_URL ? "OK" : "MISSING"
);
console.log(
  "SUPABASE_KEY:",
  SUPABASE_KEY ? "OK" : "MISSING"
);
console.log(
  "POLLINATIONS_API_KEY:",
  POLLINATIONS_API_KEY ? "OK" : "MISSING"
);
console.log(
  "IMAGE_BUCKET:",
  IMAGE_BUCKET
);
console.log("======================================");

// =====================================================
// GEMINI
// =====================================================

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY
});

// =====================================================
// SUPABASE
// =====================================================

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

// =====================================================
// WEBSITE
// =====================================================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "AI Social Agent",
    status: "online",
    image_provider: "Pollinations"
  });
});

// =====================================================
// MEMORY
// =====================================================

async function saveMemory(memory) {
  try {
    const { error } = await supabase
      .from("agent_memory")
      .insert({
        memory
      });

    if (error) {
      console.error(
        "Memory save error:",
        error
      );
      return false;
    }

    return true;

  } catch (error) {
    console.error(
      "Memory exception:",
      error
    );

    return false;
  }
}

async function getMemories() {
  try {
    const { data, error } =
      await supabase
        .from("agent_memory")
        .select(
          "memory, created_at"
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(20);

    if (error) {
      console.error(
        "Memory read error:",
        error
      );

      return [];
    }

    return data || [];

  } catch (error) {
    console.error(
      "Memory exception:",
      error
    );

    return [];
  }
}

// =====================================================
// POSTS
// =====================================================

async function savePost(
  command,
  post,
  hashtags,
  imageIdea
) {
  try {

    const { error } =
      await supabase
        .from("posts")
        .insert({
          command,
          post,
          hashtags,
          image_idea: imageIdea
        });

    if (error) {
      console.error(
        "Post save error:",
        error
      );
    }

  } catch (error) {

    console.error(
      "Post save exception:",
      error
    );

  }
}

async function getPreviousPosts() {

  try {

    const { data, error } =
      await supabase
        .from("posts")
        .select(
          "post, hashtags, created_at"
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(10);

    if (error) {

      console.error(
        "Post history error:",
        error
      );

      return [];
    }

    return data || [];

  } catch (error) {

    console.error(
      "Post history exception:",
      error
    );

    return [];
  }
}

// =====================================================
// TAVILY WEB SEARCH
// =====================================================

async function webSearch(query) {

  const apiKey =
    process.env.TAVILY_API_KEY;

  if (!apiKey) {

    console.error(
      "TAVILY_API_KEY is missing."
    );

    return {
      success: false,
      answer: "",
      results: []
    };
  }

  try {

    const response =
      await fetch(
        "https://api.tavily.com/search",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
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

      const text =
        await response.text();

      console.error(
        "Tavily error:",
        response.status,
        text
      );

      return {
        success: false,
        answer: "",
        results: []
      };
    }

    const data =
      await response.json();

    return {
      success: true,
      answer:
        data.answer || "",
      results:
        data.results || []
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

// =====================================================
// SAVE RESEARCH
// =====================================================

async function saveResearch(
  query,
  results
) {

  try {

    const { error } =
      await supabase
        .from("research")
        .insert({
          query,
          results:
            JSON.stringify(results)
        });

    if (error) {

      console.error(
        "Research save error:",
        error
      );

    }

  } catch (error) {

    console.error(
      "Research save exception:",
      error
    );

  }
}

// =====================================================
// RESEARCH DETECTION
// =====================================================

function needsWebResearch(
  command
) {

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

  const text =
    command.toLowerCase();

  return words.some(
    word =>
      text.includes(word)
  );
}

// =====================================================
// CLEAN SEARCH RESULTS
// =====================================================

function cleanSearchResults(
  results
) {

  return (results || [])
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

// =====================================================
// BUILD RESEARCH TEXT
// =====================================================

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

  const sourceText =
    results
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

// =====================================================
// GEMINI TEXT GENERATION
// =====================================================

async function generateText(
  prompt
) {

  if (!GEMINI_API_KEY) {

    throw new Error(
      "GEMINI_API_KEY is missing."
    );
  }

  try {

    console.log(
      "🧠 Sending text request to Gemini..."
    );

    const response =
      await ai.models.generateContent({
        model:
          "gemini-3.6-flash",

        contents: prompt
      });

    const text =
      response.text || "";

    if (!text.trim()) {

      throw new Error(
        "Gemini returned an empty response."
      );
    }

    return text;

  } catch (error) {

    console.error(
      "Gemini text error:",
      error
    );

    throw error;
  }
}

// =====================================================
// REAL IMAGE GENERATION - POLLINATIONS
// =====================================================

async function generateImage(
  imageIdea
) {

  console.log(
    "======================================"
  );

  console.log(
    "🎨 Starting REAL image generation..."
  );

  console.log(
    "🖼️ Provider: Pollinations"
  );

  console.log(
    "======================================"
  );

  if (!POLLINATIONS_API_KEY) {

    console.error(
      "❌ POLLINATIONS_API_KEY is missing."
    );

    return null;
  }

  if (!imageIdea) {

    console.error(
      "❌ No image idea was supplied."
    );

    return null;
  }

  try {

    // -------------------------------------------------
    // PROFESSIONAL IMAGE PROMPT
    // -------------------------------------------------

    const prompt = `
Create a professional photorealistic image
for a social media business/technology post.

IMAGE CONCEPT:
${imageIdea}

IMPORTANT REQUIREMENTS:

- Photorealistic
- Professional editorial photography
- Modern corporate aesthetic
- High visual quality
- Strong composition
- Natural realistic lighting
- Cinematic depth
- No watermark
- No logos
- No text overlay
- No captions
- No distorted objects
- No cartoon style
- No illustration style
- Suitable for an X/Twitter professional post
- Landscape 16:9 composition
`;

    // -------------------------------------------------
    // ENCODE PROMPT
    // -------------------------------------------------

    const encodedPrompt =
      encodeURIComponent(
        prompt.trim()
      );

    // -------------------------------------------------
    // POLLINATIONS IMAGE URL
    // -------------------------------------------------

    const imageUrl =
      `https://gen.pollinations.ai/image/${encodedPrompt}` +
      `?model=flux` +
      `&width=1536` +
      `&height=864` +
      `&nologo=true`;

    console.log(
      "🧠 Sending image request to Pollinations..."
    );

    // -------------------------------------------------
    // REQUEST IMAGE
    // -------------------------------------------------

    const response =
      await fetch(
        imageUrl,
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${POLLINATIONS_API_KEY}`
          }
        }
      );

    if (!response.ok) {

      const errorText =
        await response.text();

      console.error(
        "❌ Pollinations image error:",
        response.status,
        errorText
      );

      return null;
    }

    // -------------------------------------------------
    // GET IMAGE BYTES
    // -------------------------------------------------

    const imageBuffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    if (!imageBuffer.length) {

      console.error(
        "❌ Pollinations returned an empty image."
      );

      return null;
    }

    console.log(
      "✅ Pollinations returned image:",
      imageBuffer.length,
      "bytes"
    );

    // -------------------------------------------------
    // FILE NAME
    // -------------------------------------------------

    const fileName =
      `ai-social-${Date.now()}.jpg`;

    // -------------------------------------------------
    // UPLOAD TO SUPABASE
    // -------------------------------------------------

    console.log(
      "☁️ Uploading image to Supabase..."
    );

    const { error:
      uploadError
    } =
      await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(
          fileName,
          imageBuffer,
          {
            contentType:
              "image/jpeg",

            cacheControl:
              "31536000",

            upsert: false
          }
        );

    if (uploadError) {

      console.error(
        "❌ Supabase image upload error:",
        uploadError
      );

      return null;
    }

    // -------------------------------------------------
    // PUBLIC URL
    // -------------------------------------------------

    const { data:
      publicData
    } =
      supabase.storage
        .from(IMAGE_BUCKET)
        .getPublicUrl(
          fileName
        );

    const publicUrl =
      publicData?.publicUrl;

    if (!publicUrl) {

      console.error(
        "❌ Could not create public image URL."
      );

      return null;
    }

    console.log(
      "======================================"
    );

    console.log(
      "✅ REAL IMAGE GENERATED"
    );

    console.log(
      publicUrl
    );

    console.log(
      "======================================"
    );

    return publicUrl;

  } catch (error) {

    console.error(
      "❌ IMAGE GENERATION ERROR:"
    );

    console.error(
      error
    );

    return null;
  }
}

// =====================================================
// COMMAND
// =====================================================

app.post(
  "/command",
  async (req, res) => {

    const {
      command
    } = req.body;

    if (!command) {

      return res.status(400).json({
        success: false,
        error:
          "Please provide a command."
      });
    }

    try {

      const lowerCommand =
        command.toLowerCase();

      // ===============================================
      // REMEMBER COMMAND
      // ===============================================

      const rememberWords = [
        "remember that",
        "remember this",
        "remember:"
      ];

      const isRememberCommand =
        rememberWords.some(
          word =>
            lowerCommand.includes(
              word
            )
        );

      if (isRememberCommand) {

        let memory =
          command;

        for (
          const word
          of rememberWords
        ) {

          memory =
            memory
              .replace(
                new RegExp(
                  word,
                  "i"
                ),
                ""
              )
              .trim();
        }

        const saved =
          await saveMemory(
            memory
          );

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

      // ===============================================
      // GET MEMORIES
      // ===============================================

      const memories =
        await getMemories();

      const memoryWords = [
        "what do you remember",
        "what you remember",
        "show my memories",
        "my memories",
        "what have you remembered",
        "what do you know about me"
      ];

      const isMemoryQuestion =
        memoryWords.some(
          word =>
            lowerCommand.includes(
              word
            )
        );

      if (isMemoryQuestion) {

        return res.json({
          success: true,
          type: "memory",
          memories
        });
      }

      // ===============================================
      // PREVIOUS POSTS
      // ===============================================

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

      // ===============================================
      // WEB RESEARCH
      // ===============================================

      let researchText =
        "No web research was requested.";

      let researchSources = [];

      const shouldSearch =
        needsWebResearch(
          command
        );

      if (shouldSearch) {

        console.log(
          "🔎 Starting Tavily research..."
        );

        const search =
          await webSearch(
            command
          );

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

          if (
            cleanResults.length
          ) {

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

      // ===============================================
      // GEMINI PROMPT
      // ===============================================

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

IMPORTANT RULES:

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
12. Make the content engaging.
13. Follow the user's command exactly.
14. Create a useful detailed IMAGE_IDEA
    for every social media post.
15. The IMAGE_IDEA must describe a
    realistic professional image.
16. Do not put the actual image inside
    the text response.

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

      console.log(
        "🧠 Generating post..."
      );

      const result =
        await generateText(
          prompt
        );

      // ===============================================
      // EXTRACT RESULT
      // ===============================================

      let postText =
        result;

      let hashtags = "";

      let imageIdea = "";

      let sources = "";

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

      const sourceMatch =
        result.match(
          /SOURCES:\s*([\s\S]*)$/i
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

      if (sourceMatch) {

        sources =
          sourceMatch[1].trim();
      }

      // ===============================================
      // IMAGE
      // ===============================================

      let imageUrl =
        null;

      if (imageIdea) {

        imageUrl =
          await generateImage(
            imageIdea
          );

      } else {

        console.error(
          "❌ No IMAGE_IDEA was generated."
        );
      }

      // ===============================================
      // SAVE POST
      // ===============================================

      await savePost(
        command,
        postText,
        hashtags,
        imageIdea
      );

      // ===============================================
      // RESPONSE
      // ===============================================

      return res.json({

        success: true,

        command,

        response:
          result,

        post:
          postText,

        hashtags,

        image_idea:
          imageIdea,

        image_generated:
          Boolean(
            imageUrl
          ),

        image_url:
          imageUrl,

        sources,

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
        "❌ COMMAND ERROR:"
      );

      console.error(
        error
      );

      return res.status(500).json({

        success: false,

        error:
          error.message ||
          "AI could not process the command."

      });
    }
  }
);

// =====================================================
// START SERVER
// =====================================================

app.listen(
  PORT,
  () => {

    console.log(
      `AI Social Agent running on port ${PORT}`
    );

  }
);
        
