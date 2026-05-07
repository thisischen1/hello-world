import 'dotenv/config';
import { supabase } from '../src/lib/supabase.ts';
import { runWeeklyReviewForCreator } from '../src/agent/review-runner.ts';
import { slackAlert } from '../src/lib/slack.ts';

async function main() {
  const { error: refreshErr } = await supabase.rpc('refresh_creator_baselines');
  if (refreshErr) console.warn('baseline refresh failed:', refreshErr.message);

  const { data: creators, error } = await supabase
    .from('creators')
    .select('id, name')
    .eq('status', 'active');
  if (error) throw error;

  let totalCost = 0;
  let failures = 0;

  for (const c of creators ?? []) {
    try {
      const r = await runWeeklyReviewForCreator(c.id);
      totalCost += r.cost_usd;
      console.log(
        `${c.name}: review_id=${r.review_id} cost=$${r.cost_usd.toFixed(4)} dc=${r.data_completeness} posts=${r.posts_in_period}`,
      );
      if (r.parse_error) {
        failures++;
        await slackAlert(`Review parse failure for ${c.name}: ${r.parse_error}`, 'warn');
      }
    } catch (err) {
      failures++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${c.name}: ${msg}`);
      await slackAlert(`Review run failed for ${c.name}: ${msg}`, 'error');
    }
  }

  console.log(`\nTotal cost: $${totalCost.toFixed(4)} | failures: ${failures}`);
  if (failures > 0) {
    await slackAlert(`Weekly review run done: ${failures} failure(s), total cost $${totalCost.toFixed(4)}`, 'warn');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
