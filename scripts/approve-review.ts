import 'dotenv/config';
import { supabase } from '../src/lib/supabase.ts';

// Coordinator approval CLI.
// Usage:
//   npm run approve-review -- <review_id> approved
//   npm run approve-review -- <review_id> rejected "reason here"
//   npm run approve-review -- <review_id> edited '{"creator_bullets":{...}}'
//   npm run approve-review -- list

async function listPending() {
  const { data, error } = await supabase
    .from('reviews')
    .select('id, creator_id, period_start, period_end, data_completeness, total_cost_usd')
    .eq('approval_status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  for (const r of data ?? []) {
    console.log(`${r.id} ${r.period_start}..${r.period_end} dc=${r.data_completeness} cost=$${r.total_cost_usd}`);
  }
}

async function setStatus(id: string, status: string, payload?: string) {
  if (status === 'list') return listPending();

  const update: Record<string, unknown> = {
    approval_status: status,
    approved_at: new Date().toISOString(),
    approved_by: process.env['USER'] ?? 'coordinator',
  };

  if (status === 'rejected') {
    update.rejection_reason = payload ?? 'no reason given';
  } else if (status === 'edited') {
    if (!payload) throw new Error('edited status requires JSON payload of edits');
    update.coordinator_edits = JSON.parse(payload);
  } else if (status !== 'approved') {
    throw new Error(`unknown status: ${status}`);
  }

  const { error } = await supabase.from('reviews').update(update).eq('id', id);
  if (error) throw error;
  console.log(`review ${id} → ${status}`);
}

async function main() {
  const arg1 = process.argv[2];
  if (!arg1) {
    console.error('usage: approve-review <review_id> <approved|rejected|edited> [reason|json]');
    console.error('       approve-review list');
    process.exit(1);
  }
  if (arg1 === 'list') return listPending();
  const status = process.argv[3];
  if (!status) {
    console.error('status required');
    process.exit(1);
  }
  await setStatus(arg1, status, process.argv[4]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
