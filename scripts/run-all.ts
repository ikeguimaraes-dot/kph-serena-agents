/**
 * run-all.ts
 * Executa todos os agentes Orkestri em sequência.
 */

import 'dotenv/config';
import { runAgent, AgentResult } from '../lib/run-agent';
import { main as reservasMain } from '../agents/reservas-monitor';
import { main as funilMain } from '../agents/funil-comercial-analyzer';
import { main as npsMain } from '../agents/nps-tracker';
import { main as handoffsMain } from '../agents/handoffs-analyzer';
import { main as learningMain } from '../agents/learning-machine';
import { main as scorerMain } from '../agents/performance-scorer';

interface AgentDef {
  name: string;
  fn: () => Promise<AgentResult>;
}

const agents: AgentDef[] = [
  { name: 'reservas-monitor',        fn: reservasMain },
  { name: 'funil-comercial-analyzer', fn: funilMain },
  { name: 'nps-tracker',             fn: npsMain },
  { name: 'handoffs-analyzer',       fn: handoffsMain },
  { name: 'learning-machine',        fn: learningMain },
  { name: 'performance-scorer',      fn: scorerMain },
];

async function main(): Promise<void> {
  const start = Date.now();
  console.log(`[run-all] Starting Orkestri at ${new Date().toISOString()}`);
  console.log(`[run-all] Running ${agents.length} agents in sequence...\n`);

  for (const agent of agents) {
    console.log(`[${agent.name}] starting...`);
    try {
      await runAgent(agent.name, 'comercial', agent.fn);
      console.log(`[${agent.name}] done ✓\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${agent.name}] error ✗`, msg, '\n');
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[run-all] All agents completed in ${elapsed}s`);
}

main().catch((err) => {
  console.error('[run-all] Unhandled error:', err);
  process.exit(1);
});
