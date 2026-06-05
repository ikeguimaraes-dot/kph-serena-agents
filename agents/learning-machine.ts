/**
 * learning-machine
 * Analisa padrões recorrentes nos dados da Serena e gera propostas concretas
 * de melhoria — FAQ, prompt update, nova intenção, integração.
 *
 * Threshold: gera proposta sempre que:
 *   - Um tema de handoff representa > 15% do volume total
 *   - lead_score majoritariamente nulo (> 50%)
 *   - Taxa de cancelamento de reservas > 40%
 *   - Qualquer padrão recorrente identificado pelo Haiku
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../lib/serena-db';
import { runAgent, AgentResult } from '../lib/run-agent';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface LearningProposal {
  tipo: 'faq' | 'prompt_update' | 'nova_intencao' | 'integracao' | 'treino';
  prioridade: 'alta' | 'media' | 'baixa';
  titulo: string;
  descricao: string;
  evidencia: string;
  impacto_estimado: string;
  contexto?: Record<string, unknown>;
}

export async function main(): Promise<AgentResult> {
  // ── 1. Handoffs agrupados com exemplos reais ─────────────────────────────
  const motivosHandoff = await sql<{
    prefixo: string; count: string; pct: string; exemplos: string[];
  }[]>`
    SELECT
      CASE
        WHEN motivo ILIKE 'reserva%'                          THEN 'Reserva'
        WHEN motivo ILIKE 'cliente solicitou%'                THEN 'Cliente solicitou atendimento'
        WHEN motivo ILIKE 'evento%'                           THEN 'Evento'
        WHEN motivo ILIKE 'reclamac%' OR motivo ILIKE 'reclamaç%' THEN 'Reclamação'
        WHEN motivo ILIKE 'pagamento%'                        THEN 'Pagamento'
        WHEN motivo ILIKE 'cardapio%' OR motivo ILIKE 'cardápio%' THEN 'Cardápio'
        WHEN motivo IS NULL                                   THEN '(sem motivo)'
        ELSE 'Outros'
      END AS prefixo,
      COUNT(*)::text AS count,
      ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)::text AS pct,
      ARRAY_AGG(motivo ORDER BY motivo) FILTER (WHERE motivo IS NOT NULL) AS exemplos
    FROM handoff_sessions
    GROUP BY prefixo
    ORDER BY COUNT(*) DESC
  `;

  const totalHandoffs = motivosHandoff.reduce((s, r) => s + Number(r.count), 0);

  // ── 2. Intenções com alta taxa de handoff ────────────────────────────────
  const intencoesProblem = await sql<{
    intencao_detectada: string | null;
    total: string;
    com_handoff: string;
    taxa_handoff: string;
  }[]>`
    SELECT
      intencao_detectada,
      COUNT(*)::text                                                        AS total,
      COUNT(*) FILTER (WHERE handoff_acionado = true)::text                AS com_handoff,
      ROUND(100.0 * COUNT(*) FILTER (WHERE handoff_acionado = true)
            / NULLIF(COUNT(*), 0), 1)::text                                AS taxa_handoff
    FROM serena_metrics
    GROUP BY intencao_detectada
    HAVING COUNT(*) FILTER (WHERE handoff_acionado = true) > 2
    ORDER BY COUNT(*) FILTER (WHERE handoff_acionado = true) DESC
    LIMIT 10
  `;

  // ── 3. Qualidade do funil ────────────────────────────────────────────────
  const [funilQuality] = await sql<{
    total: string; null_score: string; pct_null: string;
  }[]>`
    SELECT
      COUNT(*)::text                                                        AS total,
      COUNT(*) FILTER (WHERE lead_score IS NULL)::text                     AS null_score,
      ROUND(100.0 * COUNT(*) FILTER (WHERE lead_score IS NULL)
            / NULLIF(COUNT(*), 0), 1)::text                                AS pct_null
    FROM contacts
  `;

  // ── 4. Taxa de cancelamento de reservas ─────────────────────────────────
  const [reservasStats] = await sql<{
    total: string; canceladas: string; confirmadas: string; pct_cancel: string;
  }[]>`
    SELECT
      COUNT(*)::text                                                        AS total,
      COUNT(*) FILTER (WHERE status = 'cancelada')::text                   AS canceladas,
      COUNT(*) FILTER (WHERE status = 'confirmada')::text                  AS confirmadas,
      ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'cancelada')
            / NULLIF(COUNT(*), 0), 1)::text                                AS pct_cancel
    FROM reservas
    WHERE criado_em >= NOW() - INTERVAL '30 days'
  `;

  // ── 5. Exemplos reais dos "Outros" handoffs ──────────────────────────────
  const exemplosOutros = await sql<{ motivo: string }[]>`
    SELECT DISTINCT motivo
    FROM handoff_sessions
    WHERE motivo IS NOT NULL
      AND motivo NOT ILIKE 'reserva%'
      AND motivo NOT ILIKE 'cliente solicitou%'
      AND motivo NOT ILIKE 'evento%'
      AND motivo NOT ILIKE 'reclamac%'
      AND motivo NOT ILIKE 'pagamento%'
    ORDER BY motivo
    LIMIT 20
  `;

  // ── 6. Constrói contexto para o Haiku ────────────────────────────────────
  const contextoAnalise = {
    handoffs: {
      total: totalHandoffs,
      distribuicao: motivosHandoff.map(m => ({
        tema: m.prefixo,
        volume: Number(m.count),
        percentual: Number(m.pct),
        exemplos: (m.exemplos || []).slice(0, 3),
      })),
      exemplos_outros: exemplosOutros.map(e => e.motivo).slice(0, 15),
    },
    funil: {
      total_contatos: Number(funilQuality?.total ?? 0),
      lead_score_nulo: Number(funilQuality?.null_score ?? 0),
      pct_sem_qualificacao: Number(funilQuality?.pct_null ?? 0),
    },
    reservas: {
      total_30d: Number(reservasStats?.total ?? 0),
      canceladas: Number(reservasStats?.canceladas ?? 0),
      confirmadas: Number(reservasStats?.confirmadas ?? 0),
      taxa_cancelamento_pct: Number(reservasStats?.pct_cancel ?? 0),
    },
    intencoes_problema: intencoesProblem.slice(0, 5).map(i => ({
      intencao: i.intencao_detectada,
      handoffs: Number(i.com_handoff),
      taxa_pct: Number(i.taxa_handoff),
    })),
  };

  // ── 7. Prompt — instrução explícita com thresholds ───────────────────────
  const prompt = `Você é o Learning Machine do Orkestri, sistema de melhoria contínua da Serena (IA do restaurante Madonna Cucina).

DADOS ANALISADOS:
${JSON.stringify(contextoAnalise, null, 2)}

REGRA DE THRESHOLD — gere uma proposta para CADA uma das condições abaixo que for verdadeira:
1. Qualquer tema de handoff com percentual > 15% do total
2. Taxa de cancelamento de reservas > 40%
3. Percentual de lead_score nulo > 50%
4. Qualquer intenção com mais de 5 handoffs nos dados
5. Exemplos de handoff "Outros" que revelam um padrão identificável

FORMATO — responda com um JSON array. Cada item deve ter EXATAMENTE estes campos:
{
  "tipo": "faq" | "prompt_update" | "nova_intencao" | "integracao" | "treino",
  "prioridade": "alta" | "media" | "baixa",
  "titulo": "Título curto e direto (máx 80 chars)",
  "descricao": "O que fazer concretamente — ação específica (máx 200 chars)",
  "evidencia": "Número(s) que justificam a proposta (ex: '88 handoffs = 77% em Outros')",
  "impacto_estimado": "Resultado esperado se implementado (ex: '-20 handoffs/mês')"
}

REGRAS:
- Não repita propostas óbvias sem evidência nos dados
- Seja específico: cite motivos reais de handoff quando disponíveis
- Responda SOMENTE com o JSON array, sem markdown, sem texto extra`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  // Strip markdown fences (mesma proteção dos outros agentes)
  const raw = response.content[0].type === 'text' ? response.content[0].text : '[]';
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let propostas: LearningProposal[] = [];
  try {
    const parsed = JSON.parse(text);
    propostas = Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error('[learning-machine] JSON.parse failed. Raw response:', raw.slice(0, 300));
    propostas = [];
  }

  // ── 8. Inserir propostas em orkestri_learning ────────────────────────────
  let inseridas = 0;
  for (const p of propostas) {
    if (!p.titulo && !p.descricao) continue; // skip proposals missing required fields

    try {
      await sql`
        INSERT INTO orkestri_learning
          (titulo, proposta, tipo, prioridade, descricao, evidencia, impacto_estimado, contexto, status)
        VALUES (
          ${(p.titulo ?? '').slice(0, 200)},
          ${(p.titulo ?? p.descricao ?? '').slice(0, 500)},
          ${['faq','prompt_update','nova_intencao','integracao','treino'].includes(p.tipo) ? p.tipo : 'treino'},
          ${['alta','media','baixa'].includes(p.prioridade) ? p.prioridade : 'media'},
          ${(p.descricao ?? '').slice(0, 500)},
          ${(p.evidencia ?? '').slice(0, 300)},
          ${(p.impacto_estimado ?? '').slice(0, 200)},
          ${sql.json((p.contexto ?? {
            tema_handoff: contextFromProposal(p, contextoAnalise),
          }) as never)},
          'pending'
        )
      `;
      inseridas++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[learning-machine] Failed to insert proposal:', msg);
    }
  }

  return {
    score: Math.min(100, inseridas * 20),
    insight: `${inseridas} proposta(s) de melhoria gerada(s) e salva(s) em orkestri_learning.`,
    data: {
      propostas_geradas: propostas.length,
      propostas_inseridas: inseridas,
      titulos: propostas.map(p => p.titulo),
      dados_analisados: {
        total_handoffs: totalHandoffs,
        pct_sem_score: Number(funilQuality?.pct_null ?? 0),
        taxa_cancelamento: Number(reservasStats?.pct_cancel ?? 0),
      },
    },
  };
}

// Extrai contexto relevante com base no título/tipo da proposta
function contextFromProposal(
  p: LearningProposal,
  ctx: Record<string, unknown>
): Record<string, unknown> {
  return { tipo: p.tipo, prioridade: p.prioridade, fonte: 'learning-machine', ctx };
}

if (require.main === module) {
  runAgent('learning-machine', 'comercial', main).then(() => process.exit(0)).catch(console.error);
}
