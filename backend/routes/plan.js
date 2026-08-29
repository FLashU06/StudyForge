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
    const now = new Date().toISOString();

    const planId = await db.withTransaction(async (tx) => {
      const info = await tx.run(
        `INSERT INTO study_plans (user_id, subject, goal, level, hours_per_day, duration_days, notes, overview, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [
          req.user.id,
          subject,
          goal || null,
          level || null,
          Number(hoursPerDay) || null,
          Number(durationDays) || null,
          notes || null,
          plan.overview,
          now,
        ]
      );
      const id = info.lastInsertRowid;

      for (const t of plan.topics) {
        await tx.run(
          `INSERT INTO topics (plan_id, title, description, order_index, estimated_hours, resources)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, t.title, t.description, t.orderIndex, t.estimatedHours, JSON.stringify(t.resources || [])]
        );
      }
      return id;
    });

    const fullPlan = await getPlanWithTopics(planId, req.user.id);
    res.json({ plan: fullPlan, aiSource: plan.source });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate study plan" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const plans = await db.all("SELECT * FROM study_plans WHERE user_id = ? ORDER BY created_at DESC", [
      req.user.id,
    ]);
    const withCounts = [];
    for (const p of plans) {
      const total = (await db.get("SELECT COUNT(*) c FROM topics WHERE plan_id = ?", [p.id])).c;
      const completed = (
        await db.get("SELECT COUNT(*) c FROM topics WHERE plan_id = ? AND status = 'completed'", [p.id])
      ).c;
      withCounts.push({ ...p, totalTopics: Number(total), completedTopics: Number(completed) });
    }
    res.json({ plans: withCounts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load plans" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const plan = await getPlanWithTopics(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    res.json({ plan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load plan" });
  }
});

router.patch("/:planId/topics/:topicId", requireAuth, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!["pending", "in_progress", "completed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const plan = await db.get("SELECT id FROM study_plans WHERE id = ? AND user_id = ?", [
      req.params.planId,
      req.user.id,
    ]);
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    const topic = await db.get("SELECT * FROM topics WHERE id = ? AND plan_id = ?", [
      req.params.topicId,
      req.params.planId,
    ]);
    if (!topic) return res.status(404).json({ error: "Topic not found" });

    const now = new Date().toISOString();
    await db.run(
      `UPDATE topics SET status = ?,
         started_at = CASE WHEN ? = 'in_progress' AND started_at IS NULL THEN ? ELSE started_at END,
         completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END
       WHERE id = ?`,
      [status, status, now, status, now, req.params.topicId]
    );

    const updated = await db.get("SELECT * FROM topics WHERE id = ?", [req.params.topicId]);
    res.json({ topic: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update topic" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const result = await db.run("DELETE FROM study_plans WHERE id = ? AND user_id = ?", [
      req.params.id,
      req.user.id,
    ]);
    if (result.changes === 0) return res.status(404).json({ error: "Plan not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete plan" });
  }
});

async function getPlanWithTopics(planId, userId) {
  const plan = await db.get("SELECT * FROM study_plans WHERE id = ? AND user_id = ?", [planId, userId]);
  if (!plan) return null;
  const rows = await db.all("SELECT * FROM topics WHERE plan_id = ? ORDER BY order_index ASC", [planId]);
  const topics = rows.map((t) => ({ ...t, resources: safeParse(t.resources, []) }));
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
