import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const url = process.env.DATABASE_URL?.trim()
if (!url)
  throw new Error('Set DATABASE_URL in .env to the PostgreSQL connection string from neon.new')
export const client = postgres(url, { max: 5, connect_timeout: 10 })
export const db = drizzle(client, { schema })
