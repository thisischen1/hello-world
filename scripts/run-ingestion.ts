import 'dotenv/config';
import { supabase } from '../src/lib/supabase.ts';
import { ingestTikTokForCreator } from '../src/ingest/tiktok.ts';
import { ingestInstagramForCreator } from '../src/ingest/instagram.ts';
import { slackAlert } from '../src/lib/slack.ts';

interface CreatorAuth {
  creator_id: string;
  platform: 'tiktok' | 'instagram';
  access_token: string;
  external_user_id: string | null;
}

async function loadAuth(creatorId: string): Promise<CreatorAuth[]> {
  // OAuth tokens via env vars are a stopgap. Migrate to a platform_credentials table
  // before onboarding more than ~5 creators.
  const tt = process.env[`TIKTOK_TOKEN_${creatorId}`];
  const ig = process.env[`IG_TOKEN_${creatorId}`];
  const igUser = process.env[`IG_USER_${creatorId}`];
  const out: CreatorAuth[] = [];
  if (tt) out.push({ creator_id: creatorId, platform: 'tiktok', access_token: tt, external_user_id: null });
  if (ig && igUser) out.push({ creator_id: creatorId, platform: 'instagram', access_token: ig, external_user_id: igUser });
  return out;
}

async function logRun(
  creator_id: string,
  platform: 'tiktok' | 'instagram',
  source: 'display_api' | 'graph_api',
  result: { inserted: number; updated: number; success: boolean; error?: string | undefined },
): Promise<void> {
  const { error } = await supabase.from('ingestion_runs').insert({
    creator_id,
    platform,
    source,
    inserted: result.inserted,
    updated: result.updated,
    success: result.success,
    error: result.error ?? null,
  });
  if (error) console.error('ingestion_runs insert failed:', error.message);
}

async function main() {
  const { data: creators, error } = await supabase
    .from('creators')
    .select('*')
    .eq('status', 'active');
  if (error) throw error;

  const summary: Array<{ creator: string; platform: string; inserted: number; updated: number; error?: string }> = [];

  for (const creator of creators ?? []) {
    const auths = await loadAuth(creator.id);
    if (auths.length === 0) {
      summary.push({ creator: creator.name, platform: '-', inserted: 0, updated: 0, error: 'no auth' });
      continue;
    }
    for (const auth of auths) {
      try {
        const r =
          auth.platform === 'tiktok'
            ? await ingestTikTokForCreator(creator, auth.access_token)
            : await ingestInstagramForCreator(creator, auth.external_user_id!, auth.access_token);
        await logRun(creator.id, auth.platform, auth.platform === 'tiktok' ? 'display_api' : 'graph_api', {
          ...r,
          success: true,
        });
        summary.push({ creator: creator.name, platform: auth.platform, ...r });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await logRun(creator.id, auth.platform, auth.platform === 'tiktok' ? 'display_api' : 'graph_api', {
          inserted: 0,
          updated: 0,
          success: false,
          error: msg,
        });
        summary.push({ creator: creator.name, platform: auth.platform, inserted: 0, updated: 0, error: msg });
        await slackAlert(`Ingestion failed: ${creator.name} / ${auth.platform} — ${msg}`, 'warn');
      }
    }
  }

  const { error: refreshErr } = await supabase.rpc('refresh_creator_baselines');
  if (refreshErr) {
    console.warn('baseline refresh failed:', refreshErr.message);
    await slackAlert(`Baseline refresh failed: ${refreshErr.message}`, 'warn');
  }

  console.table(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
