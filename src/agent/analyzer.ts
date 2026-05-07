import { supabase } from '../lib/supabase.ts';
import { diagnoseRetention, tagHook } from './hook-tagger.ts';
import { logAgentRun } from './runs.ts';

// Find posts that haven't been analyzed yet, run hook + retention analyses, persist.
// Skips posts already analyzed (status != 'detected'). Idempotent across reruns.

export async function analyzeNewPosts(): Promise<{ analyzed: number; failures: number }> {
  const { data: posts, error } = await supabase
    .from('posts')
    .select('*')
    .eq('status', 'detected')
    .order('posted_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  let analyzed = 0;
  let failures = 0;

  for (const post of posts ?? []) {
    const { data: latestMetrics } = await supabase
      .from('post_metrics')
      .select('*')
      .eq('post_id', post.id)
      .order('collected_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: history } = await supabase
      .from('hook_analyses')
      .select('post_id, hook_type, hook_label, posts!inner(creator_id, posted_at)')
      .eq('posts.creator_id', post.creator_id)
      .order('posts(posted_at)', { ascending: false })
      .limit(10);

    const recent = (history ?? []).map((h) => ({
      post_id: h.post_id as string,
      hook_type: h.hook_type as string,
      hook_label: h.hook_label as string,
    }));

    const { data: baseline } = await supabase
      .from('creator_baselines')
      .select('median_awt, median_views')
      .eq('creator_id', post.creator_id)
      .maybeSingle();

    const hookResult = await tagHook({ post, recent_hook_history: recent });
    await logAgentRun({
      kind: 'hook_tag',
      model: hookResult.model,
      post_id: post.id,
      success: hookResult.hook !== null,
      parse_error: hookResult.parse_error,
      usage: hookResult.usage,
      duration_ms: hookResult.duration_ms,
    });

    if (hookResult.hook) {
      await supabase.from('hook_analyses').upsert(
        {
          post_id: post.id,
          hook_type: hookResult.hook.hook_type,
          hook_text: hookResult.hook.hook_text || null,
          first_frame_note: hookResult.hook.first_frame_note,
          hook_label: hookResult.hook.hook_label,
          recommended_hook: hookResult.hook.recommended_hook || null,
          model: hookResult.model,
        },
        { onConflict: 'post_id' },
      );
    } else {
      failures++;
    }

    const retResult = await diagnoseRetention({
      post,
      metrics: latestMetrics,
      retention_curve: null,
      creator_baseline: baseline ?? null,
    });
    await logAgentRun({
      kind: 'retention_diagnosis',
      model: retResult.model,
      post_id: post.id,
      success: retResult.retention !== null,
      parse_error: retResult.parse_error,
      usage: retResult.usage,
      duration_ms: retResult.duration_ms,
    });

    if (retResult.retention) {
      await supabase.from('retention_diagnoses').upsert(
        {
          post_id: post.id,
          retention_label: retResult.retention.retention_label,
          dropoff_second: retResult.retention.dropoff_second,
          diagnosis: retResult.retention.diagnosis,
          edit_recommendation: retResult.retention.edit_recommendation || null,
          model: retResult.model,
        },
        { onConflict: 'post_id' },
      );
    } else {
      failures++;
    }

    if (hookResult.hook && retResult.retention) {
      await supabase.from('posts').update({ status: 'analyzed' }).eq('id', post.id);
      analyzed++;
    }
  }

  return { analyzed, failures };
}
