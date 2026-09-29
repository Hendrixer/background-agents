import { eq } from "drizzle-orm";
import { db } from "./db";
import { environments } from "./schema";

// This is the only world read the harness needs. A real application can replace
// this adapter with an API call, database query, or a collection of tools.
export async function getLatestState(environmentId: string) {
  const [row] = await db.select({ state: environments.state, version: environments.version }).from(environments).where(eq(environments.id, environmentId)).limit(1);
  if (!row) throw new Error("Observed environment not found");
  return row;
}
