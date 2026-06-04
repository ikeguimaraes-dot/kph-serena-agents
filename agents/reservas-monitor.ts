/**
 * reservas-monitor
 * Monitora ocupação do restaurante: hoje, amanhã e média mensal.
 * Score = (reservas_hoje / media_diaria_mes) * 100, capped at 100.
 */

import Anthropic from "@anthropic-ai/sdk";
import { serena } from "../lib/serena-source";
import { runAgent, AgentResult } from "../lib/run-agent";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function run(): Promise<AgentResult> {
  const hoje = isoDate(0);
  const amanha = isoDate(1);
  const mes = currentMonth();

  const [ocupacaoMes, reservasHoje, reservasAmanha] = await Promise.all([
    serena.ocupacaoMensal(mes),
    serena.reservasDia(hoje),
    serena.reservasDia(amanha),
  ]);

  const dadosColetados = {
    ocupacao_mensal: ocupacaoMes,
    reservas_hoje: reservasHoje,
    reservas_amanha: reservasAmanha,
    meta: { data_hoje: hoje, data_amanha: amanha, mes },
  };

  const prompt = `Você é um analista de dados do restaurante Madonna Cucina.
Analise os dados abaixo e responda em JSON com exatamente 3 campos:
- score: número de 0 a 100 (saúde do indicador — (reservas_hoje / media_diaria_mes) * 100, capped 100)
- insight: string em português, máximo 200 chars, direta e acionável
- data: objeto com os KPIs calculados relevantes (reservas_hoje, reservas_amanha, media_diaria_mes, taxa_ocupacao_pct)

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
  runAgent("reservas-monitor", run).catch(console.error);
}
