import { client } from "./db";
import { ensureEnvironment } from "./environment";

const environment = await ensureEnvironment();
console.log(`Environment ready: ${environment.id}`);
await client.end();
