/**
 * nps-tracker
 * Não há tabela NPS — usa proxies de contacts:
 *   frequencia_visitas >= 3 → promotor
 *   frequencia_visitas == 2 → neutro
 *   frequencia_visitas <= 1 → detrator
 * NPS proxy = %promotores - %detratores
 * Score = (NPS + 100) / 2  (normaliza -100..+100 para 0..100)
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../lib/serena-db';
import { runAgent, AgentResult } from '../lib/run-agent';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function main(): Promise<AgentResult> {
  // Segmentação NPS proxy por frequencia_visitas
  const [totais] = await sql<{
    total: string;
    promotores: string;
    neutros: string;
    detratores: string;
    sem_visita: string;
  }[]>`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE frequencia_visitas >= 3)::text AS promotores,
      COUNT(*) FILTER (WHERE frequencia_visitas = 2)::text AS neutros,
      COUNT(*) FILTER (WHERE frequencia_visitas <= 1 AND frequencia_visitas IS NOT NULL)::text AS detratores,
      COUNT(*) FILTER (WHERE frequencia_visitas IS NULL)::text AS sem_visita
    FROM contacts
  `;

  // Distribuição por tier como sinal adicional
  const tierDist = await sql<{ tier: string | null; count: string; avg_ltv: string }[]>`
    SELECT
      tier,
      COUNT(*)::text AS count,
      ROUND(AVG(ltv_total), 2)::text AS avg_ltv
    FROM contacts
    WHERE tier IS NOT NULL
    GROUP BY tier
    ORDER BY count DESC
  `;

  // LTV médio por segmento de frequência
  const ltvPorFreq = await sql<{ segmento: string; count: string; avg_ltv: string }[]>`
    SELECT
      CASE
        WHEN frequencia_visitas >= 3 THEN 'promotor'
        WHEN frequencia_visitas = 2 THEN 'neutro'
        WHEN frequencia_visitas <= 1 THEN 'detrator'
        ELSE 'sem_dados'
      END AS segmento,
      COUNT(*)::text AS count,
      ROUND(AVG(ltv_total), 2)::text AS avg_ltv
    FROM contacts
    GROUP BY segmento
  `;

  const total = Number(totais?.total ?? 0);
  const promotores = Number(totais?.promotores ?? 0);
  const neutros = Number(totais?.neutros ?? 0);
  const detratores = Number(totais?.detratores ?? 0);
  const comDados = promotores + neutros + detratores;

  let npsProxy = 0;
  let scoreCalc = 50; // default neutro

  if (comDados > 0) {
    const pctPromotores = (promotores / comDados) * 100;
    const pctDetratores = (detratores / comDados) * 100;
    npsProxy = Math.round(pctPromotores - pctDetratores);
    scoreCalc = Math.round((npsProxy + 100) / 2);
  }

  const dadosColetados = {
    aviso: 'NPS ESTIMADO — não há tabela de NPS coletado. Proxy calculado via frequencia_visitas dos contatos.',
    total_contatos: total,
    com_dados_frequencia: comDados,
    sem_dados_frequencia: Number(totais?.sem_visita ?? 0),
    promotores,
    neutros,
    detratores,
    nps_proxy: npsProxy,
    score_normalizado: scoreCalc,
    ltv_por_segmento: ltvPorFreq,
    distribuicao_tier: tierDist,
  };

  if (total === 0) {
    return {
      score: 50,
      insight: 'Nenhum contato encontrado. NPS não calculável.',
      data: dadosColetados,
    };
  }

  const prompt = `Você é analista de dados do restaurante Madonna Cucina.
Analise o NPS estimado abaixo e responda em JSON com exatamente 3 campos:
- score: número de 0 a 100 (use o valor já calculado: ${scoreCalc})
- insight: string em português, máximo 200 chars, acionável — deixe claro que é NPS ESTIMADO e não coletado
- data: objeto com KPIs relevantes (nps_proxy, promotores_pct, neutros_pct, detratores_pct, total_com_dados, alerta_nps_estimado)

Dados: ${JSON.stringify(dadosColetados, null, 2)}

Responda SOMENTE com JSON válido, sem markdown.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = JSON.parse(text) as AgentResult;
  return parsed;
}

if (require.main === module) {
  runAgent('nps-tracker', 'comercial', main).then(() => process.exit(0)).catch(console.error);
}
