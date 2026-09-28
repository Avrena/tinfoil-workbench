# Releasing

A release is built and verified on a maintainer machine from a clean, tagged commit, then published as a GitHub release on the private repository. CI verifies every push but does not publish.

## Version

`package.json` is the only version source. The Windows installers take their file names from it, and the Android build derives `versionName` and `versionCode` from it (`major·1,000,000 + minor·1,000 + patch`; 0.11.0 → 11000). Add a `CHANGELOG.md` entry and a validation record in `docs/VALIDATION.md` (move the previous record to `docs/history/`).

## Gates

Run from a clean working tree at the commit to be tagged, in this order:

```powershell
npm run bootstrap                        # npm ci + checksum-verified Electron binary
npm run doctor                           # every entry must pass
npm run dist:win                         # doctor, 300+ Node tests, native smoke, NSIS + portable, then the package check
python tests/ui-smoke.py                 # …and the other nine ui-*.py suites (after npm run preview:build)
npm run android:apk                      # signed release APK (TINFOIL_ANDROID_SIGNING set)
node scripts/android-build.mjs --debug   # debuggable APK for device tests
python tests/android-device.py --debug --live --apk release/Tinfoil-Workbench-<v>-android-debug.apk
python tests/android-device.py --release --apk release/Tinfoil-Workbench-<v>-android.apk
```

Then check the packaged Windows app itself. Source runs resolve modules from the repository's `node_modules`, so they cannot show that a module is missing from the package:

- `npm run dist:win` ends with `scripts/check-package.mjs`, which must print `PACKAGE_CHECK_OK`: every packaged module's dependencies and required peer dependencies are in `app.asar`. electron-builder does not pack packages that npm installed only to satisfy a peer dependency; declare such a package as a dependency instead.
- `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` must print `DESKTOP_SMOKE_OK`. It also loads the attested SDK, without a network request.
- The SDK loads some modules only while it verifies an enclave. Run the live check with the packaged executable in Node mode; it verifies the enclave with a placeholder key and lists the models, without a prompt, an account or billing, and must print `PACKAGED_PROVIDER_OK`:

  ```powershell
  $env:ELECTRON_RUN_AS_NODE = '1'
  & 'release\win-unpacked\Tinfoil Workbench.exe' scripts\check-packaged-provider.mjs
  Remove-Item Env:ELECTRON_RUN_AS_NODE
  ```

For installer changes, run a silent per-user install, smoke and uninstall:

```powershell
Tinfoil-Workbench-<v>-x64-Setup.exe /S /D=C:\path\to\scratch
"C:\path\to\scratch\Tinfoil Workbench.exe" --smoke-test
"C:\path\to\scratch\Uninstall Tinfoil Workbench.exe" /S
```

Check that the new signed APK upgrades the previous release in place: install the previous release's APK on an emulator, create a draft, `adb install -r` the new APK, and confirm the draft is still there.

Record any failure, skip or retry in the validation record; do not describe a release as verified beyond what ran.

## Publish

1. Tag the verified commit: `git tag -a v<version> -m "Tinfoil Workbench <version>"` and push the tag.
2. Write `SHA256SUMS` for the files being published (`sha256sum Tinfoil-Workbench-* > SHA256SUMS`).
3. Create the release with the Windows installer, the Windows portable executable, the signed Android APK and `SHA256SUMS` attached. Do not attach the debug APK.

   ```powershell
   gh release create v<version> --repo Avrena/tinfoil-workbench --title "Tinfoil Workbench <version>" --notes-file <notes> <files…>
   ```

4. Download the published assets again and compare them against `SHA256SUMS`.

## Signing

- **Windows:** code signing is not configured, so the installer and portable executable are unsigned and Windows SmartScreen warns on first run. Configure an Authenticode certificate in electron-builder before claiming signed Windows builds.
- **Android:** releases are signed with the maintainer's release key (certificate SHA-256 `63:95:EA:D7:97:A5:20:C6:32:15:6A:BC:D9:EE:27:31:86:9C:64:ED:0E:E5:10:AD:5B:52:E8:87:18:54:94:CB`). See [ANDROID.md](ANDROID.md#release-signing). The key is not stored in GitHub; CI builds only debug and unsigned release APKs.

## Continuous integration

| Workflow | Runner | What it does |
|---|---|---|
| `windows.yml` | windows-latest | bootstrap, doctor, Node tests, native Electron/DPAPI/PDF smoke, x64 packaging, the package check and the packaged app's smoke test; uploads the installers as a 14-day artifact |
| `android.yml` | ubuntu-latest | bootstrap, Node tests, Android debug and unsigned release builds; uploads the debug APK as a 14-day artifact |
| `renderer.yml` | ubuntu-latest | rebuilds the preview and runs the ten browser UI suites |

CI artifacts are for verification only; they are not release assets.
