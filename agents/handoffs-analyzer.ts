/**
 * handoffs-analyzer
 * Lê handoff_sessions + serena_metrics.
 * Agrupa motivos semanticamente, calcula taxa de resolução autônoma.
 * Score = taxa_resolucao_autonoma * 100
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../lib/serena-db';
import { runAgent, AgentResult } from '../lib/run-agent';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function main(): Promise<AgentResult> {
  // Total handoffs por status
  const handoffsPorStatus = await sql<{ status: string | null; count: string }[]>`
    SELECT status, COUNT(*)::text AS count
    FROM handoff_sessions
    GROUP BY status
    ORDER BY count DESC
  `;

  // Motivos agrupados semanticamente pelo início do texto
  const motivosAgrupados = await sql<{ prefixo: string; count: string; exemplos: string[] }[]>`
    SELECT
      CASE
        WHEN motivo ILIKE 'reserva%'                        THEN 'Reserva'
        WHEN motivo ILIKE 'cliente solicitou%'              THEN 'Cliente solicitou atendimento'
        WHEN motivo ILIKE 'fornecedor%'                     THEN 'Fornecedor'
        WHEN motivo ILIKE 'evento%'                         THEN 'Evento'
        WHEN motivo ILIKE 'reclamação%' OR motivo ILIKE 'reclamacao%' THEN 'Reclamação'
        WHEN motivo ILIKE 'pagamento%'                      THEN 'Pagamento'
        WHEN motivo IS NULL                                 THEN '(sem motivo)'
        ELSE 'Outros'
      END AS prefixo,
      COUNT(*)::text AS count,
      ARRAY_AGG(DISTINCT motivo ORDER BY motivo) FILTER (WHERE motivo IS NOT NULL) AS exemplos
    FROM handoff_sessions
    GROUP BY prefixo
    ORDER BY count DESC
  `;

  // Tempo médio de resolução
  const [tempoResolucao] = await sql<{
    avg_minutos: string;
    resolvidos: string;
    em_atendimento: string;
    aguardando: string;
  }[]>`
    SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60), 1)::text AS avg_minutos,
      COUNT(*) FILTER (WHERE status = 'resolvido')::text AS resolvidos,
      COUNT(*) FILTER (WHERE status = 'em_atendimento')::text AS em_atendimento,
      COUNT(*) FILTER (WHERE status = 'aguardando')::text AS aguardando
    FROM handoff_sessions
  `;

  // Taxa de resolução autônoma (conversas sem handoff / total conversas)
  const [autonomiaStats] = await sql<{
    total_conversas: string;
    com_handoff: string;
    sem_handoff: string;
  }[]>`
    SELECT
      COUNT(DISTINCT conversation_id)::text AS total_conversas,
      COUNT(DISTINCT conversation_id) FILTER (WHERE handoff_acionado = true)::text AS com_handoff,
      COUNT(DISTINCT conversation_id) FILTER (WHERE handoff_acionado = false OR handoff_acionado IS NULL)::text AS sem_handoff
    FROM serena_metrics
    WHERE conversation_id IS NOT NULL
  `;

  // Intenções com mais handoffs
  const intencoesProblem = await sql<{
    intencao_detectada: string | null;
    total: string;
    com_handoff: string;
  }[]>`
    SELECT
      intencao_detectada,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE handoff_acionado = true)::text AS com_handoff
    FROM serena_metrics
    GROUP BY intencao_detectada
    ORDER BY com_handoff DESC
    LIMIT 10
  `;

  const totalConversas = Number(autonomiaStats?.total_conversas ?? 0);
  const semHandoff = Number(autonomiaStats?.sem_handoff ?? 0);
  const taxaAutonomia =
    totalConversas > 0 ? (semHandoff / totalConversas) * 100 : 0;
  const scoreCalc = Math.round(taxaAutonomia);

  const dadosColetados = {
    handoffs_por_status: handoffsPorStatus,
    motivos_agrupados: motivosAgrupados,
    tempo_resolucao: tempoResolucao,
    autonomia: autonomiaStats,
    taxa_resolucao_autonoma_pct: taxaAutonomia.toFixed(1),
    intencoes_com_mais_handoffs: intencoesProblem,
  };

  const prompt = `Você é analista de dados do restaurante Madonna Cucina.
Analise os dados de handoffs e autonomia da IA Serena abaixo. Responda em JSON com exatamente 3 campos:
- score: número de 0 a 100 (use o valor já calculado: ${scoreCalc} — taxa de resolução autônoma)
- insight: string em português, máximo 200 chars, acionável — mencione o motivo de handoff mais frequente como oportunidade de automação
- data: objeto com KPIs relevantes (taxa_autonomia_pct, total_handoffs, motivo_mais_frequente, intencao_mais_problemática, resolvidos, em_atendimento)

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
  runAgent('handoffs-analyzer', 'comercial', main).then(() => process.exit(0)).catch(console.error);
}
