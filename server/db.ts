import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL || "postgres://localhost:5432/background_agents";
export const client = postgres(url, { max: 5 });
export const db = drizzle(client, { schema });
