# Notices

Copyright 2026 Avrena.

Tinfoil Workbench is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE). Third-party components retain their own licences.

Tinfoil Workbench is an unofficial client. It is not endorsed by Tinfoil, OpenAI, Microsoft or the authors of the interface inspirations. Product names identify compatibility or inspiration only.

Tinfoil and its logo are trademarks of their owner. Tinfoil Workbench names Tinfoil only to say which service it connects to. Its app icon and title-bar mark are its own drawing and do not reproduce Tinfoil's logo; no Tinfoil artwork is copied from Tinfoil's repositories. The Settings dialog says that the app is unofficial. This licence does not grant permission to use Tinfoil's name, logo or trademarks.

The interface is original application code inspired by familiar editor/chat layouts, not a copied Codex application or VS Code theme package. The appearance presets in `src/core/themes.ts` use the accent, background and foreground colours shown by the Codex app for its themes. Only colour values are included; no theme files are bundled.

The Tinfoil SDK is an external npm dependency under its own license. Electron, TypeScript, electron-builder and transitive dependencies also retain their licenses. Review the resolved dependency tree and notices after bootstrap; this source package does not contain a downloaded npm dependency tree or a fabricated lockfile.

Bundled renderer components: Marked 4.0.19 (MIT), KaTeX 0.16.27 (MIT), and PrismJS 1.30.0 (MIT). Copies of their licenses and provenance are in `src/vendor/`, copied into `dist/vendor/` by the build. There are no bundled font binaries. KaTeX emits native MathML and relies on the operating system for math fonts. These versions were available in the preparation environment; they are not advertised as the newest versions or independently audited.

The offline preview contains clearly labeled synthetic responses and no provider credentials. Browser test fixtures are not real model outputs or evidence of live provider execution.

PDF.js (`pdfjs-dist` 6.3.289) is an external Apache-2.0 dependency, not downloaded into this preparation archive. Bootstrap installs it; the build copies its module, worker and LICENSE into `dist/vendor/pdfjs`. No standard-font binaries, external viewer resources or third-party script CDNs are bundled here. Review the complete resolved dependency notices before distribution.

The model picker's maker logos are single-colour paths from LobeHub Icons (`@lobehub/icons-static-svg` 1.95.1, MIT), copied into `src/renderer/maker-logos.ts`. The logos are trademarks of their owners (DeepSeek, Z.ai, Moonshot AI, Google, OpenAI, Meta, Mistral AI and Alibaba Cloud's Qwen); they only identify each model's maker, and no endorsement is implied.

The model capability adapter references the public Tinfoil webapp's `src/config/models.ts` schema. The visual tool implementations and panel are original project code, not copies of proprietary ChatGPT/Claude tools. The Kimi K3 fallback follows the specified behavior; it is not an independently verified account-specific capability result.

## Android app (0.11)

The Android APK compiles the tinfoil SDK and its dependencies, Capacitor's JavaScript runtime (`@capacitor/core`, MIT) and the `buffer` polyfill (MIT, with `base64-js` MIT and `ieee754` BSD-3-Clause) into its host bundles. `npm run build:mobile` writes their license texts to `mobile-dist/THIRD-PARTY-NOTICES.txt`, which is packaged in the APK. The native side includes Capacitor for Android (MIT) and AndroidX libraries (Apache-2.0) resolved by Gradle. The launcher icon is derived from the existing application icon. As on Windows, no font binaries are bundled.
