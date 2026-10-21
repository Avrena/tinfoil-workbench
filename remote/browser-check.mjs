import { RemoteAccountWindow } from './chat-session.mjs';
const adapter = new RemoteAccountWindow();
try {
  await adapter.open();
  console.log(JSON.stringify({ browserStartedWithSandbox: true, origin: new URL(adapter.page.url()).origin,
    sessionEnrolled: false, liveInferenceTested: false }));
} catch {
  console.error('Sandboxed account browser could not start or reach Tinfoil.');
  process.exitCode = 1;
} finally { await adapter.clear({ end: false }).catch(() => {}); }
