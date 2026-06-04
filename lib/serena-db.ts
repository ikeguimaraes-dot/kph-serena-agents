import 'dotenv/config';
import postgres from 'postgres';

if (!process.env.SERENA_DATABASE_URL) {
  throw new Error('SERENA_DATABASE_URL is required');
}

export const sql = postgres(process.env.SERENA_DATABASE_URL!, { ssl: 'require' });

// ── Tabelas de leitura ────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  celular: string | null;
  nome: string | null;
  sobrenome: string | null;
  email: string | null;
  lead_score: string | null; // quente/morno/frio — todos NULL no momento
  estagio_kanban: string | null;
  tier: string | null;
  ltv_total: number | null;
  total_eventos: number | null;
  frequencia_visitas: number | null;
  ticket_medio: number | null;
  ultima_visita: string | null;
  total_handoffs: number | null;
  criado_em: string | null;
  atualizado_em: string | null;
}

export interface Conversation {
  id: number;
  user_phone: string | null;
  restaurant_id: string | null;
  role: string | null; // 'user' | 'assistant'
  content: string | null;
  created_at: string | null;
}

export interface HandoffSession {
  id: number;
  user_phone: string | null;
  restaurant_id: string | null;
  motivo: string | null;
  status: string | null; // 'resolvido' | 'em_atendimento' | 'aguardando'
  atendente_nome: string | null;
  created_at: string | null;
  resolved_at: string | null;
}

export interface SerenaMetric {
  id: string;
  conversation_id: number | null;
  user_phone: string | null;
  restaurant_id: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  custo_usd: number | null;
  latencia_ms: number | null;
  tools_chamadas: string[] | null;
  handoff_acionado: boolean | null;
  handoff_motivo: string | null;
  handoff_categoria: string | null;
  cliente_pediu_humano: boolean | null;
  serena_admitiu_nao_saber: boolean | null;
  conversa_resolvida: boolean | null;
  enviou_link_tagme: boolean | null;
  intencao_detectada: string | null;
  horario_conversa: string | null;
  duracao_segundos: number | null;
  num_mensagens: number | null;
  prompt_versao_id: number | null;
  criado_em: string | null;
}

export interface Reserva {
  id: string;
  restaurant_id: string | null;
  turno_id: string | null;
  evento_id: string | null;
  cliente_phone: string | null;
  cliente_nome: string | null;
  cliente_email: string | null;
  data: string | null;
  hora_inicio: string | null;
  posicoes: number | null;
  status: string | null; // 'cancelada' | 'pendente' | 'confirmada'
  canal: string | null;
  observacoes: string | null;
  pagamento_status: string | null;
  pagamento_valor: number | null;
  confirmado_whatsapp: boolean | null;
  confirmado_email: boolean | null;
  criado_em: string | null;
  atualizado_em: string | null;
}

// ── Tabelas de escrita ────────────────────────────────────────────────────────

export interface OrkestriRun {
  id: number;
  module: string;
  agent_name: string;
  status: 'success' | 'error' | 'running';
  result: Record<string, unknown> | null;
  executed_at: string;
}

export interface OrkestriScore {
  id: number;
  module: string;
  score: number;
  breakdown: Record<string, unknown>;
  generated_at: string;
}

export interface OrkestriInsight {
  id: number;
  module: string;
  insight: string;
  score: number;
  period: string;
  created_at: string;
}

export interface OrkestriLearning {
  id: number;
  proposta: string;
  tipo: string;
  prioridade: 'alta' | 'media' | 'baixa';
  status: 'pending' | 'approved' | 'dismissed';
  contexto: Record<string, unknown>;
  created_at: string;
}
