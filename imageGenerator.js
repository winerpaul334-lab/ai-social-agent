// ==========================================
// IMAGE GENERATION SERVICE
// ==========================================

const { GoogleGenAI } = require("@google/genai");
const { createClient } = require("@supabase/supabase-js");

// ==========================================
// PLACEHOLDER: GEMINI API KEY
// ==========================================

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY;

// ==========================================
// PLACEHOLDER: SUPABASE URL
// ==========================================

const SUPABASE_URL =
  process.env.SUPABASE_URL;

// ==========================================
// PLACEHOLDER: SUPABASE SERVICE ROLE KEY
// ==========================================

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

// ==========================================
// PLACEHOLDER: SUPABASE STORAGE BUCKET
// ==========================================

const IMAGE_BUCKET =
  "generated-images";

// ==========================================
// CLIENTS
// ==========================================

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY
});

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// ==========================================
// GENERATE IMAGE
// ==========================================

async function generateImage(imagePrompt) {

  console.log(
    "🎨 Starting real image generation..."
  );

  if (!GEMINI_API_KEY) {
    console.error(
      "❌ GEMINI_API_KEY is missing."
    );

    return null;
  }

  if (!SUPABASE_URL) {
    console.error(
      "❌ SUPABASE_URL is missing."
    );

    return null;
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "❌ SUPABASE_SERVICE_ROLE_KEY is missing."
    );

    return null;
  }

  try {

    // ========================================
    // ASK GEMINI TO GENERATE IMAGE
    // ========================================

    const response =
      await ai.models.generateContent({

        model:
          "gemini-2.0-flash-exp",

        contents:
          imagePrompt,

        config: {
          responseModalities: [
            "TEXT",
            "IMAGE"
          ]
        }

      });

    // ========================================
    // FIND GENERATED IMAGE
    // ========================================

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

    // ========================================
    // CONVERT BASE64 TO IMAGE
    // ========================================

    const imageBuffer =
      Buffer.from(
        imagePart.inlineData.data,
        "base64"
      );

    // ========================================
    // CREATE FILE NAME
    // ========================================

    const fileName =
      `ai-social-${Date.now()}.png`;

    console.log(
      "📤 Uploading generated image..."
    );

    // ========================================
    // UPLOAD TO SUPABASE STORAGE
    // ========================================

    const { error } =
      await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(
          fileName,
          imageBuffer,
          {
            contentType:
              "image/png",

            cacheControl:
              "31536000",

            upsert:
              false
          }
        );

    if (error) {

      console.error(
        "❌ Supabase upload failed:",
        error
      );

      return null;
    }

    // ========================================
    // GET PUBLIC IMAGE URL
    // ========================================

    const { data } =
      supabase.storage
        .from(IMAGE_BUCKET)
        .getPublicUrl(
          fileName
        );

    if (
      !data ||
      !data.publicUrl
    ) {

      console.error(
        "❌ Could not get image URL."
      );

      return null;
    }

    console.log(
      "✅ REAL IMAGE GENERATED:"
    );

    console.log(
      data.publicUrl
    );

    // ========================================
    // RETURN IMAGE URL
    // ========================================

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
// EXPORT
// ==========================================

module.exports = {
  generateImage
};
