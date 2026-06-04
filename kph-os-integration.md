# kph-os Integration

O diretório `kph-os` não foi encontrado localmente em `/Users/henriqueguimaraes/Desktop/_HOS/kph-os/`.
Os arquivos abaixo precisam ser adicionados quando o projeto estiver disponível.

---

## 1. `app/(dashboard)/comercial/page.tsx`

Se já existir, adicionar o componente `InsightPanel` que busca de:
```
GET /api/intelligence/insights?module=comercial&period=daily
```

Exemplo de adição mínima ao final da página existente:
```tsx
import { InsightPanel } from "@/components/intelligence/InsightPanel";

// dentro do JSX da página:
<InsightPanel module="comercial" period="daily" />
```

Se não existir, criar a página com estrutura básica:
```tsx
// app/(dashboard)/comercial/page.tsx
import { InsightPanel } from "@/components/intelligence/InsightPanel";

export default function ComercialPage() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Comercial — Madonna Cucina</h1>
      <InsightPanel module="comercial" period="daily" />
    </div>
  );
}
```

---

## 2. `app/(dashboard)/inteligencia/orquestrador/page.tsx`

Se existir, adicionar card "Comercial" lendo de:
```
GET /api/intelligence/scores?module=comercial
```

Exemplo:
```tsx
<ScoreCard
  module="comercial"
  label="Serena — Comercial"
  endpoint="/api/intelligence/scores?module=comercial"
/>
```

---

## 3. Tabelas necessárias no Supabase kph-os

```sql
-- Execuções dos agentes
CREATE TABLE agent_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module      text NOT NULL,          -- 'comercial'
  agent_name  text NOT NULL,
  status      text NOT NULL,          -- 'success' | 'error'
  result      jsonb,
  executed_at timestamptz NOT NULL DEFAULT now()
);

-- Score consolidado diário
CREATE TABLE kph_intelligence_scores (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module       text NOT NULL,         -- 'comercial'
  score        integer NOT NULL,      -- 0–100
  breakdown    jsonb,
  generated_at timestamptz NOT NULL DEFAULT now()
);

-- Insights em linguagem natural
CREATE TABLE kph_insights (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module     text NOT NULL,           -- 'comercial'
  insight    text NOT NULL,
  score      integer,
  period     text NOT NULL,           -- 'daily'
  created_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 4. API Routes necessárias em kph-os

### `app/api/agents/run/route.ts`
Recebe POST com `{ module, agent_name, status, result, executed_at }` e persiste.

### `app/api/intelligence/insights/route.ts`
GET com `?module=comercial&period=daily` → retorna últimos insights.

### `app/api/intelligence/scores/route.ts`
GET com `?module=comercial` → retorna score mais recente + histórico.
