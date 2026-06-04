# kph-serena-agents

Agentes de IA que lêem dados do restaurante **Madonna Cucina** via Serena (API REST em Railway) e gravam resultados no Supabase do **kph-os** (holding).

---

## Propósito

Liga **Serena** (IA do restaurante) → **kph-os** (painel de inteligência da holding).

Executa diariamente às 06:00 BRT via GitHub Actions, analisando:
- Ocupação e reservas
- Funil comercial (leads vs meta)
- NPS consolidado
- Eficiência da automação (handoffs)

Gera um **score 0-100 por dimensão** + **score final ponderado** + **insight em português** para o painel kph-os.

---

## STEP 0 — Fonte de dados (auditoria realizada)

**Fonte: REST API Serena (Railway)** — não há acesso direto ao banco de dados.

| Parâmetro | Valor |
|-----------|-------|
| Base URL | `https://restaurant-ai-production-bb5d.up.railway.app` |
| Auth | `X-Admin-Secret: kph@serena2026` |
| restaurant_id | `madonna_cucina` |

### Endpoints utilizados

| Endpoint | Agente |
|----------|--------|
| `GET /api/contacts/stats` | nps-tracker, funil-comercial-analyzer |
| `GET /api/contacts/funil-stats` | funil-comercial-analyzer |
| `GET /api/serena/metrics?periodo=30d` | handoffs-analyzer |
| `GET /api/serena/handoffs/categorizados?periodo=30d` | handoffs-analyzer |
| `GET /api/agenda/madonna_cucina/ocupacao?mes=YYYY-MM` | reservas-monitor |
| `GET /api/agenda/madonna_cucina/reservas?data=YYYY-MM-DD` | reservas-monitor |
| `GET /api/reports?rid=madonna_cucina&days=30` | nps-tracker |

---

## Como os agentes funcionam

```
scripts/run-all.ts
  └── agents/performance-scorer.ts
        ├── agents/reservas-monitor.ts        (30%)
        ├── agents/funil-comercial-analyzer.ts (30%)
        ├── agents/nps-tracker.ts             (20%)
        └── agents/handoffs-analyzer.ts       (20%)
```

Cada agente:
1. Busca dados via `lib/serena-source.ts`
2. Monta prompt e chama **claude-haiku-4-5-20251001**
3. Recebe JSON `{ score, insight, data }`
4. Registra via `lib/run-agent.ts` → Supabase `agent_runs`

O `performance-scorer` agrega os 4 scores (média ponderada) e grava:
- `kph_intelligence_scores` — score final + breakdown
- `kph_insights` — insight consolidado

---

## Secrets necessários

| Secret | Descrição |
|--------|-----------|
| `ANTHROPIC_API_KEY` | Chave Anthropic para claude-haiku |
| `KPH_SUPABASE_URL` | URL do projeto Supabase kph-os |
| `KPH_SUPABASE_SERVICE_ROLE_KEY` | Service role key do Supabase kph-os |
| `SERENA_API_URL` | Base URL da API Serena (Railway) |
| `SERENA_API_KEY` | Header `X-Admin-Secret` da Serena |
| `KPH_API_SECRET` | Bearer token para `POST /api/agents/run` no kph-os |
| `DISCORD_WEBHOOK_ORQUESTRADOR` | Webhook Discord para alertas de falha |

---

## Resultados no kph-os

Os agentes gravam em 3 tabelas do Supabase kph-os:

| Tabela | Conteúdo |
|--------|----------|
| `agent_runs` | Log de cada execução (status, resultado, timestamp) |
| `kph_intelligence_scores` | Score diário por módulo + breakdown por agente |
| `kph_insights` | Insight em linguagem natural, score, período |

Ver `kph-os-integration.md` para DDL das tabelas e rotas de API necessárias.

---

## Como rodar localmente

```bash
# 1. Clonar e instalar
git clone https://github.com/ikeguimaraes-dot/kph-serena-agents.git
cd kph-serena-agents
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais

# 3. Executar
npm run dev
```

### Rodar agente individual

```bash
npx ts-node agents/reservas-monitor.ts
npx ts-node agents/funil-comercial-analyzer.ts
npx ts-node agents/nps-tracker.ts
npx ts-node agents/handoffs-analyzer.ts
npx ts-node agents/performance-scorer.ts
```

---

## Estrutura do projeto

```
kph-serena-agents/
├── agents/
│   ├── reservas-monitor.ts         # Ocupação e reservas
│   ├── funil-comercial-analyzer.ts # Leads vs meta
│   ├── nps-tracker.ts              # NPS normalizado
│   ├── handoffs-analyzer.ts        # Eficiência automação
│   └── performance-scorer.ts       # Orquestrador + score final
├── lib/
│   ├── serena-source.ts            # Cliente HTTP Serena API
│   ├── kph-supabase.ts             # Cliente Supabase kph-os
│   └── run-agent.ts                # Wrapper de execução + logging
├── scripts/
│   └── run-all.ts                  # Entry point (GitHub Actions)
├── .github/
│   └── workflows/
│       └── daily-agents.yml        # Cron 06:00 BRT diário
├── kph-os-integration.md           # Guia de integração no kph-os
└── .env.example
```
