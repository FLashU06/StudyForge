const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const ai = require("../services/aiService");

const router = express.Router();

// Create a new AI-generated study plan based on user input
router.post("/generate", requireAuth, async (req, res) => {
  try {
    const { subject, goal, level, hoursPerDay, durationDays, notes } = req.body || {};
    if (!subject) return res.status(400).json({ error: "subject is required" });

    const plan = await ai.generateStudyPlan({ subject, goal, level, hoursPerDay, durationDays, notes });

    const insertPlan = db.prepare(`
      INSERT INTO study_plans (user_id, subject, goal, level, hours_per_day, duration_days, notes, overview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = insertPlan.run([
      req.user.id,
      subject,
      goal || null,
      level || null,
      Number(hoursPerDay) || null,
      Number(durationDays) || null,
      notes || null,
      plan.overview,
    ]);
    const planId = info.lastInsertRowid;

    const insertTopic = db.prepare(`
      INSERT INTO topics (plan_id, title, description, order_index, estimated_hours, resources)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    db.exec("BEGIN");
    plan.topics.forEach((t) => {
      insertTopic.run([planId, t.title, t.description, t.orderIndex, t.estimatedHours, JSON.stringify(t.resources || [])]);
    });
    db.exec("COMMIT");

    const fullPlan = getPlanWithTopics(planId, req.user.id);
    res.json({ plan: fullPlan, aiSource: plan.source });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate study plan" });
  }
});

router.get("/", requireAuth, (req, res) => {
  const plans = db
    .prepare("SELECT * FROM study_plans WHERE user_id = ? ORDER BY created_at DESC")
    .all(req.user.id);
  const withCounts = plans.map((p) => {
    const total = db.prepare("SELECT COUNT(*) c FROM topics WHERE plan_id = ?").get([p.id]).c;
    const completed = db
      .prepare("SELECT COUNT(*) c FROM topics WHERE plan_id = ? AND status = 'completed'")
      .get([p.id]).c;
    return { ...p, totalTopics: total, completedTopics: completed };
  });
  res.json({ plans: withCounts });
});

router.get("/:id", requireAuth, (req, res) => {
  const plan = getPlanWithTopics(req.params.id, req.user.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  res.json({ plan });
});

router.patch("/:planId/topics/:topicId", requireAuth, (req, res) => {
  const { status } = req.body || {};
  if (!["pending", "in_progress", "completed"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const plan = db
    .prepare("SELECT id FROM study_plans WHERE id = ? AND user_id = ?")
    .get([req.params.planId, req.user.id]);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const topic = db
    .prepare("SELECT * FROM topics WHERE id = ? AND plan_id = ?")
    .get([req.params.topicId, req.params.planId]);
  if (!topic) return res.status(404).json({ error: "Topic not found" });

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE topics SET status = ?,
       started_at = CASE WHEN ? = 'in_progress' AND started_at IS NULL THEN ? ELSE started_at END,
       completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END
     WHERE id = ?`
  ).run([status, status, now, status, now, req.params.topicId]);

  const updated = db.prepare("SELECT * FROM topics WHERE id = ?").get(req.params.topicId);
  res.json({ topic: updated });
});

router.delete("/:id", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM study_plans WHERE id = ? AND user_id = ?").run([req.params.id, req.user.id]);
  if (result.changes === 0) return res.status(404).json({ error: "Plan not found" });
  res.json({ ok: true });
});

function getPlanWithTopics(planId, userId) {
  const plan = db.prepare("SELECT * FROM study_plans WHERE id = ? AND user_id = ?").get([planId, userId]);
  if (!plan) return null;
  const topics = db
    .prepare("SELECT * FROM topics WHERE plan_id = ? ORDER BY order_index ASC")
    .all(planId)
    .map((t) => ({ ...t, resources: safeParse(t.resources, []) }));
  return { ...plan, topics };
}

function safeParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

module.exports = router;
