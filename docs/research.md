# Research — Bugfix: stale poll responses (setup roster + "stuck waiting")

Two reported bugs, one root cause. Investigated via the systematic-debugging skill;
reproduced the failing boundary with curl.

## 1. Requirements Summary

- **Bug 1:** The members list on the room configuration (setup) page does not update when a new member joins.
- **Bug 2:** After the host starts the room, the other user stays on "Waiting for the host to start…" even though they are a member of the (now VOTING) room.

Both must reflect server state promptly.

## 2. Stack Choices

No new dependency, no schema change. Fix at the HTTP layer: make `/api/rooms/[code]/poll` responses non-cacheable (`Cache-Control: no-store`), plus defense-in-depth `cache: 'no-store'` on the client poll fetches. Keep the existing ETag/304 optimization for the vote page's *manual* `If-None-Match` (it still works server-side and is what limits TMDB calls during voting).

## 3. Environment Verification (evidence gathered)

Reproduced with a two-user curl flow against `next dev`:

- Host poll after a 2nd user joins → `members: ['Host','Bob']`, `memberCount: 2`. **The API returns fresh data.** The setup render correctly reads the `members` state set by its 3s poll (`setup/page.tsx:344-346,150-153`), so Bug 1 is not a React bug.
- Second user's poll right after start → `status: VOTING`, `currentMovie: <title>`, `pendingApproval:false`. **The API returns the correct VOTING state.**
- Poll response headers: `etag: "0"` and **no `Cache-Control`**.
- With the room already VOTING, a poll carrying `If-None-Match: "0"` (the value the browser auto-attaches from the cached LOBBY response) returns **`304 Not Modified`** — i.e. the server tells the browser "nothing changed" even though status went LOBBY→VOTING.

**Root cause:** the poll ETag is `queueVersion`, which does **not** change on LOBBY→VOTING (start leaves `queueVersion=0`) nor when a member joins. With no `Cache-Control`, the browser caches the GET `/poll` response and, on the next identical poll, serves the stale body (either via an auto-revalidation that 304s, or directly from cache). So the lobby/vote client keeps the stale `status` (Bug 2) and the setup client keeps the stale `members` (Bug 1). The lobby and setup use plain `fetch`; the vote page sends a manual `If-None-Match` and shares the same cached URL.

## 4. Risks & Edge Cases

- Must not break the vote page's intentional 304 optimization: `no-store` stops *browser* caching but the vote page's explicit `If-None-Match` still produces a server-side 304 that the client handles (`res.status===304 → return`). Verified the client path already handles 304.
- Group D's `canShortCircuit` (host & pending excluded from 304) is unaffected; this fix is orthogonal and complementary.
- The stale 304 also explains the older "second user stuck" symptom that was only instrumented, never root-caused.

## 5. Assumptions & Open Questions

- Assume polling endpoints should always be fresh (no HTTP caching) — correct for a real-time poll.
- No open questions; the failing boundary is reproduced and the mechanism is confirmed.

## 6. Out of Scope

- Removing the ETag/304 mechanism entirely (kept for the vote page's TMDB-call reduction).
- Switching off polling for websockets/SSE.
- Removing the leftover debug `console.log`s from the prior instrumentation cycle.

## 7. Readiness Verdict: READY FOR PLANNING

Root cause confirmed (cacheable poll responses + ETag that ignores status). Fix is a `Cache-Control: no-store` header on poll responses plus `cache: 'no-store'` on the client poll fetches, with a regression test. **READY FOR PLANNING.**
