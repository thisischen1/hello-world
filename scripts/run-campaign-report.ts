import 'dotenv/config';
import { generateCampaignReport } from '../src/agent/campaign-report.ts';

async function main() {
  const campaignId = process.argv[2];
  if (!campaignId) {
    console.error('usage: run-campaign-report <campaign_id>');
    process.exit(1);
  }
  const r = await generateCampaignReport(campaignId);
  console.log(JSON.stringify(r, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
