# Skirmish calibration

Live Jev suite that checks whether standing-order wording maps to **adopted** `skirmish` behavior — criteria text and hysteresis together, not raw Choice labels alone.

Entry point: `skirmish.calibration.ts` via `npm run calibrate:skirmish`.

## Why not `npm test`

- Calls live Jev (tokens, network, non-deterministic).
- Excluded from Vitest (`vite.config.ts` → `exclude: ['test/calibration/**']`).
- Not meant for CI watch / unit-test loops.

Unit coverage that *is* in `npm test`: the goblin-closing fixture lock (`test/digest.goblin-closing.spec.ts`).

## Prerequisites

1. `TYPESAFE_API_KEY` in the environment or `.env` (script loads `--env-file=.env`).
2. Free port / quiet Vite: the runner kills whatever is on **5173** and Vite processes before calling Jev.

## How to run

```bash
npm run calibrate:skirmish
npm run calibrate:skirmish -- --repeats=5
```

`--repeats=N` overrides the default per-tier counts for **all** cases:

| Tier | Default repeats |
|------|-----------------|
| 1 (positives) | 3 |
| N (negatives) | 3 |
| 2 (observed) | 1 |

## What it measures

For each case, the suite:

1. Loads the locked digest fixture (`fixtures/situation.goblin-closing.json`).
2. Injects `orders.given_directly_to_this_character` = case order.
3. Builds the same questions as production (`buildDecideQuestions`).
4. Asks live Jev.
5. Grades **`applyBehaviorDecision`** (Choice + hysteresis), starting from `hold_and_shoot` — not the raw `choice` string.

Low-confidence skirmish labels that leave the actor in `hold_and_shoot` fail tier-1 cases. Console `picked` / snapshot `resolvedBehavior` are the post-hysteresis state; `choice` is the raw label.

## Fixture

Situation: Case A reference fight with the goblin **a short run away** (edge gap ≈ 4u). Built by `createGoblinClosingWorld` / `buildGoblinClosingDigest` in `situation.ts`.

The JSON fixture matches the current **slim player** digest from `buildDigest` (character role/abilities/behavior; enemy `kind` only; no orders — orders are injected per case).

Lock test (`npm test`):

- Positions still bucket as `a short run away`.
- `buildGoblinClosingDigest()` equals `situation.goblin-closing.json` exactly.

If you change player digest shape, update the fixture and the lock will catch drift.

## Cases (`cases.ts`)

| Tier | IDs | Pass rule |
|------|-----|-----------|
| **1** | 1–5 | `resolved === skirmish` |
| **2** | 6–10 | Recorded as `observed` only — never fails the run |
| **N** | N1–N2 | `resolved ===` required (`close_and_attack` / `retreat`) |

Tier-2 probes (jargon, idiom, indirect phrasing, split clauses) are for hand inspection of rates, not gates.

### Case 6 — `"close"` collision

Order: `don't let the goblin get close`. Probe hypothesis: negation / the word **close** colliding with `close_and_attack` criteria.

If this misroutes, **report it** in notes or snapshots. Do not silently reword behavior criteria to make case 6 pass.

## Snapshots

Each run writes `snapshots/skirmish.<ISO>.json` (probabilities, confidence, raw `choice`, `resolvedBehavior`, summary counts, `questionsGitSha` of last change to `src/net/questions.ts`).

- **Never asserted** by Vitest.
- After criteria rewords, **hand-diff** recent snapshots to see probability / adoption shifts.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Tier 1 and negatives all PASS (tier 2 ignored for exit) |
| `1` | Missing `TYPESAFE_API_KEY`, thrown error, or any tier-1 / negative `FAIL` |
