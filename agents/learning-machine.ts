/**
 * learning-machine
 * Coração do Orkestri — analisa padrões recorrentes e gera propostas de melhoria.
 * Lê handoff_sessions + serena_metrics → Claude Haiku → insere em orkestri_learning.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../lib/serena-db';
import { runAgent, AgentResult } from '../lib/run-agent';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface LearningProposal {
  tipo: 'faq' | 'prompt_update' | 'nova_intencao' | 'treino';
  prioridade: 'alta' | 'media' | 'baixa';
  proposta: string;
  contexto: Record<string, unknown>;
}

export async function main(): Promise<AgentResult> {
  // Handoffs recorrentes agrupados por motivo semântico
  const motivosHandoff = await sql<{ prefixo: string; count: string; exemplos: string[] }[]>`
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

  // Intenções com mais handoffs (não resolvidas pela IA)
  const intencoesProblem = await sql<{
    intencao_detectada: string | null;
    total: string;
    com_handoff: string;
    taxa_handoff: string;
  }[]>`
    SELECT
      intencao_detectada,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE handoff_acionado = true)::text AS com_handoff,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE handoff_acionado = true) / NULLIF(COUNT(*), 0),
        1
      )::text AS taxa_handoff
    FROM serena_metrics
    GROUP BY intencao_detectada
    HAVING COUNT(*) FILTER (WHERE handoff_acionado = true) > 0
    ORDER BY com_handoff DESC
    LIMIT 10
  `;

  // Contagem de "serena_admitiu_nao_saber"
  const [naoSaberCount] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM serena_metrics
    WHERE serena_admitiu_nao_saber = true
  `;

  // Intenções desconhecidas — exemplos de conteúdo
  const intencoesDesconhecidas = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM serena_metrics
    WHERE intencao_detectada = 'desconhecida'
  `;

  // Exemplos de conversas com intenção desconhecida (últimas 10)
  const exemplosDesconhecidos = await sql<{ content: string; created_at: string }[]>`
    SELECT c.content, c.created_at::text
    FROM conversations c
    JOIN serena_metrics sm ON sm.user_phone = c.user_phone
    WHERE sm.intencao_detectada = 'desconhecida'
      AND c.role = 'user'
      AND LENGTH(c.content) > 10
    ORDER BY c.created_at DESC
    LIMIT 10
  `;

  const dadosParaHaiku = {
    handoffs_recorrentes: motivosHandoff,
    intencoes_nao_resolvidas: intencoesProblem,
    serena_admitiu_nao_saber: Number(naoSaberCount?.count ?? 0),
    intencoes_desconhecidas_count: Number(intencoesDesconhecidas[0]?.count ?? 0),
    exemplos_intencoes_desconhecidas: exemplosDesconhecidos.map((e: { content: string; created_at: string }) => e.content).slice(0, 5),
  };

  const prompt = `Você é o Learning Machine do Orkestri, engine de melhoria contínua da Serena (IA da Madonna Cucina).

Dados de hoje:
- Handoffs recorrentes: ${JSON.stringify(motivosHandoff.map((m: { prefixo: string; count: string; exemplos: string[] }) => `${m.prefixo}: ${m.count} ocorrências`))}
- Intenções não resolvidas: ${JSON.stringify(intencoesProblem.slice(0, 5).map((i: { intencao_detectada: string | null; total: string; com_handoff: string; taxa_handoff: string }) => `${i.intencao_detectada}: ${i.com_handoff} handoffs de ${i.total} conversas`))}
- Serena admitiu não saber: ${naoSaberCount?.count ?? 0} vezes
- Intenções desconhecidas: ${intencoesDesconhecidas[0]?.count ?? 0} ocorrências
- Exemplos de mensagens sem intenção: ${JSON.stringify(exemplosDesconhecidos.map((e: { content: string; created_at: string }) => e.content).slice(0, 5))}

Gere de 3 a 5 propostas CONCRETAS de melhoria. Para cada proposta:
- tipo: "faq" | "prompt_update" | "nova_intencao" | "treino"
- prioridade: "alta" | "media" | "baixa"
- proposta: texto claro do que mudar (ex: "Adicionar ao FAQ: 'O que está incluído no menu degustação do Dia dos Namorados?'")
- contexto: objeto com dados que justificam a proposta

Retorne SOMENTE um JSON array de propostas, sem markdown.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';

  let propostas: LearningProposal[] = [];
  try {
    propostas = JSON.parse(text) as LearningProposal[];
  } catch {
    console.error('[learning-machine] Failed to parse Haiku response as JSON:', text.slice(0, 200));
    propostas = [];
  }

  // Inserir cada proposta em orkestri_learning
  let inseridas = 0;
  for (const p of propostas) {
    try {
      await sql`
        INSERT INTO orkestri_learning (proposta, tipo, prioridade, contexto, status)
        VALUES (
          ${p.proposta ?? ''},
          ${p.tipo ?? 'treino'},
          ${p.prioridade ?? 'media'},
          ${sql.json((p.contexto ?? {}) as never)},
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
    score: Math.min(100, inseridas * 20), // 5 propostas = score 100
    insight: `${inseridas} proposta(s) de melhoria gerada(s) e salva(s) em orkestri_learning.`,
    data: {
      propostas_geradas: propostas.length,
      propostas_inseridas: inseridas,
      propostas,
      dados_analisados: dadosParaHaiku,
    },
  };
}

if (require.main === module) {
  runAgent('learning-machine', 'comercial', main).then(() => process.exit(0)).catch(console.error);
}
