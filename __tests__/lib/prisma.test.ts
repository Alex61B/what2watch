/**
 * @jest-environment node
 *
 * Guards the serverless connection-pool cap. Each Vercel instance builds its own pg Pool;
 * without a bounded `max` a few warm instances exhaust Supabase's pooler
 * (XX000 EMAXCONNSESSION). This locks the pool to a small per-instance size.
 */
jest.mock('pg', () => ({ Pool: jest.fn() }))
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }))
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn() }))

import { Pool } from 'pg'
// Importing the module constructs the pg Pool as a side effect.
import '@/lib/prisma'

test('creates the pg pool with a bounded max for serverless', () => {
  expect(Pool).toHaveBeenCalledTimes(1)
  const opts = (Pool as unknown as jest.Mock).mock.calls[0][0] as { max?: number }
  expect(opts.max).toBe(1)
})
