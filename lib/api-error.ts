// lib/api-error.ts
// Centralized API error handling. The split is deliberate:
//   - logServerError keeps the FULL structured context (stage/roomCode/name/message/stack)
//     on the server, exactly as routes logged before.
//   - serverError returns a GENERIC body to the client — never a stack, stage, name, or
//     raw message. This is the one place to wire an error tracker (e.g. Sentry) later.
import { NextResponse } from 'next/server'

/** Structured server-side error log. Call inside catch blocks; never sent to the client. */
export function logServerError(
  tag: string,
  context: Record<string, unknown>,
  err: unknown,
): void {
  const error = err instanceof Error ? err : new Error(String(err))
  console.error(`${tag} fatal error`, {
    ...context,
    name: error.name,
    message: error.message,
    stack: error.stack,
  })
}

/** Client-safe generic error response. Leaks nothing about the failure. */
export function serverError(status = 500): NextResponse {
  return NextResponse.json({ error: 'Internal server error' }, { status })
}
