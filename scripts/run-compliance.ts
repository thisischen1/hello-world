import 'dotenv/config';
import { runComplianceChecks } from '../src/agent/compliance.ts';

async function main() {
  const r = await runComplianceChecks();
  console.log(`compliance: checked ${r.checked}, flagged ${r.flagged}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
