import type { SimJsonOutput, StaleJsonOutput } from "../core/types.js";

export function printJson(payload: SimJsonOutput | StaleJsonOutput): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}
