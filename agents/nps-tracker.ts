/**
 * nps-tracker
 * Rastreia NPS consolidado, promotores e detratores.
 * Score = ((promotores% - detratores%) + 100) / 2  — normaliza NPS para 0-100.
 */

import Anthropic from "@anthropic-ai/sdk";
import { serena } from "../lib/serena-source";
import { runAgent, AgentResult } from "../lib/run-agent";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function run(): Promise<AgentResult> {
  const [contactStats, reports] = await Promise.all([
    serena.contactStats(),
    serena.reports(30),
  ]);

  const dadosColetados = {
    contatos: contactStats,
    relatorio_30d: reports,
  };

  const prompt = `Você é um analista de dados do restaurante Madonna Cucina.
Analise os dados abaixo e responda em JSON com exatamente 3 campos:
- score: número de 0 a 100 (NPS normalizado: ((promotores_pct - detratores_pct) + 100) / 2)
- insight: string em português, máximo 200 chars, direta e acionável
- data: objeto com os KPIs calculados relevantes (nps_liquido, promotores_pct, detratores_pct, neutros_pct, total_avaliados, detratores_requerem_acao)

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
  runAgent("nps-tracker", run).catch(console.error);
}
