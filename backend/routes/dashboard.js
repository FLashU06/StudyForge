const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const ai = require("../services/aiService");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const userId = req.user.id;

  const plans = db.prepare("SELECT * FROM study_plans WHERE user_id = ?").all(userId);
  const totalPlans = plans.length;

  const totalTopics = db
    .prepare(
      `SELECT COUNT(*) c FROM topics t JOIN study_plans p ON p.id = t.plan_id WHERE p.user_id = ?`
    )
    .get(userId).c;
  const completedTopics = db
    .prepare(
      `SELECT COUNT(*) c FROM topics t JOIN study_plans p ON p.id = t.plan_id WHERE p.user_id = ? AND t.status = 'completed'`
    )
    .get(userId).c;
  const inProgressTopics = db
    .prepare(
      `SELECT COUNT(*) c FROM topics t JOIN study_plans p ON p.id = t.plan_id WHERE p.user_id = ? AND t.status = 'in_progress'`
    )
    .get(userId).c;

  const quizAttempts = db
    .prepare("SELECT score, total, taken_at FROM quiz_attempts WHERE user_id = ? ORDER BY taken_at DESC")
    .all(userId);
  const quizzesTaken = quizAttempts.length;
  const avgScorePct =
    quizzesTaken > 0
      ? Math.round(
          (quizAttempts.reduce((sum, a) => sum + a.score / a.total, 0) / quizzesTaken) * 100
        )
      : null;

  // simple activity streak: distinct calendar days with topic completion or quiz attempt in last 30 days
  const activityDates = new Set();
  db.prepare(
    `SELECT completed_at FROM topics t JOIN study_plans p ON p.id = t.plan_id WHERE p.user_id = ? AND completed_at IS NOT NULL`
  )
    .all(userId)
    .forEach((r) => activityDates.add(r.completed_at.slice(0, 10)));
  quizAttempts.forEach((a) => activityDates.add(a.taken_at.slice(0, 10)));

  let streak = 0;
  let cursor = new Date();
  for (;;) {
    const iso = cursor.toISOString().slice(0, 10);
    if (activityDates.has(iso)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }

  const recentPlans = plans
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
    .map((p) => {
      const total = db.prepare("SELECT COUNT(*) c FROM topics WHERE plan_id = ?").get(p.id).c;
      const completed = db
        .prepare("SELECT COUNT(*) c FROM topics WHERE plan_id = ? AND status = 'completed'")
        .get(p.id).c;
      return {
        id: p.id,
        subject: p.subject,
        goal: p.goal,
        createdAt: p.created_at,
        totalTopics: total,
        completedTopics: completed,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    });

  res.json({
    totalPlans,
    totalTopics,
    completedTopics,
    inProgressTopics,
    quizzesTaken,
    avgScorePct,
    streakDays: streak,
    recentPlans,
    recentQuizAttempts: quizAttempts.slice(0, 5),
    aiConfigured: ai.isAiConfigured(),
  });
});

module.exports = router;
