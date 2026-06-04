/**
 * funil-comercial-analyzer
 * Analisa o funil comercial: leads da semana vs meta, % leads quentes.
 * Score baseado em aderência à meta e qualidade dos leads.
 */

import Anthropic from "@anthropic-ai/sdk";
import { serena } from "../lib/serena-source";
import { runAgent, AgentResult } from "../lib/run-agent";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function run(): Promise<AgentResult> {
  const [funilStats, contactStats] = await Promise.all([
    serena.funilStats(),
    serena.contactStats(),
  ]);

  const dadosColetados = {
    funil: funilStats,
    contatos: contactStats,
  };

  const prompt = `Você é um analista de dados do restaurante Madonna Cucina.
Analise os dados abaixo e responda em JSON com exatamente 3 campos:
- score: número de 0 a 100 (saúde do funil — baseado em leads_semana vs meta e % leads quentes)
- insight: string em português, máximo 200 chars, direta e acionável
- data: objeto com os KPIs calculados relevantes (leads_semana, meta_leads, pct_meta, leads_quentes_pct, oportunidades_conversao)

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
  runAgent("funil-comercial-analyzer", run).catch(console.error);
}
