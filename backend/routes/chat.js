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
      const plan = db.prepare("SELECT * FROM study_plans WHERE id = ? AND user_id = ?").get(planId, req.user.id);
      if (plan) {
        subject = plan.subject;
        const topics = db.prepare("SELECT title, status FROM topics WHERE plan_id = ? ORDER BY order_index").all(planId);
        planContext = topics.map((t) => `- ${t.title} [${t.status}]`).join("\n");
      }
    }

    const history = db
      .prepare(
        `SELECT role, content FROM chat_messages WHERE user_id = ? ${planId ? "AND plan_id = ?" : ""} ORDER BY id DESC LIMIT 10`
      )
      .all(...(planId ? [req.user.id, planId] : [req.user.id]))
      .reverse();

    const { reply, source } = await ai.chatReply({ subject, planContext, history, message });

    db.prepare("INSERT INTO chat_messages (user_id, plan_id, role, content) VALUES (?, ?, 'user', ?)").run(
      req.user.id,
      planId || null,
      message
    );
    db.prepare("INSERT INTO chat_messages (user_id, plan_id, role, content) VALUES (?, ?, 'assistant', ?)").run(
      req.user.id,
      planId || null,
      reply
    );

    res.json({ reply, aiSource: source });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get tutor reply" });
  }
});

router.get("/history", requireAuth, (req, res) => {
  const { planId } = req.query;
  const rows = planId
    ? db
        .prepare("SELECT * FROM chat_messages WHERE user_id = ? AND plan_id = ? ORDER BY id ASC")
        .all(req.user.id, planId)
    : db.prepare("SELECT * FROM chat_messages WHERE user_id = ? ORDER BY id ASC").all(req.user.id);
  res.json({ messages: rows });
});

module.exports = router;
