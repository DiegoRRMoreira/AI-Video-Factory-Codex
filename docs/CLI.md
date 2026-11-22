# CLI guide

[Documentation](README.md) · [Project home](../README.md)

## Episode commands

```bash
pnpm ys episode new --topic "Ottoman coffeehouse bans" --lang en --minutes 3 --motion vector --budget 5
pnpm ys episode run <id>                    # all stages; run again to resume after an error
pnpm ys episode run <id> --until script     # story + script only (no image or voice spend)
pnpm ys episode run <id> --from keyframes   # regenerate from a stage
pnpm ys episode show <id>
pnpm ys cost --episode <id>
pnpm ys plan --cap i2v --duration 5         # provider ranking without spending money
pnpm ys version
```

Replace `<id>` with the ID printed by `episode new`. The creation command saves the episode settings;
`episode run` starts production and uses your configured Claude account and media providers.

### Approvals and resuming

With `--manual`, production pauses for script, concept and preview approval. Inspect the episode in the
Studio or with `episode show`, then approve the gate it is waiting for and run it again. For example,
after reviewing the script:

```sh
pnpm ys episode approve <id> script
pnpm ys episode run <id>
```

Use `concept` or `preview` in place of `script` when that gate is reached. Preview approval starts the
render on the next run. Without `--manual`, a failed draft review can still require explicit preview
approval; inspect its findings before continuing.

After an error, repeat `episode run <id>` to resume saved progress. Use `--from <stage>` only when you
intend to regenerate that stage and its downstream results; generation can incur new costs.

## Episode options

Useful options for `episode new`:

- `--motion animated|mixed|still|vector`
- `--style-pack auto|custom|<pack>` (list: `pnpm ys styles`)
- `--line outline|flat|sketch|ink` (default: the pack's line style)
- `--manual`: stop at the approval gates. Without it the gates are approved automatically, except the render gate while a scene is below the draft review's 8 bar (`pnpm ys episode show <id>` lists those scenes; `pnpm ys episode approve <id> preview` renders anyway).
- `--no-qa`: turn off the frame checks.
- `--no-realism`: turn off the reality check.
- `--side-views`: vector mode only. Characters that walk get a second, profile drawing and turn to it while walking. Each one costs a designer call and a gate check (about $0.15–0.35) and is kept in the library.
- `--no-reverse-views`: vector mode only. By default a room used in six or more shots (at most three rooms) gets its reverse angle drawn once (about $0.11 each, kept in the library); this turns it off.
- `--no-set-dressing`: vector mode only. By default every place gets up to two large period pieces of furniture, drawn once (about $0.05 each, kept in the library) and placed at the back of the room in its wide and medium shots (never with an edge running through or just beside someone's head); this turns it off.
- `--vertical`: render in 9:16.
- `--no-captions`: do not burn subtitles into the video (the `.srt` is still written).

## Shorts from your own footage

`episode new --footage <file>` (repeat the flag for each file) makes a vertical 1080×1920 Short from your own
videos and images (mp4, mov, webm, mkv, m4v, jpg, jpeg, png, webp):

```sh
pnpm ys episode new --footage trip.mp4 --footage beach.mov --footage sunrise.jpg --sec 30 \
  --topic "A weekend on the coast, ending on the sunrise" --overlay "Best morning ever" --lang en --manual
```

- `--sec 15–180`: target length (default 30). Narration may make it longer; the edit never cuts through speech it keeps.
- `--topic`: optional brief for the editor (default "Short").
- `--overlay "text"` (repeatable): your on-screen texts, used verbatim; the editor adds a hook and a call to action itself.
- `--no-narration`: no AI voice-over; the footage, its own sound and the texts carry the Short.
- `--no-transcribe`: do not transcribe the speech in your videos; without it the editor only sees frames and kept speech gets no captions. Transcription uses a local whisper.cpp when `YS_WHISPER` (the `whisper-cli` path) and `YS_WHISPER_MODEL` (a ggml model) are set, free, otherwise ElevenLabs Scribe (about $0.40 per hour of audio, needs `ELEVENLABS_API_KEY`).
- `--no-captions`, `--voice`, `--lang`, `--budget` (default 5) and `--manual` work as for other episodes.

The stages are: scan (frames and transcript), edit (the `footage-editor` agent picks the parts, the crop and whether
each part's own sound plays, writes the narration and on-screen texts; the script gate stops here with `--manual`),
voice, timing (each beat fits its narration and the target), cut (FFmpeg, 9:16, cropped around the subject or shown
whole over a blurred copy), timeline (captions, texts, the original sound, music and sound effects), preview gate and
render. Where narration plays over a part, its own speech drops to a quiet ambience so the two never talk over each
other. In the Studio, choose **New episode → Short from your footage**; files upload as you pick them (up to 1 GB each,
`YS_FOOTAGE_MAX_MB` changes it). The Script tab then shows the edit (each beat's parts with a frame, range, framing and
sound, the narration to edit, the on-screen texts). Before approving you can rearrange or remove beats and parts,
change a part's range, crop focus, framing and sound, a beat's music mood and the texts, then *Save the edit*;
approving it cuts and builds the preview, and the Shots tab plays it
before you approve the render. The cover image is the rendered Short's frame where the hook is fully on screen.

## Character bank

In vector mode, every approved character is kept in a library and shown on the Studio's **Characters** page.
You can have Claude draw a topic-independent character there (a presenter, a scientist, a child…; about
$0.15–0.35 each, gate-checked) and make any character a series mascot. When you start an episode you can pick
a bank character as the on-screen presenter (it speaks the narration and appears in most shots) or add bank
characters to the cast. They are not redrawn: the episode switches to their style pack. CLI: `pnpm ys bank
[list|add|mascot]`, `episode new --presenter <id> --with <id,id>`.

Run `pnpm ys --help` for everything.

## Diagnostics and audit commands

```sh
pnpm ys doctor
pnpm ys doctor --json
pnpm ys episode audit <id>
pnpm ys episode audit-voice <id>
pnpm ys episode compare-style <id>
```

These commands inspect existing tools or media. See [Environment diagnostics](DOCTOR.md), [Rendered-video
audit](RENDER_AUDIT.md), [Voice stem audit](VOICE_AUDIT.md) and [Measured reference
direction](REFERENCE_STYLE.md) for prerequisites and evidence boundaries.

## Local render demo

`pnpm ys render-demo` creates a synthetic episode without paid generation. It pauses at preview approval;
use its printed ID to approve and complete only the render stage:

```sh
pnpm ys render-demo
pnpm ys episode approve <id> preview
pnpm ys episode run <id> --only render
```

For an isolated output directory and an audit of the resulting MP4, follow [Continuous verification](CI.md#run-the-same-gates-locally).
