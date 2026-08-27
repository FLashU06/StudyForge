const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const ai = require("../services/aiService");

const router = express.Router();

// Generate a quiz based on topics the user has already covered (in_progress or completed)
// in a plan, or from an explicit list of topic titles.
router.post("/generate", requireAuth, async (req, res) => {
  try {
    const { planId, numQuestions = 5, difficulty = "medium", topicIds } = req.body || {};
    if (!planId) return res.status(400).json({ error: "planId is required" });

    const plan = db.prepare("SELECT * FROM study_plans WHERE id = ? AND user_id = ?").get([planId, req.user.id]);
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    let topics;
    if (Array.isArray(topicIds) && topicIds.length > 0) {
      const placeholders = topicIds.map(() => "?").join(",");
      topics = db
        .prepare(`SELECT * FROM topics WHERE plan_id = ? AND id IN (${placeholders})`)
        .all([planId, ...topicIds]);
    } else {
      topics = db
        .prepare("SELECT * FROM topics WHERE plan_id = ? AND status IN ('in_progress','completed')")
        .all(planId);
    }

    if (topics.length === 0) {
      return res.status(400).json({
        error: "No covered topics yet. Mark at least one topic as in-progress or completed before generating a quiz.",
      });
    }

    const topicTitles = topics.map((t) => t.title);
    const quizData = await ai.generateQuiz({
      subject: plan.subject,
      topics: topicTitles,
      numQuestions: Math.min(Math.max(Number(numQuestions) || 5, 3), 15),
      difficulty,
    });

    const info = db
      .prepare(
        `INSERT INTO quizzes (user_id, plan_id, title, difficulty, topic_titles, questions_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run([req.user.id, planId, quizData.title, difficulty, JSON.stringify(topicTitles), JSON.stringify(quizData.questions)]);

    const quizId = info.lastInsertRowid;
    res.json({
      quiz: {
        id: quizId,
        title: quizData.title,
        difficulty,
        topicTitles,
        // strip correct answers before sending to client
        questions: quizData.questions.map((q, i) => ({ index: i, question: q.question, options: q.options })),
      },
      aiSource: quizData.source,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate quiz" });
  }
});

router.post("/:id/submit", requireAuth, (req, res) => {
  const { answers } = req.body || {}; // array of selected option indices, same order as questions
  const quiz = db.prepare("SELECT * FROM quizzes WHERE id = ? AND user_id = ?").get([req.params.id, req.user.id]);
  if (!quiz) return res.status(404).json({ error: "Quiz not found" });
  if (!Array.isArray(answers)) return res.status(400).json({ error: "answers array is required" });

  const questions = JSON.parse(quiz.questions_json);
  let score = 0;
  const results = questions.map((q, i) => {
    const selected = answers[i];
    const correct = selected === q.correctIndex;
    if (correct) score++;
    return {
      question: q.question,
      options: q.options,
      selectedIndex: selected,
      correctIndex: q.correctIndex,
      correct,
      explanation: q.explanation,
    };
  });

  db.prepare(
    `INSERT INTO quiz_attempts (quiz_id, user_id, score, total, answers_json) VALUES (?, ?, ?, ?, ?)`
  ).run([quiz.id, req.user.id, score, questions.length, JSON.stringify(answers)]);

  res.json({ score, total: questions.length, results });
});

router.get("/history", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT qa.id, qa.score, qa.total, qa.taken_at, q.title, q.difficulty, q.plan_id
       FROM quiz_attempts qa
       JOIN quizzes q ON q.id = qa.quiz_id
       WHERE qa.user_id = ?
       ORDER BY qa.taken_at DESC`
    )
    .all(req.user.id);
  res.json({ attempts: rows });
});

module.exports = router;
