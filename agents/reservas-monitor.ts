/**
 * reservas-monitor
 * Lê tabela `reservas` do banco Serena e analisa ocupação via Claude Haiku.
 * Score = reservas confirmadas / (total - canceladas) * 100.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../lib/serena-db';
import { runAgent, AgentResult } from '../lib/run-agent';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

export async function main(): Promise<AgentResult> {
  const hoje = isoDate(0);
  const sete = isoDate(-7);
  const trinta = isoDate(-30);

  // Totais por status
  const [byStatus] = await Promise.all([
    sql<{ status: string; count: string; total_posicoes: string }[]>`
      SELECT
        status,
        COUNT(*)::text AS count,
        COALESCE(SUM(posicoes), 0)::text AS total_posicoes
      FROM reservas
      GROUP BY status
    `,
  ]);

  const reservasHoje = await sql<{ status: string; count: string }[]>`
    SELECT status, COUNT(*)::text AS count
    FROM reservas
    WHERE data = ${hoje}
    GROUP BY status
  `;

  const reservas7d = await sql<{ status: string; count: string }[]>`
    SELECT status, COUNT(*)::text AS count
    FROM reservas
    WHERE data >= ${sete}
    GROUP BY status
  `;

  const reservas30d = await sql<{ status: string; count: string }[]>`
    SELECT status, COUNT(*)::text AS count
    FROM reservas
    WHERE data >= ${trinta}
    GROUP BY status
  `;

  const diasComMais = await sql<{ data: string; total: string }[]>`
    SELECT data::text, COUNT(*)::text AS total
    FROM reservas
    WHERE status IN ('confirmada', 'pendente')
    GROUP BY data
    ORDER BY total DESC
    LIMIT 5
  `;

  // Pessoas esperadas = posicoes onde confirmada ou pendente
  const [pessoasEsperadas] = await sql<{ total: string }[]>`
    SELECT COALESCE(SUM(posicoes), 0)::text AS total
    FROM reservas
    WHERE status IN ('confirmada', 'pendente')
  `;

  const dadosColetados = {
    data_referencia: hoje,
    por_status_geral: byStatus,
    reservas_hoje: reservasHoje,
    reservas_7d: reservas7d,
    reservas_30d: reservas30d,
    dias_mais_movimentados: diasComMais,
    pessoas_esperadas_total: pessoasEsperadas?.total ?? '0',
  };

  // Calcular score: confirmadas / (total - canceladas) * 100
  const confirmadas = byStatus.find((r: { status: string; count: string; total_posicoes: string }) => r.status === 'confirmada');
  const canceladas = byStatus.find((r: { status: string; count: string; total_posicoes: string }) => r.status === 'cancelada');
  const totalGeral = byStatus.reduce((acc: number, r: { status: string; count: string; total_posicoes: string }) => acc + Number(r.count), 0);
  const totalSemCanceladas = totalGeral - Number(canceladas?.count ?? 0);
  const scoreCalc =
    totalSemCanceladas > 0
      ? Math.round((Number(confirmadas?.count ?? 0) / totalSemCanceladas) * 100)
      : 0;

  // Verificar se há dados
  if (totalGeral === 0) {
    return {
      score: 0,
      insight: 'Nenhuma reserva encontrada no banco de dados.',
      data: dadosColetados,
    };
  }

  const prompt = `Você é analista de dados do restaurante Madonna Cucina.
Analise os dados de reservas abaixo e responda em JSON com exatamente 3 campos:
- score: número de 0 a 100 (use o valor já calculado: ${scoreCalc})
- insight: string em português, máximo 200 chars, direta e acionável
- data: objeto com KPIs relevantes (total_reservas, confirmadas, pendentes, canceladas, pessoas_esperadas, dias_mais_movimentados)

Dados: ${JSON.stringify(dadosColetados, null, 2)}

Responda SOMENTE com JSON válido, sem markdown.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '';
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const parsed = JSON.parse(text) as AgentResult;
  return parsed;
}

if (require.main === module) {
  runAgent('reservas-monitor', 'comercial', main).then(() => process.exit(0)).catch(console.error);
}
