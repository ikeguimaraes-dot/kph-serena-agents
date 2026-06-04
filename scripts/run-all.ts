/**
 * run-all.ts
 * Entry point para GitHub Actions e execução local.
 * Delega para performance-scorer, que orquestra os 4 agentes internamente.
 * Exit code 1 em falha — detectável pelo Actions.
 */

import { run } from "../agents/performance-scorer";
import { kphSupabase } from "../lib/kph-supabase";

async function main(): Promise<void> {
  const start = Date.now();
  console.log(`[run-all] Starting at ${new Date().toISOString()}`);

  try {
    const result = await run();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[run-all] Completed in ${elapsed}s`);
    console.log(`[run-all] Score final: ${result.score}`);
    console.log(`[run-all] Insight: ${result.insight}`);
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[run-all] FAILED after ${elapsed}s:`, message);

    // Tentar registrar falha global no Supabase
    try {
      await kphSupabase.from("agent_runs").insert({
        module: "comercial",
        agent_name: "run-all",
        status: "error",
        result: { error: message },
        executed_at: new Date().toISOString(),
      });
    } catch {
      // Silently ignore secondary failure
    }

    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[run-all] Unhandled error:", err);
  process.exit(1);
});
