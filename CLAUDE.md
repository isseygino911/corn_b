# corn_b

Express + MySQL auth and catalog backend for `../corn`. Plain JS, ESM, Node 22. Contracts: `docs/plans/auth.md`, `docs/plans/panels.md`.

- First time: `scripts/setup-db.sh` (prompts for MySQL root password), then put the printed `DB_USER`/`DB_PASSWORD` in `.env` (copy `.env.example`).
- Run: `npm run dev` (port 3001). Migrate: `npm run migrate`. Admin: `npm run make-admin <email>`.
- Test: `npm test` (uses the `${DB_NAME}_test` database; needs `.env`).
- Images: `S3_*` and `AWS_*` values go in `.env`. The bucket stays private and needs a CORS rule allowing `PUT` from `APP_URL`; image reads are signed links from `services/storage.js` (`signedReadUrl`). `services/storage.js` is the only S3 file and is stubbed under `NODE_ENV=test`.
