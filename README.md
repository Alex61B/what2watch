# What2Watch

Collaborative movie-watching decisions. Create a room, vote on movies, find a match.

Stack: Next.js (App Router) · TypeScript · Prisma · PostgreSQL · NextAuth · TailwindCSS.

## Development

```bash
npm run dev         # start the dev server
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm test            # jest
```

## Admin dashboard

A private, read-only dashboard at **`/admin`** lets developers view users, activity, and
analytics. It is **not linked anywhere** in the product UI and is enforced server-side on
every page — unauthorized visitors (anonymous or signed-in non-admins) receive a **404**.

Authorization is an allowlist of admin emails. Set it wherever the app runs:

```bash
# .env.local (local) and your Vercel project env (production)
ADMIN_EMAILS=you@example.com,cofounder@example.com
```

- Comma-separated; whitespace and case are ignored.
- If unset/empty, **no one** can access `/admin`.
- An admin is a signed-in user whose account email is in the list.

Pages: `/admin` (overview metrics), `/admin/users` (user list), `/admin/users/[id]`
(per-user activity), `/admin/events` (global event feed). The dashboard never exposes
password hashes, session tokens, or OAuth tokens.
