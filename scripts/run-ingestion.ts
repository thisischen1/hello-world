import 'dotenv/config';
import { supabase } from '../src/lib/supabase.ts';
import { ingestTikTokForCreator } from '../src/ingest/tiktok.ts';
import { ingestInstagramForCreator } from '../src/ingest/instagram.ts';

// Daily ingestion runner. Executed by GitHub Actions cron (.github/workflows/daily-ingest.yml).
//
// For each active creator, pull whatever we have credentials for. Failures are logged
// per-creator-per-platform but do not stop the run — partial data is better than none.

interface CreatorAuth {
  creator_id: string;
  platform: 'tiktok' | 'instagram';
  access_token: string;
  external_user_id: string | null;
}

async function loadAuth(creatorId: string): Promise<CreatorAuth[]> {
  // Auth tokens live in a separate table not modeled here yet (env-driven for the demo).
  // Stub: read from env vars TIKTOK_TOKEN_<id> / IG_TOKEN_<id> / IG_USER_<id>.
  const tt = process.env[`TIKTOK_TOKEN_${creatorId}`];
  const ig = process.env[`IG_TOKEN_${creatorId}`];
  const igUser = process.env[`IG_USER_${creatorId}`];
  const out: CreatorAuth[] = [];
  if (tt) out.push({ creator_id: creatorId, platform: 'tiktok', access_token: tt, external_user_id: null });
  if (ig && igUser) out.push({ creator_id: creatorId, platform: 'instagram', access_token: ig, external_user_id: igUser });
  return out;
}

async function main() {
  const { data: creators, error } = await supabase
    .from('creators')
    .select('*')
    .eq('status', 'active');
  if (error) throw error;

  const results: Array<{ creator: string; platform: string; inserted: number; updated: number; error?: string }> = [];

  for (const creator of creators ?? []) {
    const auths = await loadAuth(creator.id);
    if (auths.length === 0) {
      results.push({ creator: creator.name, platform: '-', inserted: 0, updated: 0, error: 'no auth' });
      continue;
    }
    for (const auth of auths) {
      try {
        const r =
          auth.platform === 'tiktok'
            ? await ingestTikTokForCreator(creator, auth.access_token)
            : await ingestInstagramForCreator(creator, auth.external_user_id!, auth.access_token);
        results.push({ creator: creator.name, platform: auth.platform, ...r });
      } catch (err) {
        results.push({
          creator: creator.name,
          platform: auth.platform,
          inserted: 0,
          updated: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const { error: refreshErr } = await supabase.rpc('refresh_creator_baselines').single();
  if (refreshErr && refreshErr.code !== 'PGRST202') {
    // PGRST202 = function not found; tolerable for now
    console.warn('baseline refresh failed:', refreshErr.message);
  }

  console.table(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
