const API = "/api";
let state = {
  token: localStorage.getItem("sf_token") || null,
  user: JSON.parse(localStorage.getItem("sf_user") || "null"),
  currentPlanId: null,
  currentQuiz: null,
};

// ---------- API helper ----------
async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ---------- Auth ----------
const authScreen = document.getElementById("authScreen");
const appEl = document.getElementById("app");

document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("loginForm").classList.toggle("hidden", tab.dataset.tab !== "login");
    document.getElementById("registerForm").classList.toggle("hidden", tab.dataset.tab !== "register");
  });
});

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  try {
    const data = await api("/auth/login", { method: "POST", body: { email: f.get("email"), password: f.get("password") } });
    onAuthed(data);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const errEl = document.getElementById("registerError");
  errEl.textContent = "";
  try {
    const data = await api("/auth/register", {
      method: "POST",
      body: { name: f.get("name"), email: f.get("email"), password: f.get("password") },
    });
    onAuthed(data);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  state.token = null;
  state.user = null;
  localStorage.removeItem("sf_token");
  localStorage.removeItem("sf_user");
  authScreen.classList.remove("hidden");
  appEl.classList.add("hidden");
});

function onAuthed({ token, user }) {
  state.token = token;
  state.user = user;
  localStorage.setItem("sf_token", token);
  localStorage.setItem("sf_user", JSON.stringify(user));
  authScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  document.getElementById("userName").textContent = `👤 ${user.name}`;
  loadDashboard();
}

// ---------- Nav ----------
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

function switchView(view) {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const target = document.getElementById(`view-${view}`);
  if (target) target.classList.add("active");
  if (view === "dashboard") loadDashboard();
  if (view === "plans") loadPlansList();
  if (view === "tutor") loadTutorView();
  if (view === "quizzes") loadQuizHistory();
}

// ---------- Dashboard ----------
async function loadDashboard() {
  try {
    const d = await api("/dashboard");
    const banner = document.getElementById("aiBanner");
    if (!d.aiConfigured) {
      banner.classList.remove("hidden");
      banner.textContent =
        "⚡ Running in offline fallback mode (no AI key configured). Add a free GROQ_API_KEY in backend/.env for full AI-generated plans, quizzes and tutoring. See README.";
    } else {
      banner.classList.add("hidden");
    }

    document.getElementById("statGrid").innerHTML = `
      ${statCard(d.totalPlans, "Study Plans")}
      ${statCard(`${d.completedTopics}/${d.totalTopics}`, "Topics Completed")}
      ${statCard(d.quizzesTaken, "Quizzes Taken")}
      ${statCard(d.avgScorePct === null ? "—" : d.avgScorePct + "%", "Avg Quiz Score")}
      ${statCard(d.streakDays, "Day Streak 🔥")}
    `;

    const rp = document.getElementById("recentPlans");
    rp.innerHTML = d.recentPlans.length
      ? d.recentPlans
          .map(
            (p) => `<div class="list-item" onclick="openPlan(${p.id})">
              <div class="title-row"><strong>${esc(p.subject)}</strong><span class="small muted">${p.percent}%</span></div>
              <div class="meta">${esc(p.goal || "")} · ${p.completedTopics}/${p.totalTopics} topics</div>
            </div>`
          )
          .join("")
      : `<div class="empty-note">No study plans yet — create one to get started.</div>`;

    const rq = document.getElementById("recentQuizzes");
    rq.innerHTML = d.recentQuizAttempts.length
      ? d.recentQuizAttempts
          .map(
            (a) => `<div class="list-item">
              <div class="title-row"><strong>${esc(a.title)}</strong><span class="small muted">${a.score}/${a.total}</span></div>
              <div class="meta">${new Date(a.taken_at).toLocaleString()}</div>
            </div>`
          )
          .join("")
      : `<div class="empty-note">No quizzes taken yet.</div>`;
  } catch (err) {
    console.error(err);
  }
}
function statCard(num, label) {
  return `<div class="stat-card"><div class="num">${num}</div><div class="label">${label}</div></div>`;
}
function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- New Plan ----------
document.getElementById("planForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = document.getElementById("generatePlanBtn");
  const errEl = document.getElementById("planError");
  errEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "✨ Generating with AI...";
  try {
    const body = {
      subject: f.get("subject"),
      goal: f.get("goal"),
      level: f.get("level"),
      hoursPerDay: f.get("hoursPerDay"),
      durationDays: f.get("durationDays"),
      notes: f.get("notes"),
    };
    const data = await api("/plans/generate", { method: "POST", body });
    e.target.reset();
    openPlan(data.plan.id);
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Generate My Study Plan";
  }
});

// ---------- Plans list ----------
async function loadPlansList() {
  const el = document.getElementById("plansList");
  el.innerHTML = `<div class="empty-note">Loading...</div>`;
  const { plans } = await api("/plans");
  el.innerHTML = plans.length
    ? plans
        .map(
          (p) => `<div class="list-item" onclick="openPlan(${p.id})">
            <div class="title-row"><strong>${esc(p.subject)}</strong><span class="small muted">${p.totalTopics ? Math.round((p.completedTopics / p.totalTopics) * 100) : 0}%</span></div>
            <div class="meta">${esc(p.goal || "No specific goal set")} · Level: ${esc(p.level || "—")} · Created ${new Date(p.created_at).toLocaleDateString()}</div>
          </div>`
        )
        .join("")
    : `<div class="empty-note">No study plans yet. Go to "New Study Plan" to create one.</div>`;
}

// ---------- Plan detail ----------
async function openPlan(id) {
  state.currentPlanId = id;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-plandetail").classList.add("active");
  await renderPlanDetail(id);
}
window.openPlan = openPlan;

document.getElementById("backToPlans").addEventListener("click", () => switchView("plans"));

async function renderPlanDetail(id) {
  const { plan } = await api(`/plans/${id}`);
  document.getElementById("pdTitle").textContent = plan.subject;
  document.getElementById("pdOverview").textContent = plan.overview || "";
  const total = plan.topics.length;
  const completed = plan.topics.filter((t) => t.status === "completed").length;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  document.getElementById("pdProgressBar").style.width = pct + "%";
  document.getElementById("pdProgressText").textContent = `${completed}/${total} topics completed (${pct}%)`;

  document.getElementById("pdTopics").innerHTML = plan.topics
    .map(
      (t, i) => `<div class="topic-card status-${t.status}">
        <div class="topic-num">${String(i + 1).padStart(2, "0")}</div>
        <div class="topic-body">
          <h4>${esc(t.title)}</h4>
          <p>${esc(t.description || "")}</p>
          <div class="topic-meta">~${t.estimated_hours || 1}h${t.resources && t.resources.length ? " · " + t.resources.map(esc).join(" · ") : ""}</div>
          <select class="topic-status-select" onchange="updateTopicStatus(${plan.id}, ${t.id}, this.value)">
            <option value="pending" ${t.status === "pending" ? "selected" : ""}>Pending</option>
            <option value="in_progress" ${t.status === "in_progress" ? "selected" : ""}>In progress</option>
            <option value="completed" ${t.status === "completed" ? "selected" : ""}>Completed</option>
          </select>
        </div>
      </div>`
    )
    .join("");

  document.getElementById("generateQuizBtn").onclick = () => generateQuiz(plan.id);
}

async function updateTopicStatus(planId, topicId, status) {
  await api(`/plans/${planId}/topics/${topicId}`, { method: "PATCH", body: { status } });
  renderPlanDetail(planId);
}
window.updateTopicStatus = updateTopicStatus;

// ---------- Quiz generate & take ----------
async function generateQuiz(planId) {
  const btn = document.getElementById("generateQuizBtn");
  const errEl = document.getElementById("quizGenError");
  errEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Generating quiz...";
  try {
    const numQuestions = document.getElementById("quizNumQ").value;
    const difficulty = document.getElementById("quizDifficulty").value;
    const { quiz } = await api("/quizzes/generate", { method: "POST", body: { planId, numQuestions, difficulty } });
    state.currentQuiz = quiz;
    renderQuizTaking(quiz);
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById("view-quiz").classList.add("active");
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate Quiz";
  }
}

function renderQuizTaking(quiz) {
  document.getElementById("quizTitle").textContent = quiz.title;
  document.getElementById("quizResults").classList.add("hidden");
  document.getElementById("quizResults").innerHTML = "";
  const form = document.getElementById("quizForm");
  form.innerHTML = quiz.questions
    .map(
      (q, qi) => `<div class="quiz-question">
        <p class="qtext">${qi + 1}. ${esc(q.question)}</p>
        ${q.options
          .map(
            (opt, oi) => `<label class="quiz-option">
              <input type="radio" name="q${qi}" value="${oi}" required />
              <span>${esc(opt)}</span>
            </label>`
          )
          .join("")}
      </div>`
    )
    .join("");
  document.getElementById("submitQuizBtn").classList.remove("hidden");
}

document.getElementById("backFromQuiz").addEventListener("click", () => openPlan(state.currentPlanId));

document.getElementById("submitQuizBtn").addEventListener("click", async () => {
  const quiz = state.currentQuiz;
  const answers = quiz.questions.map((_, qi) => {
    const selected = document.querySelector(`input[name="q${qi}"]:checked`);
    return selected ? Number(selected.value) : -1;
  });
  if (answers.includes(-1)) {
    alert("Please answer all questions before submitting.");
    return;
  }
  const data = await api(`/quizzes/${quiz.id}/submit`, { method: "POST", body: { answers } });
  document.getElementById("submitQuizBtn").classList.add("hidden");

  const resultsEl = document.getElementById("quizResults");
  resultsEl.classList.remove("hidden");
  resultsEl.innerHTML = `<p class="score-badge">${data.score} / ${data.total} correct</p>` +
    data.results
      .map(
        (r, i) => `<div class="quiz-question">
          <p class="qtext">${i + 1}. ${esc(r.question)}</p>
          ${r.options
            .map((opt, oi) => {
              let cls = "quiz-option";
              if (oi === r.correctIndex) cls += " correct";
              else if (oi === r.selectedIndex) cls += " incorrect";
              return `<div class="${cls}">${oi === r.correctIndex ? "✅" : oi === r.selectedIndex ? "❌" : "•"} ${esc(opt)}</div>`;
            })
            .join("")}
          <div class="explanation">${esc(r.explanation)}</div>
        </div>`
      )
      .join("");
});

// ---------- Quiz history ----------
async function loadQuizHistory() {
  const el = document.getElementById("quizHistoryList");
  el.innerHTML = `<div class="empty-note">Loading...</div>`;
  const { attempts } = await api("/quizzes/history");
  el.innerHTML = attempts.length
    ? attempts
        .map(
          (a) => `<div class="list-item">
            <div class="title-row"><strong>${esc(a.title)}</strong><span class="small muted">${a.score}/${a.total} (${Math.round((a.score / a.total) * 100)}%)</span></div>
            <div class="meta">Difficulty: ${esc(a.difficulty)} · ${new Date(a.taken_at).toLocaleString()}</div>
          </div>`
        )
        .join("")
    : `<div class="empty-note">No quiz attempts yet.</div>`;
}

// ---------- Tutor chat ----------
async function loadTutorView() {
  const { plans } = await api("/plans");
  const select = document.getElementById("tutorPlanSelect");
  select.innerHTML =
    `<option value="">General / no specific plan</option>` +
    plans.map((p) => `<option value="${p.id}">${esc(p.subject)}</option>`).join("");
  select.onchange = () => loadChatHistory();
  await loadChatHistory();
}

async function loadChatHistory() {
  const planId = document.getElementById("tutorPlanSelect").value;
  const qs = planId ? `?planId=${planId}` : "";
  const { messages } = await api(`/chat/history${qs}`);
  const win = document.getElementById("chatWindow");
  win.innerHTML = messages.length
    ? messages.map((m) => `<div class="chat-msg ${m.role}">${esc(m.content)}</div>`).join("")
    : `<div class="empty-note">No messages yet — ask your tutor a question below!</div>`;
  win.scrollTop = win.scrollHeight;
}

document.getElementById("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("chatInput");
  const message = input.value.trim();
  if (!message) return;
  const planId = document.getElementById("tutorPlanSelect").value || null;
  const win = document.getElementById("chatWindow");
  win.innerHTML += `<div class="chat-msg user">${esc(message)}</div>`;
  win.scrollTop = win.scrollHeight;
  input.value = "";
  input.disabled = true;
  win.innerHTML += `<div class="chat-msg assistant" id="typingIndicator">Thinking...</div>`;
  win.scrollTop = win.scrollHeight;
  try {
    const data = await api("/chat", { method: "POST", body: { message, planId } });
    document.getElementById("typingIndicator")?.remove();
    win.innerHTML += `<div class="chat-msg assistant">${esc(data.reply)}</div>`;
  } catch (err) {
    document.getElementById("typingIndicator")?.remove();
    win.innerHTML += `<div class="chat-msg assistant">⚠️ ${esc(err.message)}</div>`;
  } finally {
    input.disabled = false;
    input.focus();
    win.scrollTop = win.scrollHeight;
  }
});

// ---------- Boot ----------
if (state.token && state.user) {
  authScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  document.getElementById("userName").textContent = `👤 ${state.user.name}`;
  loadDashboard();
}
