require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const db = require("./db");
const authRoutes = require("./routes/auth");
const planRoutes = require("./routes/plan");
const quizRoutes = require("./routes/quiz");
const chatRoutes = require("./routes/chat");
const dashboardRoutes = require("./routes/dashboard");
const ai = require("./services/aiService");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth", authRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, aiConfigured: ai.isAiConfigured() });
});

// Serve the frontend (single-page static app)
const frontendPath = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendPath));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(frontendPath, "index.html"));
});

async function start() {
  await db.init();
  app.listen(PORT, () => {
    console.log(`\n🚀 Study AI server running at http://localhost:${PORT}`);
    console.log(
      `   AI provider configured: ${ai.isAiConfigured() ? "YES" : "NO (using built-in fallback generators)"}\n`
    );
    console.log(`   Database: Postgres (${process.env.DATABASE_URL ? "connected" : "DATABASE_URL not set!"})\n`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
