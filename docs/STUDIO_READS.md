# Studio read behavior

An episode detail request reads the ledger once. Episode media spend, Claude cost,
stage/provider breakdowns and provider latency estimates use that same snapshot.
Provider latency still uses entries from every episode; spend and breakdowns use
only the requested episode. Cached calls and Claude calls stay outside the media
budget, and billed failures remain included.

Studio list consumers use `EpisodeRepo.summaries()`. Each episode has a small,
rebuildable `episodes/<id>/summary.json` beside its authoritative `state.json` in
the asset store. Warm reads check source metadata and read the summary, without
parsing the timeline-bearing state. Reads remain bounded to four episodes at once.
The index still enumerates episode keys and summaries; it is not an O(1) global
database index. Default `EpisodeRepo.list()` and the legacy
`list({ includeTimeline: false })` retain their existing complete/light behavior.
Individual loads and stored state serialization are unchanged.

## Summary publication and recovery

The manifest contains a format version, an opaque source-object identity, a
checksum and compact display/production metadata. Its content revision is SHA-256
of the serialized source state. No revision field is added to the episode itself,
so narration-edit/undo fingerprints keep their existing meaning.

Publication writes a pending marker, persists the state, then conditionally replaces
its own marker with the summary. Filesystem writes obtain the committed file's
identity through their own open file handle; S3 writes use the PUT response's
ETag/version ID. Reading a later writer's path metadata would incorrectly bind an
older summary to newer content. Ownership-fenced regression tests force that order.

Warm filesystem validation uses device/inode, size and nanosecond modification/
change metadata; S3 uses HEAD ETag/version ID. This is cache freshness protection,
not cryptographic proof against an actor controlling the store. The summary
checksum detects accidental changes to cached content. Unknown metadata errors
propagate rather than becoming a successful empty result.

Missing, corrupt or stale manifests are reconstructed from stable authoritative
reads. A source change during reconstruction or a lost summary CAS retries the
read; a repair cannot overwrite a newer writer's index. An interrupted write whose
pending revision does not match the current source is disclosed as pending until a
new write or explicit rebuild resolves it. Deleted source files cannot be served
from orphan manifests. Source corruption is disclosed in `notices`, including on
the Home page, rather than being counted as a complete library.

`POST /api/episodes/index` with JSON `{ "rebuild": true }` explicitly rebuilds the
derived index under each episode's existing producer lock. Busy/unreadable records
are reported in `notices`. It changes no episode content, starts no production job
and performs no generation. Producer ownership remains required for modifying an
existing episode; the cache protocol is not a replacement for that lock. Custom
stores without metadata/versioned-write capabilities fall back to authoritative
reads and do not gain the same warm-read optimization.

Summaries carry recorded render markers, durations and plan counts. They do not
certify that a referenced MP4 exists, that its bytes are healthy, that narration
claims are resolved or that a video passed editorial review.

## List API and cards

`GET /api/episodes` without query parameters preserves the legacy array shape.
Query parameters opt into `{ episodes, total, offset, limit, notices }`:

```text
/api/episodes?limit=20&offset=0&q=topic&series=Series&status=waiting&sort=newest
```

`limit` is 1–100; `offset` is a nonnegative integer. Sort is newest by default or
`oldest`, with episode ID as a stable time-tie breaker. Status accepts the existing
six run states. Series matching preserves Turkish case/whitespace folding; `-`
means no series. The Home page renders 20 cards at a time, retains its series in
page links and clamps invalid/out-of-range page requests. Series defaults and the
Costs/Characters pages also consume summaries rather than full timelines.

## Status and lazy panel protocol

The legacy detail GET still returns its complete existing response without the
timeline. The new Studio client first sends `x-ys-status: 1` and `x-ys-panel` to the
same endpoint. That bounded response contains a revision, summary, effective run
status and progress. It includes no raw script, shot recipes, reviews, job log or
cost ledger. An unchanged revision preserves the loaded panel and transfers no
additional heavy detail. This is an application revision protocol, not an HTTP 304
or browser-cache claim.

The view revision binds the source state, ledger snapshot, Studio job and selected
panel. Pending-voice episodes also refresh their quota context on minute buckets.
The client requests detail with `x-ys-panel` only for a changed revision or newly
selected tab. The server projects the script, concept, shots, overview, costs or
activity fields that panel uses. Cross-panel data is not treated as an empty valid
panel while its fetch is pending. Vector drawing recipes are omitted from card
payloads; actual browser playback still reads the separate full timeline endpoint.
An already open player reloads when the completed timeline marker changes.

The episode view schedules its next poll after the previous one settles: 1.5 seconds
while running, five seconds otherwise. Requests time out after 30 seconds. A new
refresh aborts the previous GET and its generation number prevents a late response
from replacing newer data, even when a transport ignores cancellation. Changing
episodes or unmounting invalidates and aborts the pending GET. Network failures are
retried on the next poll. A failed initial request displays a localized error and
**Try again** button instead of leaving the page in its loading state. A later
failure keeps the last loaded episode visible with an explicit stale-data warning.
HTTP failures, invalid response JSON, network errors and timeouts use the same safe
message; raw transport/server error text is not displayed. Successful refresh clears
the warning. Manual retry starts immediately and resets the polling schedule, so a
previously scheduled poll cannot interrupt that retry. Action POST requests are not
part of GET cancellation.

Regression tests use deferred responses, fake timers and read-count assertions.
The legacy fixed listing fixture retains its four-read bound. Summary tests cover
missing/corrupt/pending data, restart, external edits, deletion, source-write failure,
source/index identity and gated repair/publication races. Client tests count detail
fetches across unchanged polls, revision changes and tab navigation. Compact status
recalculates elapsed-time ETA from the saved stage start and counts on each request;
the source revision stays stable while time advances. Legacy summaries without a
stage-start field retain their stored estimate until rebuilt or next saved.

## Review workspace identity and lifetime

Detail responses now carry `sourceRevision` and canonical `outputVersions` for main
and Short, including the existing legacy path/time identity. The Shots projection
also includes Short and voice-audit summaries. These additions do not change state
serialization or create another rendering engine. Quality-board refresh identity
uses the source revision and completed-timeline marker as well as report/output
versions, so plan changes cannot silently retain an old issue list.

EpisodeView retains the last fully loaded Shots panel while another panel is
active. It hides/pauses that workspace, disables its pending evidence reads and
keeps local filters, shot selection and positions. Reopening first waits for the
requested current Shots panel; late detail responses still pass the existing
request-generation guard. The cache is scoped to the episode ID and cleared by
unmounting the episode; it is not a disk/session cache.

The timeline player bounds reads to 30 seconds, aborts obsolete loads and cleans
frame listeners on close/unmount. A pending hidden seek applies once when active;
returning to the same request does not rewind. Encoded players retain positions
per output identity. `export=<canonical identity>` on the video stream rejects an
identity mismatch with 409; measured source size/time mismatch also returns 409.
Legacy video callers without this query retain their existing behavior. These
metadata checks do not provide a cryptographic guarantee against arbitrary
concurrent external filesystem mutation.

Quality decisions abort and ignore stale request completion when episode/export
identity changes or the board unmounts. Backend producer-lock and export/finding
checks remain authoritative. Selecting an issue never grants a decision or starts
generation, and a missing association is shown explicitly.

## Library query and cost scopes

Studio's library uses the same filter normalization and predicates for Home and
the list API (`apps/studio/src/lib/library.ts`). `q`, `series`, `status`, `style`,
`queue` and `sort` compose before pagination. The style is the resolved pack when
recorded, otherwise the requested pack or automatic default. The Home `page` is
zero-based; API `offset`/`limit` remain bounded as before. Shareable filter links
reset the page, and paging preserves the filters. Filtering never starts a job.

Approval queues use the stored run status and actual script/concept/preview stage
mapping. Active jobs are not pending review. Failed/stalled episodes take precedence
over export labels. Missing-output labels indicate an absent render record after
timeline/render completion; recorded-output labels require render completion.
These are metadata classifications, not physical file existence checks or accepted
export decisions. Expensive file-health checks remain separate from warm listing.

Home sums ledger entries only for the matching episode IDs, across all pages.
Non-cached LLM costs are agent usage; other non-cached costs are media spend, and
billed failures remain included. The combined cap is the sum of matching media
budgets. Historical/orphan entries remain in the ledger and on Costs; they are
not silently deleted or charged to the selected library subset.

## Cost snapshot cache

JSONL ledgers validate file identity/size/nanosecond timestamps and reuse parsed
entries while those metadata remain unchanged. Returned entries are isolated from
the private cache. Cold concurrent reads share one stable read; changed files are
retried before caching, and invalid JSON/read errors still fail. A snapshot's
revision is bound to its own returned entries even if another reader advances the
cache before its caller resumes. Append, replacement, truncation and deletion all
invalidate the metadata identity.

The database-backed ledger retains its existing list queries and uses a digest of
the returned rows for the response revision. It does not yet have the JSONL
metadata/cache optimization. Spend policy is unchanged: billed media failures
count; cached calls and agent calls remain outside the media cap.

Snapshot support is detected by capability rather than constructor identity because
Next.js bundle layers can share a singleton created by another module copy. HMR
also upgrades a pre-index repository object while keeping the existing store,
ledger and job map. Restart a long-lived Studio process to install the new storage
and ledger implementations fully; older objects remain functional through the
authoritative-read fallback until then.

## Isolated scale measurements on 16 November 2026

Each synthetic state contains 256 KiB of inert timeline padding. These are metadata
fixtures, not rendered or editorially reviewed episodes. Node.js 26.13.0 on the
current Windows filesystem; one baseline, one cold rebuild and three warm samples:

| Episodes | Legacy listing ms | Cold rebuild ms | Warm range ms | Source bytes read, legacy | Summary bytes read, warm |
| --- | ---: | ---: | ---: | ---: | ---: |
| 50 | 26.76 | 86.64 | 4.74–5.81 | 13,121,640 | 31,140 |
| 200 | 70.37 | 314.20 | 20.76–52.30 | 52,486,690 | 124,690 |
| 1,000 | 454.77 | 1,953.28 | 86.23–143.61 | 262,433,890 | 623,890 |

Warm source-body reads were zero in every sample. A 20-row JSON page was about
8.7 KB on these fixtures. The cold pass pays reconstruction/CAS costs and is slower
than the old one-off listing; subsequent processes reuse its durable summaries.

Bytes above are values returned by `AssetStore.get`, not total physical disk or
network traffic. Approximate sampled heap peaks above baseline at 1,000 records
were 50.0 MB for the old listing and at most 26.3 MB for the warm samples; immediate
heap deltas varied with collection. Sampling was every 5 ms, not a full allocation
profile or RSS measurement. No universal latency, p95, live S3 performance or
production-memory guarantee is inferred. All fixture source hashes were preserved.

Evidence/script: `.temp_files/roadmap-b-2026-11-16/benchmark.mjs` and
`benchmark-final/results.json`. The final run verifies source/dependency
fingerprints before and after execution. These Git-ignored local artifacts are not
hosted CI proof.
