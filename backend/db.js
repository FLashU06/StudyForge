// Postgres (Supabase) database layer.
// Replaces the old SQLite file, which reset every time Render restarted the service.
// Set DATABASE_URL in your environment to your Supabase connection string
// (Project Settings -> Database -> Connection string -> "Transaction pooler" URI recommended).

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn(
    "[db] WARNING: DATABASE_URL is not set. Set it to your Supabase Postgres connection string, " +
      "or the app will crash as soon as it tries to query the database."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Converts SQLite-style "?" placeholders (used throughout the route files) into
// Postgres-style "$1, $2, ..." placeholders, in order of appearance.
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function all(sql, params = []) {
  const res = await pool.query(toPg(sql), params);
  return res.rows;
}

async function get(sql, params = []) {
  const res = await pool.query(toPg(sql), params);
  return res.rows[0];
}

// For INSERT/UPDATE/DELETE. If your INSERT ends with "RETURNING id", the returned
// object's `lastInsertRowid` will be populated (mirrors the old better-sqlite3 API).
async function run(sql, params = []) {
  const res = await pool.query(toPg(sql), params);
  return {
    lastInsertRowid: res.rows[0] ? res.rows[0].id : undefined,
    changes: res.rowCount,
  };
}

// Runs several statements as one atomic transaction on a single connection.
// Usage: await db.withTransaction(async (tx) => { await tx.run(...); await tx.run(...); });
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tx = {
      all: async (sql, params = []) => (await client.query(toPg(sql), params)).rows,
      get: async (sql, params = []) => (await client.query(toPg(sql), params)).rows[0],
      run: async (sql, params = []) => {
        const res = await client.query(toPg(sql), params);
        return { lastInsertRowid: res.rows[0] ? res.rows[0].id : undefined, changes: res.rowCount };
      },
    };
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Creates the schema if it doesn't exist yet (safe to run on every boot).
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS study_plans (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      goal TEXT,
      level TEXT,
      hours_per_day REAL,
      duration_days INTEGER,
      notes TEXT,
      overview TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topics (
      id SERIAL PRIMARY KEY,
      plan_id INTEGER NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      order_index INTEGER NOT NULL DEFAULT 0,
      estimated_hours REAL DEFAULT 1,
      resources TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES study_plans(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      difficulty TEXT DEFAULT 'medium',
      topic_titles TEXT,
      questions_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id SERIAL PRIMARY KEY,
      quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      answers_json TEXT,
      taken_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES study_plans(id) ON DELETE SET NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

module.exports = { all, get, run, withTransaction, init, pool };
