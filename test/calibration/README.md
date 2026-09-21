# Calibration suites

Live Jev suites excluded from `npm test` / Vitest (`vite.config.ts` →
`exclude: ['test/calibration/**']`).

| Script | Entry | Purpose |
|--------|-------|---------|
| `npm run calibrate:skirmish` | `skirmish.calibration.ts` | Standing-order wording → adopted `skirmish` (Arcanist + Vanguard) |
| `npm run calibrate:health` | `health.calibration.ts` | Fixed order; step `condition` + `survivable_hits` ladder |

## Why not `npm test`

- Calls live Jev (tokens, network, non-deterministic).
- Not meant for CI watch / unit-test loops.

Unit coverage that *is* in `npm test`: the goblin-closing fixture lock
(`test/digest.goblin-closing.spec.ts`) and `test/buckets.spec.ts`
(condition hysteresis + lethality phrases).

## Prerequisites

1. `TYPESAFE_API_KEY` in the environment or `.env` (scripts load `--env-file=.env`).
2. Free port / quiet Vite: runners kill whatever is on **5173** and Vite processes before calling Jev.

---

# Skirmish calibration

Entry point: `skirmish.calibration.ts` via `npm run calibrate:skirmish`.

## How to run

```bash
npm run calibrate:skirmish
npm run calibrate:skirmish -- --repeats=5
npm run calibrate:skirmish -- --class=vanguard
```

`--repeats=N` overrides the default per-tier counts for **all** cases:

| Tier | Default repeats |
|------|-----------------|
| 1 (positives) | 3 |
| N (negatives) | 3 |
| 2 (observed) | 1 |

`--class=arcanist` or `--class=vanguard` runs one class. Default is both.

## What it measures

For each class, then each case, the suite:

1. Loads that class's locked digest fixture (`situation.goblin-closing.json` for Arcanist, `situation.goblin-closing.vanguard.json` for Vanguard).
2. Injects `orders.given_directly_to_this_character` = case order.
3. Builds the same questions as production (`buildDecideQuestions`) from that class's actor (role, kit, default state).
4. Asks live Jev.
5. Grades **`applyBehaviorDecision`** (Choice + hysteresis), starting from the **class default state** — `hold_and_shoot` for Arcanist, `close_and_attack` for Vanguard — not the raw `choice` string.

Low-confidence skirmish labels that leave the actor in their default state fail tier-1 cases. Console `picked` / snapshot `resolvedBehavior` are the post-hysteresis state; `choice` is the raw label.

## Fixture

Situation: Case A 1v1 with the goblin **a short run away** (edge gap ≈ 4u). Built by `createGoblinClosingWorld` / `buildGoblinClosingDigest` in `situation.ts` (one player kind vs one goblin).

Each JSON fixture matches that class's **player** digest from `buildDigest`
(character role/abilities/behavior + `condition` / `survivable_hits`; enemy
`kind` + `condition` / `hits_to_finish`; no orders — orders are injected per case).

Lock test (`npm test`):

- Positions still bucket as `a short run away` for both classes.
- `buildGoblinClosingDigest(1, kind)` equals that class's fixture exactly.

If you change player digest shape, update the fixtures and the lock will catch drift.

## Cases (`cases.ts`)

Same wording cases run for each class.

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

Each run writes `snapshots/skirmish.<ISO>.json` (class kind, probabilities, confidence, raw `choice`, `resolvedBehavior`, per-class and overall summary counts, `questionsGitSha` of last change to `src/net/questions.ts`).

- **Never asserted** by Vitest.
- After criteria rewords, **hand-diff** recent snapshots to see probability / adoption shifts.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Tier 1 and negatives all PASS (tier 2 ignored for exit) |
| `1` | Missing `TYPESAFE_API_KEY`, thrown error, or any tier-1 / negative `FAIL` |

---

# Health ladder calibration

Entry point: `health.calibration.ts` via `npm run calibrate:health`.

Fixed standing order: **`keep your distance and shoot`**. Situation locked to the
Arcanist goblin-closing fixture; only `condition` and `survivable_hits` step through five
rungs (matching lethality phrases).

| Rung | condition | survivable_hits | Gate |
|------|-----------|-----------------|------|
| H1 | untouched | can take several more hits | tier 1 → `skirmish` |
| H2 | scratched | three more hits… | observed |
| H3 | bloodied | two more hits… | observed |
| H4 | badly hurt | two more hits… | observed |
| H5 | at death's door | the next hit will kill… | tier 1 → `retreat` |

Reports:

- `P(retreat)` across the five rungs (expect rising — soft report, not a hard fail).
- Snapshot under `snapshots/health.<ISO>.json`.
- Ablation pass with `survivable_hits` omitted; console notes whether the curve
  moved (if barely, the amendment may buy little for this order).

```bash
npm run calibrate:health
```

Exit `1` only on missing key, thrown errors, or H1/H5 tier-1 failures.
