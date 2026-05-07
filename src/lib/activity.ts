import { supabase } from './supabase.ts';

// Lightweight activity log helper. Call from any mutation worth knowing about.
// Used by the per-coordinator daily digest and ad-hoc audit queries.

export interface LogActivityArgs {
  user_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  payload?: unknown;
}

export async function logActivity(args: LogActivityArgs): Promise<void> {
  const { error } = await supabase.from('activity_log').insert({
    user_id: args.user_id ?? null,
    action: args.action,
    entity_type: args.entity_type,
    entity_id: args.entity_id ?? null,
    payload: args.payload ?? null,
  });
  if (error) console.error('activity_log insert failed:', error.message);
}
