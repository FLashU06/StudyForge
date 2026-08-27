# StudyForge — AI Study Planner, Tutor & Quiz Generator

A complete, working full-stack web app:

- **Backend:** Node.js + Express + SQLite (file-based DB, no external DB server needed)
- **Auth:** Real accounts — register/login with hashed passwords (bcrypt) + JWT sessions
- **AI:** Uses a **free AI API (Groq)** for study-plan generation, the AI tutor chatbot, and quiz
  generation — with a built-in offline fallback generator so **the app fully works even with
  zero API keys configured**
- **Frontend:** Single-page app (plain HTML/CSS/JS, no build step) — Dashboard, plan creation,
  topic progress tracking, AI tutor chat, and quizzes

Everything you asked for is wired end-to-end and has been tested: register → AI generates a
personalized study plan from your input → track topic progress → generate an AI quiz on the
topics you've covered → get graded with explanations → chat with an AI tutor → see it all
summarized on a dashboard.

## 1. Install & run

```bash
cd backend
npm install
cp .env.example .env      # then edit .env (see step 2 below)
npm start
```

Open **http://localhost:4000** in your browser. That's it — frontend and backend are served
from the same process, so there's no CORS setup or second server to run.

The database is a single file at `backend/data/app.db`, created automatically on first run. It
persists your users, study plans, topics, quizzes, and chat history between restarts.

## 2. (Recommended) Add a free AI key for real AI output

Without any key, the app still fully works — it uses smart built-in template generators for
study plans, quizzes, and tutor replies. But for genuinely AI-personalized plans, quizzes
that adapt to exactly what you studied, and a real conversational tutor, add a **free** key:

1. Go to https://console.groq.com/keys and sign up (free, no credit card).
2. Create an API key.
3. Open `backend/.env` and set:
   ```
   GROQ_API_KEY=your_key_here
   ```
4. Restart the server (`npm start`).

The dashboard shows a banner telling you whether AI is currently configured or running in
fallback mode. (Google Gemini's free tier is also supported as an alternative — see the
comments in `.env.example`.)

## 3. How it works

- **Study plans:** On the "New Study Plan" page you enter subject, goal, current level, hours/day
  and duration. This is sent to `POST /api/plans/generate`, which prompts the AI (or uses the
  fallback generator) to produce an ordered list of topics with descriptions, time estimates, and
  resource pointers — saved to the database against your account.
- **Progress tracking:** Each topic can be marked Pending / In Progress / Completed from the plan
  detail page. This updates the database and drives the dashboard stats and streak counter.
- **Quizzes:** From a plan's detail page, "Generate Quiz" sends your **in-progress/completed
  topics** to `POST /api/quizzes/generate`, which asks the AI to write multiple-choice questions
  that specifically test those topics (not the whole subject generically). Grading happens
  server-side so answers can't be seen in the browser before submitting.
- **AI Tutor:** The chat page lets you optionally pick a study plan for context (so the tutor
  knows what you're studying and how far you've gotten) and chats via `POST /api/chat`, with
  history saved per user.
- **Dashboard:** Aggregates plans, topic completion, quiz average score, and a day-streak from
  real activity in the database.

## 4. Project structure

```
study-ai-app/
├── backend/
│   ├── server.js            # Express app entrypoint, serves API + static frontend
│   ├── db.js                 # SQLite schema + connection
│   ├── middleware/auth.js    # JWT verification
│   ├── services/aiService.js # AI calls (Groq/Gemini) + offline fallback generators
│   ├── routes/
│   │   ├── auth.js           # register/login/me
│   │   ├── plan.js           # AI study plan generation + topic progress
│   │   ├── quiz.js           # AI quiz generation + grading + history
│   │   ├── chat.js           # AI tutor chat + history
│   │   └── dashboard.js      # aggregated stats
│   ├── data/app.db           # SQLite database file (auto-created)
│   └── .env                  # your local config (not committed)
└── frontend/
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## 5. Notes

- All passwords are hashed with bcrypt; sessions are JWTs valid for 30 days, stored in
  `localStorage` on the client.
- Quiz correct answers are never sent to the browser until after you submit — grading is
  server-side.
- To reset all data, stop the server and delete `backend/data/app.db` (and the `-wal`/`-shm`
  files if present); it will be recreated empty on next start.
- To deploy this somewhere public (Render, Railway, Fly.io, a VPS, etc.), just run the backend
  the same way (`npm install && npm start`) with your `.env` configured, and expose the port.
