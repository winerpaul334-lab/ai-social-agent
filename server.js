const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ================================
// GEMINI
// ================================

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// ================================
// SUPABASE
// ================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ================================
// WEBSITE
// ================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ================================
// MEMORY
// ================================

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

// ================================
// POSTS
// ================================

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

// ================================
// TAVILY WEB SEARCH
// ================================

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
          max_results: 5,
          include_answer: true,
          include_raw_content: false
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
    console.error("Tavily request error:", error);

    return {
      success: false,
      answer: "",
      results: []
    };
  }
}

// ================================
// SAVE RESEARCH
// ================================

async function saveResearch(query, results) {
  const { error } = await supabase
    .from("research")
    .insert({
      query,
      results: JSON.stringify(results)
    });

  if (error) {
    console.error("Research save error:", error);
  }
}

// ================================
// DETECT WEB RESEARCH
// ================================

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
    "this month"
  ];

  const text = command.toLowerCase();

  return words.some(word => text.includes(word));
}

// ================================
// AI COMMAND
// ================================

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

    // ================================
    // REMEMBER
    // ================================

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
        memory = memory
          .replace(new RegExp(word, "i"), "")
          .trim();
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

    // ================================
    // GET MEMORIES
    // ================================

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

    // ================================
    // PREVIOUS POSTS
    // ================================

    const previousPosts = await getPreviousPosts();

    const memoryText =
      memories.length > 0
        ? memories
            .map(
              (item, index) =>
                `${index + 1}. ${item.memory}`
            )
            .join("\n")
        : "No saved memories yet.";

    const postHistoryText =
      previousPosts.length > 0
        ? previousPosts
            .map(
              (item, index) =>
                `${index + 1}. ${item.post}`
            )
            .join("\n\n")
        : "No previous posts yet.";

    // ================================
    // WEB RESEARCH
    // ================================

    let researchText =
      "No web research was requested.";

    let researchSources = [];

    const shouldSearch = needsWebResearch(command);

    if (shouldSearch) {
      console.log("Searching web with Tavily...");

      const search = await webSearch(command);

      if (search.success && search.results.length > 0) {

        researchSources = search.results;

        researchText = `
TAVILY ANSWER:
${search.answer || "No direct answer returned."}

SEARCH RESULTS:
${search.results
  .map(
    (item, index) => `
SOURCE ${index + 1}
TITLE: ${item.title}
URL: ${item.url}
CONTENT:
${item.content}
`
  )
  .join("\n")}
`;

        await saveResearch(
          command,
          search.results
        );

      } else {

        researchText = `
Web research was requested, but no usable Tavily
results were returned.

Do NOT invent current information.
`;
      }
    }

    // ================================
    // AI PROMPT
    // ================================

    const prompt = `
You are the AI brain of a professional social media agent.

USER COMMAND:
${command}

USER MEMORY:
${memoryText}

PREVIOUS POSTS:
${postHistoryText}

WEB RESEARCH:
${researchText}

RESEARCH RULES:

1. Treat web research as evidence, not automatically as truth.
2. Only make factual claims supported by the provided research.
3. Prefer claims supported by multiple independent sources.
4. If sources disagree, do not hide the disagreement.
5. For current or latest news, prefer the newest reliable information.
6. Never invent statistics, people, companies, events, dates or quotes.
7. Never claim something happened today unless the research supports it.
8. Do not use general knowledge to fill missing details about current events.
9. Do not copy source articles.
10. Rewrite information in original wording.
11. Use the user's memory when relevant.
12. Avoid repeating previous posts.
13. Keep the writing professional, natural and engaging.
14. Follow the user's exact command.
15. If the research is insufficient, say so instead of guessing.

SOURCE RULES:

- If web research was used, include 2–3 of the strongest sources.
- Use only URLs actually provided by Tavily.
- Never invent URLs.
- Do not cite a source for a claim it does not support.

When creating a social media post, return exactly:

POST:
[actual original post]

HASHTAGS:
[relevant hashtags]

IMAGE_IDEA:
[suitable image idea]

SOURCES:
[2–3 relevant URLs if web research was used]
`;

    // ================================
    // GEMINI
    // ================================

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt
    });

    const result = response.text || "";

    // ================================
    // EXTRACT CONTENT
    // ================================

    let postText = result;
    let hashtags = "";
    let imageIdea = "";

    const hashtagMatch = result.match(
      /HASHTAGS:\s*([\s\S]*?)(?=\nIMAGE_IDEA:|$)/i
    );

    const imageMatch = result.match(
      /IMAGE_IDEA:\s*([\s\S]*?)(?=\nSOURCES:|$)/i
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

    // ================================
    // SAVE POST
    // ================================

    await savePost(
      command,
      postText,
      hashtags,
      imageIdea
    );

    // ================================
    // RESPONSE
    // ================================

    res.json({
      success: true,
      command,
      response: result,
      memory_used: memories.length,
      previous_posts_checked: previousPosts.length,
      web_research_used: shouldSearch,
      research_sources: researchSources.length
    });

  } catch (error) {
    console.error("AI error:", error);

    res.status(500).json({
      success: false,
      error: "AI could not process the command."
    });
  }
});

// ================================
// START SERVER
// ================================

app.listen(PORT, () => {
  console.log(
    `AI Social Agent running on port ${PORT}`
  );
});
