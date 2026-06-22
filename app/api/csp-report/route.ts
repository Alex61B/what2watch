// app/api/csp-report/route.ts
// First-party CSP violation sink (WP2 / audit H4). Browsers POST violation reports here from the
// Content-Security-Policy-Report-Only header — both the legacy `report-uri` form
// (application/csp-report) and the modern Reporting API form (application/reports+json). We log
// best-effort and return 204.
//
// Public + unauthenticated by design (browsers post here with no credentials); no DB, no
// rate-limit, fail-open. The endpoint does no expensive or persistent work, so coupling it to the
// DB/rate-limiter would add risk without benefit; the body-size cap + log truncation bound the
// log-spam surface. A reporting beacon must never receive an error.
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Cap the body we read/log so the endpoint can't be used to inflate runtime logs.
const MAX_BODY_BYTES = 64 * 1024
const LOG_TRUNCATE = 2000

const noContent = () => new NextResponse(null, { status: 204 })

export async function POST(request: Request) {
  try {
    const declared = Number(request.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return noContent()

    const raw = await request.text()
    if (raw.length === 0 || raw.length > MAX_BODY_BYTES) return noContent()

    console.warn('[csp-report]', raw.slice(0, LOG_TRUNCATE))
  } catch {
    // fail-open: never surface an error to the reporting browser
  }
  return noContent()
}

// The report sink only accepts POST.
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } })
}
