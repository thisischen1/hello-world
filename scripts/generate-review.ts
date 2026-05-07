import 'dotenv/config';
import { runWeeklyReviewForCreator } from '../src/agent/review-runner.ts';

async function main() {
  const creatorId = process.argv[2];
  if (!creatorId) {
    console.error('usage: generate-review <creator_id>');
    process.exit(1);
  }
  const r = await runWeeklyReviewForCreator(creatorId);
  console.log(JSON.stringify(r, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
