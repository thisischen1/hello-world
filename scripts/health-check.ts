import 'dotenv/config';
import { supabase } from '../src/lib/supabase.ts';
import { slackAlert } from '../src/lib/slack.ts';

// Health check feedback loops:
//   1. Data freshness: any active creator with >48h since last metric
//   2. Parser failure rate: % of agent_runs in last 7d that failed
//   3. Cost: total $ spent on agent_runs in last 7d
//   4. Review approval rate: % of reviews from last 14d that are approved/edited (vs pending/rejected)
//
// Prints to stdout + Slacks anything alarming.

const SEVEN_DAYS = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const FOURTEEN_DAYS = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
const FAILURE_THRESHOLD = 0.05;
const STALE_HOURS = 48;

async function main() {
  const { data: freshness, error: fErr } = await supabase
    .from('creator_data_freshness')
    .select('*');
  if (fErr) throw fErr;

  const stale = (freshness ?? []).filter(
    (f) => f.hours_since_last_metric == null || (f.hours_since_last_metric as number) > STALE_HOURS,
  );

  const { data: runs, error: rErr } = await supabase
    .from('agent_runs')
    .select('kind, success, cost_usd')
    .gte('created_at', SEVEN_DAYS);
  if (rErr) throw rErr;

  const byKind: Record<string, { total: number; failed: number; cost: number }> = {};
  let totalCost = 0;
  for (const r of runs ?? []) {
    const bucket = (byKind[r.kind] ??= { total: 0, failed: 0, cost: 0 });
    bucket.total++;
    if (!r.success) bucket.failed++;
    const c = (r.cost_usd as number | null) ?? 0;
    bucket.cost += c;
    totalCost += c;
  }

  const { data: reviews, error: revErr } = await supabase
    .from('reviews')
    .select('approval_status')
    .gte('created_at', FOURTEEN_DAYS);
  if (revErr) throw revErr;

  const reviewCounts = { pending: 0, approved: 0, rejected: 0, edited: 0 };
  for (const r of reviews ?? []) {
    const k = r.approval_status as keyof typeof reviewCounts;
    reviewCounts[k] = (reviewCounts[k] ?? 0) + 1;
  }
  const decided = reviewCounts.approved + reviewCounts.rejected + reviewCounts.edited;
  const approvalRate = decided > 0 ? (reviewCounts.approved + reviewCounts.edited) / decided : null;

  console.log('=== Dawn health check ===');
  console.log(`Stale creators (>${STALE_HOURS}h): ${stale.length}`);
  for (const s of stale) {
    const h = s.hours_since_last_metric;
    console.log(`  - ${s.name}: ${h == null ? 'no metrics ever' : `${(h as number).toFixed(1)}h`}`);
  }

  console.log(`\nLast 7d agent_runs by kind:`);
  for (const [kind, v] of Object.entries(byKind)) {
    const failRate = v.total > 0 ? v.failed / v.total : 0;
    console.log(
      `  ${kind}: ${v.total} runs, ${v.failed} failed (${(failRate * 100).toFixed(1)}%), $${v.cost.toFixed(4)}`,
    );
  }

  console.log(`\nLast 7d total cost: $${totalCost.toFixed(4)}`);
  console.log(`Projected monthly: $${(totalCost * 4.33).toFixed(2)}`);

  console.log(`\nLast 14d reviews:`);
  console.log(`  pending=${reviewCounts.pending} approved=${reviewCounts.approved} edited=${reviewCounts.edited} rejected=${reviewCounts.rejected}`);
  if (approvalRate != null) {
    console.log(`  approval rate (decided): ${(approvalRate * 100).toFixed(1)}%`);
  }

  const alerts: string[] = [];
  if (stale.length > 0) {
    alerts.push(`${stale.length} creator(s) with stale data: ${stale.map((s) => s.name).join(', ')}`);
  }
  for (const [kind, v] of Object.entries(byKind)) {
    if (v.total >= 10 && v.failed / v.total > FAILURE_THRESHOLD) {
      alerts.push(`${kind} parser failure rate ${((v.failed / v.total) * 100).toFixed(1)}% (${v.failed}/${v.total})`);
    }
  }
  if (decided >= 5 && approvalRate != null && approvalRate < 0.7) {
    alerts.push(`Review approval rate ${(approvalRate * 100).toFixed(1)}% — prompts may need tuning`);
  }

  for (const a of alerts) {
    console.log(`ALERT: ${a}`);
    await slackAlert(a, 'warn');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
