// AI service layer.
// Tries a real free AI provider (Groq first, then Gemini) if a key is configured.
// If no key is set, or the call fails for any reason, falls back to solid
// built-in generators so the app always works end-to-end.

const GROQ_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const startArr = t.indexOf("[");
  let s = start;
  if (s === -1 || (startArr !== -1 && startArr < s)) s = startArr;
  const endBrace = t.lastIndexOf("}");
  const endBracket = t.lastIndexOf("]");
  const e = Math.max(endBrace, endBracket);
  if (s === -1 || e === -1) return null;
  try {
    return JSON.parse(t.slice(s, e + 1));
  } catch {
    return null;
  }
}

async function callGroq(systemPrompt, userPrompt, jsonMode) {
  if (!GROQ_KEY) return null;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.5,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}

async function callGemini(systemPrompt, userPrompt) {
  if (!GEMINI_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// Tries providers in order; returns raw text or null if none configured/working.
async function callAI(systemPrompt, userPrompt, jsonMode = false) {
  try {
    const g = await callGroq(systemPrompt, userPrompt, jsonMode);
    if (g) return g;
  } catch (e) {
    console.warn("[aiService] Groq failed:", e.message);
  }
  try {
    const gm = await callGemini(systemPrompt, userPrompt);
    if (gm) return gm;
  } catch (e) {
    console.warn("[aiService] Gemini failed:", e.message);
  }
  return null;
}

function isAiConfigured() {
  return Boolean(GROQ_KEY || GEMINI_KEY);
}

// ---------- STUDY PLAN ----------

async function generateStudyPlan({ subject, goal, level, hoursPerDay, durationDays, notes }) {
  const systemPrompt = `You are an expert curriculum designer and tutor. You design clear, realistic, personalized study plans.
Always respond with ONLY valid JSON (no markdown fences, no commentary) matching exactly this shape:
{
  "overview": "2-3 sentence summary of the plan and approach",
  "topics": [
    {
      "title": "short topic title",
      "description": "1-2 sentence description of what to learn and why it matters",
      "estimatedHours": number,
      "resources": ["short suggestion 1", "short suggestion 2"]
    }
  ]
}
Order topics from foundational to advanced. Make the number of topics and hours realistic for the given timeframe and hours/day. Aim for 6-14 topics.`;

  const userPrompt = `Subject: ${subject}
Learner goal: ${goal || "General mastery"}
Current level: ${level || "beginner"}
Hours available per day: ${hoursPerDay || 1}
Target duration: ${durationDays || 14} days
Extra notes from learner: ${notes || "none"}

Design the study plan now as JSON.`;

  const raw = await callAI(systemPrompt, userPrompt, true);
  const parsed = raw ? extractJson(raw) : null;

  if (parsed && Array.isArray(parsed.topics) && parsed.topics.length > 0) {
    return {
      overview: parsed.overview || `A personalized ${durationDays || 14}-day plan to learn ${subject}.`,
      topics: parsed.topics.map((t, i) => ({
        title: t.title || `Topic ${i + 1}`,
        description: t.description || "",
        estimatedHours: Number(t.estimatedHours) || 2,
        resources: Array.isArray(t.resources) ? t.resources : [],
        orderIndex: i,
      })),
      source: "ai",
    };
  }

  return fallbackStudyPlan({ subject, goal, level, hoursPerDay, durationDays, notes });
}

function fallbackStudyPlan({ subject, goal, level, hoursPerDay, durationDays }) {
  const lvl = (level || "beginner").toLowerCase();
  const days = Number(durationDays) || 14;
  const perDay = Number(hoursPerDay) || 1;

  const phaseTemplates = {
    beginner: [
      ["Orientation & Fundamentals", "Get comfortable with the core vocabulary and building blocks of the subject."],
      ["Core Concept I", "Dive into the first major concept area with guided examples."],
      ["Core Concept II", "Build on the fundamentals with the next essential concept."],
      ["Hands-on Practice I", "Apply what you've learned through exercises and small projects."],
      ["Core Concept III", "Cover the next key concept, connecting it back to earlier topics."],
      ["Hands-on Practice II", "Reinforce learning with more applied practice."],
      ["Common Mistakes & Debugging", "Learn what typically goes wrong and how to fix it."],
      ["Mini Project", "Combine everything learned so far into a small real project."],
      ["Advanced Topic Preview", "Get an early look at more advanced ideas in this subject."],
      ["Review & Self-Test", "Revisit weak areas and consolidate your understanding."],
    ],
    intermediate: [
      ["Refresher & Gap-filling", "Quickly review fundamentals and identify gaps."],
      ["Intermediate Concept I", "Go deeper into intermediate-level ideas."],
      ["Intermediate Concept II", "Continue building intermediate skills."],
      ["Applied Practice I", "Work through realistic problems."],
      ["Intermediate Concept III", "Cover another key intermediate concept."],
      ["Design Patterns / Best Practices", "Learn the conventions experienced practitioners use."],
      ["Applied Practice II", "Solve more complex, multi-step problems."],
      ["Project Work", "Build a project that exercises most of what you've learned."],
      ["Performance / Edge Cases", "Study edge cases, optimization, and pitfalls."],
      ["Review & Self-Test", "Consolidate and test your understanding."],
    ],
    advanced: [
      ["Landscape Overview", "Survey the advanced landscape and current best practices."],
      ["Advanced Concept I", "Deep-dive into a sophisticated topic area."],
      ["Advanced Concept II", "Continue with another advanced concept."],
      ["Research / Case Studies", "Study real-world case studies or papers."],
      ["Advanced Concept III", "Explore a further advanced topic."],
      ["System Design / Architecture", "Understand how concepts combine at scale."],
      ["Capstone Project", "Build a substantial project demonstrating mastery."],
      ["Peer-level Review", "Critically review and refine your own work."],
      ["Cutting-edge Trends", "Explore what's new and evolving in the field."],
      ["Final Review & Self-Test", "Consolidate mastery and identify remaining gaps."],
    ],
  };

  const templates = phaseTemplates[lvl] || phaseTemplates.beginner;
  const numTopics = Math.max(6, Math.min(templates.length, Math.round(days / 1.4)));
  const chosen = templates.slice(0, numTopics);
  const hoursPerTopic = Math.max(1, Math.round(((perDay * days) / numTopics) * 10) / 10);

  return {
    overview: `A ${days}-day self-paced plan to help you go from "${lvl}" to confidently achieving: ${goal || `mastery of ${subject}`}. Roughly ${perDay} hour(s)/day.`,
    topics: chosen.map(([title, description], i) => ({
      title: `${title}: ${subject}`,
      description,
      estimatedHours: hoursPerTopic,
      resources: [
        `Search "${subject} ${title.toLowerCase()} tutorial"`,
        `Practice problems on ${title.toLowerCase()}`,
      ],
      orderIndex: i,
    })),
    source: "fallback",
  };
}

// ---------- QUIZ ----------

async function generateQuiz({ subject, topics, numQuestions = 5, difficulty = "medium" }) {
  const topicList = topics.map((t) => `- ${t}`).join("\n");
  const systemPrompt = `You are an expert exam writer. You write rigorous, fair multiple-choice quizzes that genuinely test understanding (not just recall of exact wording).
Respond with ONLY valid JSON, no markdown fences, matching exactly:
{
  "title": "quiz title",
  "questions": [
    {
      "question": "question text",
      "options": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "explanation": "why this answer is correct, 1-2 sentences"
    }
  ]
}`;
  const userPrompt = `Subject: ${subject}
Difficulty: ${difficulty}
Number of questions: ${numQuestions}
The quiz must test the learner's understanding of these topics they just studied:
${topicList}

Write the quiz now as JSON. Exactly 4 options per question, only one correct.`;

  const raw = await callAI(systemPrompt, userPrompt, true);
  const parsed = raw ? extractJson(raw) : null;

  if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
    const questions = parsed.questions
      .filter((q) => Array.isArray(q.options) && q.options.length >= 2 && q.question)
      .map((q) => ({
        question: q.question,
        options: q.options.slice(0, 4),
        correctIndex: Math.min(Number(q.correctIndex) || 0, q.options.length - 1),
        explanation: q.explanation || "",
      }));
    if (questions.length > 0) {
      return { title: parsed.title || `${subject} Quiz`, questions, source: "ai" };
    }
  }

  return fallbackQuiz({ subject, topics, numQuestions, difficulty });
}

function fallbackQuiz({ subject, topics, numQuestions, difficulty }) {
  const qs = [];
  const pool = topics.length ? topics : [subject];
  for (let i = 0; i < numQuestions; i++) {
    const topic = pool[i % pool.length];
    qs.push({
      question: `Which statement best describes a correct application of "${topic}" in the context of ${subject}?`,
      options: [
        `It is correctly and appropriately applied as taught in "${topic}".`,
        `It is applied in a way that contradicts the fundamentals of "${topic}".`,
        `It is unrelated to "${topic}" or ${subject} entirely.`,
        `It uses an outdated approach superseded before "${topic}" was introduced.`,
      ],
      correctIndex: 0,
      explanation: `Option A reflects the standard, correct application of "${topic}". (Note: this is a generic fallback question — add a free AI API key in .env for richer, more specific quizzes.)`,
    });
  }
  return { title: `${subject} Review Quiz`, questions: qs, source: "fallback" };
}

// ---------- CHAT TUTOR ----------

async function chatReply({ subject, planContext, history, message }) {
  const systemPrompt = `You are a friendly, encouraging, and precise AI tutor helping a student learn "${subject || "their subject"}".
${planContext ? `The student's current study plan context:\n${planContext}\n` : ""}
Explain clearly, use examples, ask a short check-in question when useful, and keep answers focused and not overly long. If the student seems stuck, break concepts into smaller steps.`;

  const historyText = history
    .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
    .join("\n");
  const userPrompt = `${historyText ? historyText + "\n" : ""}Student: ${message}\nTutor:`;

  const raw = await callAI(systemPrompt, userPrompt, false);
  if (raw && raw.trim()) return { reply: raw.trim(), source: "ai" };

  return {
    reply: fallbackChatReply(message, subject),
    source: "fallback",
  };
}

function fallbackChatReply(message, subject) {
  return `I hear you: "${message.slice(0, 200)}"\n\nI don't have a live AI connection configured right now (no GROQ_API_KEY / GEMINI_API_KEY set in the backend .env), so here's a quick generic pointer instead of a full AI answer:\n\n1. Break the question about ${subject || "this topic"} into smaller sub-questions.\n2. Look up one core definition you're unsure about.\n3. Try a small example by hand before checking the answer.\n\nTo get real AI tutoring, add a free Groq API key (https://console.groq.com/keys) to backend/.env as GROQ_API_KEY and restart the server.`;
}

module.exports = {
  isAiConfigured,
  generateStudyPlan,
  generateQuiz,
  chatReply,
};
