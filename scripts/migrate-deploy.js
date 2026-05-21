'use strict'
const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id"                  VARCHAR(36)  NOT NULL PRIMARY KEY,
        "checksum"            VARCHAR(64)  NOT NULL,
        "finished_at"         TIMESTAMPTZ,
        "migration_name"      VARCHAR(255) NOT NULL,
        "logs"                TEXT,
        "rolled_back_at"      TIMESTAMPTZ,
        "started_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER      NOT NULL DEFAULT 0
      )
    `)

    const { rows } = await pool.query(
      `SELECT migration_name FROM "_prisma_migrations"
       WHERE rolled_back_at IS NULL ORDER BY started_at`
    )
    const applied = new Set(rows.map(r => r.migration_name))

    const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations')
    const dirs = fs.readdirSync(migrationsDir)
      .filter(e => fs.statSync(path.join(migrationsDir, e)).isDirectory())
      .sort()

    let count = 0
    for (const name of dirs) {
      if (applied.has(name)) continue
      const sqlFile = path.join(migrationsDir, name, 'migration.sql')
      if (!fs.existsSync(sqlFile)) continue
      const sql = fs.readFileSync(sqlFile, 'utf8')
      const checksum = crypto.createHash('sha256').update(sql).digest('hex')
      const id = crypto.randomUUID()
      console.log(`Applying migration: ${name}`)
      await pool.query('BEGIN')
      try {
        await pool.query(sql)
        await pool.query(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, migration_name, finished_at, applied_steps_count)
           VALUES ($1, $2, $3, now(), 1)`,
          [id, checksum, name]
        )
        await pool.query('COMMIT')
        count++
        console.log(`  ✓ ${name}`)
      } catch (err) {
        await pool.query('ROLLBACK')
        throw new Error(`Migration "${name}" failed: ${err.message}`)
      }
    }

    console.log(count === 0 ? 'All migrations already applied.' : `\n${count} migration(s) applied.`)
  } finally {
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
