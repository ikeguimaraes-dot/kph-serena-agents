/**
 * performance-scorer
 * Lê os últimos runs de orkestri_runs para os agentes 1-4,
 * calcula score consolidado ponderado, grava em orkestri_scores e orkestri_insights.
 *
 * Pesos: reservas 20%, funil 30%, nps 20%, handoffs 30%
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../lib/serena-db';
import { runAgent, AgentResult } from '../lib/run-agent';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const WEIGHTS = {
  'reservas-monitor': 0.2,
  'funil-comercial-analyzer': 0.3,
  'nps-tracker': 0.2,
  'handoffs-analyzer': 0.3,
};

type AgentKey = keyof typeof WEIGHTS;

interface RunResult {
  agent_name: string;
  status: string;
  result: Record<string, unknown> | null;
  executed_at: string;
}

export async function main(): Promise<AgentResult> {
  const generatedAt = new Date().toISOString();
  const agentNames = Object.keys(WEIGHTS) as AgentKey[];

  // Buscar último run de sucesso por agente
  const lastRuns = await sql<RunResult[]>`
    SELECT DISTINCT ON (agent_name)
      agent_name,
      status,
      result,
      executed_at::text
    FROM orkestri_runs
    WHERE agent_name = ANY(${agentNames})
      AND status = 'success'
    ORDER BY agent_name, executed_at DESC
  `;

  const runsMap = new Map<string, RunResult>();
  for (const run of lastRuns) {
    runsMap.set(run.agent_name, run);
  }

  // Extrair scores — excluir agentes sem run recente da média
  const breakdown: Record<string, { score: number | null; weight: number; status: string }> = {};
  let weightedSum = 0;
  let totalWeight = 0;
  const ausentes: string[] = [];

  for (const agent of agentNames) {
    const run = runsMap.get(agent);
    if (run?.result && typeof run.result === 'object' && 'score' in run.result) {
      const score = Number(run.result.score);
      breakdown[agent] = { score, weight: WEIGHTS[agent], status: 'ok' };
      weightedSum += score * WEIGHTS[agent];
      totalWeight += WEIGHTS[agent];
    } else {
      breakdown[agent] = { score: null, weight: WEIGHTS[agent], status: 'ausente' };
      ausentes.push(agent);
    }
  }

  const finalScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  if (ausentes.length > 0) {
    console.warn(`[performance-scorer] Agentes sem run recente: ${ausentes.join(', ')}`);
  }

  const dadosColetados = {
    breakdown,
    ausentes,
    final_score: finalScore,
    generated_at: generatedAt,
    aviso: ausentes.length > 0 ? `Agentes ausentes excluídos da média: ${ausentes.join(', ')}` : null,
  };

  // Claude Haiku — 1 insight consolidado em português
  const prompt = `Você é analista sênior de dados do restaurante Madonna Cucina.
Com base nos scores abaixo, gere 1 insight consolidado em português (máximo 200 chars), direto e acionável.
Mencione o ponto mais crítico e a ação mais importante.

Scores dos agentes:
${JSON.stringify(breakdown, null, 2)}

Score final: ${finalScore}/100
${ausentes.length > 0 ? `Agentes sem dados: ${ausentes.join(', ')}` : ''}

Responda SOMENTE com um JSON: { "insight": "..." }`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '{"insight":""}';
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let insight = '';
  try {
    const parsed = JSON.parse(text) as { insight: string };
    insight = parsed.insight ?? '';
  } catch {
    insight = text.slice(0, 200);
  }

  // Gravar em orkestri_scores
  try {
    await sql`
      INSERT INTO orkestri_scores (module, score, breakdown, generated_at)
      VALUES ('comercial', ${finalScore}, ${sql.json(breakdown as never)}, NOW())
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[performance-scorer] Failed to write orkestri_scores:', msg);
  }

  // Gravar em orkestri_insights
  try {
    await sql`
      INSERT INTO orkestri_insights (module, insight, score, period)
      VALUES ('comercial', ${insight}, ${finalScore}, 'daily')
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[performance-scorer] Failed to write orkestri_insights:', msg);
  }

  return {
    score: finalScore,
    insight,
    data: dadosColetados,
  };
}

if (require.main === module) {
  runAgent('performance-scorer', 'comercial', main).then(() => process.exit(0)).catch(console.error);
}
