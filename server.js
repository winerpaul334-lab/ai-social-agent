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
  process.env.SUPABASE_KEY
);

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
    .insert({
      memory: memory
    });

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
    .order("created_at", {
      ascending: false
    })
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
      command: command,
      post: post,
      hashtags: hashtags,
      image_idea: imageIdea
    });

  if (error) {
    console.error("Post save error:", error);
  }
}

async function getPreviousPosts() {
  const { data, error } = await supabase
    .from("posts")
    .select(
      "post, hashtags, created_at"
    )
    .order("created_at", {
      ascending: false
    })
    .limit(10);

  if (error) {
    console.error(
      "Post history error:",
      error
    );

    return [];
  }

  return data || [];
}

// ==========================================
// TAVILY SEARCH
// ==========================================

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
    const response = await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          api_key: apiKey,
          query: query,

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
      const errorText =
        await response.text();

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

    const data =
      await response.json();

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

async function saveResearch(
  query,
  results
) {
  const { error } = await supabase
    .from("research")
    .insert({
      query: query,
      results: JSON.stringify(
        results
      )
    });

  if (error) {
    console.error(
      "Research save error:",
      error
    );
  }
}

// ==========================================
// DETECT WEB RESEARCH
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

  return words.some(word =>
    text.includes(word)
  );
}

// ==========================================
// CHECK WHETHER RESULT IS USEFUL
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
// BUILD RESEARCH TEXT
// ==========================================

function buildResearchText(
  answer,
  results
) {
  if (!results.length) {
    return `
No usable web research was returned.

IMPORTANT:
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
// COMMAND
// ==========================================

app.post(
  "/command",
  async (req, res) => {

    const { command } =
      req.body;

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

      // ====================================
      // REMEMBER COMMAND
      // ====================================

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

        for (
          const word of rememberWords
        ) {
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
          memory: memory
        });
      }

      // ====================================
      // GET MEMORIES
      // ====================================

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
          memories: memories
        });
      }

      // ====================================
      // PREVIOUS POSTS
      // ====================================

      const previousPosts =
        await getPreviousPosts();

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

      // ====================================
      // WEB RESEARCH
      // ====================================

      let researchText =
        "No web research was requested.";

      let researchSources = [];

      const shouldSearch =
        needsWebResearch(command);

      if (shouldSearch) {

        console.log(
          "Starting Tavily research..."
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
Do not pretend that research was successful.
`;
        }
      }

      // ====================================
      // GEMINI PROMPT
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

========================================
RESEARCH AND ACCURACY RULES
========================================

1. Web research is evidence.

2. Do not automatically assume every search
result is correct.

3. Only make factual current-event claims
that are supported by the supplied sources.

4. Never invent facts.

5. Never invent numbers.

6. Never invent dates.

7. Never invent people.

8. Never invent companies.

9. Never invent quotes.

10. Never invent URLs.

11. If a claim is not supported by the
research, leave it out.

12. If sources disagree, do not present an
uncertain claim as certain.

13. Prefer information supported by multiple
independent sources.

14. Prefer recent sources for current news.

15. Do not confuse an article about one event
with evidence for a different event.

16. Before mentioning a major number, funding
amount, acquisition, product launch, deal,
investment or announcement, make sure the
supplied source actually supports that claim.

17. Do not combine unrelated facts from
different articles and present them as one
event.

18. Do not use your general knowledge to fill
missing information about current events.

19. If the research is insufficient, clearly
say that the information could not be
verified instead of guessing.

20. Rewrite information in original wording.
Do not copy articles.

========================================
POST RULES
========================================

1. Follow the user's command exactly.

2. Use USER MEMORY when relevant.

3. Avoid repeating PREVIOUS POSTS.

4. Make the content natural.

5. Make the content professional.

6. Make it engaging.

7. Do not exaggerate facts.

8. Do not use clickbait unless requested.

9. Do not claim something happened "today"
unless the research supports that timing.

10. For news posts, focus on the most
important verified story.

========================================
SOURCE RULES
========================================

If web research was used:

- Include 2–3 strongest sources.
- Use only URLs supplied by Tavily.
- Never create a URL yourself.
- Only include a source if it supports the
information being discussed.
- If fewer than 2 reliable sources support
the story, use fewer sources rather than
inventing additional ones.

========================================
OUTPUT FORMAT
========================================

When creating a social media post, return:

POST:
[original post]

HASHTAGS:
[relevant hashtags]

IMAGE_IDEA:
[suitable image idea]

SOURCES:
[strong supporting URLs]
`;

      // ====================================
      // GEMINI
      // ====================================

      const response =
        await ai.models.generateContent({
          model:
            "gemini-3.6-flash",
          contents: prompt
        });

      const result =
        response.text || "";

      // ====================================
      // EXTRACT POST
      // ====================================

      let postText = result;
      let hashtags = "";
      let imageIdea = "";

      const hashtagMatch =
        result.match(
          /HASHTAGS:\s*([\s\S]*?)(?=\nIMAGE_IDEA:|$)/i
        );

      const imageMatch =
        result.match(
          /IMAGE_IDEA:\s*([\s\S]*?)(?=\nSOURCES:|$)/i
        );

      const postMatch =
        result.match(
          /POST:\s*([\s\S]*?)(?=\nHASHTAGS:|$)/i
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

      // ====================================
      // SAVE POST
      // ====================================

      await savePost(
        command,
        postText,
        hashtags,
        imageIdea
      );

      // ====================================
      // RESPONSE
      // ====================================

      return res.json({
        success: true,

        command: command,

        response: result,

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
        "AI error:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "AI could not process the command."
      });
    }
  }
);

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log(
    `AI Social Agent running on port ${PORT}`
  );
});
