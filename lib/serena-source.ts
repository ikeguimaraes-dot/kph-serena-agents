// Cliente HTTP para a API Serena (REST)
// Base: https://restaurant-ai-production-bb5d.up.railway.app
// Auth: X-Admin-Secret header
// restaurant_id: madonna_cucina

const BASE =
  process.env.SERENA_API_URL ??
  "https://restaurant-ai-production-bb5d.up.railway.app";
const ADMIN_KEY = process.env.SERENA_API_KEY ?? "";
const RID = "madonna_cucina";

export const serena = {
  async get<T>(path: string): Promise<T> {
    const url = `${BASE}${path}`;
    const res = await fetch(url, {
      headers: {
        "X-Admin-Secret": ADMIN_KEY,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`Serena API error ${res.status}: ${path}`);
    }
    return res.json() as Promise<T>;
  },

  RID,

  contactStats: () => serena.get<Record<string, unknown>>("/api/contacts/stats"),
  funilStats: () => serena.get<Record<string, unknown>>("/api/contacts/funil-stats"),
  serenaMetrics: (periodo = "7d") =>
    serena.get<Record<string, unknown>>(`/api/serena/metrics?periodo=${periodo}`),
  handoffsCat: (periodo = "30d") =>
    serena.get<Record<string, unknown>>(
      `/api/serena/handoffs/categorizados?periodo=${periodo}`
    ),
  ocupacaoMensal: (mes: string) =>
    serena.get<Record<string, unknown>>(`/api/agenda/${RID}/ocupacao?mes=${mes}`),
  reservasDia: (data: string) =>
    serena.get<Record<string, unknown>>(`/api/agenda/${RID}/reservas?data=${data}`),
  reports: (days = 7) =>
    serena.get<Record<string, unknown>>(`/api/reports?rid=${RID}&days=${days}`),
};
