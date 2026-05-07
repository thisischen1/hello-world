import 'dotenv/config';
import { runPostingMonitor } from '../src/agent/posting-monitor.ts';

async function main() {
  const r = await runPostingMonitor();
  console.log(`posting monitor: ${r.alerted} alerted, ${r.ok} on-target`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
