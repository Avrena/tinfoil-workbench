# Offline rendering components

No CDN requests or font files are required by this renderer. Retain these license files when packaging. Review and update dependencies before a sensitive-data release; the retained versions are not claimed to be current or audited.

| File | Component | Version | Preparation provenance | Local change |
| --- | --- | --- | --- | --- |
| `marked.js` | Marked | 4.0.19 | Installed nbclassic component, package metadata verified | UMD wrapper converted to an ES-module wrapper; exports object renamed; parser body unchanged |
| `katex.js` | KaTeX | 0.16.27 | Installed Gradio frontend standalone module, embedded version verified | No algorithm changes; used only with `output: "mathml"` |
| `prism.js` | PrismJS | 1.30.0 | Installed Prism package, package metadata verified | Manual mode; appended bundled language components; ES-module default export |

Prism includes its default markup/CSS/JavaScript support plus Python, TypeScript, JSON, Bash, PowerShell, Lua, C, C++, C#, Rust, Go, SQL and YAML grammars. Highlighting does not execute the code. Application-controlled renderers escape raw HTML and enforce URI policy; Marked alone is not an HTML sanitizer.

The corresponding MIT licenses are `MARKED-LICENSE.txt`, `KATEX-LICENSE.txt` and `PRISM-LICENSE.txt`. Type declarations are local integration shims. `SHA256SUMS` records the exact packaged JavaScript for reproducibility, not a security attestation.

Upstreams: https://github.com/markedjs/marked ; https://github.com/KaTeX/KaTeX ; https://github.com/PrismJS/prism . KaTeX option documentation: https://katex.org/docs/options . Tinfoil is installed separately and is not vendored in this directory.
