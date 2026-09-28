import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Builds the Android APK: compiled renderer -> mobile-dist -> Capacitor sync -> Gradle.
 * `--debug` builds the debuggable variant used for emulator automation. A release build is signed
 * only when TINFOIL_ANDROID_SIGNING (or the TINFOIL_ANDROID_* variables) is set; see docs/ANDROID.md.
 * The signed APK is verified with apksigner and copied to release/ with its SHA-256. */
const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const debug = process.argv.includes('--debug');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const windows = process.platform === 'win32';

function run(program, args, options = {}) {
  // Windows batch launchers (gradlew.bat, apksigner.bat) need a shell; the arguments are fixed tokens.
  const batch = windows && /\.(cmd|bat)$/i.test(program);
  const result = batch ? spawnSync(`"${program}" ${args.join(' ')}`, { stdio: 'inherit', shell: true, ...options })
    : spawnSync(program, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) { console.error(`${program} ${args.join(' ')} failed (${result.status}). Later steps were not run.`); process.exit(result.status ?? 1); }
}
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk || !existsSync(sdk)) { console.error('Set ANDROID_HOME to an Android SDK with platforms;android-36 and build-tools;36.0.0.'); process.exit(1); }
if (!process.env.JAVA_HOME) { console.error('Set JAVA_HOME to a JDK 21 installation.'); process.exit(1); }

run(process.execPath, ['scripts/build.mjs']);
run(process.execPath, ['scripts/build-mobile.mjs']);
run(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'android']);
run(join(root, 'android', windows ? 'gradlew.bat' : 'gradlew'), ['--no-daemon', debug ? 'assembleDebug' : 'assembleRelease'], { cwd: join(root, 'android') });

const variant = debug ? 'debug' : 'release';
const outputDir = join(root, 'android/app/build/outputs/apk', variant);
const built = readdirSync(outputDir).find(name => name.endsWith('.apk'));
if (!built) { console.error('Gradle did not produce an APK.'); process.exit(1); }
const apk = join(outputDir, built);
if (!debug && built.includes('unsigned')) {
  console.log(`Built an unsigned release APK: ${apk}\nSet TINFOIL_ANDROID_SIGNING to sign it; unsigned APKs cannot be installed.`);
  process.exit(0);
}
const buildTools = join(sdk, 'build-tools');
const tools = readdirSync(buildTools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
run(join(buildTools, tools, windows ? 'apksigner.bat' : 'apksigner'), ['verify', '--verbose', '--print-certs', apk]);
mkdirSync('release', { recursive: true });
const target = join('release', `Tinfoil-Workbench-${version}-android${debug ? '-debug' : ''}.apk`);
copyFileSync(apk, target);
console.log(`${target}\nSHA-256 ${createHash('sha256').update(readFileSync(target)).digest('hex')}`);
