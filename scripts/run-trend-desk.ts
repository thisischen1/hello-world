import 'dotenv/config';
import { runTrendDesk } from '../src/agent/trend-desk.ts';
import { slackAlert } from '../src/lib/slack.ts';

async function main() {
  const r = await runTrendDesk();
  console.log(`trend desk: ${r.signals} cross-creator signals, $${r.cost_usd.toFixed(4)}`);
  if (r.summary) {
    console.log(r.summary);
    await slackAlert(`*Weekly trend desk*\n\`\`\`${r.summary}\`\`\``, 'info');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
