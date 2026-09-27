# Work2Earn BD — Starter

This is a starter full-stack project for the Worker website.

## Included
- BDT (৳) balance
- Minimum withdrawal ৳50
- Username, mobile, email, password + optional referral code
- Referral tracking
- 20-task referral milestone is defined as a product rule to implement in the admin/reward service
- bKash, Nagad and Binance withdrawal choices
- Task list and proof submission
- Dark mode by default

## Run locally
1. Install Node.js 20+.
2. In this folder run: `npm install`
3. Set a strong environment variable:
   - Linux/macOS: `JWT_SECRET="a-long-random-secret" npm start`
   - Windows PowerShell: `$env:JWT_SECRET="a-long-random-secret"; npm start`
4. Open http://localhost:3000

## Important
This is a starter, not a production payment platform. Before real money is used, add:
- a real admin authentication system with separate admin roles
- CSRF/session hardening as appropriate
- email/OTP verification and password reset
- server-side task proof validation/review
- immutable transaction ledger
- withdrawal idempotency and fraud/risk controls
- referral anti-abuse checks and automatic milestone logic
- secure file storage for proof images
- HTTPS, backups, monitoring and secrets management
- real bKash/Nagad/Binance integration only after checking their current terms/API requirements

Never put API keys, payment secrets, or the JWT secret in frontend JavaScript.
