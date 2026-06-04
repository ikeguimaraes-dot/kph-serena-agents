# kph-serena-agents

Engine de inteligência do Orkestri embarcada dentro da Serena — célula Comercial/Ruptura do Grupo KPH.

## Princípio central

O Orkestri roda **dentro da Serena**: lê os dados do Supabase da Serena (Madonna Cucina), analisa via Claude Haiku e grava os resultados no **mesmo** Supabase. Fonte e destino são o mesmo banco. Nenhuma integração com o kph-os por enquanto.

```
Supabase Serena (fgntcrxuhfwcauvahaiz)
    lê                       grava
  contacts              orkestri_runs
  conversations         orkestri_scores
  handoff_sessions      orkestri_insights
  serena_metrics        orkestri_learning
  reservas
```

## Schema descoberto (04/06/2026)

| Tabela | Linhas | Descrição |
|---|---|---|
| `contacts` | 185 | Leads/clientes — `lead_score`, `estagio_kanban`, `ltv_total` |
| `conversations` | 2157 | Mensagens brutas WhatsApp |
| `handoff_sessions` | 112 | Transferências humano — `motivo` (texto livre), `status` |
| `serena_metrics` | 624 | Métricas por conversa — `intencao_detectada`, `handoff_acionado`, `custo_usd` |
| `reservas` | 8 | Reservas own-system (status: confirmada/pendente/cancelada) |
| `faq_items` | 6 | Base de conhecimento |
| `operadores` | 2 | Operadores do painel |

> `lead_score` e `conversa_resolvida` estão 100% NULL — campos ainda não populados pela Serena. Os agentes documentam isso explicitamente nos seus outputs.

## Tabelas de destino (orkestri_*)

Criadas via migration direta no Supabase da Serena em 04/06/2026:

| Tabela | Descrição |
|---|---|
| `orkestri_runs` | Log de cada execução de agente (module, agent_name, status, result jsonb) |
| `orkestri_scores` | Score consolidado por módulo (score 0-100, breakdown jsonb) |
| `orkestri_insights` | Insight textual diário por módulo |
| `orkestri_learning` | Propostas de melhoria geradas pelo Learning Machine (status: pending/approved/dismissed) |

Todas com RLS habilitado, policy `TO authenticated`.

## Agentes

| Agente | Arquivo | Fonte | Score |
|---|---|---|---|
| reservas-monitor | `agents/reservas-monitor.ts` | `reservas` | confirmadas/(total-canceladas)×100 |
| funil-comercial-analyzer | `agents/funil-comercial-analyzer.ts` | `contacts` | (qualificado+proposta+fechado)/total×100 |
| nps-tracker | `agents/nps-tracker.ts` | `contacts` (proxy) | NPS estimado normalizado 0-100 |
| handoffs-analyzer | `agents/handoffs-analyzer.ts` | `handoff_sessions` + `serena_metrics` | taxa de resolução autônoma×100 |
| learning-machine | `agents/learning-machine.ts` | handoffs + metrics | propostas inseridas×20 (máx 100) |
| performance-scorer | `agents/performance-scorer.ts` | `orkestri_runs` (agentes 1-4) | média ponderada 20/30/20/30 |

**learning-machine** é o coração do Orkestri: todo dia analisa os padrões da Serena e gera propostas concretas (FAQ, ajuste de prompt, nova intenção) que o time aprova no painel.

## Pesos do score comercial

```
reservas:  20%
funil:     30%
nps:       20%
handoffs:  30%
```

## Estrutura

```
kph-serena-agents/
├── agents/
│   ├── reservas-monitor.ts
│   ├── funil-comercial-analyzer.ts
│   ├── nps-tracker.ts
│   ├── handoffs-analyzer.ts
│   ├── learning-machine.ts
│   └── performance-scorer.ts
├── lib/
│   ├── serena-db.ts        # conexão postgres + interfaces TypeScript
│   └── run-agent.ts        # wrapper que grava em orkestri_runs
├── scripts/
│   └── run-all.ts          # executa os 6 agentes em sequência
├── .github/workflows/
│   └── daily-agents.yml    # schedule 06h BRT + workflow_dispatch
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## Variáveis de ambiente

```bash
cp .env.example .env.local
# preencher SERENA_DATABASE_URL e ANTHROPIC_API_KEY
```

| Variável | Descrição |
|---|---|
| `SERENA_DATABASE_URL` | Connection string direta ao Postgres da Serena |
| `ANTHROPIC_API_KEY` | Chave Anthropic (modelo: claude-haiku-4-5-20251001) |
| `DISCORD_WEBHOOK_ORQUESTRADOR` | Webhook do canal #orquestrador para alertas de falha |

## Como rodar localmente

```bash
npm install
cp .env.example .env.local

npm run run:all         # todos os agentes
npm run run:reservas    # agente individual
npm run run:funil
npm run run:nps
npm run run:handoffs
npm run run:learning
npm run run:scorer
npm run typecheck       # verificar tipos
```

## GitHub Actions

Schedule: todo dia às 06h BRT (09h UTC).

Secrets necessários no repo GitHub (Settings → Secrets → Actions):
- `SERENA_DATABASE_URL`
- `ANTHROPIC_API_KEY`
- `DISCORD_WEBHOOK_ORQUESTRADOR`

Manual dispatch: Actions → "Orkestri — Serena Daily Agents" → Run workflow → selecionar agente.

## Surface no painel

Os resultados aparecem em `madonna-painel.vercel.app/orkestri`:

- Score comercial com breakdown por componente
- Insight do dia gerado pelo Haiku
- Propostas de melhoria (orkestri_learning) com botões Aprovar/Descartar
- Status da última execução de cada agente

## Roadmap

- [ ] lead_score no funil quando a Serena popular o campo
- [ ] NPS real via formulário pós-visita (substituir proxy por frequencia_visitas)
- [ ] Bridge opcional: espelhar módulo `comercial` para o kph-os quando a Serena for integrada ao grupo
- [ ] Agente de custo de IA (custo_usd diário vs baseline)
- [ ] Multi-restaurante: onboarding do Meet & Eat

---

Stack: Node.js + TypeScript · Modelo: claude-haiku-4-5-20251001 · DB: Supabase PostgreSQL (fgntcrxuhfwcauvahaiz)
