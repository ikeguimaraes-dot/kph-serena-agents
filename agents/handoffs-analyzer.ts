/**
 * handoffs-analyzer
 * Analisa handoffs para humanos: categorias mais frequentes = oportunidades de automação.
 * Score inversamente proporcional ao volume: menos handoff = score maior.
 */

import Anthropic from "@anthropic-ai/sdk";
import { serena } from "../lib/serena-source";
import { runAgent, AgentResult } from "../lib/run-agent";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function run(): Promise<AgentResult> {
  const [handoffsCat, serenaMetrics] = await Promise.all([
    serena.handoffsCat("30d"),
    serena.serenaMetrics("30d"),
  ]);

  const dadosColetados = {
    handoffs_categorizados_30d: handoffsCat,
    metricas_serena_30d: serenaMetrics,
  };

  const prompt = `Você é um analista de dados do restaurante Madonna Cucina.
Analise os dados abaixo e responda em JSON com exatamente 3 campos:
- score: número de 0 a 100 (saúde da automação — inversamente proporcional ao volume de handoffs; taxa_resolucao_autonoma * 100 é uma boa base)
- insight: string em português, máximo 200 chars, direta e acionável — mencione a categoria mais frequente de handoff como oportunidade de automação
- data: objeto com os KPIs calculados relevantes (total_handoffs_30d, categoria_mais_frequente, pct_handoffs_total, taxa_resolucao_autonoma, economia_estimada)

Dados: ${JSON.stringify(dadosColetados, null, 2)}

Responda SOMENTE com JSON válido, sem markdown.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const parsed = JSON.parse(text) as AgentResult;
  return parsed;
}

if (require.main === module) {
  runAgent("handoffs-analyzer", run).catch(console.error);
}
