Work2Earn BD — Full replacement package (testing build)

এই ZIP-এ আছে:
- server.js (Express + PostgreSQL API; existing DB-তে migrations চালায়, data মুছে ফেলে না)
- index.html, app.js, style.css (worker/user panel)
- public/admin/index.html, admin.js, admin.css (admin panel)
- package.json

Upload steps (phone):
1. ZIP extract করুন।
2. GitHub repo work2earn-bd-এ একই নামের ফাইলগুলো upload করে Replace করুন:
   package.json, server.js, index.html, app.js, style.css
   public/admin/index.html, public/admin/admin.js, public/admin/admin.css
3. Folder structure ঠিক রাখবেন; admin files অবশ্যই public/admin/ এর ভিতরে যাবে।
4. Commit changes দিন এবং Render deploy শেষ হওয়া পর্যন্ত অপেক্ষা করুন।
5. Test: /health, homepage, /admin/ খুলুন।

IMPORTANT:
- Render Environment Variables (DATABASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET) পরিবর্তন/মুছবেন না। কোনো secret এখানে লিখবেন না।
- Render Postgres database delete/reset করবেন না। এই server existing tables-এ additive migrations চালায়; তবু production data থাকলে আগে database backup নিন।
- নতুন app code আগের session token-কে reject করতে পারে; একবার logout করে আবার login করতে হতে পারে।
- This is a testing build. Deposit/withdrawal approval করার আগে payment manually verify করুন। Website নিজে payment পাঠায় না।
- Current feature set: user registration/login, tasks/proof submission with screenshot, referral bonus after 20 approved tasks, withdrawal requests/history, optional deposit requests, admin dashboard, task create/close/delete, user ban/unban, proof review, withdrawal/deposit review, deposit settings.
- User-created paid jobs / escrow and platform-fee wallet are NOT implemented in this package; don't advertise those features as live.


গুরুত্বপূর্ণ: এই প্যাকেজের server.js পুরোনো PostgreSQL ডাটাবেসে প্রয়োজনীয় user columns ADD COLUMN IF NOT EXISTS দিয়ে যোগ করে। এটি users, balance বা task ডিলিট/রিসেট করে না। GitHub-এ ZIP extract করে ফাইলগুলো তাদের একই path-এ replace করুন; Render-এর DATABASE_URL/ENV পরিবর্তন বা database delete করবেন না।
