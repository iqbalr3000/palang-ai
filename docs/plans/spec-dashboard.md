# Dashboard — spec

Feature entry: `docs/plans/roadmap.md`. Second of the three features TSD M5 was split into
(`admin-api` → `dashboard` → `launch`). Source: `docs/TSD.md` §13 (pages, rules), §3 (stack),
§10.2 (admin token never reaches the browser). Built on the endpoints from `spec-admin-api.md`.
Decisions agreed 2026-09-28.

## Scope

- `apps/dashboard`: Next.js (App Router) + Tailwind + shadcn/ui + Recharts, on the Node runtime
  with Bun only as the package manager (TSD §3).
- Password login (`DASHBOARD_PASSWORD`).
- The four TSD §13 pages: Overview, Events (with detail drawer), API keys, Config.
- Wired into the monorepo's `dev`, `typecheck`, `lint`, `test` and CI.

Explicitly out of scope: container image and `docker compose` (`launch`); policy editing and
DB-backed tenants (v0.2, TSD §16).

## Design

| Point | Decision | Why |
|---|---|---|
| Runtime check | Next 16 + Tailwind 4 + Recharts 3 build and serve (`next build` / `next start`, Node 24) under the repo's `linker = "isolated"` — verified with a throwaway spike before deciding. | The one real integration risk; no fallback needed. |
| Data access | Server Components and Server Actions only, through a small `server-only` admin client using `PALANG_ADMIN_URL` + `PALANG_ADMIN_TOKEN`. | TSD §13, §10.2: the admin token never reaches the browser. |
| Session | Signed cookie: HMAC-SHA256 with a key derived from `PALANG_ADMIN_TOKEN`; `httpOnly`, `SameSite=Lax`, `Secure` over HTTPS, 12 h expiry. Password compared in constant time. | Agreed. The admin token is high-entropy and already on the server, so no new env var; a weak `DASHBOARD_PASSWORD` can't be brute-forced from a leaked cookie. Rotating the admin token signs everyone out. |
| UI language | English. | Agreed; open-source audience, matches code and API. |
| Overview | Range picker (24 h / 7 d / 30 d) and tenant filter; stacked allow/flag/block over time buckets; top block reasons; latency p50/p95 and per-guard p95. No auto-refresh. | TSD §13 page 1, from `/admin/stats`. |
| Events | Filters in the URL (tenant, action, guard, date range), cursor pagination, a detail drawer with decisions and the stored (redacted) content. | TSD §13 page 2; URL state keeps views shareable and back-button friendly. |
| API keys | Per-tenant list; create via a Server Action whose plaintext key is shown once (never put in a URL or cookie); revoke with a confirmation. | TSD §13 page 3, TSD §7.4 "returns plaintext once". |
| Config | Read-only view of `/admin/config` (secrets already redacted by the API). | TSD §13 page 4. |
| Look | shadcn/ui defaults (neutral), light/dark following the system. | No design brief; the user iterates on UI polish. |
| Typecheck | `next typegen` before `tsc --noEmit`, so CI doesn't need a full `next build`. | Next's route types are generated. |
| Lint | The root ESLint flat config, no `eslint-config-next`. | Not in TSD §3 (Working rule 10). |
| Tests | `bun test` for the session and the admin client; the UI is checked by hand with the user. | The user's own rule for generated UI; no browser-test dependency. |

## Engineering tasks

- [x] Scaffold `apps/dashboard` (Next, Tailwind, shadcn/ui components used, Recharts), wired into
      turbo `dev`/`typecheck`/`lint`/`test`.
- [x] Session: sign/verify, login page + Server Action, logout, route protection.
- [x] Admin client (`server-only`, Zod-validated responses).
- [x] Overview page.
- [x] Events page + detail drawer.
- [x] API keys page (create shown once, revoke).
- [x] Config page.
- [x] Tests: session, admin client.

## Implementation notes

Decided or found while building, not separately discussed — flagged for the user to confirm or
overrule:
- **Standalone output** (`output: "standalone"`, tracing rooted at the monorepo), at the user's
  request for a smaller build: `.next/standalone` is 43 MB including its trimmed `node_modules`.
  `build` copies `.next/static` into it and `start` runs `node --env-file-if-exists=.env.local
  .next/standalone/apps/dashboard/server.js` — `next start` doesn't support standalone (an earlier
  attempt that kept `next start` broke Server Actions). Verified: assets, login, and every page
  served from the standalone server. The standalone server doesn't load `.env.local` itself (only
  `next dev`/`next start` do), hence Node's `--env-file-if-exists` (Node 22.9+); plain env vars still
  work when there's no file, as in a container.
- **One `.env` at the repo root** for the gateway, dashboard and migrations (the user's call, for
  first-time open-source users): `next.config.ts` and `drizzle.config.ts` load it, `start` passes
  `--env-file-if-exists=../../.env`, and Bun loads it for root scripts. `PALANG_ADMIN_URL` defaults
  to `http://localhost:8081`. `bun run setup` creates `.env` (generated admin token and dashboard
  password) and `palang.yaml` without overwriting; root scripts `db:migrate`, `mock`, `gateway`,
  `dashboard`. Missing required variables fail at startup, pointing at `.env.example`.
- **`recharts` is 3.8.0, not 3.10.1**: shadcn's `chart` component pins it. Both are Recharts 3.
- **shadcn CLI without `init`** installed an unrelated npm package named `cn` and left
  `lib/utils.ts` and the theme tokens out; replaced by hand with the standard `cn` helper
  (`clsx` + `tailwind-merge`), `class-variance-authority`, `tw-animate-css`, and the neutral
  theme. Dark mode follows `prefers-color-scheme`.
- **Action colors** (`--action-allow/flag/block`) are extra theme tokens used by badges and the
  chart, so allow/flag/block read the same everywhere.
- **Filter forms are plain GET forms** with native `<select>`s, so filtering works without client
  JS and the URL is the state. Timestamps render in the browser's time zone (`LocalTime`).
- **Events date filters** are whole UTC days (`to` inclusive).
- **Failed logins wait 500 ms**; there's no lockout in v0.1.
- `next-env.d.ts` and `.next/` are git-, lint- and prettier-ignored; `typecheck` runs
  `next typegen` first.

**Verified against a real stack** (gateway + mock upstream + Postgres + `next start`): every page
renders with a session and redirects without one or with a forged cookie; the admin token appears
in no rendered HTML; config shows `***` for upstream keys; the event drawer shows `[CANARY]`, never
the token. The login form and key creation were exercised as no-JS form posts (wrong password →
error, right password → `HttpOnly; SameSite=lax` 12 h cookie and redirect; a created key is shown
once). Not yet checked in a real browser: layout, the chart, the drawer and revoke dialog (both
client-only), and dark mode.

## Enhancements (2026-09-28)

Asked for after the first round of use; agreed 2026-09-28, to be iterated on with the user in the
browser:
- **Cursor:** Tailwind v4's preflight gives buttons and selects the default cursor and shadcn's
  components don't add it back; one base rule in `globals.css` restores `cursor: pointer` for
  enabled buttons, selects, `summary` and `[role=button]`.
- **Which key made the request:** the admin API's event list and detail join `api_keys` and
  return `api_key: { id, name, prefix, revoked }` (additive). Events shows a Key column (name +
  prefix, marked when revoked) and the drawer shows it too. No key filter for now.
- **Theme from the logo** (navy `#0a1030`, blue `#1e8ff5`, cyan `#22c8f5`, white): follows the
  system; dark uses the logo's navy with blue/cyan accents, light is white with the logo blue as
  primary. Status colors: allow = logo blue, flag = amber, block = red. The favicon mark and name
  go in the sidebar, the full logo on the login page.

Then iterated with the user in the browser:
- **Colors toned down:** "not everything blue" — surfaces are neutral grays in both themes, and
  the logo blue is kept for accents (primary actions, focus, the active nav item, "AI", allowed
  traffic). The light theme uses soft off-white surfaces instead of pure white.
- **Theme setting:** Light / Dark / System, stored in the browser, applied before first paint
  (class-based `dark` variant).
- **Sidebar:** fixed while the content scrolls; grouped nav (Monitor: Overview, Events · Manage:
  API keys, Config) with icons and a soft blue tint on the active item; an account menu at the
  bottom (avatar → Theme submenu, Sign out).
- **Cursor:** in the end set per component (`Button`, selects, menu items, sheet close); the
  global base rule was removed as a duplicate.

Second code/security review fixes (2026-09-28): the theme `<head>` script is generated from the
same function the toggle uses and only guards the storage read (a blocked `localStorage` still
follows the system); a root-level `ThemeSync` follows OS changes and other tabs on every page;
theme colors used outside the palette became tokens (`--nav-active-foreground`, `--brand-navy`);
`api_key` is optional in the client schema so an older gateway doesn't break Events; Sign out is
a real form submit again (works without JS); images are served at their display size (56 px mark,
400 px login logo); on small screens the sidebar becomes a top bar with the nav scrolling on its
own row; `PALANG_ADMIN_URL` defaults to `http://127.0.0.1:8081` (the admin API binds IPv4
loopback, and `localhost` can resolve to `::1`).
