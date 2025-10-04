import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// if you plan to call this from a funnel page with fetch(), allow that origin here:
app.use(cors({
  origin: "*", // tighten later to your funnel domain
  methods: ["GET", "POST"],
}));

app.use(express.json());

// health check (handy for uptime monitors / Render)
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

/**
 * Helper: turn various incoming payload shapes into a single prompt string.
 * Adjust this to match the fields your GHL survey sends.
 */
function extractPromptFromGHL(body) {
  // common places GHL webhooks carry answers:
  const directMessage = body?.message;
  const answers = body?.survey_answers || body?.form_answers || body?.custom_fields;

  if (directMessage) return directMessage;

  if (Array.isArray(answers)) {
    // e.g. [{question:"Goal", answer:"Grow leads"}, ...]
    return answers.map(a => `${a.question || a.name}: ${a.answer || a.value}`).join("\n");
  }

  if (answers && typeof answers === "object") {
    // e.g. { goal:"Grow leads", niche:"Dentists" }
    return Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join("\n");
  }

  // fallback: stringify entire body (good during initial testing)
  return JSON.stringify(body, null, 2);
}

/**
 * Core endpoint your GHL Webhook will call.
 * It reads the survey payload, sends it to ChatGPT, and returns a reply.
 */
app.post("/webhook/survey", async (req, res) => {
  try {
    const prompt = extractPromptFromGHL(req.body);

    // --- call OpenAI Chat Completions ---
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You turn survey answers into a short, useful response for the user. Be clear, concise, and actionable.",
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.4
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return res.status(502).json({ error: "OpenAI error", detail: errText });
    }

    const data = await openaiRes.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "(no reply)";

    // return something simple and predictable
    return res.status(200).json({
      ok: true,
      reply
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
});

// (optional) a second endpoint you can call directly from a funnel page via fetch()
app.post("/api/generate", async (req, res) => {
  // this just forwards to the same logic as /webhook/survey
  req.body = { message: req.body?.message ?? req.body };
  return app._router.handle(req, res, () => {}, "post", "/webhook/survey");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 server listening on http://localhost:${port}`);
});
