import { createApp } from './app';
import { config } from './config';
import { extendSchedule } from './schedule';
import { generateDemoData } from './seed';
import { exclusive, hasData, loadAll, saveAll, saveSessions, saveTeacher } from './store';
import { forEachDataCopy, pruneWorkspaces } from './workspaces';

// First start (or a fresh host with an empty disk): create demo data around today's date.
if (!(await hasData())) {
  await saveAll(generateDemoData(new Date(), { buyerEmail: config.demoBuyerEmail }));
  console.log(`Created demo data in ${config.dataDir}`);
}

// Weekly classes are generated ahead; top them up now and every hour, in every data copy.
async function topUp() {
  await exclusive(async () => {
    const data = await loadAll();
    const before = data.teacher.scheduledUntil;
    const added = extendSchedule(data, new Date());
    if (data.teacher.scheduledUntil === before) return;
    await saveSessions(data.sessions);
    await saveTeacher(data.teacher);
    if (added) console.log(`Scheduled ${added} upcoming classes`);
  });
}
async function keepScheduleAhead() {
  await pruneWorkspaces();
  await forEachDataCopy(topUp);
}
await keepScheduleAhead();
setInterval(() => keepScheduleAhead().catch(console.error), 60 * 60 * 1000).unref();

createApp().listen(config.port, () => {
  console.log(`Tanpura API on http://localhost:${config.port} (PayPal: ${config.paypal ? 'sandbox' : 'mock'}, AI: ${config.gemini ? 'live' : 'mock'})`);
});
