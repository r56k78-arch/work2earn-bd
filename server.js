const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const app = express();
const db = new Database("work2earn.db");
const PORT = process.env.PORT || 3000;
const TELEGRAM_SUPPORT_URL = "https://t.me/arafatxyz0";
const TELEGRAM_GROUP_URL = "https://t.me/+zlVgZjLxRjtlODM1";
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_BEFORE_DEPLOYING";

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "200kb" }));
app.use(express.static("public"));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
app.use("/api/register", authLimiter);
app.use("/api/login", authLimiter);

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
`);

function tokenFor(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({error:"Login required"}); }
}
function makeReferralCode(username) {
  return (username.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0,8) + Math.random().toString(36).slice(2,6)).slice(0,12);
}

app.post("/api/register", (req,res)=>{
  const {username,mobile,email,password,confirmPassword,referralCode} = req.body;
  if (!username || !mobile || !email || !password || !confirmPassword)
    return res.status(400).json({error:"সব তথ্য পূরণ করুন"});
  if (password !== confirmPassword) return res.status(400).json({error:"Password মিলছে না"});
  if (password.length < 8) return res.status(400).json({error:"Password কমপক্ষে 8 অক্ষরের হতে হবে"});
  const referred = referralCode ? db.prepare("SELECT id FROM users WHERE referral_code=?").get(referralCode) : null;
  try {
    const hash = bcrypt.hashSync(password, 12);
    const code = makeReferralCode(username);
    const info = db.prepare(`INSERT INTO users(username,mobile,email,password_hash,referral_code,referred_by)
      VALUES(?,?,?,?,?,?)`).run(username.trim(),mobile.trim(),email.trim().toLowerCase(),hash,code,referred?.id || null);
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid);
    res.json({token:tokenFor(user), user:{username:user.username, referralCode:user.referral_code}});
  } catch(e) {
    res.status(409).json({error:"Username, mobile বা email আগে থেকেই ব্যবহার করা হয়েছে"});
  }
});

app.post("/api/login",(req,res)=>{
  const {login,password}=req.body;
  const user = db.prepare("SELECT * FROM users WHERE username=? OR email=? OR mobile=?").get(login,login.toLowerCase(),login);
  if (!user || !bcrypt.compareSync(password,user.password_hash)) return res.status(401).json({error:"Login তথ্য সঠিক নয়"});
  res.json({token:tokenFor(user)});
});

app.get("/api/me",auth,(req,res)=>{
  const u=db.prepare("SELECT username,email,mobile,referral_code,balance,total_earned,total_withdrawn,completed_tasks FROM users WHERE id=?").get(req.user.id);
  const referrals=db.prepare("SELECT COUNT(*) n FROM users WHERE referred_by=?").get(req.user.id).n;
  res.json({...u, referrals, minWithdrawal:50});
});

app.get("/api/tasks",auth,(req,res)=>{
  res.json(db.prepare("SELECT id,title,description,reward FROM tasks WHERE active=1 ORDER BY id DESC").all());
});

app.post("/api/tasks/:id/submit",auth,(req,res)=>{
  const task=db.prepare("SELECT * FROM tasks WHERE id=? AND active=1").get(req.params.id);
  if(!task) return res.status(404).json({error:"Task পাওয়া যায়নি"});
  const existing=db.prepare("SELECT id FROM submissions WHERE user_id=? AND task_id=? AND status IN ('pending','approved')").get(req.user.id,task.id);
  if(existing) return res.status(400).json({error:"এই task আগে submit করা হয়েছে"});
  const proof=String(req.body.proof||"").trim();
  if(!proof) return res.status(400).json({error:"Proof দিন"});
  db.prepare("INSERT INTO submissions(user_id,task_id,proof) VALUES(?,?,?)").run(req.user.id,task.id,proof);
  res.json({ok:true});
});

app.post("/api/withdraw",auth,(req,res)=>{
  const {method,account,amount}=req.body;
  amount=Number(amount);
  if(!["bKash","Nagad","Binance"].includes(method)) return res.status(400).json({error:"Payment method সঠিক নয়"});
  if(!Number.isInteger(amount) || amount<50) return res.status(400).json({error:"Minimum withdrawal ৳50"});
  const u=db.prepare("SELECT balance FROM users WHERE id=?").get(req.user.id);
  if(u.balance<amount) return res.status(400).json({error:"পর্যাপ্ত balance নেই"});
  const tx=db.transaction(()=>{
    db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(amount,req.user.id);
    db.prepare("INSERT INTO withdrawals(user_id,method,account,amount) VALUES(?,?,?,?)").run(req.user.id,method,account.trim(),amount);
  });
  tx();
  res.json({ok:true,message:"Withdrawal request submitted"});
});

app.get("/api/health",(req,res)=>res.json({ok:true,name:"Work2Earn BD"}));

app.listen(PORT,()=>console.log(`Work2Earn BD running on http://localhost:${PORT}`));
