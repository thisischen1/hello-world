import 'dotenv/config';
import { spawn } from 'node:child_process';
import { supabase } from '../src/lib/supabase.ts';

// Fan out the per-creator review generator across all active creators.
// Sequential (not concurrent) to keep Anthropic spend predictable.

async function main() {
  const { data: creators, error } = await supabase
    .from('creators')
    .select('id, name')
    .eq('status', 'active');
  if (error) throw error;

  for (const c of creators ?? []) {
    console.log(`---- ${c.name} (${c.id}) ----`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn('npm', ['run', 'review', '--silent', '--', c.id], {
        stdio: 'inherit',
      });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
    }).catch((err) => {
      console.error(`review for ${c.name} failed:`, err.message);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
