const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname)));


// ======================================================
// ENVIRONMENT
// ======================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY;

const IMAGE_BUCKET = "generated-images";


// ======================================================
// SUPABASE
// ======================================================

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);


// ======================================================
// CHECK ENVIRONMENT
// ======================================================

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
  "IMAGE_BUCKET:",
  IMAGE_BUCKET
);

console.log("======================================");


// ======================================================
// WEBSITE
// ======================================================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});


// ======================================================
// GEMINI TEXT GENERATION
// ======================================================

async function generateText(prompt) {

  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is missing."
    );
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },

      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: prompt
              }
            ]
          }
        ]
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {

    console.error(
      "Gemini text error:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      data?.error?.message ||
      "Gemini text generation failed."
    );
  }

  const text =
    data?.candidates?.[0]
      ?.content?.parts
      ?.find(part => part.text)
      ?.text;

  if (!text) {
    throw new Error(
      "Gemini returned no text."
    );
  }

  return text;
}


// ======================================================
// REAL IMAGE GENERATION
// ======================================================

async function generateRealImage(imageIdea) {

  console.log(
    "🎨 Starting REAL image generation..."
  );

  if (!GEMINI_API_KEY) {

    console.error(
      "❌ GEMINI_API_KEY is missing."
    );

    return null;
  }

  try {

    const prompt = `
Create a professional, photorealistic image
for a social media post.

IMAGE CONCEPT:
${imageIdea}

IMPORTANT:

- Generate an actual image.
- Photorealistic.
- Professional editorial quality.
- Modern and premium.
- Clean composition.
- Suitable for a professional X/Twitter post.
- Landscape 16:9 composition.
- No watermark.
- No unnecessary text.
- Do not return only an image description.
- Actually generate the image.
`;

    console.log(
      "🧠 Sending image request to Gemini..."
    );

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY
        },

        body: JSON.stringify({

          model:
            "gemini-3.1-flash-image",

          input: prompt,

          response_format: {
            type: "image",
            mime_type: "image/jpeg",
            aspect_ratio: "16:9",
            image_size: "2K"
          }

        })
      }
    );

    const data = await response.json();

    if (!response.ok) {

      console.error(
        "❌ Gemini IMAGE API error:"
      );

      console.error(
        JSON.stringify(
          data,
          null,
          2
        )
      );

      return null;
    }


    // ==================================================
    // GET GENERATED IMAGE
    // ==================================================

    let imageData = null;

    if (
      data?.output_image?.data
    ) {

      imageData =
        data.output_image.data;

    }


    // Some responses may return the image
    // inside interaction steps.

    if (!imageData && Array.isArray(data?.steps)) {

      for (const step of data.steps) {

        if (
          step.type ===
          "model_output"
        ) {

          const contents =
            step.content || [];

          for (
            const content of contents
          ) {

            if (
              content.type === "image" &&
              content.data
            ) {

              imageData =
                content.data;

              break;
            }

          }

        }

        if (imageData) {
          break;
        }

      }

    }


    if (!imageData) {

      console.error(
        "❌ Gemini returned NO REAL IMAGE."
      );

      console.error(
        "Gemini response:",
        JSON.stringify(
          data,
          null,
          2
        )
      );

      return null;
    }


    // ==================================================
    // CONVERT BASE64 TO IMAGE
    // ==================================================

    const imageBuffer =
      Buffer.from(
        imageData,
        "base64"
      );


    // ==================================================
    // FILE NAME
    // ==================================================

    const fileName =
      `ai-social-${Date.now()}.jpg`;


    console.log(
      "☁️ Uploading generated image to Supabase..."
    );


    // ==================================================
    // SUPABASE STORAGE
    // ==================================================

    const {
      error: uploadError
    } =
      await supabase
        .storage
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
        "❌ Supabase image upload error:"
      );

      console.error(
        uploadError
      );

      return null;
    }


    // ==================================================
    // PUBLIC URL
    // ==================================================

    const {
      data: publicData
    } =
      supabase
        .storage
        .from(IMAGE_BUCKET)
        .getPublicUrl(
          fileName
        );


    const imageUrl =
      publicData?.publicUrl;


    if (!imageUrl) {

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
      imageUrl
    );

    console.log(
      "======================================"
    );


    return imageUrl;

  } catch (error) {

    console.error(
      "❌ REAL IMAGE GENERATION ERROR:"
    );

    console.error(
      error
    );

    return null;
  }
}


// ======================================================
// MEMORY
// ======================================================

async function saveMemory(memory) {

  try {

    const {
      error
    } =
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
      "Memory error:",
      error
    );

    return false;
  }
}


async function getMemories() {

  try {

    const {
      data,
      error
    } =
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
      "Memory read error:",
      error
    );

    return [];
  }
}


// ======================================================
// POSTS
// ======================================================

async function savePost(
  command,
  post,
  hashtags,
  imageIdea
) {

  try {

    const {
      error
    } =
      await supabase
        .from("posts")
        .insert({

          command,

          post,

          hashtags,

          image_idea:
            imageIdea

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

    const {
      data,
      error
    } =
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
      "Post history error:",
      error
    );

    return [];
  }
}


// ======================================================
// TAVILY
// ======================================================

async function webSearch(query) {

  const apiKey =
    process.env.TAVILY_API_KEY;


  if (!apiKey) {

    console.log(
      "TAVILY_API_KEY not configured."
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
              apiKey,

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


// ======================================================
// RESEARCH DETECTION
// ======================================================

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


// ======================================================
// CLEAN RESEARCH
// ======================================================

function cleanSearchResults(
  results
) {

  return results

    .filter(item =>
      item &&
      item.title &&
      item.url &&
      item.content
    )

    .map(item => ({

      title:
        item.title,

      url:
        item.url,

      content:
        item.content

    }));
}


// ======================================================
// COMMAND
// ======================================================

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


      // ==========================================
      // MEMORY COMMAND
      // ==========================================

      const rememberWords = [

        "remember that",
        "remember this",
        "remember:"

      ];


      const isRemember =
        rememberWords.some(
          word =>
            lowerCommand.includes(word)
        );


      if (isRemember) {

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


        return res.json({

          success:
            saved,

          type:
            "memory",

          message:
            saved
              ? "Memory saved successfully."
              : "Could not save memory.",

          memory

        });
      }


      // ==========================================
      // LOAD MEMORY
      // ==========================================

      const memories =
        await getMemories();


      // ==========================================
      // MEMORY QUESTION
      // ==========================================

      const memoryQuestionWords = [

        "what do you remember",
        "what you remember",
        "show my memories",
        "my memories",
        "what have you remembered"

      ];


      const isMemoryQuestion =
        memoryQuestionWords.some(
          word =>
            lowerCommand.includes(word)
        );


      if (isMemoryQuestion) {

        return res.json({

          success:
            true,

          type:
            "memory",

          memories

        });
      }


      // ==========================================
      // PREVIOUS POSTS
      // ==========================================

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


      // ==========================================
      // WEB RESEARCH
      // ==========================================

      let researchText =
        "No web research was requested.";


      let researchSources = [];


      if (
        needsWebResearch(
          command
        )
      ) {

        console.log(
          "🔎 Starting web research..."
        );


        const search =
          await webSearch(
            command
          );


        if (search.success) {

          researchSources =
            cleanSearchResults(
              search.results
            );


          if (
            researchSources.length
          ) {

            researchText =
              researchSources
                .map(
                  (item, index) =>
                    `
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

          }

        }

      }


      // ==========================================
      // AI POST
      // ==========================================

      const prompt = `

You are a professional AI social media agent.

USER COMMAND:
${command}

USER MEMORY:
${memoryText}

PREVIOUS POSTS:
${postHistoryText}

WEB RESEARCH:
${researchText}

RULES:

1. Follow the user's command.
2. Use memory when relevant.
3. Never invent memories.
4. Do not repeat previous posts.
5. If current information is requested, use the research.
6. Never invent current news.
7. Never invent statistics.
8. Write naturally.
9. Make the post professional.
10. Make the post engaging.
11. Avoid unnecessary repetition.
12. Create a detailed IMAGE_IDEA for every social media post.
13. The IMAGE_IDEA must describe a REAL image that can be generated.

Return exactly this format:

POST:
[post]

HASHTAGS:
[hashtags]

IMAGE_IDEA:
[detailed image description]

SOURCES:
[URLs used, or N/A]

`;


      console.log(
        "🧠 Generating post..."
      );


      const result =
        await generateText(
          prompt
        );


      // ==========================================
      // EXTRACT
      // ==========================================

      let postText =
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


      // ==========================================
      // REAL IMAGE
      // ==========================================

      let imageUrl =
        null;


      if (imageIdea) {

        imageUrl =
          await generateRealImage(
            imageIdea
          );

      }


      // ==========================================
      // SAVE POST
      // ==========================================

      await savePost(

        command,

        postText,

        hashtags,

        imageIdea

      );


      // ==========================================
      // RESPONSE
      // ==========================================

      return res.json({

        success:
          true,

        post:
          postText,

        hashtags,

        image_idea:
          imageIdea,

        image_generated:
          Boolean(imageUrl),

        image_url:
          imageUrl,

        response:
          result,

        memory_used:
          memories.length,

        previous_posts_checked:
          previousPosts.length,

        web_research_used:
          needsWebResearch(
            command
          ),

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

        success:
          false,

        error:
          error.message ||
          "AI could not process the command."

      });

    }

  }
);


// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
  "/health",
  (req, res) => {

    res.json({

      success:
        true,

      service:
        "AI Social Agent",

      image_generation:
        "Gemini 3.1 Flash Image",

      status:
        "online"

    });

  }
);


// ======================================================
// START
// ======================================================

app.listen(
  PORT,
  () => {

    console.log(
      `AI Social Agent running on port ${PORT}`
    );

  }
);
