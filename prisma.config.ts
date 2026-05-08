import { config } from "dotenv";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  experimental: {
    adapter: true,
  },
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "js",
  async adapter() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return new PrismaPg(pool);
  },
});
