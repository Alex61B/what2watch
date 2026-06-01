# Research — Second user stuck on "Waiting for the host to start…"

Investigation (debug instrumentation cycle). Follows the per-room session cookie change ([per-room-session-cookie], PR #1, merged 2026-06-01).

## 1. Requirements Summary

Symptom: host starts the session and votes normally, but the **second user stays on the "Waiting for the host to start…" screen** and never advances to voting. Production logs so far show **only the host's** successful polls (`member lookup found:true`, `room lookup found:true`, `queueLength:60`, `currentPosition:0`). We have **zero logs from the second user**, so root cause is not yet known. Goal of this cycle: add temporary, targeted instrumentation to capture the second user's join + poll path and pinpoint where they get stuck.

## 2. Stack Choices

No new deps. `console.log`/`console.warn` instrumentation in the affected route handlers and client pages. Logs are temporary and will be removed once the culprit is found.

## 3. Environment Verification

- **Both client pages silently swallow poll errors:** `app/room/[code]/lobby/page.tsx:88` and `app/room/[code]/vote/page.tsx:63` both do `if (!res.ok) return` — a non-2xx poll leaves the user frozen on the waiting screen with no console signal.
- **Lobby** advances by polling `/poll` and redirecting on `status === 'VOTING'` (`handleRedirect`). If the second user's poll never returns 200/VOTING, no redirect fires → stuck on "Waiting for the host to start…".
- **Vote** shows "Waiting for the host to start…" when `!state?.currentMovie`; `currentMovie` is room-level (from `roomQueue` at `room.currentPosition`), identical for all members — so a *null* currentMovie for the second user while the host sees one would mean the poll is erroring or returning a degraded state, not a per-member queue difference.
- **poll route** already logs member/room lookup and `[queue]`, but not the final response (status, currentMovie, memberId, isHost) — so we can't see what the second user's poll actually returns.
- **join route** already logs `[join] member created` (roomCode, foundRoomId, memberId, memberRoomId, cookie, tokenPrefix) from the cookie fix; missing the room member count.

## 4. Risks & Edge Cases

- **Leading hypothesis:** the second user's `/poll` returns a non-2xx that the client swallows. Candidates: `401` (no `w2w_session_<CODE>` cookie — join didn't set/send it), `403 wrong_room` (the new defense-in-depth branch firing — cookie resolves to a member of another room), or `200` with `currentMovie:null`. Instrumentation must reveal the **status code** distinctly.
- **Secondary:** late join — opening the link after the host starts redirects lobby→vote before joining, leaving no cookie → poll 401 → stuck on "Loading…/Waiting".
- Instrumentation only; no behavior change beyond surfacing swallowed poll errors to the console. Must not log full session tokens (prefix only).

## 5. Assumptions & Open Questions

- **Open (the whole point):** is the second user's poll 401, 403, or 200-with-null-movie? The next deploy's logs (server `[poll] response` + client `[client … poll]`) answer this.
- **Assumption:** the host's path is healthy (confirmed by existing logs); only the second user's path needs tracing.

## 6. Out of Scope

- The actual fix — deferred until instrumentation identifies the failing boundary.
- Removing the swallow-on-error entirely / waiting-screen UX redesign.
- Any schema/migration/dependency change.

## 7. Readiness Verdict: READY FOR PLANNING

Failing boundary unknown; plan is to instrument join + poll (server) and lobby + vote polling (client) to capture the second user's status codes and state, then deploy and read logs. **READY FOR PLANNING.**
