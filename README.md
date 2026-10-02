# Pocket

A mobile-first todo app with a direct task list, quick review cards, notes, and
accessible display settings. Neon Auth and Postgres power account sign-in and
cloud sync. Offline work stays in browser storage.

## Local setup

```sh
npm install
neon login
neon link --project-id raspy-thunder-70940103 --branch production -y
neon env pull
npm run db:migrate
npm run dev
```

The current directory is linked to the `Pocket todo` project. `.neon` and
`.env.local` are gitignored. Env pull supplies `DATABASE_URL`,
`DATABASE_URL_UNPOOLED`, and `NEON_AUTH_BASE_URL`. Add a separate
`NEON_AUTH_COOKIE_SECRET` to `.env.local` using `openssl rand -base64 32`.
An example is provided in `.env.example`; never put these credentials in
`NEXT_PUBLIC_` variables. The cookie secret has already been generated locally.

Open http://localhost:3000. Signed-out visitors see the landing page; choose
**Get started** or **I already have an account** to open `/login`. Request an email code and
enter the six digits to sign in or create your Neon account. The same-origin
`/api/auth/*` routes use Neon's Next.js SDK and HTTP-only session cookies.
Localhost sign-in is enabled on this branch. Register your deployed origin with
`neon neon-auth domain add https://your-app.example` before production use.

The app uses TypeScript, Tailwind CSS v4, and a shadcn-compatible
`components.json`. UI components live in `src/components/ui` because the
`@/*` alias points to `src/*`. Add more with `npx shadcn@latest add <component>`.
The supplied hover-stack interaction is adapted for the task review cards there.

## User flow

- **Tasks** shows every new task immediately. Due today appears in Today;
  future and past due tasks appear in Later. Past due tasks retain their date
  and show an Overdue badge. Undated tasks appear under No date.
- The **plus** button opens the task form as a popup on desktop and mobile.
  A title is enough. Save closes the popup and the task appears in Tasks.
- **Cards** provides a quick pass through unfinished tasks. Choose Done,
  Tomorrow, or Skip. Tomorrow moves the due date forward and keeps the task in
  Later. On desktop cards spread on hover; on touch screens they form a deck.
- **Notes** holds ideas that are not tasks, **Activity** shows the log, and
  **Settings** holds preferences. The help button opens the built-in guide.
  **Log out** returns to the landing page.

Task creation records its time automatically. Due date and time are optional;
when supplied, each task can choose a reminder at the deadline or 5, 10, 15,
30, or 60 minutes before. The current reminder loop runs while Pocket is open.
Browser notifications additionally require permission in Settings.

## Database and sync

`neon/schema.sql` defines the private `pocket.records` table. Apply it with
`npm run db:migrate`; migrations use the direct database connection. Test it
on an isolated branch with:

```sh
neon branches create --name pocket-migration-check --parent production
npm run db:migrate -- --branch pocket-migration-check --verify
neon branches delete pocket-migration-check
```

The authenticated `/api/sync` handler gets the owner from Neon Auth, validates
requests, and queries only that owner's composite keys. Database credentials
stay on the server. Tasks, checklists, notes, areas, activity history, and
settings sync atomically. Task and note timestamps resolve concurrent edits;
other records use version checks. Deletions retain tombstones so stale devices
cannot restore erased records. A deliberate undo based on the current version
can restore an item. Edits made while syncing stay in the local working set
and sync on the next round. Unchanged records are not rewritten.

Each account has a separate offline cache. The first Neon account on this
browser adopts the previous local working set, preserving an untouched backup
under `smallsteps.tasks.v2:pre-neon-backup` (the exact prefix is `STORAGE_KEY` in
`src/lib/defaults.ts`). Other accounts do not inherit it. Signing out returns
to the landing page; account data remains available after signing back in.
Existing old-provider sessions do not carry over: sign in again with Neon.
If you have records saved only in an old cloud account, export and import them
using Pocket's Settings before discarding that account.

Reminder plans persist with tasks, but delivery, browser notification permission,
and active countdown timers run on the device. Email/Telegram reminder delivery
and support-person sharing are not implemented by this migration.

## Neon configuration

`neon.ts` declares Auth, the private `pocket` bucket, and the sample `api`
function (`hello.ts`). AI Gateway is disabled. `neon config plan` previews
infrastructure changes; `neon deploy` applies them. The sample Function returns
`Hello from Neon Functions`; todo sync runs in the Next.js app's protected
route handlers. The bucket is provisioned for future attachments.

Deploy the Next.js app to your app host with `DATABASE_URL`,
`NEON_AUTH_BASE_URL`, and `NEON_AUTH_COOKIE_SECRET` set on the server, and
register that app's origin with Neon Auth. Neon Functions do not deploy this UI.
Set `GOOGLE_API_KEY` only if enabling the optional assistant/transcription API.

## Verification and troubleshooting

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
```

- Sign-in unavailable on `/login`: check `NEON_AUTH_BASE_URL` and the cookie secret,
  then restart the server/rebuild after changing configuration.
- Email code failure: use a fresh code, check Neon Auth email settings, and
  confirm the app origin is allowed. Configure custom SMTP for production.
- Sync paused: use Retry sync. Your offline cache keeps edits while disconnected;
  sync retries on reconnect and when returning to the tab.
- Missing table: run `npm run db:migrate` against the matching database.
- Full browser storage: export a backup in Settings before clearing anything.

References: [Neon Auth for Next.js](https://neon.com/docs/auth/quick-start/nextjs-api-only),
[Neon Postgres driver](https://neon.com/docs/serverless/serverless-driver).
