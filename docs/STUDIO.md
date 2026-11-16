# Studio guide

[Documentation](README.md) · [Project home](../README.md)

## Start and access

```bash
pnpm studio                   # development: http://localhost:3100
pnpm studio:build && pnpm studio:start   # production build, same port
```

The Studio has no login, so it listens on this machine only (`127.0.0.1`) and answers only requests addressed
to `localhost`, `127.0.0.1` or `[::1]`. To open it from another device on a network you trust, start Next.js
on the other interface yourself and name the address the browser will use (comma-separated, set in the shell
that starts the Studio):

```sh
YS_STUDIO_HOSTS=192.168.1.20 pnpm --filter @ys/studio exec next dev -p 3100 -H 0.0.0.0
```

For PowerShell, set the variable before starting Next.js:

```powershell
$env:YS_STUDIO_HOSTS = "192.168.1.20"
pnpm --filter @ys/studio exec next dev -p 3100 -H 0.0.0.0
```

Anyone who can reach that address can start paid jobs and delete episodes.

## Create an episode

Click **New episode** at the start of the top menu; the form has its own full-width page. Enter a topic, then
choose the language, length, motion mode, line style, voice, budget, whether the reality check is on and
whether subtitles are burned into the video. Each motion-mode card shows its estimated cost; the panel on the
right breaks the chosen mode down by stage. Start with the brief, series, language
and duration. **Appearance and style options** and **Budget and advanced production
options** are collapsed initially; expanding them preserves every style and control.
Their inputs remain part of the form, including when collapsed.

Recent-series buttons apply the latest recorded settings without creating an
episode: language, duration, mode, style, line style, voice, tier and media budget.
The series field still lists every series. Previewing a preset or cost estimate
does not start generation; submitting the episode form does.

## Find episodes and pending work

The Episodes page searches titles/topics and combines production status, series,
resolved style pack, oldest/newest sorting and 20-card pagination. Apply the search
form to update the URL. Shared links and refresh retain the filters; changing a
filter or series resets pagination. **Clear filters** returns to the full library.

The work queue opens script, concept and preview approvals, failed/stalled jobs,
missing output records and recorded outputs ready for inspection. Queue counts
respect the other filters. These labels describe stored production state: they do
not check physical output files or grant publishing approval. A missing output
record means timeline/render completion was recorded without a current render
record; early episodes without a video are not automatically classified as broken.

Counts, media spend, agent usage, total spend and combined media budgets cover
every matching episode across all pages. Cached calls and episodes outside the
matching set are excluded; billed failed attempts count. Agent usage is outside
the media budget caps. Orphan ledger entries remain visible on Costs rather than
being assigned to unrelated library cards.

## Follow the next action

The episode's next-action panel precedes the expandable 14-stage detail. It opens
the actual waiting approval, resumes interrupted work, opens a missing script or
opens the recorded output for review. Opening an approval does not approve it or
start generation. Its displayed estimate describes the work after approval, up to
the next unapproved gate; completed stages are excluded. Resume/generation actions
may use paid media or agents. A local-only label is used only when all affected
stages are timeline, render or Short processing. Estimates remain approximate and
provider warnings on Costs still apply; this is not a guaranteed quote.

## Review the script

Edit the scenes and approve them.

## Review the concept

Characters and places are cast and drawn. The quality-gate panel shows each drawing with its references,
scores, defects and drawing plan. Accept, reject or redraw with a note.

## Preview, revise and render

The pipeline rail, live panel and activity log show every agent call with its model, cost and duration.
Production stops before the render and waits for your approval: the Shots tab shows a preview frame of every
shot, and *Approve and render* starts the render once you are happy (re-creating shots asks for the approval
again; changing only subtitles, sound effects or music re-renders without asking). CLI episodes are approved
automatically unless created with `--manual` (`pnpm ys episode approve <id> preview`); in vector mode a shot's
frame appears as soon as all of its props are drawn.

### Re-create selected shots

To change part of a vector episode, before or after the render, select shots there (Shift-click for a range),
write what should change ("the map should show 1453, with the Ottoman and Byzantine states highlighted") and
press *Re-create*: the review's findings for the selected shots go along automatically, so *Select weak shots*
(score 4 or lower) plus *Re-create* fixes them in bulk without a note. The director re-plans only those
scenes, new props are drawn and the video is rendered again (one director call per scene, which also sees the
shots' current frames; the automatic revision passes are skipped so they cannot undo your note, and the
re-planned scenes are reviewed once afterwards so their new scores show). Only the scenes that changed are
rendered again: the render is kept scene by scene, and a render that stops halfway resumes from the scenes
already finished.

### Play without rendering

Once the timeline is ready (voice-over, shot plan and drawings done, the same point as the render approval),
*Play without rendering* on the Shots tab plays the whole episode in the browser: the same scene code the
render uses, with voice-over, music, sound effects, transitions and captions, and a timeline you can seek to
any second. The play button on a shot card (or *Play from this shot* in its details) opens the player at that
shot's first frame. No video file is made and nothing is spent. A paused frame matches the render; busy scenes
may drop frames while playing (the audio stays in sync), and the audio does not get the render's final
loudness pass. Playback is smooth only in the production build (`pnpm studio:build && pnpm studio:start`);
`pnpm studio` (development mode) runs React's checks on every frame.

## Download the publishing package

Watch and download the video and its `.srt` subtitle file, and read its review. Subtitles are always written
as an `.srt` next to the video; burning them in is a per-episode switch (changing it re-renders only, at no
cost). The publishing package gives a YouTube title, a description with chapters, tags (each with a copy
button) and a downloadable 1280×720 thumbnail. A horizontal episode also gets a vertical Short: the package
picks its best 20–60 seconds and they are re-rendered locally as 9:16.

## Delete an episode

Every card on the Episodes page has a trash button, for unfinished and finished episodes alike. It asks first,
then deletes the episode's state, its video, Short, thumbnail, subtitles, render cache, review frames, sound
effects and music. Drawings approved into the library, the shared generation cache and the cost ledger stay.
An episode with a running job cannot be deleted until the job stops.

## On-screen text

On-screen text follows one layout: place, date and event lines sit in a fixed info card at the top-left, and
name tags stay next to their person, all in one typeface and one plate style. The card never covers a face, a
name tag or the text on a screen or board: when people or a board stand in the top corners it moves to the
other corner or into the gap between them, and it keeps that place for the whole shot.

## Other pages

- **Costs:** the spend ledger.
- **Pricing:** provider prices.
- **Lessons:** the learned rule book.
- **Rules:** the Studio rules, read from the same constants the code uses.
- **Models:** the model for each agent.

Heavy work runs in a separate CLI process, not in the Studio server, so CLI runs also appear live in the
Studio.

## Editorial and quality tools

See the [documentation index](README.md#editing-and-quality) for narration edits, claim sources, pronunciation
dictionaries, render/voice audits and export-specific review decisions.
