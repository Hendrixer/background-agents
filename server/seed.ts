import { client } from "./db";
import { ensureLab } from "./lab-data";

const lab = await ensureLab();
console.log(`Lab ready: ${lab.id} (${lab.scenario})`);
await client.end();
