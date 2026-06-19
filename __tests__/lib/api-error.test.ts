/**
 * @jest-environment node
 *
 * Unit tests for the centralized API error helpers. `serverError` must NEVER leak
 * internal details (stack/stage/name/message) to the client; `logServerError` must
 * preserve the full structured server log.
 */
import { serverError, logServerError } from '@/lib/api-error'

describe('serverError', () => {
  it('returns a 500 with a generic body and no internal details', async () => {
    const res = serverError()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(body)).not.toMatch(/stack|stage|name|at /i)
  })

  it('honors a custom status', () => {
    expect(serverError(503).status).toBe(503)
  })
})

describe('logServerError', () => {
  it('logs the tag, context, and full error fields to console.error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('boom')
    logServerError('[votes]', { stage: 'vote-upsert', roomCode: 'ABC' }, err)
    expect(spy).toHaveBeenCalledTimes(1)
    const [tag, payload] = spy.mock.calls[0] as [string, Record<string, unknown>]
    expect(tag).toBe('[votes] fatal error')
    expect(payload).toMatchObject({
      stage: 'vote-upsert',
      roomCode: 'ABC',
      name: 'Error',
      message: 'boom',
    })
    expect(typeof payload.stack).toBe('string')
    spy.mockRestore()
  })

  it('coerces non-Error throwables to a message string', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    logServerError('[x]', {}, 'plain string')
    const payload = spy.mock.calls[0][1] as { message: string }
    expect(payload.message).toBe('plain string')
    spy.mockRestore()
  })
})
