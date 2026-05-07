import 'dotenv/config';
import { runCoordinatorDigest } from '../src/agent/digest.ts';

async function main() {
  const r = await runCoordinatorDigest();
  console.log(`coordinator digest: ${r.digests_sent} sent`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
