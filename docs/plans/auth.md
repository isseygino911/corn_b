# Slice 1 — Auth (signup, login, Google, verify, reset)

Backend `corn_b` (this folder) + auth UI in `../corn`. Agreed with the owner; do not widen scope.
Out of scope: products, accessories, admin product routes, image upload, orders, payments.

## Rules
- Plain JavaScript, ESM, Node 22. No TypeScript.
- Dependencies, total, approved: `express`, `mysql2`, `nodemailer` (corn_b); `react-router` (corn).
  Nothing else. scrypt = `node:crypto`, tests = `node:test`, env = `node --env-file`.
- DRY, no dead code, no speculative abstraction. Reference only: `../simple_ecom/server/src`
  (HttpError/asyncHandler, requireUser/requireAdmin, errorHandler, mailer). Do not copy its JWT approach.
- Never `git commit`/`git push`. Never commit `.env`. No real secrets anywhere.
- MySQL: `/usr/local/mysql/bin/mysql` (9.4, running, not on PATH). Env var `MYSQL_BIN` overrides.
  The owner creates `.env`; teammates may NOT guess or read the root password.

## File ownership (one owner per file)
| Owner | Files |
|---|---|
| `auth-tester` | `corn_b/tests/**` only |
| `backend-builder` | everything else in `corn_b/` except `tests/` and `docs/`: `package.json`, `.gitignore`, `.env.example`, `CLAUDE.md`, `migrations/`, `scripts/`, `src/`, `deploy/` |
| `frontend-builder` | `corn/` only: auth UI, router, `Nav.jsx`, `main.jsx`/`App.jsx`, `vite.config.js` (proxy), `package.json` (+`react-router`), new `src/auth/**` |
| lead | `corn_b/docs/**` |

## Environment (`.env.example`, backend-builder writes it)
`PORT=3001`, `APP_URL=http://localhost:5173`, `NODE_ENV`,
`DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_USER=corn_b`, `DB_PASSWORD=`, `DB_NAME=corn_b`,
`SMTP_HOST` (Titan), `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=http://localhost:5173/api/auth/google/callback`,
`RATE_LIMIT_MAX=10`.
Mail is sent from `SMTP_USER` with display name "Glass Gem Farm" (mirror `simple_ecom` mailer).
Under `NODE_ENV=test`: db.js uses `${DB_NAME}_test`; mailer records mail in an exported `outbox` array
instead of using SMTP.

## Data (migration `migrations/001_auth.sql`; a `schema_migrations` table tracks applied files)
- `users`: `id` PK, `email` UNIQUE (stored lowercased/trimmed), `name`, `password_hash` NULL, `google_id` UNIQUE NULL,
  `email_verified` BOOL default 0, `is_admin` BOOL default 0, `created_at`.
- `sessions`: `id` PK, `user_id` FK ON DELETE CASCADE, `token_hash` CHAR(64) UNIQUE (sha256 hex), `expires_at`, `created_at`.
- `auth_tokens`: `id` PK, `user_id` FK CASCADE, `type` ENUM('verify','reset'), `token_hash` CHAR(64) UNIQUE,
  `expires_at`, `used_at` NULL.
Tokens: 32 random bytes base64url; only the sha256 hex is stored. Verify tokens last 24 h, reset tokens 1 h,
single use. Issuing a new token of a type invalidates the user's earlier unused ones of that type.

## Session
Cookie `session`: httpOnly, SameSite=Lax, Secure when `NODE_ENV=production`, Path=/, Max-Age 86400 (24 h, fixed, not sliding).
Value = random token; DB holds its hash. Logout deletes the row. Expired rows are ignored (and may be deleted lazily).
Cookies parsed by hand (no cookie-parser). Passwords hashed with `crypto.scrypt` + random salt, compared with `timingSafeEqual`.

## API (`/api/auth`, JSON in/out, errors are `{ "error": "message" }` plus optional `code`)
User shape everywhere: `{ id, email, name, isAdmin }`.
Validation: email must look like an email; password 8–128 chars (no composition rules); name 1–80 chars. 400 on invalid.

| Endpoint | Auth | Body | Success | Failures |
|---|---|---|---|---|
| `POST /signup` | – | `email,password,name` | 201 `{message}`; creates unverified user, sends verify email | 400; 409 email exists |
| `POST /verify-email` | – | `token` | 200 `{message}`; sets `email_verified` | 400 invalid/expired/used token |
| `POST /resend-verification` | – | `email` | 200 `{message}` always (no enumeration); sends mail only if user exists and is unverified | 400 invalid email |
| `POST /login` | – | `email,password` | 200 `{user}` + session cookie | 401 bad credentials (also Google-only account without password; same message); 403 `code:"email_not_verified"` |
| `POST /logout` | – | – | 200 `{message}`, clears cookie, deletes session (idempotent) | – |
| `GET /me` | session | – | 200 `{user}` | 401 |
| `POST /forgot-password` | – | `email` | 200 `{message}` always; sends reset mail if user exists | 400 invalid email |
| `POST /reset-password` | – | `token,password` | 200 `{message}`; sets password, marks email verified, deletes ALL the user's sessions | 400 bad token/password |
| `POST /change-password` | session | `currentPassword,newPassword` | 200 `{message}`; deletes the user's OTHER sessions | 401; 400 wrong current password / user has no password / invalid new |
| `GET /google` | – | – | 302 to Google (PKCE S256 + `state`; short-lived httpOnly cookie `g_oauth` holds state+verifier, 10 min) | – |
| `GET /google/callback` | – | `code,state` | verifies state, exchanges code at Google's token endpoint with global `fetch`, checks id_token `aud`/`iss`/`exp` and `email_verified`; creates user (verified, null password) or links to the existing same-email user; creates session; 302 to `${APP_URL}/` | any failure: 302 to `${APP_URL}/login?error=google` (`google_unverified` if Google says email not verified) |

Rules: Google sign-in never sets `is_admin`; no endpoint can set `is_admin` (only `npm run make-admin <email>`).
Login for a password account is refused until `email_verified`. Email links: `${APP_URL}/verify-email?token=…`,
`${APP_URL}/reset-password?token=…`.
Rate limit (in-memory, hand-written): `POST /signup, /login, /forgot-password, /resend-verification` allow
`RATE_LIMIT_MAX` requests per 15 min per IP, and `/login` additionally the same per email. Over limit → 429
`{error}` with `Retry-After`. `trust proxy` = 1 in production.
`GET /api/health` → 200 `{ok:true}`.

## Backend structure (mirror simple_ecom)
`src/index.js` (listen) · `src/app.js` exports `createApp()` (tests call it and `listen(0)`) · `src/db.js` ·
`src/lib/{http,session,tokens,password}.js` · `src/middleware/{requireUser,requireAdmin,errorHandler,rateLimit}.js` ·
`src/routes/auth.js` · `src/controllers/auth.js` · `src/services/{auth,mailer,google}.js`.
`requireAdmin` is built now (used by later slices) and must be exercised by a test route-less unit test, not left untested.
`scripts/migrate.js`, `scripts/setup-db.sh` (prompts for the MySQL root password, creates DBs `corn_b` and `corn_b_test`
and a `corn_b` user limited to them, then runs migrations), `scripts/make-admin.js <email>`.
`npm run` scripts: `start`, `dev` (`node --watch`), `migrate`, `make-admin`, `test`
(`NODE_ENV=test node --env-file=.env --test --test-concurrency=1 tests/`).
`deploy/Caddyfile` + `deploy/ecosystem.config.cjs`: examples only, placeholder domain, `/api/*` → :3001, rest → built `corn/dist`.

## Tests (auth-tester writes first, from this contract; backend-builder runs them)
Use `node:test` and global `fetch` against `createApp().listen(0)`; truncate tables in `beforeEach` via a shared
`tests/helpers.js`; read verification/reset tokens from `outbox`; stub `globalThis.fetch` for Google's token endpoint.
Cover: signup (ok, dup, invalid), verify (ok, expired, reused), login (ok, unverified 403, wrong password, Google-only
account), cookie flags and 24 h Max-Age, session expiry, logout, me, forgot/reset (sessions revoked, token single-use,
no enumeration), change-password (other sessions revoked, current session kept), Google (new user, link, unverified
email, bad state), rate limit (separate file, sets `RATE_LIMIT_MAX=3`), `is_admin` can never be set via any endpoint,
`requireAdmin` (403 for normal user, pass for admin). Tests that cannot pass against the contract are reported to the
lead, not silently changed.

## Frontend (frontend-builder; `corn/`, edited in place — uncommitted, dev server on :5173 already running)
- Add `react-router`; landing stays at `/`; its nav `#anchor` links become `/#anchor`. The landing's GSAP/ScrollTrigger/Lenis
  setup must clean up fully on route change and re-init on return (no leaked triggers, no scroll lock).
- Routes: `/` landing · `/login` · `/signup` · `/forgot-password` · `/reset-password?token` · `/verify-email?token` ·
  `/account` (change password, sign out; redirects to `/login` when signed out).
- `src/auth/` holds an `AuthProvider` (calls `GET /api/auth/me` on load), an `api` helper (same-origin fetch, JSON,
  throws `{error, code}`), and the pages. Login shows the `email_not_verified` state with a "resend" action;
  the `/login?error=google` query is shown as an error message. "Continue with Google" is a plain link to `/api/auth/google`.
- Nav: "Sign in" pill when signed out; user name + "Sign out"/"Account" when signed in. Styled with the page tokens
  (bone / rose / ink / gold, Geist + Geist Mono), mobile-safe at 390 px. No new dependencies beyond `react-router`.
- `vite.config.js`: proxy `/api` → `http://localhost:3001`.
- Respect `prefers-reduced-motion`. `npm run build` must pass warning-free.

## Verification (after build)
`npm test` green in corn_b → `verify-app` in a real browser (signup → read verify link from the dev outbox/log → login → account →
logout; forgot/reset; Google button redirect; landing page still scrolls correctly after navigating away and back; 390 px) →
`code-review`. No commit.

## Open items for the owner (not blockers for building)
- Create `corn_b/.env` (DB user/password after `setup-db.sh`, Titan SMTP, Google client ID/secret).
- Google Cloud OAuth client with redirect URI `http://localhost:5173/api/auth/google/callback`.
- Production domain, sender mailbox.
