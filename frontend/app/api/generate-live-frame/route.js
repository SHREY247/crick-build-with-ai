import { GoogleGenerativeAI } from "@google/generative-ai";

// Vercel Serverless runtime
export const runtime = 'edge';

const PERSONALITIES = {
  "harsha": {
    "name": "Harsha Mode",
    "emoji": "🎙️",
    "prompt": "Style: Poetic, enthusiastic cricket broadcast legend. Explicitly use metaphors like 'the corridors of uncertainty', 'painting a canvas on the green', or 'a gentle caress of the ball'. Focus on the romance of the game.",
  },
  "desi_aunty": {
    "name": "Desi Aunty",
    "emoji": "👵",
    "prompt": "Style: Indian family watch-party energy. Clean Hinglish. Mandate: You MUST include at least one mention of 'chai', 'samosa', or make a judgmental comment about a player's haircut. Playful and emotional.",
  },
  "bollywood": {
    "name": "Bollywood Mode",
    "emoji": "🎬",
    "prompt": "Style: cinematic Indian movie trailer energy. Dramatic, high-stakes, over-the-top. Every ball is destiny.",
  },
  "hinglish": {
    "name": "Hinglish Street",
    "emoji": "🤙",
    "prompt": "Style: casual Indian cricket fan in natural Hinglish. Short, punchy, stadium vibe.",
  },
  "coach": {
    "name": "Coach Mode",
    "emoji": "📋",
    "prompt": "Style: serious cricket coach. Mandate: You MUST end every 2 sentences with a 'Technical Cue' such as 'Watch the backlift', 'Footwork is lazy', or 'Keep the head still'. Focus on technique.",
  },
};

const MOCK_TEXT = {
  "harsha": "The floodlights bathe the ground in a warm glow as the crowd noise picks up. The corridors of uncertainty await the batter.",
  "desi_aunty": "Arre dekho dekho, poora match ka scene set ho gaya hai! Chai pee lo sab!",
  "bollywood": "The stadium becomes a battlefield, the bat becomes destiny! This is cinema!",
  "hinglish": "Scene set hai boss! Batter wait kar raha hai ek proper loose ball ka. Let's gooo!",
  "coach": "Notice the batter's stance. Watch the backlift. Keep the head still.",
};

export async function POST(req) {
  try {
    const { frame_base64, personality = "harsha", force_demo = false, history_text = "" } = await req.json();

    const pData = PERSONALITIES[personality] || PERSONALITIES["harsha"];
    
    // Simulate streaming for demo mode
    if (force_demo || !process.env.GEMINI_API_KEY) {
      const mockStr = MOCK_TEXT[personality] || MOCK_TEXT["harsha"];
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const chunks = mockStr.split(" ");
          for (let i = 0; i < chunks.length; i++) {
            controller.enqueue(encoder.encode(chunks[i] + " "));
            await new Promise((r) => setTimeout(r, 100)); // 100ms per word
          }
          controller.close();
        }
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/plain' } });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-2.5-flash" });

    const context_block = history_text ? `\nRECENT COMMENTARY IN THIS ROOM:\n${history_text}\nIMPORTANT: Do NOT repeat the previous commentary. Add a fresh observation.` : "";

    const prompt = `You are an AI cricket commentator. 
${pData.prompt}
Analyze this frame. Give me 1-3 sentences of raw text commentary. No JSON. No markdown.${context_block}`;

    const result = await model.generateContentStream([
      prompt,
      { inlineData: { data: frame_base64, mimeType: "image/jpeg" } }
    ]);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              controller.enqueue(encoder.encode(chunkText));
            }
          }
          controller.close();
        } catch (error) {
          console.error("Stream error", error);
          controller.error(error);
        }
      }
    });

    return new Response(stream, { headers: { 'Content-Type': 'text/plain' } });

  } catch (error) {
    console.error("Vercel Edge Function Error:", error);
    return new Response("Error generating live frame", { status: 500 });
  }
}
