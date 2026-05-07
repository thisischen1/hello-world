import 'dotenv/config';
import { supabase } from '../src/lib/supabase.ts';
import { generateMonthlyStatement } from '../src/agent/statement.ts';
import { slackAlert } from '../src/lib/slack.ts';

// Generates statements for the previous month for every active creator.
// Called from .github/workflows/monthly-statements.yml on the 1st.

async function main() {
  const today = new Date();
  const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));

  const { data: creators, error } = await supabase
    .from('creators')
    .select('id, name')
    .eq('status', 'active');
  if (error) throw error;

  let total_cost = 0;
  let failures = 0;

  for (const c of creators ?? []) {
    try {
      const r = await generateMonthlyStatement(c.id, lastMonth);
      total_cost += r.cost_usd;
      console.log(`${c.name}: statement_id=${r.statement_id} cost=$${r.cost_usd.toFixed(4)}`);
    } catch (err) {
      failures++;
      console.error(`${c.name}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nTotal cost: $${total_cost.toFixed(4)} | failures: ${failures}`);
  await slackAlert(
    `Monthly statements done for ${lastMonth.toISOString().slice(0, 7)}: ${
      (creators?.length ?? 0) - failures
    } generated, ${failures} failures, $${total_cost.toFixed(2)} spent.`,
    failures > 0 ? 'warn' : 'info',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
