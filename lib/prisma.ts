import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createPrismaClient() {
  // Cap the pool at 1 connection per instance. On Vercel each serverless instance holds its
  // own pool; the pg default of 10 lets a few warm instances exhaust Supabase's pooler
  // (XX000 EMAXCONNSESSION). Pair with a transaction-mode pooler (DATABASE_URL on port 6543)
  // for headroom. The driver adapter sizes the pool here — the URL's connection_limit is
  // ignored by pg.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
