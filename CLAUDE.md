# corn_b

Express + MySQL auth backend for `../corn`. Plain JS, ESM, Node 22. Contract: `docs/plans/auth.md`.

- First time: `scripts/setup-db.sh` (prompts for MySQL root password), then put the printed `DB_USER`/`DB_PASSWORD` in `.env` (copy `.env.example`).
- Run: `npm run dev` (port 3001). Migrate: `npm run migrate`. Admin: `npm run make-admin <email>`.
- Test: `npm test` (uses the `${DB_NAME}_test` database; needs `.env`).
