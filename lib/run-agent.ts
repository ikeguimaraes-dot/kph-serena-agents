import { kphSupabase } from "./kph-supabase";

export interface AgentResult {
  score: number;
  insight: string;
  data: Record<string, unknown>;
}

/**
 * Registra a execução de um agente em `agent_runs` no Supabase kph-os
 * e notifica o endpoint POST https://kph-os.vercel.app/api/agents/run.
 *
 * Em caso de erro: status='error', result.error = mensagem.
 */
export async function runAgent(
  agentName: string,
  fn: () => Promise<AgentResult>
): Promise<void> {
  const executedAt = new Date().toISOString();
  let status: "success" | "error" = "success";
  let result: AgentResult | { error: string } = { score: 0, insight: "", data: {} };

  console.log(`[${agentName}] Starting at ${executedAt}`);

  try {
    result = await fn();
    console.log(`[${agentName}] Score: ${(result as AgentResult).score}`);
    console.log(`[${agentName}] Insight: ${(result as AgentResult).insight}`);
  } catch (err) {
    status = "error";
    const message = err instanceof Error ? err.message : String(err);
    result = { error: message };
    console.error(`[${agentName}] Error:`, message);
  }

  // Gravar em agent_runs
  const { error: dbError } = await kphSupabase.from("agent_runs").insert({
    module: "comercial",
    agent_name: agentName,
    status,
    result,
    executed_at: executedAt,
  });

  if (dbError) {
    console.error(`[${agentName}] Failed to write agent_runs:`, dbError.message);
  }

  // Notificar endpoint kph-os
  try {
    const apiUrl = process.env.KPH_OS_URL ?? "https://kph-os.vercel.app";
    const res = await fetch(`${apiUrl}/api/agents/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.KPH_API_SECRET
          ? { Authorization: `Bearer ${process.env.KPH_API_SECRET}` }
          : {}),
      },
      body: JSON.stringify({
        module: "comercial",
        agent_name: agentName,
        status,
        result,
        executed_at: executedAt,
      }),
    });
    if (!res.ok) {
      console.warn(
        `[${agentName}] kph-os notify returned ${res.status}`
      );
    }
  } catch (notifyErr) {
    console.warn(
      `[${agentName}] Failed to notify kph-os:`,
      notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
    );
  }

  if (status === "error") {
    process.exit(1);
  }
}
