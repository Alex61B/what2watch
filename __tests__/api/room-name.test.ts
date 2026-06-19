/**
 * @jest-environment node
 *
 * Group B — room naming. The optional Room.name must be stored on creation
 * (trimmed, empty→null), readable via GET, and editable by the host via PATCH.
 */
import { POST as createRoom } from '@/app/api/rooms/route'
import { GET as getRoom, PATCH as patchRoom } from '@/app/api/rooms/[code]/route'
import { checkRateLimit } from '@/lib/rate-limit-db'

interface RoomRow {
  id: string
  code: string
  name: string | null
  status: string
  matchedMovieId: string | null
  currentPosition: number
  queueVersion: number
  watchedFilter: boolean
  streamingServices: string[]
  filters: unknown
  expiresAt: Date
}
interface MemberRow {
  id: string
  roomId: string
  displayName: string
  sessionToken: string
  isHost: boolean
  userId: string | null
  joinedAt: Date
  leftAt: Date | null
}

let rooms: RoomRow[] = []
let members: MemberRow[] = []
let seq = 0

// Inlined inside the factory so the only out-of-scope references (rooms/members/seq)
// live in lazy callbacks, evaluated at test runtime rather than at factory creation.
jest.mock('@/lib/prisma', () => {
  const roomApi = {
    findUnique: async ({ where, include }: { where: { code?: string; id?: string }; include?: { members?: unknown } }) => {
      const room = rooms.find(r => (where.code ? r.code === where.code : r.id === where.id)) ?? null
      if (room && include?.members) {
        return {
          ...room,
          members: members
            .filter(m => m.roomId === room.id && m.leftAt === null)
            .map(m => ({ id: m.id, displayName: m.displayName, isHost: m.isHost, lastSeenAt: null })),
        }
      }
      return room
    },
    create: async ({ data }: { data: Partial<RoomRow> }) => {
      const room: RoomRow = {
        id: `r${++seq}`,
        code: data.code!,
        name: data.name ?? null,
        status: 'LOBBY',
        matchedMovieId: null,
        currentPosition: 0,
        queueVersion: 0,
        watchedFilter: false,
        streamingServices: data.streamingServices ?? [],
        filters: null,
        expiresAt: data.expiresAt ?? new Date(),
      }
      rooms.push(room)
      return room
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<RoomRow> }) => {
      const room = rooms.find(r => r.id === where.id)!
      Object.assign(room, data)
      return room
    },
  }

  const memberApi = {
    create: async ({ data }: { data: { roomId: string; displayName: string; sessionToken: string; isHost: boolean } }) => {
      const row: MemberRow = {
        id: `m${++seq}`, roomId: data.roomId, displayName: data.displayName,
        sessionToken: data.sessionToken, isHost: data.isHost, userId: null,
        joinedAt: new Date(seq), leftAt: null,
      }
      members.push(row)
      return row
    },
    findUnique: async ({ where }: { where: { sessionToken?: string; id?: string } }) => {
      if (where.sessionToken) return members.find(m => m.sessionToken === where.sessionToken) ?? null
      if (where.id) return members.find(m => m.id === where.id) ?? null
      return null
    },
    findFirst: async ({ where }: { where: { sessionToken: string; roomId: string } }) =>
      members.find(m => m.sessionToken === where.sessionToken && m.roomId === where.roomId) ?? null,
  }

  return {
    prisma: {
      room: roomApi,
      member: memberApi,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ room: roomApi, member: memberApi }),
    },
  }
})

jest.mock('@/lib/tmdb', () => ({ getMovieById: jest.fn(async () => ({})) }))
jest.mock('@/lib/rate-limit-db', () => ({
  ...jest.requireActual('@/lib/rate-limit-db'),
  checkRateLimit: jest.fn(async () => ({ ok: true, retryAfterSeconds: 0 })),
}))

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

function ctx(code: string) {
  return { params: Promise.resolve({ code }) }
}
function applyCookies(res: { cookies: { getAll: () => { name: string; value: string }[] } }) {
  for (const { name, value } of res.cookies.getAll()) {
    if (value) jar.set(name, value)
    else jar.delete(name)
  }
}
function createReq(body: Record<string, unknown>) {
  return new Request('http://test/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function patchReq(code: string, body: Record<string, unknown>) {
  return new Request(`http://test/api/rooms/${code}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  rooms = []
  members = []
  seq = 0
  jar.clear()
})

test('creating a room stores a trimmed name', async () => {
  const res = await createRoom(createReq({ displayName: 'Alice', name: '  Friday Night  ' }))
  const { code } = await res.json()
  expect(rooms.find(r => r.code === code)?.name).toBe('Friday Night')
})

test('a blank room name is stored as null', async () => {
  const res = await createRoom(createReq({ displayName: 'Alice', name: '   ' }))
  const { code } = await res.json()
  expect(rooms.find(r => r.code === code)?.name).toBeNull()
})

test('GET returns the room name, and the host can rename via PATCH', async () => {
  const created = await createRoom(createReq({ displayName: 'Alice', name: 'Movie Night' }))
  applyCookies(created)
  const { code } = await created.json()

  const got = await getRoom(new Request(`http://test/api/rooms/${code}`), ctx(code))
  expect((await got.json()).name).toBe('Movie Night')

  const patched = await patchRoom(patchReq(code, { name: 'Renamed Night' }), ctx(code))
  expect(patched.status).toBe(200)
  expect((await patched.json()).name).toBe('Renamed Night')
  expect(rooms.find(r => r.code === code)?.name).toBe('Renamed Night')
})

test('room creation is rate-limited per IP (429 + Retry-After)', async () => {
  ;(checkRateLimit as jest.Mock).mockResolvedValueOnce({ ok: false, retryAfterSeconds: 30 })
  const res = await createRoom(createReq({ displayName: 'Alice' }))
  expect(res.status).toBe(429)
  expect(res.headers.get('Retry-After')).toBe('30')
  expect(rooms).toHaveLength(0)
})
