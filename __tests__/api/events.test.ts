/**
 * @jest-environment node
 *
 * Route tests for POST /api/events — the behavioral-event ingest. Prisma + auth are
 * mocked (repo convention); the in-memory rate limiter is reset per test.
 */
import { POST } from '@/app/api/events/route'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import { __resetRateLimit } from '@/lib/rate-limit'

jest.mock('@/lib/prisma', () => ({
  prisma: { event: { createMany: jest.fn(async () => ({ count: 0 })) } },
}))
jest.mock('@/auth', () => ({ auth: jest.fn(async () => null) }))

const createMany = prisma.event.createMany as jest.Mock
const mockAuth = auth as unknown as jest.Mock

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://test/api/events', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    }),
  )

beforeEach(() => {
  createMany.mockClear()
  mockAuth.mockResolvedValue(null)
  __resetRateLimit()
})

test('persists allowlisted events and stamps null userId when anonymous', async () => {
  const res = await post({ anonId: 'a1', events: [{ type: 'page_view', props: { path: '/' } }] })
  expect(res.status).toBe(204)
  expect(createMany).toHaveBeenCalledTimes(1)
  const rows = createMany.mock.calls[0][0].data
  expect(rows[0]).toMatchObject({ type: 'page_view', anonId: 'a1', userId: null })
})

test('stamps userId from the session when authenticated', async () => {
  mockAuth.mockResolvedValue({ user: { id: 'u9' } })
  await post({ anonId: 'a1', events: [{ type: 'session_start' }] })
  expect(createMany.mock.calls[0][0].data[0].userId).toBe('u9')
})

test('drops unknown event types but keeps valid ones', async () => {
  await post({
    anonId: 'a1',
    events: [{ type: 'evil' }, { type: 'card_decided', props: { movieId: '1', vote: true, dwellMs: 10 } }],
  })
  const rows = createMany.mock.calls[0][0].data
  expect(rows).toHaveLength(1)
  expect(rows[0].type).toBe('card_decided')
})

test('stores clientTs in props._clientTs without trusting it for ts', async () => {
  await post({ anonId: 'a1', events: [{ type: 'page_view', clientTs: 1_234_567_890 }] })
  const row = createMany.mock.calls[0][0].data[0]
  expect(row.props._clientTs).toBe(1_234_567_890)
  expect(row.ts).toBeInstanceOf(Date)
})

test('truncates batches beyond MAX_EVENTS_PER_REQUEST', async () => {
  const events = Array.from({ length: 50 }, () => ({ type: 'page_view' }))
  await post({ anonId: 'a1', events })
  expect(createMany.mock.calls[0][0].data.length).toBeLessThanOrEqual(20)
})

test('malformed body returns 204 and never writes', async () => {
  const res = await POST(new Request('http://test/api/events', { method: 'POST', body: 'not json' }))
  expect(res.status).toBe(204)
  expect(createMany).not.toHaveBeenCalled()
})

test('returns 429 when rate-limited', async () => {
  const many = Array.from({ length: 20 }, () => ({ type: 'page_view' }))
  let last = 204
  for (let i = 0; i < 40; i++) last = (await post({ anonId: 'flood', events: many })).status
  expect(last).toBe(429)
})
