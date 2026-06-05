/**
 * funil-comercial-analyzer
 * Lê tabela `contacts` do banco Serena.
 * ATENÇÃO: lead_score está 100% NULL — usa estagio_kanban + tier + ltv como sinais alternativos.
 * Score = (qualificado + proposta + fechado) / total_contacts * 100, mínimo 5 se houver dados.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../lib/serena-db';
import { runAgent, AgentResult } from '../lib/run-agent';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function main(): Promise<AgentResult> {
  // Distribuição por estagio_kanban
  const estagios = await sql<{ estagio_kanban: string | null; count: string }[]>`
    SELECT estagio_kanban, COUNT(*)::text AS count
    FROM contacts
    GROUP BY estagio_kanban
    ORDER BY count DESC
  `;

  // Lead_score — verificar se algum foi preenchido
  const leadScoreStats = await sql<{ lead_score: string | null; count: string }[]>`
    SELECT lead_score, COUNT(*)::text AS count
    FROM contacts
    GROUP BY lead_score
  `;

  // Distribuição por tier
  const tierStats = await sql<{ tier: string | null; count: string }[]>`
    SELECT tier, COUNT(*)::text AS count
    FROM contacts
    WHERE tier IS NOT NULL
    GROUP BY tier
    ORDER BY count DESC
  `;

  // LTV e frequência — sinais de qualidade
  const [ltvStats] = await sql<{
    avg_ltv: string;
    sum_ltv: string;
    avg_freq: string;
    total_contatos: string;
    com_ltv: string;
  }[]>`
    SELECT
      ROUND(AVG(ltv_total), 2)::text AS avg_ltv,
      ROUND(SUM(ltv_total), 2)::text AS sum_ltv,
      ROUND(AVG(frequencia_visitas), 2)::text AS avg_freq,
      COUNT(*)::text AS total_contatos,
      COUNT(ltv_total)::text AS com_ltv
    FROM contacts
  `;

  // Total por estágio para calcular score
  const totalContatos = Number(ltvStats?.total_contatos ?? 0);
  const avancoCount = estagios
    .filter((e: { estagio_kanban: string | null; count: string }) => ['qualificado', 'proposta', 'fechado'].includes(e.estagio_kanban ?? ''))
    .reduce((acc: number, e: { estagio_kanban: string | null; count: string }) => acc + Number(e.count), 0);

  const scoreCalc =
    totalContatos > 0
      ? Math.max(5, Math.round((avancoCount / totalContatos) * 100))
      : 5;

  const dadosColetados = {
    aviso: 'lead_score está 100% NULL — análise usa estagio_kanban, tier e ltv como sinais alternativos',
    distribuicao_estagio_kanban: estagios,
    lead_score_stats: leadScoreStats,
    distribuicao_tier: tierStats,
    resumo_ltv_frequencia: ltvStats,
    total_contatos: totalContatos,
    em_etapas_avancadas: avancoCount,
  };

  if (totalContatos === 0) {
    return {
      score: 5,
      insight: 'Nenhum contato encontrado no banco de dados.',
      data: dadosColetados,
    };
  }

  const prompt = `Você é analista de dados do restaurante Madonna Cucina.
Analise o funil comercial abaixo e responda em JSON com exatamente 3 campos:
- score: número de 0 a 100 (use o valor já calculado: ${scoreCalc})
- insight: string em português, máximo 200 chars, acionável — mencione que lead_score ainda não foi populado e sugira ação prioritária no funil
- data: objeto com KPIs relevantes (total_contatos, distribuicao_kanban, taxa_conversao_pct, captacao, qualificado, proposta, fechado, alerta_lead_score_null)

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
  runAgent('funil-comercial-analyzer', 'comercial', main).then(() => process.exit(0)).catch(console.error);
}
