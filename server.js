const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 3000;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const JWT_SECRET =
  process.env.JWT_SECRET || "CHANGE_THIS_SECRET_BEFORE_DEPLOYING";

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME || "admin";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "CHANGE_ADMIN_PASSWORD";

const TELEGRAM_SUPPORT_URL =
  process.env.TELEGRAM_SUPPORT_URL ||
  "https://t.me/arafatxyz0";

const TELEGRAM_GROUP_URL =
  process.env.TELEGRAM_GROUP_URL ||
  "https://t.me/+zlVgZjLxRjtlODM1";

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: "200kb" }));

app.use(express.static("public"));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50
});

app.use("/api/register", authLimiter);
app.use("/api/login", authLimiter);
app.use("/api/admin/login", authLimiter);


/* =========================
   DATABASE HELPERS
========================= */

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      mobile TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      referral_code TEXT UNIQUE NOT NULL,
      referred_by INTEGER REFERENCES users(id),
      balance INTEGER NOT NULL DEFAULT 0,
      total_earned INTEGER NOT NULL DEFAULT 0,
      total_withdrawn INTEGER NOT NULL DEFAULT 0,
      completed_tasks INTEGER NOT NULL DEFAULT 0,
      referral_bonus_paid BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      reward INTEGER NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      proof TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      method TEXT NOT NULL,
      account TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS unique_active_submission
    ON submissions(user_id, task_id)
    WHERE status IN ('pending', 'approved');
  `);

  await query(
    `
    INSERT INTO settings(key, value)
    VALUES ($1, $2)
    ON CONFLICT(key) DO NOTHING
    `,
    ["telegramSupportUrl", TELEGRAM_SUPPORT_URL]
  );

  await query(
    `
    INSERT INTO settings(key, value)
    VALUES ($1, $2)
    ON CONFLICT(key) DO NOTHING
    `,
    ["telegramGroupUrl", TELEGRAM_GROUP_URL]
  );
}


/* =========================
   JWT
========================= */

function tokenFor(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: "worker"
    },
    JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );
}

function adminToken() {
  return jwt.sign(
    {
      username: ADMIN_USERNAME,
      role: "admin"
    },
    JWT_SECRET,
    {
      expiresIn: "12h"
    }
  );
}


/* =========================
   WORKER AUTH
========================= */

function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : "";

    req.user = jwt.verify(token, JWT_SECRET);

    if (req.user.role !== "worker") {
      return res.status(403).json({
        error: "Worker access required"
      });
    }

    next();
  } catch {
    res.status(401).json({
      error: "Login required"
    });
  }
}


/* =========================
   ADMIN AUTH
========================= */

function adminAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : "";

    req.admin = jwt.verify(token, JWT_SECRET);

    if (req.admin.role !== "admin") {
      return res.status(403).json({
        error: "Admin access required"
      });
    }

    next();
  } catch {
    res.status(401).json({
      error: "Admin login required"
    });
  }
}


/* =========================
   REFERRAL CODE
========================= */

function makeReferralCode(username) {
  const base = String(username)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);

  return (
    base +
    Math.random()
      .toString(36)
      .slice(2, 6)
  ).slice(0, 12);
}


/* =========================
   REGISTER
========================= */

app.post("/api/register", async (req, res) => {
  try {
    const {
      username,
      mobile,
      email,
      password,
      confirmPassword,
      referralCode
    } = req.body;

    if (
      !username ||
      !mobile ||
      !email ||
      !password ||
      !confirmPassword
    ) {
      return res.status(400).json({
        error: "সব তথ্য পূরণ করুন"
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        error: "Password মিলছে না"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "Password কমপক্ষে 8 অক্ষরের হতে হবে"
      });
    }

    const cleanUsername = String(username).trim();
    const cleanMobile = String(mobile).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanReferral = referralCode
      ? String(referralCode).trim()
      : "";

    let referredId = null;

    if (cleanReferral) {
      const referred = await query(
        "SELECT id FROM users WHERE referral_code=$1",
        [cleanReferral]
      );

      if (referred.rows.length > 0) {
        referredId = referred.rows[0].id;
      }
    }

    const hash = await bcrypt.hash(password, 12);

    let code = makeReferralCode(cleanUsername);

    while (true) {
      const existingCode = await query(
        "SELECT id FROM users WHERE referral_code=$1",
        [code]
      );

      if (existingCode.rows.length === 0) break;

      code = makeReferralCode(cleanUsername);
    }

    const result = await query(
      `
      INSERT INTO users
      (
        username,
        mobile,
        email,
        password_hash,
        referral_code,
        referred_by
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [
        cleanUsername,
        cleanMobile,
        cleanEmail,
        hash,
        code,
        referredId
      ]
    );

    const user = result.rows[0];

    res.json({
      token: tokenFor(user),
      user: {
        username: user.username,
        referralCode: user.referral_code
      }
    });
  } catch (e) {
    console.error(e);

    res.status(409).json({
      error:
        "Username, mobile বা email আগে থেকেই ব্যবহার করা হয়েছে"
    });
  }
});


/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({
        error: "Login তথ্য দিন"
      });
    }

    const loginText = String(login).trim();

    const result = await query(
      `
      SELECT *
      FROM users
      WHERE username=$1
         OR email=$2
         OR mobile=$3
      LIMIT 1
      `,
      [
        loginText,
        loginText.toLowerCase(),
        loginText
      ]
    );

    const user = result.rows[0];

    if (
      !user ||
      !(await bcrypt.compare(
        password,
        user.password_hash
      ))
    ) {
      return res.status(401).json({
        error: "Login তথ্য সঠিক নয়"
      });
    }

    res.json({
      token: tokenFor(user)
    });
  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: "Server error"
    });
  }
});


/* =========================
   ME
========================= */

app.get("/api/me", auth, async (req, res) => {
  try {
    const userResult = await query(
      `
      SELECT
        username,
        email,
        mobile,
        referral_code,
        balance,
        total_earned,
        total_withdrawn,
        completed_tasks
      FROM users
      WHERE id=$1
      `,
      [req.user.id]
    );

    const u = userResult.rows[0];

    if (!u) {
      return res.status(404).json({
        error: "User পাওয়া যায়নি"
      });
    }

    const referralsResult = await query(
      "SELECT COUNT(*)::int AS n FROM users WHERE referred_by=$1",
      [req.user.id]
    );

    const pendingResult = await query(
      `
      SELECT COALESCE(SUM(amount),0)::int AS amount
      FROM withdrawals
      WHERE user_id=$1
      AND status='pending'
      `,
      [req.user.id]
    );

    res.json({
      ...u,
      referrals: referralsResult.rows[0].n,
      pendingWithdrawal:
        pendingResult.rows[0].amount,
      minWithdrawal: 50
    });
  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: "Server error"
    });
  }
});


/* =========================
   TASK LIST
========================= */

app.get("/api/tasks", auth, async (req, res) => {
  try {
    const result = await query(
      `
      SELECT
        id,
        title,
        description,
        reward
      FROM tasks
      WHERE active=TRUE
      ORDER BY id DESC
      `
    );

    res.json(result.rows);
  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: "Tasks load করা যায়নি"
    });
  }
});


/* =========================
   SUBMIT TASK
========================= */

app.post(
  "/api/tasks/:id/submit",
  auth,
  async (req, res) => {
    try {
      const taskResult = await query(
        `
        SELECT *
        FROM tasks
        WHERE id=$1
        AND active=TRUE
        `,
        [req.params.id]
      );

      const task = taskResult.rows[0];

      if (!task) {
        return res.status(404).json({
          error: "Task পাওয়া যায়নি"
        });
      }

      const existing = await query(
        `
        SELECT id
        FROM submissions
        WHERE user_id=$1
        AND task_id=$2
        AND status IN ('pending','approved')
        LIMIT 1
        `,
        [req.user.id, task.id]
      );

      if (existing.rows.length > 0) {
        return res.status(400).json({
          error: "এই task আগে submit করা হয়েছে"
        });
      }

      const proof = String(
        req.body.proof || ""
      ).trim();

      if (!proof) {
        return res.status(400).json({
          error: "Proof দিন"
        });
      }

      await query(
        `
        INSERT INTO submissions
        (user_id, task_id, proof)
        VALUES ($1,$2,$3)
        `,
        [
          req.user.id,
          task.id,
          proof
        ]
      );

      res.json({
        ok: true
      });
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: "Proof submit করা যায়নি"
      });
    }
  }
);


/* =========================
   WITHDRAW
========================= */

app.post("/api/withdraw", auth, async (req, res) => {
  const client = await pool.connect();

  try {
    const method = String(
      req.body.method || ""
    ).trim();

    const account = String(
      req.body.account || ""
    ).trim();

    const amount = Number(req.body.amount);

    if (
      !["bKash", "Nagad", "Binance"].includes(method)
    ) {
      return res.status(400).json({
        error: "Payment method সঠিক নয়"
      });
    }

    if (!account) {
      return res.status(400).json({
        error: "Payment account দিন"
      });
    }

    if (
      !Number.isInteger(amount) ||
      amount < 50
    ) {
      return res.status(400).json({
        error: "Minimum withdrawal ৳50"
      });
    }

    await client.query("BEGIN");

    const userResult = await client.query(
      `
      SELECT balance
      FROM users
      WHERE id=$1
      FOR UPDATE
      `,
      [req.user.id]
    );

    const user = userResult.rows[0];

    if (!user || user.balance < amount) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "পর্যাপ্ত balance নেই"
      });
    }

    await client.query(
      `
      UPDATE users
      SET balance=balance-$1
      WHERE id=$2
      `,
      [amount, req.user.id]
    );

    await client.query(
      `
      INSERT INTO withdrawals
      (user_id, method, account, amount)
      VALUES ($1,$2,$3,$4)
      `,
      [
        req.user.id,
        method,
        account,
        amount
      ]
    );

    await client.query("COMMIT");

    res.json({
      ok: true,
      message: "Withdrawal request submitted"
    });
  } catch (e) {
    await client.query("ROLLBACK");

    console.error(e);

    res.status(500).json({
      error: "Withdrawal request failed"
    });
  } finally {
    client.release();
  }
});


/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post("/api/admin/login", (req, res) => {
  const username = String(
    req.body.username || ""
  ).trim();

  const password = String(
    req.body.password || ""
  );

  if (
    username !== ADMIN_USERNAME ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      error: "Admin username বা password ভুল"
    });
  }

  res.json({
    token: adminToken(),
    admin: {
      username: ADMIN_USERNAME
    }
  });
});


/* =========================================================
   ADMIN STATS
========================================================= */

app.get(
  "/api/admin/stats",
  adminAuth,
  async (req, res) => {
    try {
      const users = await query(
        "SELECT COUNT(*)::int AS n FROM users"
      );

      const tasks = await query(
        "SELECT COUNT(*)::int AS n FROM tasks WHERE active=TRUE"
      );

      const pendingProofs = await query(
        `
        SELECT COUNT(*)::int AS n
        FROM submissions
        WHERE status='pending'
        `
      );

      const pendingWithdrawals = await query(
        `
        SELECT COUNT(*)::int AS n
        FROM withdrawals
        WHERE status='pending'
        `
      );

      const totalBalance = await query(
        `
        SELECT COALESCE(SUM(balance),0)::int AS amount
        FROM users
        `
      );

      const totalEarned = await query(
        `
        SELECT COALESCE(SUM(total_earned),0)::int AS amount
        FROM users
        `
      );

      const totalWithdrawn = await query(
        `
        SELECT COALESCE(SUM(total_withdrawn),0)::int AS amount
        FROM users
        `
      );

      res.json({
        users: users.rows[0].n,
        tasks: tasks.rows[0].n,
        pendingProofs:
          pendingProofs.rows[0].n,
        pendingWithdrawals:
          pendingWithdrawals.rows[0].n,
        totalBalance:
          totalBalance.rows[0].amount,
        totalEarned:
          totalEarned.rows[0].amount,
        totalWithdrawn:
          totalWithdrawn.rows[0].amount
      });
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: "Stats load করা যায়নি"
      });
    }
  }
);


/* =========================================================
   ADMIN USERS
========================================================= */

app.get(
  "/api/admin/users",
  adminAuth,
  async (req, res) => {
    try {
      const result = await query(
        `
        SELECT
          id,
          username,
          mobile,
          email,
          referral_code,
          referred_by,
          balance,
          total_earned,
          total_withdrawn,
          completed_tasks,
          created_at
        FROM users
        ORDER BY id DESC
        `
      );

      res.json(result.rows);
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: "Users load করা যায়নি"
      });
    }
  }
);


/* =========================================================
   ADMIN TASKS
========================================================= */

app.get(
  "/api/admin/tasks",
  adminAuth,
  async (req, res) => {
    try {
      const result = await query(
        `
        SELECT *
        FROM tasks
        ORDER BY id DESC
        `
      );

      res.json(result.rows);
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: "Tasks load করা যায়নি"
      });
    }
  }
);


app.post(
  "/api/admin/tasks",
  adminAuth,
  async (req, res) => {
    try {
      const title = String(
        req.body.title || ""
      ).trim();

      const description = String(
        req.body.description || ""
      ).trim();

      const reward = Number(
        req.body.reward
      );

      if (!title || !description) {
        return res.status(400).json({
          error: "Title এবং description দিন"
        });
      }

      if (
        !Number.isInteger(reward) ||
        reward <= 0
      ) {
        return res.status(400).json({
          error: "Reward সঠিক নয়"
        });
      }

      const result = await query(
        `
        INSERT INTO tasks
        (title, description, reward)
        VALUES ($1,$2,$3)
        RETURNING id
        `,
        [
          title,
          description,
          reward
        ]
      );

      res.json({
        ok: true,
        id: result.rows[0].id
      });
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: "Task তৈরি করা যায়নি"
      });
    }
  }
);


/* =========================================================
   ADMIN DELETE TASK
========================================================= */

app.delete(
  "/api/admin/tasks/:id",
  adminAuth,
  async (req, res) => {
    try {
      const taskId = Number(req.params.id);

      if (!Number.isInteger(taskId)) {
        return res.status(400).json({
          error: "Task ID সঠিক নয়"
        });
      }

      const taskResult = await query(
        `
        SELECT id, active
        FROM tasks
        WHERE id=$1
        `,
        [taskId]
      );

      const task = taskResult.rows[0];

      if (!task) {
        return res.status(404).json({
          error: "Task পাওয়া যায়নি"
        });
      }

      if (!task.active) {
        return res.status(400).json({
          error: "Task ইতিমধ্যে deleted"
        });
      }

      await query(
        `
        UPDATE tasks
        SET active=FALSE
        WHERE id=$1
        `,
        [taskId]
      );

      res.json({
        ok: true,
        message: "Task deleted successfully"
      });
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: "Task delete করা যায়নি"
      });
    }
  }
);


/* =========================================================
   ADMIN PROOFS
========================================================= */

app.get(
  "/api/admin/proofs",
  adminAuth,
  async (req, res) => {
    try {
      const result = await query(
        `
        SELECT
          s.id,
          s.user_id,
          s.task_id,
          s.proof,
          s.status,
          s.created_at,
          u.username,
          u.email,
          t.title AS task_title,
          t.reward
        FROM submissions s
        JOIN users u
          ON u.id=s.user_id
        JOIN tasks t
          ON t.id=s.task_id
        ORDER BY s.id DESC
        `
      );

      res.json(result.rows);
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: "Proofs load করা যায়নি"
      });
    }
  }
);


/* =========================================================
   APPROVE / REJECT PROOF
========================================================= */

app.patch(
  "/api/admin/proofs/:id",
  adminAuth,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const action = String(
        req.body.status ||
        req.body.action ||
        ""
      ).toLowerCase();

      if (
        !["approved", "rejected"].includes(action)
      ) {
        return res.status(400).json({
          error:
            "Status approved অথবা rejected হতে হবে"
        });
      }

      await client.query("BEGIN");

      const submissionResult = await client.query(
        `
        SELECT
          s.*,
          t.reward
        FROM submissions s
        JOIN tasks t
          ON t.id=s.task_id
        WHERE s.id=$1
        FOR UPDATE OF s
        `,
        [req.params.id]
      );

      const submission =
        submissionResult.rows[0];

      if (!submission) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "Proof পাওয়া যায়নি"
        });
      }

      if (submission.status !== "pending") {
        await client.query("ROLLBACK");

        return res.status(400).json({
          error:
            "এই proof ইতিমধ্যে process করা হয়েছে"
        });
      }

      if (action === "approved") {
        await client.query(
          `
          UPDATE submissions
          SET status='approved'
          WHERE id=$1
          `,
          [submission.id]
        );

        await client.query(
          `
          UPDATE users
          SET
            balance=balance+$1,
            total_earned=total_earned+$1,
            completed_tasks=completed_tasks+1
          WHERE id=$2
          `,
          [
            submission.reward,
            submission.user_id
          ]
        );

        const workerResult =
          await client.query(
            `
            SELECT
              referred_by,
              completed_tasks,
              referral_bonus_paid
            FROM users
            WHERE id=$1
            FOR UPDATE
            `,
            [submission.user_id]
          );

        const worker =
          workerResult.rows[0];

        if (
          worker &&
          worker.completed_tasks >= 20 &&
          worker.referred_by &&
          worker.referral_bonus_paid === false
        ) {
          await client.query(
            `
            UPDATE users
            SET
              balance=balance+20,
              total_earned=total_earned+20
            WHERE id=$1
            `,
            [worker.referred_by]
          );

          await client.query(
            `
            UPDATE users
            SET referral_bonus_paid=TRUE
            WHERE id=$1
            `,
            [submission.user_id]
          );
        }
      } else {
        await client.query(
          `
          UPDATE submissions
          SET status='rejected'
          WHERE id=$1
          `,
          [submission.id]
        );
      }

      await client.query("COMMIT");

      res.json({
        ok: true,
        status: action
      });
    } catch (e) {
      await client.query("ROLLBACK");

      console.error(e);

      res.status(500).json({
        error: "Proof process করা যায়নি"
      });
    } finally {
      client.release();
    }
  }
);


/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

app.get(
  "/api/admin/withdrawals",
  adminAuth,
  async (req, res) => {
    try {
      const result = await query(
        `
        SELECT
          w.id,
          w.user_id,
          w.method,
          w.account,
          w.amount,
          w.status,
          w.created_at,
          u.username,
          u.email,
          u.mobile
        FROM withdrawals w
        JOIN users u
          ON u.id=w.user_id
        ORDER BY w.id DESC
        `
      );

      res.json(result.rows);
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: "Withdrawals load করা যায়নি"
      });
    }
  }
);


/* =========================================================
   APPROVE / REJECT WITHDRAWAL
========================================================= */

app.patch(
  "/api/admin/withdrawals/:id",
  adminAuth,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const action = String(
        req.body.status ||
        req.body.action ||
        ""
      ).toLowerCase();

      if (
        !["approved", "rejected"].includes(action)
      ) {
        return res.status(400).json({
          error:
            "Status approved অথবা rejected হতে হবে"
        });
      }

      await client.query("BEGIN");

      const withdrawalResult =
        await client.query(
          `
          SELECT *
          FROM withdrawals
          WHERE id=$1
          FOR UPDATE
          `,
          [req.params.id]
        );

      const withdrawal =
        withdrawalResult.rows[0];

      if (!withdrawal) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "Withdrawal পাওয়া যায়নি"
        });
      }

      if (withdrawal.status !== "pending") {
        await client.query("ROLLBACK");

        return res.status(400).json({
          error:
            "এই withdrawal ইতিমধ্যে process করা হয়েছে"
        });
      }

      if (action === "approved") {
        await client.query(
          `
          UPDATE withdrawals
          SET status='approved'
          WHERE id=$1
          `,
          [withdrawal.id]
        );

        await client.query(
          `
          UPDATE users
          SET total_withdrawn=total_withdrawn+$1
          WHERE id=$2
          `,
          [
            withdrawal.amount,
            withdrawal.user_id
          ]
        );
      } else {
        await client.query(
          `
          UPDATE withdrawals
          SET status='rejected'
          WHERE id=$1
          `,
          [withdrawal.id]
        );

        await client.query(
          `
          UPDATE users
          SET balance=balance+$1
          WHERE id=$2
          `,
          [
            withdrawal.amount,
            withdrawal.user_id
          ]
        );
      }

      await client.query("COMMIT");

      res.json({
        ok: true,
        status: action
      });
    } catch (e) {
      await client.query("ROLLBACK");

      console.error(e);

      res.status(500).json({
        error: "Withdrawal process করা যায়নি"
      });
    } finally {
      client.release();
    }
  }
);


/* =========================================================
   ADMIN SETTINGS
========================================================= */

app.get(
  "/api/admin/settings",
  adminAuth,
  async (req, res) => {
    try {
      const result = await query(
        "SELECT key,value FROM settings"
      );

      const settings = {};

      for (const row of result.rows) {
        settings[row.key] = row.value;
      }

      res.json(settings);
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: "Settings load করা যায়নি"
      });
    }
  }
);


app.put(
  "/api/admin/settings",
  adminAuth,
  async (req, res) => {
    try {
      const supportUrl = String(
        req.body.telegramSupportUrl || ""
      ).trim();

      const groupUrl = String(
        req.body.telegramGroupUrl || ""
      ).trim();

      if (supportUrl) {
        await query(
          `
          INSERT INTO settings(key,value)
          VALUES('telegramSupportUrl',$1)
          ON CONFLICT(key)
          DO UPDATE SET value=EXCLUDED.value
          `,
          [supportUrl]
        );
      }

      if (groupUrl) {
        await query(
          `
          INSERT INTO settings(key,value)
          VALUES('telegramGroupUrl',$1)
          ON CONFLICT(key)
          DO UPDATE SET value=EXCLUDED.value
          `,
          [groupUrl]
        );
      }

      res.json({
        ok: true,
        message: "Settings saved"
      });
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: "Settings save করা যায়নি"
      });
    }
  }
);


/* =========================================================
   PUBLIC SETTINGS
========================================================= */

app.get(
  "/api/settings",
  async (req, res) => {
    try {
      const result = await query(
        `
        SELECT key,value
        FROM settings
        WHERE key IN
        ('telegramSupportUrl','telegramGroupUrl')
        `
      );

      const settings = {};

      for (const row of result.rows) {
        settings[row.key] = row.value;
      }

      res.json({
        telegramSupportUrl:
          settings.telegramSupportUrl ||
          TELEGRAM_SUPPORT_URL,

        telegramGroupUrl:
          settings.telegramGroupUrl ||
          TELEGRAM_GROUP_URL
      });
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error: "Settings load করা যায়নি"
      });
    }
  }
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  async (req, res) => {
    try {
      await query("SELECT 1");

      res.json({
        ok: true,
        name: "Work2Earn BD",
        database: "postgresql"
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        name: "Work2Earn BD",
        database: "error"
      });
    }
  }
);


/* =========================================================
   START SERVER
========================================================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `Work2Earn BD running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Database initialization failed:",
      error
    );

    process.exit(1);
  }
}

startServer();
