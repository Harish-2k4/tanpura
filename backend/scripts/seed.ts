// Rebuilds the demo data around today's date, replacing what is in DATA_DIR.
// Run: npm run seed
import { config } from '../src/config';
import { generateDemoData } from '../src/seed';
import { saveAll } from '../src/store';

const data = generateDemoData(new Date(), { buyerEmail: config.demoBuyerEmail });
await saveAll(data);
console.log(
  `Wrote ${data.students.length} students, ${data.sessions.length} classes, ${data.invoices.length} invoices to ${config.dataDir}`,
);
