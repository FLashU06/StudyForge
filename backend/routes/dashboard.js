const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const ai = require("../services/aiService");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const plans = await db.all("SELECT * FROM study_plans WHERE user_id = ?", [userId]);
    const totalPlans = plans.length;

    const totalTopics = Number(
      (
        await db.get(
          `SELECT COUNT(*) c FROM topics t JOIN study_plans p ON p.id = t.plan_id WHERE p.user_id = ?`,
          [userId]
        )
      ).c
    );
    const completedTopics = Number(
      (
        await db.get(
          `SELECT COUNT(*) c FROM topics t JOIN study_plans p ON p.id = t.plan_id WHERE p.user_id = ? AND t.status = 'completed'`,
          [userId]
        )
      ).c
    );
    const inProgressTopics = Number(
      (
        await db.get(
          `SELECT COUNT(*) c FROM topics t JOIN study_plans p ON p.id = t.plan_id WHERE p.user_id = ? AND t.status = 'in_progress'`,
          [userId]
        )
      ).c
    );

    const quizAttempts = await db.all(
      "SELECT score, total, taken_at FROM quiz_attempts WHERE user_id = ? ORDER BY taken_at DESC",
      [userId]
    );
    const quizzesTaken = quizAttempts.length;
    const avgScorePct =
      quizzesTaken > 0
        ? Math.round(
            (quizAttempts.reduce((sum, a) => sum + a.score / a.total, 0) / quizzesTaken) * 100
          )
        : null;

    // simple activity streak: distinct calendar days with topic completion or quiz attempt in last 30 days
    const activityDates = new Set();
    (
      await db.all(
        `SELECT completed_at FROM topics t JOIN study_plans p ON p.id = t.plan_id WHERE p.user_id = ? AND completed_at IS NOT NULL`,
        [userId]
      )
    ).forEach((r) => activityDates.add(r.completed_at.slice(0, 10)));
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

    const sortedPlans = plans
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5);

    const recentPlans = [];
    for (const p of sortedPlans) {
      const total = Number((await db.get("SELECT COUNT(*) c FROM topics WHERE plan_id = ?", [p.id])).c);
      const completed = Number(
        (await db.get("SELECT COUNT(*) c FROM topics WHERE plan_id = ? AND status = 'completed'", [p.id])).c
      );
      recentPlans.push({
        id: p.id,
        subject: p.subject,
        goal: p.goal,
        createdAt: p.created_at,
        totalTopics: total,
        completedTopics: completed,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      });
    }

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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

module.exports = router;
