# 幻界 OS Design QA

## Evidence

- Source: `/Users/yuruby/.codex/generated_images/01a00a04-64ab-7a60-8f2b-913d1eb879a9/exec-487ee5a3-4d78-4dba-9345-11fa5ca5fe22.png` (853 × 1844 px).
- Browser implementation: `https://staging.fantasy.bytesucceed.com/?qa=final-proof` at a 390 × 844 CSS-pixel viewport.
- Final screenshot: `/Users/yuruby/.codex/visualizations/2026/08/17/fantasy-os-qa/staging-final-proof-390x844.png` (390 × 844 px).
- Same-frame comparison: `/Users/yuruby/.codex/visualizations/2026/08/17/fantasy-os-qa/reference-vs-staging-final.png` (796 × 844 px). The source was normalized to 390 × 844 before comparison; no implementation pixels were resized.
- Focused archive evidence: `/Users/yuruby/.codex/visualizations/2026/08/17/fantasy-os-qa/staging-multi-archive-390x844.png`.

The verified state contains three independent Staging-only published novels. `焦账员` is the primary archive; `白塔沉默` and `时隙观测者` remain in API order below it. Production data was not read or copied.

## Iteration history

1. The first implementation had the correct dark terminal language and fixed Dock, but the hero was too tall compared with the source and the existing brand mark was not visible at hero scale. The Dock terminal action also opened but did not toggle closed.
2. Reused the existing `FantasyMark` as the hero anchor, made the Dock action a true toggle, and added a generated raster orbit background. Browser QA then found that an in-page transition preserved the old document scroll position; a failing contract test was added before fixing the transition.
3. The same-frame comparison showed the archive density was still too low. The hero, primary archive card, section label, and compact archive rows were tightened to match the source rhythm. The final pass also reset a legacy relative-position offset that visually overlapped the hero guidance and description.

## Final checks

- 360 × 800 account page: no horizontal overflow; active `我的` Dock state; actions remain above the safe area.
- 390 × 844 multi-novel home: document width equals viewport width; all four Dock controls render; primary and remaining novel order is correct.
- 430 × 932 guest bookshelf: no horizontal overflow; login/register actions and active `书架` state remain visible.
- 200% zoom-equivalent reflow: four Dock items remain reachable and the document does not introduce internal horizontal overflow.
- Keyboard: interactive links expose visible native focus and the Dock has accessible names.
- Reduced motion: media emulation matches `prefers-reduced-motion: reduce`; sampled shell elements have no residual animation or transition duration.
- Safe areas: system header, Dock, and bookshelf confirmation layer include the relevant `env(safe-area-inset-*)` edges.
- Primary interactions: Dock terminal opens and closes; novel entry resets scroll to the top; chapter gateway keeps the shell; formal reading removes both shell header and Dock while retaining the story terminal.
- Failure states: existing empty, network retry, cover fallback, authentication rejection, and terminal fallback contracts continue to pass.
- Browser console: no warnings or errors during the final Staging journey.

## Result

Passed. No P0, P1, or P2 visual or interaction issue remains against the selected source and this feature specification. The remaining visible content difference is intentional: Staging uses three isolated QA novels and the generated orbit asset instead of copying production covers or inventing search/filter controls.
