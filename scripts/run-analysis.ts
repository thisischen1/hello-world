import 'dotenv/config';
import { analyzeNewPosts } from '../src/agent/analyzer.ts';

async function main() {
  const result = await analyzeNewPosts();
  console.log(`analyzed ${result.analyzed} posts, ${result.failures} sub-call failures`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
