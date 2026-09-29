const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_BEFORE_DEPLOYING";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";

if (!DATABASE_URL) console.warn("DATABASE_URL is not set.");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : undefined,
});

const query = (text, params) => pool.query(text, params);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

function signUser(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "30d" });
}

function auth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) return res.status(401).json({ error: "Login required" });
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired login" });
  }
}

function adminAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) return res.status(401).json({ error: "Admin login required" });
    const p = jwt.verify(h.slice(7), JWT_SECRET);
    if (p.role !== "admin") return res.status(403).json({ error: "Admin access required" });
    req.admin = p;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid admin login" });
  }
}

async function initDb() {
  await query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    mobile TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    referral_code TEXT UNIQUE NOT NULL,
    referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    deposit_balance INTEGER NOT NULL DEFAULT 0,
    total_earned INTEGER NOT NULL DEFAULT 0,
    total_deposited INTEGER NOT NULL DEFAULT 0,
    total_withdrawn INTEGER NOT NULL DEFAULT 0,
    referrals INTEGER NOT NULL DEFAULT 0,
    completed_tasks INTEGER NOT NULL DEFAULT 0,
    banned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    reward INTEGER NOT NULL,
    max_participants INTEGER NOT NULL DEFAULT 2,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proof TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    UNIQUE(task_id, user_id)
  )`);

  await query(`CREATE TABLE IF NOT EXISTS withdrawals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    account TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
  )`);

  await query(`CREATE TABLE IF NOT EXISTS deposit_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    account TEXT NOT NULL,
    amount INTEGER NOT NULL,
    transaction_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
  )`);

  await query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deposit_balance INTEGER NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_deposited INTEGER NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS max_participants INTEGER NOT NULL DEFAULT 2`);
  await query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
  await query(`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
  await query(`ALTER TABLE deposit_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
  await query(`UPDATE tasks SET max_participants=2 WHERE max_participants IS NULL OR max_participants < 2`);

  const defaults = {
    telegram: "",
    depositEnabled: "false",
    depositMinAmount: "50",
    depositBkashEnabled: "true",
    depositBkashNumber: "",
    depositNagadEnabled: "true",
    depositNagadNumber: "",
    depositBinanceEnabled: "false",
    depositBinanceAccount: "",
    depositInstructions: "Payment করার পর Transaction ID দিয়ে Verify করুন।",
  };
  for (const [k, v] of Object.entries(defaults)) {
    await query(`INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`, [k, v]);
  }
}

function cleanUser(u) {
  return {
    id: u.id, username: u.username, mobile: u.mobile, email: u.email,
    referral_code: u.referral_code, balance: u.balance, deposit_balance: u.deposit_balance,
    total_earned: u.total_earned, total_deposited: u.total_deposited,
    total_withdrawn: u.total_withdrawn, referrals: u.referrals,
    completed_tasks: u.completed_tasks, banned: u.banned, created_at: u.created_at,
  };
}

app.post("/api/register", async (req, res) => {
  try {
    const { username, mobile, email, password, confirmPassword, referralCode } = req.body;
    if (!username || !mobile || !email || !password || !confirmPassword) return res.status(400).json({ error: "সব তথ্য দিন" });
    if (password !== confirmPassword) return res.status(400).json({ error: "Password মিলছে না" });
    if (password.length < 6) return res.status(400).json({ error: "Password কমপক্ষে 6 অক্ষরের হতে হবে" });
    const exists = await query(`SELECT id FROM users WHERE username=$1 OR mobile=$2 OR email=$3`, [username.trim(), mobile.trim(), email.trim().toLowerCase()]);
    if (exists.rowCount) return res.status(400).json({ error: "Username, mobile বা email আগে ব্যবহার হয়েছে" });

    let referredBy = null;
    if (referralCode) {
      const r = await query(`SELECT id FROM users WHERE referral_code=$1`, [referralCode.trim()]);
      if (r.rowCount) referredBy = r.rows[0].id;
    }
    const hash = await bcrypt.hash(password, 10);
    const code = "W2E" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const ins = await query(`INSERT INTO users(username,mobile,email,password_hash,referral_code,referred_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [username.trim(), mobile.trim(), email.trim().toLowerCase(), hash, code, referredBy]);
    if (referredBy) await query(`UPDATE users SET referrals=referrals+1 WHERE id=$1`, [referredBy]);
    const u = ins.rows[0];
    res.json({ token: signUser(u), user: cleanUser(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Registration failed" }); }
});

app.post("/api/login", async (req, res) => {
  try {
    const { login, password } = req.body;
    const r = await query(`SELECT * FROM users WHERE username=$1 OR email=$1 OR mobile=$1 LIMIT 1`, [String(login || "").trim()]);
    if (!r.rowCount || !(await bcrypt.compare(password || "", r.rows[0].password_hash))) return res.status(401).json({ error: "Login তথ্য সঠিক নয়" });
    if (r.rows[0].banned) return res.status(403).json({ error: "এই account banned" });
    res.json({ token: signUser(r.rows[0]), user: cleanUser(r.rows[0]) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Login failed" }); }
});

app.get("/api/me", auth, async (req, res) => {
  try { const r = await query(`SELECT * FROM users WHERE id=$1`, [req.user.id]); if (!r.rowCount) return res.status(404).json({ error: "User not found" }); res.json(cleanUser(r.rows[0])); }
  catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.get("/api/tasks", auth, async (req, res) => {
  try {
    const r = await query(`SELECT t.*, COUNT(s.id) FILTER (WHERE s.status IN ('pending','approved'))::int AS participants FROM tasks t LEFT JOIN submissions s ON s.task_id=t.id WHERE t.active=TRUE GROUP BY t.id ORDER BY t.created_at DESC`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: "Tasks load failed" }); }
});

app.post("/api/tasks/:id/submit", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id), proof = String(req.body.proof || "").trim();
    if (!Number.isInteger(id) || !proof) return res.status(400).json({ error: "Task ID বা proof সঠিক নয়" });
    await client.query("BEGIN");
    const t = await client.query(`SELECT * FROM tasks WHERE id=$1 AND active=TRUE FOR UPDATE`, [id]);
    if (!t.rowCount) throw new Error("Task আর active নেই");
    const count = await client.query(`SELECT COUNT(*)::int AS n FROM submissions WHERE task_id=$1 AND status IN ('pending','approved')`, [id]);
    if (count.rows[0].n >= t.rows[0].max_participants) throw new Error("এই task-এর সব slot পূর্ণ");
    const dup = await client.query(`SELECT id FROM submissions WHERE task_id=$1 AND user_id=$2`, [id, req.user.id]);
    if (dup.rowCount) throw new Error("এই task আগে submit করা হয়েছে");
    await client.query(`INSERT INTO submissions(task_id,user_id,proof) VALUES($1,$2,$3)`, [id, req.user.id, proof]);
    const n = count.rows[0].n + 1;
    if (n >= t.rows[0].max_participants) await client.query(`UPDATE tasks SET active=FALSE WHERE id=$1`, [id]);
    await client.query("COMMIT"); res.json({ ok: true, message: "Proof submitted" });
  } catch (e) { await client.query("ROLLBACK"); res.status(400).json({ error: e.message || "Submit failed" }); }
  finally { client.release(); }
});

app.get("/api/withdrawals", auth, async (req, res) => {
  try { const r = await query(`SELECT id,method,account,amount,status,rejection_reason,created_at,reviewed_at FROM withdrawals WHERE user_id=$1 ORDER BY id DESC`, [req.user.id]); res.json(r.rows); }
  catch (e) { res.status(500).json({ error: "History load failed" }); }
});

app.post("/api/withdraw", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { method, account, amount } = req.body; const a = Number(amount);
    if (!method || !account || !Number.isInteger(a) || a < 50) return res.status(400).json({ error: "Minimum withdrawal ৳50" });
    await client.query("BEGIN");
    const u = await client.query(`SELECT balance FROM users WHERE id=$1 FOR UPDATE`, [req.user.id]);
    if (!u.rowCount || u.rows[0].balance < a) throw new Error("Earned balance যথেষ্ট নেই");
    await client.query(`UPDATE users SET balance=balance-$1,total_withdrawn=total_withdrawn+$1 WHERE id=$2`, [a, req.user.id]);
    await client.query(`INSERT INTO withdrawals(user_id,method,account,amount) VALUES($1,$2,$3,$4)`, [req.user.id, method, account, a]);
    await client.query("COMMIT"); res.json({ ok: true });
  } catch (e) { await client.query("ROLLBACK"); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

app.get("/api/deposit/settings", auth, async (req, res) => {
  const r = await query(`SELECT key,value FROM settings WHERE key LIKE 'deposit%'`); const o={}; r.rows.forEach(x=>o[x.key]=x.value); res.json(o);
});
app.post("/api/deposit", auth, async (req,res)=>{
  try {
    const {method,account,amount,transactionId}=req.body; const a=Number(amount);
    const s=await query(`SELECT key,value FROM settings WHERE key LIKE 'deposit%'`); const o={}; s.rows.forEach(x=>o[x.key]=x.value);
    if(o.depositEnabled!=="true") return res.status(400).json({error:"Deposit বর্তমানে বন্ধ"});
    if(!Number.isInteger(a)||a<Number(o.depositMinAmount||50)) return res.status(400).json({error:`Minimum deposit ৳${o.depositMinAmount||50}`});
    if(!method||!account||!transactionId) return res.status(400).json({error:"সব তথ্য দিন"});
    await query(`INSERT INTO deposit_requests(user_id,method,account,amount,transaction_id) VALUES($1,$2,$3,$4,$5)`,[req.user.id,method,account,a,String(transactionId).trim()]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"Deposit request failed"});}
});
app.get("/api/deposit/history", auth, async(req,res)=>{try{const r=await query(`SELECT id,method,account,amount,transaction_id,status,rejection_reason,created_at,reviewed_at FROM deposit_requests WHERE user_id=$1 ORDER BY id DESC`,[req.user.id]);res.json(r.rows)}catch(e){res.status(500).json({error:"History failed"})}});

app.post("/api/admin/login", async (req,res)=>{
  const {username,password}=req.body;
  if(username!==ADMIN_USERNAME || password!==ADMIN_PASSWORD) return res.status(401).json({error:"Admin username/password ভুল"});
  res.json({token:jwt.sign({role:"admin",username},JWT_SECRET,{expiresIn:"7d"})});
});

app.get("/api/admin/stats", adminAuth, async(req,res)=>{
  try { const [u,t,p,w,d]=await Promise.all([
    query(`SELECT COUNT(*)::int n FROM users`),query(`SELECT COUNT(*)::int n FROM tasks WHERE active=TRUE`),query(`SELECT COUNT(*)::int n FROM submissions WHERE status='pending'`),query(`SELECT COUNT(*)::int n FROM withdrawals WHERE status='pending'`),query(`SELECT COUNT(*)::int n FROM deposit_requests WHERE status='pending'`)
  ]); res.json({users:u.rows[0].n,tasks:t.rows[0].n,proofs:p.rows[0].n,withdrawals:w.rows[0].n,deposits:d.rows[0].n}); }
  catch(e){res.status(500).json({error:"Stats failed"})}
});

app.get("/api/admin/users", adminAuth, async(req,res)=>{try{const r=await query(`SELECT id,username,mobile,email,balance,deposit_balance,total_earned,total_deposited,total_withdrawn,referrals,completed_tasks,banned,created_at FROM users ORDER BY id DESC`);res.json(r.rows)}catch(e){res.status(500).json({error:"Users failed"})}});
app.post("/api/admin/users/:id/ban", adminAuth, async(req,res)=>{try{const id=Number(req.params.id);const banned=req.body.banned!==false;await query(`UPDATE users SET banned=$1 WHERE id=$2`,[banned,id]);res.json({ok:true})}catch(e){res.status(500).json({error:"User update failed"})}});

app.get("/api/admin/tasks", adminAuth, async(req,res)=>{try{const r=await query(`SELECT t.*,COUNT(s.id) FILTER(WHERE s.status IN ('pending','approved'))::int participants FROM tasks t LEFT JOIN submissions s ON s.task_id=t.id GROUP BY t.id ORDER BY t.id DESC`);res.json(r.rows)}catch(e){res.status(500).json({error:"Tasks failed"})}});
app.post("/api/admin/tasks", adminAuth, async(req,res)=>{try{const {title,description,reward,maxParticipants}=req.body;const rw=Number(reward),mp=Number(maxParticipants||2);if(!title||!description||!Number.isInteger(rw)||rw<1||!Number.isInteger(mp)||mp<2)return res.status(400).json({error:"Task তথ্য সঠিক নয়"});const r=await query(`INSERT INTO tasks(title,description,reward,max_participants) VALUES($1,$2,$3,$4) RETURNING *`,[title,description,rw,mp]);res.json(r.rows[0])}catch(e){res.status(500).json({error:"Task create failed"})}});
app.delete("/api/admin/tasks/:id", adminAuth, async(req,res)=>{try{const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"Task ID সঠিক নয়"});const r=await query(`SELECT id,active FROM tasks WHERE id=$1`,[id]);if(!r.rowCount)return res.status(404).json({error:"Task পাওয়া যায়নি"});if(!r.rows[0].active)return res.status(400).json({error:"Task ইতিমধ্যে deleted"});await query(`UPDATE tasks SET active=FALSE WHERE id=$1`,[id]);res.json({ok:true,message:"Task deleted successfully"})}catch(e){console.error(e);res.status(500).json({error:"Task delete করা যায়নি"})}});

app.get("/api/admin/proofs", adminAuth, async(req,res)=>{try{const r=await query(`SELECT s.*,t.title,t.reward,u.username,u.email FROM submissions s JOIN tasks t ON t.id=s.task_id JOIN users u ON u.id=s.user_id ORDER BY s.id DESC`);res.json(r.rows)}catch(e){res.status(500).json({error:"Proofs failed"})}});
app.post("/api/admin/proofs/:id/approve", adminAuth, async(req,res)=>{
  const c=await pool.connect();
  try{await c.query("BEGIN");const s=await c.query(`SELECT s.*,t.reward,t.max_participants,t.active FROM submissions s JOIN tasks t ON t.id=s.task_id WHERE s.id=$1 FOR UPDATE`,[Number(req.params.id)]);if(!s.rowCount)throw new Error("Proof পাওয়া যায়নি");if(s.rows[0].status!=="pending")throw new Error("Already reviewed");const x=s.rows[0];const n=await c.query(`SELECT COUNT(*)::int n FROM submissions WHERE task_id=$1 AND status='approved'`,[x.task_id]);if(n.rows[0].n>=x.max_participants)throw new Error("Task participant limit পূর্ণ");await c.query(`UPDATE submissions SET status='approved',reviewed_at=NOW() WHERE id=$1`,[x.id]);await c.query(`UPDATE users SET balance=balance+$1,total_earned=total_earned+$1,completed_tasks=completed_tasks+1 WHERE id=$2`,[x.reward,x.user_id]);const u=await c.query(`SELECT referred_by,completed_tasks FROM users WHERE id=$1`,[x.user_id]);if(u.rows[0].referred_by && u.rows[0].completed_tasks===20)await c.query(`UPDATE users SET balance=balance+20,total_earned=total_earned+20 WHERE id=$1`,[u.rows[0].referred_by]);if(n.rows[0].n+1>=x.max_participants)await c.query(`UPDATE tasks SET active=FALSE WHERE id=$1`,[x.task_id]);await c.query("COMMIT");res.json({ok:true})}catch(e){await c.query("ROLLBACK");res.status(400).json({error:e.message})}finally{c.release()}
});
app.post("/api/admin/proofs/:id/reject", adminAuth, async(req,res)=>{try{const r=await query(`UPDATE submissions SET status='rejected',rejection_reason=$1,reviewed_at=NOW() WHERE id=$2 AND status='pending' RETURNING id`,[String(req.body.reason||"Rejected"),Number(req.params.id)]);if(!r.rowCount)return res.status(400).json({error:"Proof পাওয়া যায়নি বা already reviewed"});res.json({ok:true})}catch(e){res.status(500).json({error:"Reject failed"})}});

app.get("/api/admin/withdrawals", adminAuth, async(req,res)=>{try{const r=await query(`SELECT w.*,u.username,u.email FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC`);res.json(r.rows)}catch(e){res.status(500).json({error:"Withdrawals failed"})}});
app.post("/api/admin/withdrawals/:id/approve", adminAuth, async(req,res)=>{try{const r=await query(`UPDATE withdrawals SET status='approved',reviewed_at=NOW() WHERE id=$1 AND status='pending' RETURNING id`,[Number(req.params.id)]);if(!r.rowCount)return res.status(400).json({error:"Withdrawal পাওয়া যায়নি"});res.json({ok:true})}catch(e){res.status(500).json({error:"Approve failed"})}});
app.post("/api/admin/withdrawals/:id/reject", adminAuth, async(req,res)=>{const c=await pool.connect();try{await c.query("BEGIN");const r=await c.query(`SELECT * FROM withdrawals WHERE id=$1 AND status='pending' FOR UPDATE`,[Number(req.params.id)]);if(!r.rowCount)throw new Error("Withdrawal পাওয়া যায়নি");const w=r.rows[0];await c.query(`UPDATE users SET balance=balance+$1,total_withdrawn=GREATEST(0,total_withdrawn-$1) WHERE id=$2`,[w.amount,w.user_id]);await c.query(`UPDATE withdrawals SET status='rejected',rejection_reason=$1,reviewed_at=NOW() WHERE id=$2`,[String(req.body.reason||"Rejected"),w.id]);await c.query("COMMIT");res.json({ok:true})}catch(e){await c.query("ROLLBACK");res.status(400).json({error:e.message})}finally{c.release()}});

app.get("/api/admin/deposits", adminAuth, async(req,res)=>{try{const r=await query(`SELECT d.*,u.username,u.email FROM deposit_requests d JOIN users u ON u.id=d.user_id ORDER BY d.id DESC`);res.json(r.rows)}catch(e){res.status(500).json({error:"Deposits failed"})}});
app.post("/api/admin/deposits/:id/approve", adminAuth, async(req,res)=>{const c=await pool.connect();try{await c.query("BEGIN");const r=await c.query(`SELECT * FROM deposit_requests WHERE id=$1 AND status='pending' FOR UPDATE`,[Number(req.params.id)]);if(!r.rowCount)throw new Error("Deposit request পাওয়া যায়নি");const d=r.rows[0];await c.query(`UPDATE users SET deposit_balance=deposit_balance+$1,total_deposited=total_deposited+$1 WHERE id=$2`,[d.amount,d.user_id]);await c.query(`UPDATE deposit_requests SET status='approved',reviewed_at=NOW() WHERE id=$1`,[d.id]);await c.query("COMMIT");res.json({ok:true})}catch(e){await c.query("ROLLBACK");res.status(400).json({error:e.message})}finally{c.release()}});
app.post("/api/admin/deposits/:id/reject", adminAuth, async(req,res)=>{try{const r=await query(`UPDATE deposit_requests SET status='rejected',rejection_reason=$1,reviewed_at=NOW() WHERE id=$2 AND status='pending' RETURNING id`,[String(req.body.reason||"Rejected"),Number(req.params.id)]);if(!r.rowCount)return res.status(400).json({error:"Deposit request পাওয়া যায়নি"});res.json({ok:true})}catch(e){res.status(500).json({error:"Reject failed"})}});

app.get("/api/admin/settings", adminAuth, async(req,res)=>{const r=await query(`SELECT key,value FROM settings ORDER BY key`);const o={};r.rows.forEach(x=>o[x.key]=x.value);res.json(o)});
app.post("/api/admin/settings", adminAuth, async(req,res)=>{try{for(const [k,v] of Object.entries(req.body||{}))await query(`INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[k,String(v)]);res.json({ok:true})}catch(e){res.status(500).json({error:"Settings save failed"})}});
app.get("/api/settings", async(req,res)=>{try{const r=await query(`SELECT key,value FROM settings`);const o={};r.rows.forEach(x=>o[x.key]=x.value);res.json(o)}catch(e){res.status(500).json({error:"Settings failed"})}});
app.get("/health", async(req,res)=>{try{await query("SELECT 1");res.json({ok:true,db:true})}catch(e){res.status(500).json({ok:false,db:false})}});

// IMPORTANT: serve the Admin Panel from /public/admin
app.use("/admin", express.static(path.join(__dirname, "public/admin")));
app.use(express.static("."));

async function startServer(){
  try{await initDb();app.listen(PORT,()=>console.log(`Work2Earn BD running on port ${PORT}`));}
  catch(e){console.error("Startup failed:",e);process.exit(1)}
}
startServer();
