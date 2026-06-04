/**
 * performance-scorer
 * Agente orquestrador: executa os 4 agentes, calcula score ponderado final,
 * grava em kph_intelligence_scores e kph_insights.
 *
 * Pesos: reservas 30%, funil 30%, nps 20%, handoffs 20%
 */

import { run as reservasRun } from "./reservas-monitor";
import { run as funilRun } from "./funil-comercial-analyzer";
import { run as npsRun } from "./nps-tracker";
import { run as handoffsRun } from "./handoffs-analyzer";
import { kphSupabase } from "../lib/kph-supabase";
import { runAgent, AgentResult } from "../lib/run-agent";

const WEIGHTS = {
  reservas: 0.3,
  funil: 0.3,
  nps: 0.2,
  handoffs: 0.2,
};

export async function run(): Promise<AgentResult> {
  const generatedAt = new Date().toISOString();

  console.log("[performance-scorer] Running all sub-agents...");

  const [reservas, funil, nps, handoffs] = await Promise.allSettled([
    reservasRun(),
    funilRun(),
    npsRun(),
    handoffsRun(),
  ]);

  const safeScore = (r: PromiseSettledResult<AgentResult>, fallback = 50): number => {
    if (r.status === "fulfilled") return r.value.score ?? fallback;
    console.warn("[performance-scorer] Sub-agent failed:", r.reason);
    return fallback;
  };

  const safeInsight = (r: PromiseSettledResult<AgentResult>): string => {
    if (r.status === "fulfilled") return r.value.insight ?? "";
    return "";
  };

  const scores = {
    reservas: safeScore(reservas),
    funil: safeScore(funil),
    nps: safeScore(nps),
    handoffs: safeScore(handoffs),
  };

  const finalScore = Math.round(
    scores.reservas * WEIGHTS.reservas +
    scores.funil * WEIGHTS.funil +
    scores.nps * WEIGHTS.nps +
    scores.handoffs * WEIGHTS.handoffs
  );

  const insights = [
    reservas.status === "fulfilled" ? `Reservas: ${safeInsight(reservas)}` : null,
    funil.status === "fulfilled" ? `Funil: ${safeInsight(funil)}` : null,
    nps.status === "fulfilled" ? `NPS: ${safeInsight(nps)}` : null,
    handoffs.status === "fulfilled" ? `Handoffs: ${safeInsight(handoffs)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const breakdown = {
    reservas: { score: scores.reservas, weight: WEIGHTS.reservas },
    funil: { score: scores.funil, weight: WEIGHTS.funil },
    nps: { score: scores.nps, weight: WEIGHTS.nps },
    handoffs: { score: scores.handoffs, weight: WEIGHTS.handoffs },
  };

  // Gravar score consolidado
  const { error: scoreError } = await kphSupabase
    .from("kph_intelligence_scores")
    .insert({
      module: "comercial",
      score: finalScore,
      breakdown,
      generated_at: generatedAt,
    });

  if (scoreError) {
    console.error(
      "[performance-scorer] Failed to write kph_intelligence_scores:",
      scoreError.message
    );
  }

  // Gravar insight consolidado
  const consolidatedInsight = insights.slice(0, 200);
  const { error: insightError } = await kphSupabase.from("kph_insights").insert({
    module: "comercial",
    insight: consolidatedInsight,
    score: finalScore,
    period: "daily",
    created_at: generatedAt,
  });

  if (insightError) {
    console.error(
      "[performance-scorer] Failed to write kph_insights:",
      insightError.message
    );
  }

  console.log(
    `[performance-scorer] Final score: ${finalScore} | Breakdown: ${JSON.stringify(scores)}`
  );

  return {
    score: finalScore,
    insight: consolidatedInsight,
    data: { breakdown, scores, generated_at: generatedAt },
  };
}

if (require.main === module) {
  runAgent("performance-scorer", run).catch(console.error);
}
