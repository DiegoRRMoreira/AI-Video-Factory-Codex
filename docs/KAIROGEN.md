# Kairogen MCP local integration

Kairogen supplies generated media. It does not replace the Claude/ACP agents that
write, direct and review episodes. This integration uses the official MCP SDK and
the authenticated catalog, quote, generation and status tools. It does not manage
subscriptions, purchase credits or publish content.

## Connect

Run `pnpm kairogen connect`, approve the displayed device code on Kairogen, then
run `pnpm kairogen finish`. Credentials are stored in `.data/kairogen`, ignored by
Git. The connection requests only `kairogen:read` and `kairogen:generate` scopes.
Expired tokens are refreshed automatically when a refresh token is available.
An expired environment-supplied `KAIROGEN_ACCESS_TOKEN` must be replaced manually.

Read-only checks:

```powershell
pnpm kairogen models seedance-2-0-mini
pnpm kairogen models nano-banana image
pnpm kairogen gallery
pnpm kairogen status <generation-id>
pnpm kairogen quote <arguments.json>
pnpm kairogen account
pnpm kairogen download <generation-id> C:/path/existing-video.mp4
```

These commands do not create media. The quote file contains the exact generation
arguments (model, prompt, duration_seconds, aspect_ratio, resolution, reference
URLs and model-specific options), without expected_credits/wait_for_completion.
Use the catalog's exact supported parameters; they differ between models/modes.

## Enable in the Factory

Create `.data/kairogen/models.json` as an array of model configurations:

```json
[
  {
    "model": "seedance-2-0-mini",
    "type": "video",
    "capabilities": ["t2v", "i2v"],
    "limits": {
      "minDurationSec": 4,
      "maxDurationSec": 15,
      "aspectRatios": ["16:9", "9:16", "1:1"],
      "maxRefs": 2
    },
    "maxCredits": 100,
    "usdPerCredit": 0.01,
    "params": { "resolution": "720p", "generate_audio": false }
  }
]
```

The numbers above are **illustrative, not Kairogen prices**. Configure maxCredits
from a real quote and choose your own accounting conversion before enabling.
Set `KAIROGEN_ENABLED=1` in `.env` and restart Studio. Optional absolute overrides:
`KAIROGEN_AUTH_DIR` and `KAIROGEN_MODELS_FILE`.

The existing Factory budget is in USD, whereas Kairogen charges credits. Each
output conservatively reserves and records `maxCredits * usdPerCredit` USD in
the existing ledger, even when the live quote is cheaper. This is an upper
accounting estimate, not an actual USD charge or a verified currency rate.
The adapter obtains a live quote, refuses quotes above maxCredits, and passes
expected_credits to generation so a changed price is rejected by Kairogen.
Actual credit quote and generation ID are retained in local job files.

## Keyframes and references

The episode clip stage uses image-to-video. Kairogen requires reference URLs;
local files cannot be silently dropped or sent as inaccessible localhost URLs.
Map an existing, already uploaded reference explicitly:

```powershell
pnpm kairogen reference C:/path/frame.png https://your-cdn.example/frame.png
```

The mapping uses the file's SHA-256; only byte-identical inputs reuse the URL.
This command uploads nothing. The URL must already point to that image.
Alternatively configure an image model with t2i/i2i_multiref capabilities and the
catalog's parameters. Kairogen-generated image downloads are mapped to their
output URLs automatically, allowing subsequent clip generation. An unmapped
reference fails before quoting or spending. Signed output URLs can expire;
remap the original bytes to a renewed URL when that happens.

## Recovery and validation boundary

One generation runs at a time per auth directory, including across Studio/CLI
processes. Each request has a persisted checkpoint before submission. A polling
or download failure retains the generation ID; retrying resumes that ID instead
of submitting again. A submission with an unknown outcome remains blocked until
the correct job is reconciled. The adapter never automatically retries a paid
submission or falls back after it may have been accepted.

If a process is killed, inspect `.data/kairogen/generation.lock` and its recorded
PID before removing the stale lock. Job files must not be deleted to force a
retry: inspect Kairogen's history and recover the accepted generation first.
No forced regeneration option is implemented; even a Factory no-cache request
continues to reuse the same Kairogen job checkpoint.

Catalog/authentication and quote checks can run without generation. Mocked tests
exercise the adapter's quote guard, reference handling, checkpoint reuse and
failure behavior. A successful real generated image/clip download is still
required to certify the complete paid-provider path for a particular model.

The public fork also provides `pnpm kairogen:generate request.json --max-credits N
--out out/reel`. It only quotes unless `--submit` is explicitly supplied. This
uses the same persisted jobs and credit cap without requiring a USD conversion.
See [the Portuguese guide](../README.pt-BR.md) for the portable Reels editor and
the current validation boundary. Generated files and authentication remain local.

## Codex instead of Claude for production agents

The existing ACP support can use the installed `@agentclientprotocol/codex-acp`
bridge. It uses Codex authentication available on this computer. Discovery does
not send a model prompt:

```powershell
pnpm exec tsx scripts/setup-codex.ts
```

Select a discovered model for all production roles explicitly:

```powershell
pnpm exec tsx scripts/setup-codex.ts gpt-6.2-sol
```

The setup registers only the exact node executable and adapter entry point in
the project's ACP command allowlist. It saves the backend and role settings in
the existing asset store; restart Studio afterward. It preserves the runtime's
tool-free agent boundary: file/terminal capabilities are not advertised and
permission requests/tool-call events remain rejected. No new Codex chat is
created. This is a separate Codex runtime session, not execution inside the
current chat; account limits apply and a real model-response smoke test is
separate from discovery. The adapter's detected models can be changed in Studio.
