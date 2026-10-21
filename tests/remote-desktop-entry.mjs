// Native integration fixture. Explicit test profile; never opens the installed vault.
import { app } from 'electron';
import { isAbsolute } from 'node:path';
if (!process.env.TINFOIL_REMOTE_UI_TEST_PROFILE || !isAbsolute(process.env.TINFOIL_REMOTE_UI_TEST_PROFILE)) throw new Error('A separate absolute test profile is required.');
app.setPath('userData', process.env.TINFOIL_REMOTE_UI_TEST_PROFILE);
await import('../desktop/main.mjs');
