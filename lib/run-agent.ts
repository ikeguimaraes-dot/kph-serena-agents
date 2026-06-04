import { sql } from './serena-db';

export interface AgentResult {
  score?: number;
  insight?: string;
  data?: unknown;
}

/**
 * Wrapper que grava execução em orkestri_runs.
 * 1. Insere row com status='running'
 * 2. Executa fn()
 * 3. UPDATE status='success', result=resultado
 * 4. Em caso de erro: UPDATE status='error', result={error: msg}
 * Nunca lança exceção — sempre captura e grava.
 */
export async function runAgent(
  agentName: string,
  module: string,
  fn: () => Promise<AgentResult>
): Promise<void> {
  let runId: number | null = null;

  // 1. Inserir com status 'running'
  try {
    const rows = await sql<{ id: number }[]>`
      INSERT INTO orkestri_runs (module, agent_name, status, executed_at)
      VALUES (${module}, ${agentName}, 'running', NOW())
      RETURNING id
    `;
    runId = rows[0]?.id ?? null;
  } catch (insertErr) {
    const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
    console.error(`[${agentName}] Failed to insert orkestri_runs row:`, msg);
  }

  // 2. Executar fn()
  let status: 'success' | 'error' = 'success';
  let result: AgentResult | { error: string } = {};

  try {
    result = await fn();
    console.log(`[${agentName}] done ✓  score=${(result as AgentResult).score ?? 'n/a'}`);
  } catch (err) {
    status = 'error';
    const msg = err instanceof Error ? err.message : String(err);
    result = { error: msg };
    console.error(`[${agentName}] error ✗`, msg);
  }

  // 3/4. UPDATE orkestri_runs
  if (runId !== null) {
    try {
      await sql`
        UPDATE orkestri_runs
        SET status = ${status}, result = ${sql.json(result as never)}
        WHERE id = ${runId}
      `;
    } catch (updateErr) {
      const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
      console.error(`[${agentName}] Failed to update orkestri_runs:`, msg);
    }
  }
}
