import "dotenv/config";
import postgres from "postgres";

const problems = [];
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) problems.push("Use Node.js 22 or newer (an LTS release is recommended).");

if (process.env.AGENT_DEMO_MODE !== "1") {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "your-key-here") {
    problems.push("Set OPENAI_API_KEY in .env to a working key.");
  }
  if (!process.env.OPENAI_MODEL || process.env.OPENAI_MODEL === "choose-an-available-model") {
    problems.push("Set OPENAI_MODEL in .env to a model available to your key.");
  }
}

const url = process.env.DATABASE_URL || "postgres://localhost:5432/background_agents";
const sql = postgres(url, { max: 1, connect_timeout: 3 });
try {
  const [row] = await sql`select to_regclass('public.labs') as labs`;
  if (!row.labs) problems.push("Database is reachable, but the schema is missing. Run npm run db:push.");
} catch {
  problems.push("Cannot connect to the workshop database. Start PostgreSQL and create the background_agents database.");
} finally {
  await sql.end({ timeout: 1 });
}

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exitCode = 1;
} else {
  console.log("✓ Node, database schema, and model environment are ready.");
}
