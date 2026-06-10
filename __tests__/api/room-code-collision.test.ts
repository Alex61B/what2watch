/**
 * @jest-environment node
 *
 * R4 — room-code allocation must not 500 on a unique-constraint collision.
 * The old code did findUnique-then-create (check-then-insert); two creators that
 * picked the same code both passed the check and the second insert threw P2002,
 * surfacing as a 500. The route now treats the INSERT as the source of truth and
 * retries on P2002 with a freshly generated code.
 */
import { POST as createRoom } from '@/app/api/rooms/route'

interface RoomRow {
  id: string
  code: string
}

let rooms: RoomRow[] = []
let seq = 0
let collideCount = 0 // how many of the next room.create calls throw P2002
let throwPlain = false // make the next room.create throw a non-P2002 error

jest.mock('@/lib/prisma', () => {
  const room = {
    create: async ({ data }: { data: { code: string } }) => {
      if (throwPlain) {
        throwPlain = false
        throw new Error('boom: database unavailable')
      }
      if (collideCount > 0) {
        collideCount--
        throw Object.assign(new Error('Unique constraint failed on the fields: (`code`)'), {
          code: 'P2002',
          meta: { target: ['code'] },
        })
      }
      const created: RoomRow = { id: `r${++seq}`, code: data.code }
      rooms.push(created)
      return created
    },
  }
  const member = {
    create: async ({ data }: { data: { roomId: string } }) => ({ id: `m${++seq}`, roomId: data.roomId }),
  }
  const prisma: Record<string, unknown> = { room, member }
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn({ room, member })
  return { prisma }
})

const jar = new Map<string, string>()
jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name)
      return value ? { name, value } : undefined
    },
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
  }),
}))

function createReq(body: Record<string, unknown>) {
  return new Request('http://test/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  rooms = []
  seq = 0
  collideCount = 0
  throwPlain = false
  jar.clear()
})

test('a P2002 code collision is retried, not surfaced as a 500', async () => {
  collideCount = 1 // first insert collides, the retry succeeds
  const res = await createRoom(createReq({ displayName: 'Alice' }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(typeof body.code).toBe('string')
  expect(rooms).toHaveLength(1) // exactly one room ultimately created
})

test('gives up with a 500 after repeated collisions', async () => {
  collideCount = 99 // every attempt collides
  const res = await createRoom(createReq({ displayName: 'Alice' }))
  expect(res.status).toBe(500)
  expect(rooms).toHaveLength(0)
})

test('a non-P2002 database error is not swallowed', async () => {
  throwPlain = true
  await expect(createRoom(createReq({ displayName: 'Alice' }))).rejects.toThrow('boom')
})
