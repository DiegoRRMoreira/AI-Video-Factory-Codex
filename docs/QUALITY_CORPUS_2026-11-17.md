# Quality corpus readiness

Date: 17 November 2026. Package E inventory at source
`3235808fe9efd390d8b3c87e369a8eea675473c9`, including the preserved local tsconfig
bytes. This is preparation for calibration, not a completed labeled corpus.

## Verified existing material

The existing immutable `.data/bench/fixture-v1` passed the current
`verifyBenchmark` implementation: its manifest identity and all **153 referenced
file hashes** matched. Input identity:
`7bba36dc2cbd663468526477d8b0b02a289023ae422a6f6cb7c2376cf9c49af3`.

The retained `quality-baseline-20261111` run has 30 stills from 15 episodes and six
clips. All 30 stills and six clips were read and hashed. FFprobe confirmed a video
stream and positive duration for all six clips. Existing technical reports are
historical evidence; no fresh semantic or technical audit was performed here.

| Dimension | Existing coverage |
| --- | --- |
| Framing labels | 10 close, 12 wide, 4 group, 4 scene |
| Input style selections | 12 named packs plus 3 items selected with `auto`; this does not establish 13 distinct rendered styles |
| Language | 30 Turkish items |
| Composition | 30 horizontal 1920×1080 items |
| Human labels | 0 |
| Editorial review of this run | Skipped; recorded generation/review cost $0 |

The run records `1d8fc50+dirty` from 11 November. Its source hash differs from the
current source hash. The files are useful retained review material, but cannot
certify the current renderer or a 0.6.1 quality improvement.

## Review packet

`.temp_files/post-release-0.6.1-2026-11-17/human-review-packet.json` binds each item
to its episode/shot, category, input style, language, aspect, exact still bytes,
optional clip bytes/frame range and historical source identity. Every human
review field is deliberately pending/null. The packet is a new scaffold; it was
not imported into production decisions or presented as an accepted labeling
schema. Existing fixture/run files were retained unchanged.

For each item, a human reviewer should record:

1. Reviewer identity/date and the exact packet/input/media identities used.
2. A meaningful defect, an accepted artistic choice, or an explicit unresolved
   judgment. Absence of review must remain pending.
3. Concrete visible/audible evidence, affected frame/time range and severity.
4. Why a hold, monochrome treatment, tight crop or intentional silence is valid
   when it is accepted. Distinguish missing narrated action from stylistic taste.

Keep annotation revisions rather than overwriting the first judgment. Assistant
observations and automatic technical findings must remain distinct from human
labels. No automatic export or publishing approval follows from this packet.

## Next execution sequence

1. Add explicit selection metadata for narrated actions, readable text,
   transitions, archive inserts and portrait crops. Existing framing categories
   alone do not establish those coverages. Resolve the three `auto` selections
   against their frozen style context before reporting style-family counts.
2. Plan a small portrait and additional-language supplement with fixed source
   inputs; preserve the published fixture instead of replacing it. Select cases
   for observed production risks, not to increase a sample count.
3. Produce a fresh free run on quiescent, identified source inputs through the
   existing benchmark workflow. Retain skipped editorial status. Coordinate with
   ongoing production rendering and record render settings and completed/failed
   samples separately.
4. Collect human labels and adjudicate disagreements. No human judgments or
   task-time data were collected by the inventory step.
5. Only after separate authorization for paid critic calls, score repeated runs
   with matching input/reviewer configuration. Estimate reviewer variability
   before comparing a candidate; report misses, false alarms and unresolved cases.

See the [benchmark runbook](QUALITY_WORKFLOW.md#freeze-a-benchmark),
[roadmap](ROADMAP_2026-11-16.md#e-establish-a-calibrated-quality-corpus) and
[post-release verification](releases/v0.6.1-verification.md) for the acceptance
boundaries. No media was regenerated and no paid provider/critic call was made
for this inventory.
