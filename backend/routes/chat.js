const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const ai = require("../services/aiService");

const router = express.Router();

router.post("/", requireAuth, async (req, res) => {
  try {
    const { message, planId } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: "message is required" });

    let subject = null;
    let planContext = null;
    if (planId) {
      const plan = await db.get("SELECT * FROM study_plans WHERE id = ? AND user_id = ?", [
        planId,
        req.user.id,
      ]);
      if (plan) {
        subject = plan.subject;
        const topics = await db.all("SELECT title, status FROM topics WHERE plan_id = ? ORDER BY order_index", [
          planId,
        ]);
        planContext = topics.map((t) => `- ${t.title} [${t.status}]`).join("\n");
      }
    }

    const historyRows = planId
      ? await db.all(
          `SELECT role, content FROM chat_messages WHERE user_id = ? AND plan_id = ? ORDER BY id DESC LIMIT 10`,
          [req.user.id, planId]
        )
      : await db.all(`SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT 10`, [
          req.user.id,
        ]);
    const history = historyRows.slice().reverse();

    const { reply, source } = await ai.chatReply({ subject, planContext, history, message });

    const now = new Date().toISOString();
    await db.run(
      "INSERT INTO chat_messages (user_id, plan_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
      [req.user.id, planId || null, message, now]
    );
    await db.run(
      "INSERT INTO chat_messages (user_id, plan_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)",
      [req.user.id, planId || null, reply, now]
    );

    res.json({ reply, aiSource: source });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get tutor reply" });
  }
});

router.get("/history", requireAuth, async (req, res) => {
  try {
    const { planId } = req.query;
    const rows = planId
      ? await db.all("SELECT * FROM chat_messages WHERE user_id = ? AND plan_id = ? ORDER BY id ASC", [
          req.user.id,
          planId,
        ])
      : await db.all("SELECT * FROM chat_messages WHERE user_id = ? ORDER BY id ASC", [req.user.id]);
    res.json({ messages: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load chat history" });
  }
});

module.exports = router;
