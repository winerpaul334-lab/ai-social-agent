const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// CONFIG
// ==========================================

const POLLINATIONS_API_KEY =
  process.env.POLLINATIONS_API_KEY;

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY;

const TAVILY_API_KEY =
  process.env.TAVILY_API_KEY;

const IMAGE_BUCKET =
  process.env.IMAGE_BUCKET || "generated-images";

// ==========================================
// CHECK ENVIRONMENT
// ==========================================

console.log("======================================");
console.log("AI SOCIAL AGENT STARTING");
console.log("======================================");

console.log(
  "POLLINATIONS_API_KEY:",
  POLLINATIONS_API_KEY ? "OK" : "MISSING"
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
  "TAVILY_API_KEY:",
  TAVILY_API_KEY ? "OK" : "MISSING"
);

console.log(
  "IMAGE_BUCKET:",
  IMAGE_BUCKET
);

console.log("======================================");

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(express.json({ limit: "2mb" }));

app.use(
  express.static(path.join(__dirname))
);

// ==========================================
// SUPABASE
// ==========================================

let supabase = null;

if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );
}

// ==========================================
// HOME
// ==========================================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "AI Social Agent",
    status: "online",
    text_provider: "Pollinations",
    image_provider: "Pollinations",
    supabase: Boolean(supabase)
  });
});

// ==========================================
// MEMORY
// ==========================================

async function saveMemory(memory) {

  if (!supabase) {
    console.error(
      "Supabase is not configured."
    );

    return false;
  }

  try {

    const { error } =
      await supabase
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

// ==========================================
// GET MEMORIES
// ==========================================

async function getMemories() {

  if (!supabase) {
    return [];
  }

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
      "Memory read exception:",
      error
    );

    return [];
  }
}

// ==========================================
// SAVE POST
// ==========================================

async function savePost(
  command,
  post,
  hashtags,
  imageIdea
) {

  if (!supabase) {
    return;
  }

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

// ==========================================
// GET PREVIOUS POSTS
// ==========================================

async function getPreviousPosts() {

  if (!supabase) {
    return [];
  }

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

// ==========================================
// TAVILY SEARCH
// ==========================================

async function webSearch(query) {

  if (!TAVILY_API_KEY) {

    console.log(
      "Tavily key not configured."
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
            api_key:
              TAVILY_API_KEY,

            query,

            search_depth:
              "advanced",

            topic:
              "news",

            max_results:
              6,

            include_answer:
              true,

            include_raw_content:
              false,

            include_images:
              false
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

  const text =
    command.toLowerCase();

  return words.some(
    word =>
      text.includes(word)
  );
}

// ==========================================
// CLEAN RESEARCH
// ==========================================

function cleanSearchResults(
  results
) {

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

      title:
        item.title,

      url:
        item.url,

      content:
        item.content

    }));
}

// ==========================================
// SAVE RESEARCH
// ==========================================

async function saveResearch(
  query,
  results
) {

  if (!supabase) {
    return;
  }

  try {

    const { error } =
      await supabase
        .from("research")
        .insert({

          query,

          results:
            JSON.stringify(
              results
            )

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

// ==========================================
// BUILD RESEARCH TEXT
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

// ==========================================
// POLLINATIONS TEXT GENERATION
// ==========================================

async function generateText(
  prompt
) {

  if (!POLLINATIONS_API_KEY) {

    throw new Error(
      "POLLINATIONS_API_KEY is missing."
    );
  }

  console.log(
    "🧠 Generating text with Pollinations..."
  );

  const response =
    await fetch(
      "https://gen.pollinations.ai/v1/chat/completions",
      {
        method: "POST",

        headers: {

          "Authorization":
            `Bearer ${POLLINATIONS_API_KEY}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({

          model: "openai",

          messages: [

            {
              role: "system",

              content:
                "You are a professional social media content AI."
            },

            {
              role: "user",

              content: prompt
            }

          ],

          temperature: 0.8
        })
      }
    );

  const raw =
    await response.text();

  if (!response.ok) {

    console.error(
      "Pollinations text error:",
      raw
    );

    throw new Error(
      `Pollinations text request failed: ${response.status}`
    );
  }

  let data;

  try {

    data =
      JSON.parse(raw);

  } catch {

    console.error(
      "Invalid Pollinations response:",
      raw
    );

    throw new Error(
      "Pollinations returned invalid JSON."
    );
  }

  const text =
    data?.choices?.[0]
      ?.message?.content;

  if (!text) {

    console.error(
      "Pollinations returned no text:",
      data
    );

    throw new Error(
      "Pollinations returned no text."
    );
  }

  return text;
}

// ==========================================
// POLLINATIONS IMAGE GENERATION
// ==========================================

async function generateImage(
  imageIdea
) {

  if (!POLLINATIONS_API_KEY) {

    console.error(
      "POLLINATIONS_API_KEY is missing."
    );

    return null;
  }

  console.log(
    "🎨 Starting REAL image generation..."
  );

  try {

    const prompt = `

Professional high-end editorial photograph.

${imageIdea}

Requirements:

Photorealistic.
Professional.
Modern.
Clean composition.
High visual quality.
Natural realistic lighting.
No watermark.
No unnecessary text.
No logos.
Suitable for a professional X/Twitter post.
Landscape composition.
`;

    const encodedPrompt =
      encodeURIComponent(
        prompt
      );

    const imageUrl =
      `https://gen.pollinations.ai/image/${encodedPrompt}` +
      `?model=flux` +
      `&width=1536` +
      `&height=864`;

    console.log(
      "🖼️ Sending image request to Pollinations..."
    );

    const response =
      await fetch(
        imageUrl,
        {
          method: "GET",

          headers: {

            "Authorization":
              `Bearer ${POLLINATIONS_API_KEY}`,

            "Accept":
              "image/jpeg,image/png"
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

    const contentType =
      response.headers
        .get("content-type") ||
      "image/jpeg";

    if (
      !contentType.startsWith(
        "image/"
      )
    ) {

      const text =
        await response.text();

      console.error(
        "❌ Pollinations did not return an image:",
        text
      );

      return null;
    }

    const arrayBuffer =
      await response.arrayBuffer();

    const imageBuffer =
      Buffer.from(
        arrayBuffer
      );

    if (
      !imageBuffer.length
    ) {

      console.error(
        "❌ Empty image received."
      );

      return null;
    }

    console.log(
      `📦 Image received: ${imageBuffer.length} bytes`
    );

    // ======================================
    // SUPABASE STORAGE
    // ======================================

    if (!supabase) {

      console.error(
        "❌ Supabase is not configured."
      );

      return null;
    }

    let extension =
      "jpg";

    if (
      contentType.includes(
        "png"
      )
    ) {

      extension =
        "png";
    }

    const fileName =
      `ai-social-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${extension}`;

    console.log(
      "☁️ Uploading image to Supabase..."
    );

    const { error } =
      await supabase.storage
        .from(
          IMAGE_BUCKET
        )
        .upload(
          fileName,
          imageBuffer,
          {
            contentType,
            cacheControl:
              "31536000",
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
        .from(
          IMAGE_BUCKET
        )
        .getPublicUrl(
          fileName
        );

    if (
      !data ||
      !data.publicUrl
    ) {

      console.error(
        "❌ Could not create public image URL."
      );

      return null;
    }

    console.log(
      "✅ REAL IMAGE GENERATED:"
    );

    console.log(
      data.publicUrl
    );

    return data.publicUrl;

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

// ==========================================
// EXTRACT AI RESPONSE
// ==========================================

function extractPostData(
  result
) {

  let post =
    result;

  let hashtags =
    "";

  let imageIdea =
    "";

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

    post =
      postMatch[1]
        .trim();
  }

  if (hashtagMatch) {

    hashtags =
      hashtagMatch[1]
        .trim();
  }

  if (imageMatch) {

    imageIdea =
      imageMatch[1]
        .trim();
  }

  return {
    post,
    hashtags,
    imageIdea
  };
}

// ==========================================
// COMMAND
// ==========================================

app.post(
  "/command",
  async (req, res) => {

    const {
      command
    } = req.body;

    if (!command) {

      return res
        .status(400)
        .json({

          success: false,

          error:
            "Please provide a command."

        });
    }

    try {

      const lowerCommand =
        command.toLowerCase();

      // ====================================
      // REMEMBER COMMAND
      // ====================================

      const rememberWords = [

        "remember that",
        "remember this",
        "remember:"

      ];

      const isRemember =
        rememberWords.some(
          word =>
            lowerCommand.includes(
              word
            )
        );

      if (isRemember) {

        let memory =
          command;

        for (
          const word
          of rememberWords
        ) {

          memory =
            memory.replace(
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

          return res
            .status(500)
            .json({

              success: false,

              error:
                "I could not save that memory."

            });
        }

        return res.json({

          success: true,

          type:
            "memory",

          message:
            "Got it. I saved that to my memory.",

          memory

        });
      }

      // ====================================
      // MEMORY QUESTION
      // ====================================

      const memoryQuestions = [

        "what do you remember",
        "what you remember",
        "show my memories",
        "my memories",
        "what have you remembered",
        "what do you remember about me"

      ];

      const isMemoryQuestion =
        memoryQuestions.some(
          word =>
            lowerCommand.includes(
              word
            )
        );

      const memories =
        await getMemories();

      if (isMemoryQuestion) {

        return res.json({

          success: true,

          type:
            "memory",

          memories

        });
      }

      // ====================================
      // PREVIOUS POSTS
      // ====================================

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

      // ====================================
      // WEB RESEARCH
      // ====================================

      let researchText =
        "No web research was requested.";

      let researchSources =
        [];

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

      // ====================================
      // AI PROMPT
      // ====================================

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

1. Follow the user's command exactly.

2. Use relevant user memory.

3. Never invent memories.

4. Avoid repeating previous posts.

5. If web research is supplied,
use it for current claims.

6. Never invent current news.

7. Never invent statistics.

8. Never invent dates.

9. Never invent URLs.

10. Write naturally.

11. Keep the content professional.

12. Make the post engaging.

13. Avoid unnecessary emojis.

14. Do not make every post sound identical.

15. Vary the opening sentence.

16. Vary the structure.

17. Do not repeatedly use phrases such as
"the future is", "in today's world",
or "this is more than".

18. For a social media post,
always create a strong IMAGE_IDEA.

19. The image idea must describe a
realistic professional photograph or
visual suitable for the subject.

20. Do not put the image itself in the response.

RETURN EXACTLY THIS FORMAT:

POST:
[actual post]

HASHTAGS:
[relevant hashtags]

IMAGE_IDEA:
[detailed image description]

SOURCES:
[URLs if web research was used, otherwise N/A]
`;

      // ====================================
      // GENERATE POST WITH POLLINATIONS
      // ====================================

      const result =
        await generateText(
          prompt
        );

      // ====================================
      // EXTRACT
      // ====================================

      const {
        post,
        hashtags,
        imageIdea
      } =
        extractPostData(
          result
        );

      // ====================================
      // GENERATE REAL IMAGE
      // ====================================

      let imageUrl =
        null;

      if (imageIdea) {

        imageUrl =
          await generateImage(
            imageIdea
          );
      }

      // ====================================
      // SAVE POST
      // ====================================

      await savePost(
        command,
        post,
        hashtags,
        imageIdea
      );

      // ====================================
      // RETURN
      // ====================================

      return res.json({

        success: true,

        command,

        response:
          result,

        post,

        hashtags,

        image_idea:
          imageIdea,

        image_generated:
          Boolean(
            imageUrl
          ),

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
        "❌ COMMAND ERROR:"
      );

      console.error(
        error
      );

      return res
        .status(500)
        .json({

          success: false,

          error:
            error.message ||
            "AI could not process the command."

        });
    }
  }
);

// ==========================================
// START SERVER
// ==========================================

app.listen(
  PORT,
  () => {

    console.log(
      `AI Social Agent running on port ${PORT}`
    );

  }
);
