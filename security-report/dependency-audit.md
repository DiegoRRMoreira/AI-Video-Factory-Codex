# Dependency audit — 0.6.1 preparation

Date: 17 November 2026. Scope: the pnpm workspace's locked dependencies and the
reported Next.js upgrade warning. This is a focused dependency review, not a full
application penetration test, license audit or certification against future advisories.

## Finding DEP-001 — vulnerable Next.js pin

- Registry severity: Moderate. Version-match confidence: 100%; application exploit
  reachability was not established.
- Package: `next@16.4.3`, production dependency of `@ys/studio`.
- Advisory: [GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h).
- Reported affected range: `>=16.3.0 <=16.4.4`; patched range: `>=16.4.5`.
- The issue concerns cross-root-parameter information disclosure when a `use cache`
  function is invoked through `unstable_cache()`. No direct use of those APIs was
  found in `apps/studio/src`; that search alone does not establish that every
  framework/transitive path is unreachable.
- Remediation: pin `next` to `16.4.5` and update its matching `@next/env` and optional
  SWC platform packages. React, TypeScript, pnpm and unrelated dependencies retain
  their existing versions. The [official release](https://github.com/vercel/next.js/releases/tag/v16.4.5)
  lists its security fixes.
- Verification: installed and configured versions both report `16.4.5`; the
  production and all-dependency registry audit commands both exit 0 with zero
  currently reported vulnerabilities. Frozen-lockfile installation succeeds.

## Dependency audit summary

- Ecosystem examined: npm/pnpm; 11 first-party workspace manifests.
- Direct external manifest specifications: 54 unique name/version pairs. The
  all-dependency audit reports 818 resolved nodes, including development and
  optional packages; these counts include packages not used on every platform.
- Resolved external inventory: 54 direct and 764 transitive package/version nodes
  on that audit graph, across the 11 workspace manifests.
- Known registry vulnerabilities before: 1 Moderate, 0 Critical/High/Low/Info.
  After: 0 across every registry severity, in both production-only and full graphs.
- Internal dependencies: 28 references, all explicit `workspace:*` links. No new
  registry configuration, override or dependency source was introduced.
- Install behavior: no first-party install/preinstall/postinstall/prepare hooks
  were found. The existing esbuild build allowlist and disabled Depot build remain
  unchanged. This does not independently certify all transitive install scripts.
- Typosquatting/download history, complete license compatibility and package-age
  review were not performed; no zero-risk claim is made for those categories.
- Eight deprecated transitive packages remain reported by pnpm. They were not
  silently upgraded as part of this targeted security patch.

## Compatibility disclosures

`pnpm peers check` reports the existing TypeScript 7.0.2 / tsconfck 3.1.3 (`^5`)
and webpack 5.105.0 / schema-utils 4.8.1 (`^5.112`) peer-range mismatches. Their
locked versions/constraints are unchanged by this patch. Passing the relevant
build, type and test paths is recorded separately; it does not establish support
for every optional upstream tool path.

Evidence is retained locally under `.temp_files/release-0.6.1-prep-2026-11-17/`:
registry audit JSON before/after, direct-dependency inventory, install/peer logs,
source hashes and validation receipts. Prior D-package receipts describe the
earlier 16.4.3 snapshot and remain historical; they are not rewritten as patch proof.
