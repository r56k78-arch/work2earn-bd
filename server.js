const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const app = express();

const db = new Database("work2earn.db");

const PORT = process.env.PORT || 3000;

const JWT_SECRET =
  process.env.JWT_SECRET || "CHANGE_THIS_SECRET_BEFORE_DEPLOYING";

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME || "admin";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "CHANGE_ADMIN_PASSWORD";

const TELEGRAM_SUPPORT_URL =
  process.env.TELEGRAM_SUPPORT_URL || "https://t.me/arafatxyz0";

const TELEGRAM_GROUP_URL =
  process.env.TELEGRAM_GROUP_URL ||
  "https://t.me/+zlVgZjLxRjtlODM1";


/* =========================
   APP SETTINGS
========================= */

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: "200kb" }));

app.use(express.static("public"));


/* =========================
   RATE LIMIT
========================= */

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50
});

app.use("/api/register", authLimiter);
app.use("/api/login", authLimiter);
app.use("/api/admin/login", authLimiter);


/* =========================
   DATABASE
========================= */

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 mobile TEXT UNIQUE NOT NULL,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 referral_code TEXT UNIQUE NOT NULL,
 referred_by INTEGER,
 balance INTEGER NOT NULL DEFAULT 0,
 total_earned INTEGER NOT NULL DEFAULT 0,
 total_withdrawn INTEGER NOT NULL DEFAULT 0,
 completed_tasks INTEGER NOT NULL DEFAULT 0,
 referral_bonus_paid INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 description TEXT NOT NULL,
 reward INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 task_id INTEGER NOT NULL,
 proof TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS withdrawals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 method TEXT NOT NULL,
 account TEXT NOT NULL,
 amount INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
);
`);


/* =========================
   DEFAULT SETTINGS
========================= */

function setDefaultSetting(key, value) {
  const exists = db
    .prepare("SELECT key FROM settings WHERE key=?")
    .get(key);

  if (!exists) {
    db.prepare(
      "INSERT INTO settings(key,value) VALUES(?,?)"
    ).run(key, value);
  }
}

setDefaultSetting(
  "telegramSupportUrl",
  TELEGRAM_SUPPORT_URL
);

setDefaultSetting(
  "telegramGroupUrl",
  TELEGRAM_GROUP_URL
);


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
  const base = username
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

app.post("/api/register", (req, res) => {
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

  const referred = referralCode
    ? db
        .prepare(
          "SELECT id FROM users WHERE referral_code=?"
        )
        .get(String(referralCode).trim())
    : null;

  try {
    const hash = bcrypt.hashSync(password, 12);

    let code = makeReferralCode(username);

    while (
      db
        .prepare(
          "SELECT id FROM users WHERE referral_code=?"
        )
        .get(code)
    ) {
      code = makeReferralCode(username);
    }

    const info = db
      .prepare(
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
        VALUES (?,?,?,?,?,?)
        `
      )
      .run(
        String(username).trim(),
        String(mobile).trim(),
        String(email).trim().toLowerCase(),
        hash,
        code,
        referred ? referred.id : null
      );

    const user = db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(info.lastInsertRowid);

    res.json({
      token: tokenFor(user),
      user: {
        username: user.username,
        referralCode: user.referral_code
      }
    });
  } catch (e) {
    res.status(409).json({
      error:
        "Username, mobile বা email আগে থেকেই ব্যবহার করা হয়েছে"
    });
  }
});


/* =========================
   LOGIN
========================= */

app.post("/api/login", (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({
      error: "Login তথ্য দিন"
    });
  }

  const loginText = String(login).trim();

  const user = db
    .prepare(
      `
      SELECT *
      FROM users
      WHERE username=?
         OR email=?
         OR mobile=?
      `
    )
    .get(
      loginText,
      loginText.toLowerCase(),
      loginText
    );

  if (
    !user ||
    !bcrypt.compareSync(
      password,
      user.password_hash
    )
  ) {
    return res.status(401).json({
      error: "Login তথ্য সঠিক নয়"
    });
  }

  res.json({
    token: tokenFor(user)
  });
});


/* =========================
   ME
========================= */

app.get("/api/me", auth, (req, res) => {
  const u = db
    .prepare(
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
      WHERE id=?
      `
    )
    .get(req.user.id);

  const referrals = db
    .prepare(
      "SELECT COUNT(*) n FROM users WHERE referred_by=?"
    )
    .get(req.user.id).n;

  const pendingWithdrawal = db
    .prepare(
      `
      SELECT COALESCE(SUM(amount),0) amount
      FROM withdrawals
      WHERE user_id=?
      AND status='pending'
      `
    )
    .get(req.user.id).amount;

  res.json({
    ...u,
    referrals,
    pendingWithdrawal,
    minWithdrawal: 50
  });
});


/* =========================
   TASK LIST
========================= */

app.get("/api/tasks", auth, (req, res) => {
  const tasks = db
    .prepare(
      `
      SELECT
        id,
        title,
        description,
        reward
      FROM tasks
      WHERE active=1
      ORDER BY id DESC
      `
    )
    .all();

  res.json(tasks);
});


/* =========================
   SUBMIT TASK
========================= */

app.post("/api/tasks/:id/submit", auth, (req, res) => {
  const task = db
    .prepare(
      `
      SELECT *
      FROM tasks
      WHERE id=?
      AND active=1
      `
    )
    .get(req.params.id);

  if (!task) {
    return res.status(404).json({
      error: "Task পাওয়া যায়নি"
    });
  }

  const existing = db
    .prepare(
      `
      SELECT id
      FROM submissions
      WHERE user_id=?
      AND task_id=?
      AND status IN ('pending','approved')
      `
    )
    .get(
      req.user.id,
      task.id
    );

  if (existing) {
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

  db.prepare(
    `
    INSERT INTO submissions
    (user_id,task_id,proof)
    VALUES (?,?,?)
    `
  ).run(
    req.user.id,
    task.id,
    proof
  );

  res.json({
    ok: true
  });
});


/* =========================
   WITHDRAW
========================= */

app.post("/api/withdraw", auth, (req, res) => {
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

  const u = db
    .prepare(
      "SELECT balance FROM users WHERE id=?"
    )
    .get(req.user.id);

  if (!u || u.balance < amount) {
    return res.status(400).json({
      error: "পর্যাপ্ত balance নেই"
    });
  }

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE users
      SET balance=balance-?
      WHERE id=?
      `
    ).run(
      amount,
      req.user.id
    );

    db.prepare(
      `
      INSERT INTO withdrawals
      (user_id,method,account,amount)
      VALUES (?,?,?,?)
      `
    ).run(
      req.user.id,
      method,
      account,
      amount
    );
  });

  tx();

  res.json({
    ok: true,
    message: "Withdrawal request submitted"
  });
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
  (req, res) => {
    const users = db
      .prepare(
        "SELECT COUNT(*) n FROM users"
      )
      .get().n;

    const tasks = db
      .prepare(
        "SELECT COUNT(*) n FROM tasks WHERE active=1"
      )
      .get().n;

    const pendingProofs = db
      .prepare(
        `
        SELECT COUNT(*) n
        FROM submissions
        WHERE status='pending'
        `
      )
      .get().n;

    const pendingWithdrawals = db
      .prepare(
        `
        SELECT COUNT(*) n
        FROM withdrawals
        WHERE status='pending'
        `
      )
      .get().n;

    const totalBalance = db
      .prepare(
        `
        SELECT COALESCE(SUM(balance),0) amount
        FROM users
        `
      )
      .get().amount;

    const totalEarned = db
      .prepare(
        `
        SELECT COALESCE(SUM(total_earned),0) amount
        FROM users
        `
      )
      .get().amount;

    const totalWithdrawn = db
      .prepare(
        `
        SELECT COALESCE(SUM(total_withdrawn),0) amount
        FROM users
        `
      )
      .get().amount;

    res.json({
      users,
      tasks,
      pendingProofs,
      pendingWithdrawals,
      totalBalance,
      totalEarned,
      totalWithdrawn
    });
  }
);


/* =========================================================
   ADMIN USERS
========================================================= */

app.get(
  "/api/admin/users",
  adminAuth,
  (req, res) => {
    const users = db
      .prepare(
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
      )
      .all();

    res.json(users);
  }
);


/* =========================================================
   ADMIN TASKS
========================================================= */

app.get(
  "/api/admin/tasks",
  adminAuth,
  (req, res) => {
    const tasks = db
      .prepare(
        `
        SELECT *
        FROM tasks
        ORDER BY id DESC
        `
      )
      .all();

    res.json(tasks);
  }
);


app.post(
  "/api/admin/tasks",
  adminAuth,
  (req, res) => {
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

    const info = db
      .prepare(
        `
        INSERT INTO tasks
        (title,description,reward)
        VALUES (?,?,?)
        `
      )
      .run(
        title,
        description,
        reward
      );

    res.json({
      ok: true,
      id: info.lastInsertRowid
    });
  }
);


/* =========================================================
   ADMIN PROOFS
========================================================= */

app.get(
  "/api/admin/proofs",
  adminAuth,
  (req, res) => {
    const proofs = db
      .prepare(
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
      )
      .all();

    res.json(proofs);
  }
);


/* =========================================================
   APPROVE / REJECT PROOF
========================================================= */

app.patch(
  "/api/admin/proofs/:id",
  adminAuth,
  (req, res) => {
    const action = String(
      req.body.status ||
      req.body.action ||
      ""
    ).toLowerCase();

    if (
      !["approved", "rejected"].includes(action)
    ) {
      return res.status(400).json({
        error: "Status approved অথবা rejected হতে হবে"
      });
    }

    const submission = db
      .prepare(
        `
        SELECT
          s.*,
          t.reward
        FROM submissions s
        JOIN tasks t
          ON t.id=s.task_id
        WHERE s.id=?
        `
      )
      .get(req.params.id);

    if (!submission) {
      return res.status(404).json({
        error: "Proof পাওয়া যায়নি"
      });
    }

    if (submission.status !== "pending") {
      return res.status(400).json({
        error: "এই proof ইতিমধ্যে process করা হয়েছে"
      });
    }

    const tx = db.transaction(() => {
      if (action === "approved") {
        db.prepare(
          `
          UPDATE submissions
          SET status='approved'
          WHERE id=?
          `
        ).run(submission.id);

        db.prepare(
          `
          UPDATE users
          SET
            balance=balance+?,
            total_earned=total_earned+?,
            completed_tasks=completed_tasks+1
          WHERE id=?
          `
        ).run(
          submission.reward,
          submission.reward,
          submission.user_id
        );

        const worker = db
          .prepare(
            `
            SELECT
              referred_by,
              completed_tasks,
              referral_bonus_paid
            FROM users
            WHERE id=?
            `
          )
          .get(submission.user_id);

        /*
          20 completed tasks হলে referrer
          একবার ৳20 bonus পাবে।
        */

        if (
          worker &&
          worker.completed_tasks >= 20 &&
          worker.referred_by &&
          worker.referral_bonus_paid === 0
        ) {
          db.prepare(
            `
            UPDATE users
            SET
              balance=balance+20,
              total_earned=total_earned+20
            WHERE id=?
            `
          ).run(worker.referred_by);

          db.prepare(
            `
            UPDATE users
            SET referral_bonus_paid=1
            WHERE id=?
            `
          ).run(submission.user_id);
        }
      } else {
        db.prepare(
          `
          UPDATE submissions
          SET status='rejected'
          WHERE id=?
          `
        ).run(submission.id);
      }
    });

    tx();

    res.json({
      ok: true,
      status: action
    });
  }
);


/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

app.get(
  "/api/admin/withdrawals",
  adminAuth,
  (req, res) => {
    const withdrawals = db
      .prepare(
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
      )
      .all();

    res.json(withdrawals);
  }
);


/* =========================================================
   APPROVE / REJECT WITHDRAWAL
========================================================= */

app.patch(
  "/api/admin/withdrawals/:id",
  adminAuth,
  (req, res) => {
    const action = String(
      req.body.status ||
      req.body.action ||
      ""
    ).toLowerCase();

    if (
      !["approved", "rejected"].includes(action)
    ) {
      return res.status(400).json({
        error: "Status approved অথবা rejected হতে হবে"
      });
    }

    const withdrawal = db
      .prepare(
        `
        SELECT *
        FROM withdrawals
        WHERE id=?
        `
      )
      .get(req.params.id);

    if (!withdrawal) {
      return res.status(404).json({
        error: "Withdrawal পাওয়া যায়নি"
      });
    }

    if (withdrawal.status !== "pending") {
      return res.status(400).json({
        error: "এই withdrawal ইতিমধ্যে process করা হয়েছে"
      });
    }

    const tx = db.transaction(() => {
      if (action === "approved") {
        db.prepare(
          `
          UPDATE withdrawals
          SET status='approved'
          WHERE id=?
          `
        ).run(withdrawal.id);

        db.prepare(
          `
          UPDATE users
          SET total_withdrawn=total_withdrawn+?
          WHERE id=?
          `
        ).run(
          withdrawal.amount,
          withdrawal.user_id
        );
      } else {
        /*
          Withdrawal request করার সময় balance
          থেকে টাকা কেটে রাখা হয়েছিল।
          Reject হলে সেই টাকা ফেরত যাবে।
        */

        db.prepare(
          `
          UPDATE withdrawals
          SET status='rejected'
          WHERE id=?
          `
        ).run(withdrawal.id);

        db.prepare(
          `
          UPDATE users
          SET balance=balance+?
          WHERE id=?
          `
        ).run(
          withdrawal.amount,
          withdrawal.user_id
        );
      }
    });

    tx();

    res.json({
      ok: true,
      status: action
    });
  }
);


/* =========================================================
   ADMIN SETTINGS
========================================================= */

app.get(
  "/api/admin/settings",
  adminAuth,
  (req, res) => {
    const rows = db
      .prepare(
        "SELECT key,value FROM settings"
      )
      .all();

    const settings = {};

    for (const row of rows) {
      settings[row.key] = row.value;
    }

    res.json(settings);
  }
);


app.put(
  "/api/admin/settings",
  adminAuth,
  (req, res) => {
    const supportUrl =
      String(
        req.body.telegramSupportUrl || ""
      ).trim();

    const groupUrl =
      String(
        req.body.telegramGroupUrl || ""
      ).trim();

    if (supportUrl) {
      db.prepare(
        `
        INSERT INTO settings(key,value)
        VALUES('telegramSupportUrl',?)
        ON CONFLICT(key)
        DO UPDATE SET value=excluded.value
        `
      ).run(supportUrl);
    }

    if (groupUrl) {
      db.prepare(
        `
        INSERT INTO settings(key,value)
        VALUES('telegramGroupUrl',?)
        ON CONFLICT(key)
        DO UPDATE SET value=excluded.value
        `
      ).run(groupUrl);
    }

    res.json({
      ok: true,
      message: "Settings saved"
    });
  }
);


/* =========================================================
   PUBLIC TELEGRAM SETTINGS
========================================================= */

app.get(
  "/api/settings",
  (req, res) => {
    const support = db
      .prepare(
        "SELECT value FROM settings WHERE key='telegramSupportUrl'"
      )
      .get();

    const group = db
      .prepare(
        "SELECT value FROM settings WHERE key='telegramGroupUrl'"
      )
      .get();

    res.json({
      telegramSupportUrl:
        support?.value || TELEGRAM_SUPPORT_URL,

      telegramGroupUrl:
        group?.value || TELEGRAM_GROUP_URL
    });
  }
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      name: "Work2Earn BD"
    });
  }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Work2Earn BD running on port ${PORT}`
    );
  }
);
