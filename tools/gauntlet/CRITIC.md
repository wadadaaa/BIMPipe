# Gauntlet critic protocol

How a round's blind A/B is judged. Repeat verbatim every round; do not improve the
prompt between rounds (a changed prompt makes rounds incomparable).

## Privacy

- Critics receive ONLY two image paths per trial, `…/rounds/NN/<F>/trial-<t>/A.png`
  and `B.png`. `<F>` is a neutral floor code (`F1`, `F2`); the path carries no
  project, file or firm name and nothing says which side is ours.
- The images are rendered with `--anonymize` (no title strip). Storey names that
  the IFC carries inside riser tags are user data and pass through; they name no
  project or person.
- `key.json` (which side is ours) lives in the floor folder, never in a trial folder.
  Never paste it, the metrics, the model JSON or any other file into a critic prompt.
- Nothing under `external/` is committed; the round log in `PROGRESS.md` records
  only round numbers, metrics and verdict counts.

## Step 0 — style check (once per round, before the A/B)

Run the style critic twice with fresh context (see `external/gauntlet/style/log.md`
for the prompt and the history) on sanitary-only crops: a crop of the reference
sheet raster containing only sanitary pipes and fixtures, against a comparable crop
of our render of the ENGINEER model (same dpi). A named convention gap is fixed in
`src/domain/drawing/` (style only, snapshot test updated with the reason) before
the A/B is run, so the A/B measures engineering, not drafting.

## Step 1 — produce the pairs

```sh
node tools/gauntlet/run-round.ts --round NN            # both floors, 10 trials each
```

A red hard metric writes `verdict.json = { result: 'loss', reason: [...] }` and no
trial folder; the round is lost before any critic is asked. `--force-trials` still
writes the pairs (verdict stays `loss`) so the gap can be named for the next round.

## Step 2 — one fresh-context critic per trial

For every `trial-<t>` folder launch a NEW agent with empty context (Cursor: Task
tool, `subagent_type: generalPurpose`, `run_in_background: false`; one agent per
trial, sequential or a few in parallel). The prompt is exactly the string in
`rounds/NN/<F>/prompts.json` for that trial, i.e.:

```
You are a senior sanitary/drainage engineer reviewing two candidate drainage layouts for the same floor, drawn in the same drafting convention: <abs path>/A.png and <abs path>/B.png. Read both images. Decide which layout is the more professional, buildable engineering design (stack locations, collector geometry, runs along walls vs diagonals, crossings, sleeves, slopes/diameters). Answer in this exact format and nothing else:
WINNER: A|B
CONFIDENCE: low|medium|high
GAP: one sentence naming the single biggest engineering gap in the losing drawing, choosing from: stack location, collector geometry, run along walls vs diagonal, crossings, missing sleeves, unrealistic slopes/diameters, other.
```

Nothing else goes into the prompt: no context about the project, no hint about
which side is ours, no earlier verdicts, no metrics. Never reuse an agent across
trials (its memory of the first pair would bias the second).

Save each reply verbatim as `rounds/NN/<F>/critic/trial-<t>.txt`.

## Step 3 — tally

```sh
node tools/gauntlet/tally-round.ts --round NN
```

Maps A/B through `key.json` and writes per floor:

- `verdicts.json` — per trial: winner side, mapped winner (`ours` | `engineer`),
  confidence, gap category, gap sentence.
- `summary.json` — engineer preferred x/N, confidence spread, gap histogram, the
  gap histogram restricted to trials OURS lost, and `gapToFixNext` = the most
  frequent gap named against us. That is the ONE gap the next round works on.

Unparseable or missing replies are listed in `summary.json`, never guessed.

## Step 4 — record

Append the round to `external/gauntlet/index.md` (metrics, verdict, x/N, gap, image
links) and one row per floor to the `PROGRESS.md` round table (numbers only).
