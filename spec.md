# Arena Prompt Combat - Prototype Spec v0.1

## 1. Pitch

Top-down arena skirmish. Every actor, friendly and hostile, is a puck driven by a
finite state machine. The player does not control movement or attacks directly.
The player selects a puck and types a plain-English standing order. A backend
proxy to TypeSafe's Jev model picks which state each actor runs as the fight
develops, evaluated against that order.

The v0.1 fight is one Arcanist versus one Goblin, tuned so that the default
behavior loses and a correctly prompted skirmish wins. That single outcome is the
whole thesis of the prototype: prompting must be the thing that decides the fight.

---

## 2. The decision model: TypeSafe Jev

Docs: https://docs.typesafe.ai/introduction

Jev is not a text-generating LLM, and the architecture here follows from that.
Relevant pages:

| Page | URL |
|---|---|
| Introduction | https://docs.typesafe.ai/introduction |
| System One concept | https://docs.typesafe.ai/concepts/system-one |
| State | https://docs.typesafe.ai/concepts/state |
| Primitives (Choice, Score, Noul) | https://docs.typesafe.ai/primitives |
| Confidence | https://docs.typesafe.ai/confidence |
| Speculative fan-out pattern | https://docs.typesafe.ai/patterns/fan-out |
| Confidence-gated routing pattern | https://docs.typesafe.ai/patterns/confidence-routing |
| Known failure modes (jev-1.13) | https://docs.typesafe.ai/model-jaggedness/jev-1.13 |
| HTTP API reference | https://docs.typesafe.ai/api |
| JavaScript SDK | https://docs.typesafe.ai/sdk/javascript |
| Agent skill | https://docs.typesafe.ai/agent-skill |

Install the agent skill before generating any code for this project, and pick
your agent when prompted. It installs project-local by default:

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai
```

The skill itself is readable at
https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md if
you would rather drop it in by hand. Without it an agent will write this as if
Jev were a chat completion endpoint.

### What Jev gives you

Jev evaluates typed questions against a state and returns structured results directly, with no text generation and no parsing, returning typed values and probability distributions that code can branch on. Three question types, all of which can be mixed in one call:

| Type | Asks | Returns |
|---|---|---|
| Choice | Pick one option from a list | `choice`, `probabilities`, `confidence` |
| Score | Rate against ordered levels | `score`, `probabilities`, `confidence` |
| Noul | Is this statement true | `noul`, a probability from 0 to 1 |

Every question is evaluated in parallel and in isolation against the same state in one call, so adding questions barely changes response time and does not create context rot between them.

Endpoint and shape:

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json
```

```json
{
  "state": { "...": "application state, string or JSON" },
  "model": "jev-latest",
  "questions": {
    "some_id": { "type": "choice", "instructions": "...", "criteria": { "a": "...", "b": "..." } }
  }
}
```

### Design constraints this imposes

These come from the documented failure modes for `jev-1.13`
(https://docs.typesafe.ai/model-jaggedness/jev-1.13) and they drive most of
section 9.

1. **No generation.** Jev is not trained to generate text, and when the answer space is bounded the right move is to turn the problem into a Choice over the options rather than asking for the value itself. There are no free-form policy objects and no reason strings anywhere in this design.
2. **No arithmetic.** Jev is not a calculator and performs better on semantic questions than mathematical ones, so mathematical logic belongs in code. Never send coordinates, distances, or hit points as numbers and expect a spatial judgment. Compute the geometry, bucket it into named categories, send the names.
3. **Numeric buckets over interpolation.** Score outputs should not be used to reconstruct an exact magnitude between two levels, because the score levels are weak in numerical calibration. A range band comes back as a named option, mapped to units in code.
4. **Small state.** Accuracy falls as the state grows with content unrelated to the decision, so retrieve and filter in code and send only the fields the question needs. One call per deciding actor, containing only that actor's view.
5. **Literal reading.** Jev answers the question as written rather than the question you meant, so the exact condition belongs in the instructions and boundary cases belong in the criteria. Every state option needs a criteria string that describes the behavior as an observable condition.
6. **No structural invariants.** Do not carry a threshold tuned on a Noul over to a Choice, and do not hold the model to arithmetic identities between separate questions. Behavior selection is one Choice. It does not get cross-checked against per-behavior Nouls.
7. **State is not treated as hostile.** Content written to adversarially steer the model can move the answer, so criteria should be explicit and integrations tested before wide deployment. The player's typed order goes into `state`. In single player they can only cheat themselves. Before this is ever shared or competitive, screen submitted orders with a Noul before they reach a decision call (the guardrails pattern: https://docs.typesafe.ai/cookbooks/llm_guardrails).

---

## 3. Scope

### In scope for v0.1

- Single arena, fixed size, no obstacles
- One playable actor (Arcanist) and one enemy (Goblin)
- Four states: `hold_and_shoot`, `close_and_attack`, `skirmish`, `retreat`
- Tap-to-select, bottom-sheet prompt entry, tactical pause on select
- Backend: a single `POST /api/decide` proxying to Jev
- Offline fallback so the game runs with the backend down
- Deterministic sim with seeded RNG and a replayable decision log

### Spec'd now, built later

- The other three classes (Vanguard, Warden, Duelist) and party play
- `take_cover`, `guard_ally`, `focus_fire`, `hold_position`
- Cover objects and line of sight
- Additional monsters, waves, win conditions beyond "last side standing"

### Out of scope

- Artwork, animation, audio
- Character customization, progression, persistence
- Multiplayer, matchmaking, accounts

---

## 4. Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript, strict | Schema validation at the network boundary matters |
| Build | Vite | Fast, no config |
| Render | Canvas 2D, single `<canvas>` | ~20 pucks and some text, no scene graph needed |
| Sim | Hand-rolled fixed-timestep loop | Determinism and replay are requirements |
| Decisions | TypeSafe Jev via `@typesafe/sdk` (JS) | https://docs.typesafe.ai/sdk/javascript |
| Backend | Vercel serverless functions | Holds `TYPESAFE_API_KEY`, matches existing setup |
| Validation | Zod on both ends | Jev output is typed but still validate the shape |

Recommendation against Phaser for this one. Phaser's scene, tween, and arcade
physics layers assume variable-timestep frame updates and own the game loop. This
prototype needs a deterministic fixed-step sim that runs headless for balance
testing and replays from a decision log. Circles and glyphs on a raw canvas are
less code than fighting that.

### Working practices

These are instructions for whoever or whatever is writing the code, including an
agent working from this file.

**Shut the dev server down while working.** Do not leave `vite` running in the
background during edits. Start it when there is something to look at, stop it
before going back to editing. A watcher rebuilding on every keystroke slows the
whole loop down for no benefit when nobody is looking at the page.

**Do not try to test the UI directly.** No automated clicking, no screenshot
diffing, no driving the canvas through a headless browser, no writing a test that
asserts a puck moved on screen. Realtime interactive interfaces are not something
an AI agent tests usefully right now, and a test suite that pretends otherwise
produces confident green output about a broken game. The interactive acceptance
criteria in section 14 are for a person on a phone.

**Everything else should be tested, heavily.** The architecture is arranged to
make that possible: `sim/` has no imports from `render/`, `ui/`, or `net/`, so the
whole fight runs headless. Worth automated tests:

- the sim: movement, collision, ability resolve, death, determinism under a fixed seed
- `buckets.ts`: geometry and condition/lethality to named buckets, including
  boundary values and Schmitt-trigger hysteresis
- `digest.ts`: the state object sent to Jev, asserting no numbers leak into it and
  no enemy order appears in a player actor's digest
- the reference fight, both cases, end to end and headless
- hysteresis and trigger logic against synthetic answer sets, including the
  low-confidence and missing-answer paths
- validation and fallback against malformed, stale, and error responses
- `questions.spec.ts`: written orders and situations against expected behavior

If a bug is only reproducible by hand on a phone, write down the repro steps in
the issue rather than building a harness to catch it.

---

## 5. World model

### Units and coordinates

- 1 unit = roughly 1 meter. Origin at arena top-left, +x right, +y down
- Arena: `16 x 25` units (portrait, phone-first; width × height)
- Puck radius: `0.5` units for all actors in v0.1
- Render scale: `scale = min(canvasW / 16, canvasH / 25)`, letterbox the remainder

### Simulation loop

- Fixed timestep `dt = 1/60`, accumulator pattern
- All randomness from one seeded PRNG (mulberry32). Seed is displayed and enterable
- Time scale multiplier: pause (0), slow (0.15), normal (1), fast (2)

### Determinism

The sim is deterministic given `(seed, decision log)`. Jev is calibrated and
consistent but not guaranteed identical across calls or versions, so a replay
ships the recorded decisions. Record every applied decision as
`{tick, actorId, state, params, probabilities, confidence}` and provide a replay
mode that feeds the log instead of calling the backend. This makes balance testing
possible and gives a record for debugging bad decisions.

### Collision

- Actor-actor: circle overlap, push both apart along the center line by half the overlap
- Actor-wall: clamp position to `[r, W-r]` and `[r, H-r]`
- No projectile entities. Ranged attacks resolve instantly at the end of wind-up
  if the target is still within range

---

## 6. Actor model

```ts
type ActorId = string;
type Side = 'player' | 'enemy';

interface Actor {
  id: ActorId;
  side: Side;
  kind: string;             // 'arcanist' | 'goblin'
  glyph: string;            // '@' for player actors, NetHack letter for monsters
  color: string;            // class color, or outline color for monsters
  pos: Vec2;
  vel: Vec2;
  radius: number;
  hp: number;
  hpMax: number;
  moveSpeed: number;
  abilities: AbilityId[];
  cooldowns: Record<AbilityId, number>;
  casting: null | { abilityId: AbilityId; targetId?: ActorId; point?: Vec2; remaining: number };
  state: StateId;
  stateParams: StateParams;
  standingOrder: string | null;   // raw player text
  partyOrder: string | null;      // the side's order, sent alongside the actor's
  lastDecision: DecisionEntry | null;
  decisionLog: DecisionEntry[];   // last 10
}
```

### Ability model

```ts
interface Ability {
  id: AbilityId;
  name: string;
  kind: 'attack' | 'utility';
  delivery: 'melee' | 'ranged' | 'ground' | 'self' | 'ally';
  range: number;
  damage?: number;
  healing?: number;
  radius?: number;
  cooldown: number;
  windup: number;           // seconds rooted before resolve
  effects?: Effect[];
  blurb: string;            // plain-English description sent to Jev as Choice criteria
}
```

`blurb` is load-bearing, not documentation. It is the criteria string Jev reads
when choosing an ability, so it must describe the ability in observable terms
("a weak attack that can be fired from a long way off") rather than in game
jargon or numbers.

Resolution rule for v0.1: no to-hit roll. An ability resolves at the end of
wind-up and applies its effect if the target is still in range. Damage is flat.
Moving during wind-up cancels the ability, and cooldown starts on cast rather than
on resolve. Positioning is the only variable that matters, which keeps outcomes
legible while tuning.

---

## 7. Classes

Four archetypes, 4e roles, no customization. Every class has exactly four
abilities, by design:

1. An attack that plays to the role's strength
2. An attack that does not (available, legal, usually wrong)
3. A genuinely useful utility
4. A marginal utility

The off-role attack and the marginal utility are the control group. If Jev's
ability Choice is doing real work, actors pick them rarely and for the right
reasons. If they come up as often as the on-role options, the `blurb` criteria are
written badly. This is the cheapest available test of whether the decision layer
is connected to anything.

### Vanguard (Defender) - `#3B82F6` blue, glyph `@`

| Slot | Ability | Delivery | Range | Effect | CD | Windup |
|---|---|---|---|---|---|---|
| On-role attack | Shield Bash | melee | 1.4 | 5 dmg, forces target to retarget self for 3s | 1.4 | 0.3 |
| Off-role attack | Thrown Cleaver | ranged | 7 | 2 dmg | 2.0 | 0.3 |
| Strong utility | Bulwark | self | 0 | self and allies within 2u take 50% damage for 4s | 12 | 0 |
| Weak utility | Battle Shout | self | 0 | allies within 6u deal +5% damage for 4s | 10 | 0 |

### Warden (Leader) - `#22C55E` green, glyph `@`

| Slot | Ability | Delivery | Range | Effect | CD | Windup |
|---|---|---|---|---|---|---|
| On-role attack | Mending Lash | ranged | 6 | 2 dmg, heals lowest-HP ally for 3 | 1.6 | 0.25 |
| Off-role attack | Staff Swing | melee | 1.4 | 3 dmg | 1.0 | 0.25 |
| Strong utility | Suture | ally | 8 | heal 8 | 6 | 0.4 |
| Weak utility | Cleanse | ally | 8 | remove one debuff, heal 1 | 5 | 0.3 |

Cleanse is near-useless until debuffs exist.

### Duelist (Striker) - `#EF4444` red, glyph `@`

| Slot | Ability | Delivery | Range | Effect | CD | Windup |
|---|---|---|---|---|---|---|
| On-role attack | Flurry | melee | 1.4 | 3 hits of 3 dmg over 0.6s | 2.0 | 0.2 |
| Off-role attack | Thrown Dagger | ranged | 6 | 2 dmg | 1.2 | 0.2 |
| Strong utility | Shadowstep | self | 6 | dash to a point within 6u, ignores actor collision | 8 | 0.1 |
| Weak utility | Feint | self | 0 | next incoming attack in a 0.5s window misses | 6 | 0 |

Feint requires reading an enemy wind-up. Note that this is a timing judgment on a
sub-second window, which is the kind of thing to keep in code rather than ask Jev
about: expose it as an automatic reaction owned by the client, not as a per-tick
question.

### Arcanist (Controller) - `#A855F7` purple, glyph `@`

The v0.1 playable class.

| Slot | Ability | Delivery | Range | Effect | CD | Windup |
|---|---|---|---|---|---|---|
| On-role attack | Arc Bolt | ranged | 9 | 2 dmg | 1.0 | 0.2 |
| Off-role attack | Staff Jab | melee | 1.2 | 2 dmg | 0.8 | 0.2 |
| Strong utility | Glyph of Slowing | ground | 7 | 3u radius, enemies inside move at 60% speed, 4s | 10 | 0.4 |
| Weak utility | Arcane Mark | ranged | 9 | target takes +10% damage for 5s | 4 | 0.2 |

Arc Bolt is intentionally weak: 10 hits to kill a Goblin.

Stat block: `hp 24, moveSpeed 5.0, radius 0.5`

---

## 8. Monsters

Monsters use the same actor model, the same state catalog, and the same decision
pipeline as players. The only difference is that their standing order comes from
the encounter definition instead of the player.

### Goblin - glyph `g`, outline `#84CC16`

| Field | Value |
|---|---|
| HP | 20 |
| Move speed | 3.6 |
| Radius | 0.5 |
| Ability | Rusty Cleaver: melee, range 1.4, 6 dmg, CD 1.2, windup 0.35 |
| Default state | `close_and_attack` |
| Standing order | "Charge the nearest enemy and keep hitting it. Never back off." |

Rendering rule: player actors are filled circles with a white glyph, monsters are
dark circles with a colored outline and colored glyph. Side reads at a glance
without knowing the color semantics.

---

## 9. State catalog

States are class-agnostic. Every actor can run every state. What differs is which
abilities the actor has to spend inside it.

```ts
interface StateParams {
  targetId?: ActorId;
  rangeBand?: RangeBandId;     // named, mapped to units in code
  abilityPriority?: AbilityId[];
  anchor?: Vec2;
}
```

Range bands are a closed set, because Jev picks the name and code owns the number:

| Band id | Units | Criteria string sent to Jev |
|---|---|---|
| `contact` | 0 to 1.4 | Close enough to touch the enemy |
| `just_clear` | 2 to 4 | Just outside the enemy's reach |
| `well_clear` | 5 to 8 | Well away from the enemy but still able to shoot it |
| `disengaged` | 9 to 12 | Across the arena, out of the fight |

| State | v0.1 | Behavior |
|---|---|---|
| `close_and_attack` | yes | Move at target until inside the shortest-range priority ability, attack on cooldown |
| `hold_and_shoot` | yes | Do not move. Attack whatever is in range, nearest first |
| `skirmish` | yes | Hold the assigned range band. Attack only when inside it and not fleeing |
| `retreat` | yes | Move away from all hostiles, no attacks, exit when gap exceeds threshold |
| `take_cover` | no | Move to break line of sight to the highest-threat hostile |
| `guard_ally` | no | Stay within 2u of an assigned ally, body-block incoming melee |
| `focus_fire` | no | Attack the team's designated target regardless of proximity |
| `hold_position` | no | Stand at `anchor`, engage only what enters range |

### Steering

Every movement state produces a desired velocity from three weighted terms, then
normalizes to `moveSpeed`:

```
desired = w_intent * intentDir
        + w_sep   * separationDir    (from other pucks within 1.5u)
        + w_wall  * wallRepulsionDir (ramps up within 2.5u of a wall)
```

Suggested weights: `w_intent 1.0`, `w_sep 0.6`, `w_wall 0.8`.

The wall term is not optional. Without it a skirmishing actor backs into a corner
and dies, and the one fight this prototype exists to demonstrate does not work.

### `skirmish` in detail

```
gap = dist(self, target) - self.radius - target.radius
[min, max] = bandToUnits(stateParams.rangeBand)

if gap < min:
    intentDir = away_from_target rotated by +/- 35 degrees
                # rotation sign chosen once on state entry, flips if the
                # rotated heading points into a wall within 3u
    do not cast
else if gap > max:
    intentDir = toward_target
else:
    intentDir = zero
    cast the first ready ability in abilityPriority whose range >= gap
```

The 35 degree offset is what makes kiting work in a bounded arena. Running
straight away opens the gap fastest and ends at a wall. Running at an angle opens
it more slowly while tracing a wide arc the pursuer's direct-chase path keeps
cutting into but never closes.

---

## 10. Decision layer

The whole architecture in one line: **the client owns the strategy, Jev picks
which one to run.**

| Owned by the client, in code and data | Picked by Jev, per decision |
|---|---|
| The state catalog and what each state does | Which state this actor runs now |
| Range band values in units | Which range band, by name |
| Ability stats, ranges, cooldowns | Which ready ability to use next |
| All geometry, arithmetic, bucketing | Nothing numeric, ever |
| Target when there is one enemy | Target when there are several |
| Triggers, fallbacks, hysteresis, timing | Nothing that has to be fast or guaranteed |

There is no compile step and no policy object. The player's prose goes into the
state of every decision call and Jev reads it there alongside the situation.

An earlier draft of this spec had a compile pass that turned the order into a
typed policy once, then fed the policy to the per-tick calls. That was wrong here.
It added a second call site, a merge layer, a cache to invalidate, and a second
place behavior could come from, all to avoid resending a few dozen tokens of
prose. It also froze the order's meaning at submit time, when the useful property
is the opposite: "hold the line" should read differently at full health and at
three hit points, and it does, because the situation is in the same state object.

What the client keeps that a policy would otherwise have held:

- **Hard constraints.** Not inferred from prose. If a behavior must never happen,
  the encounter leaves it out of `allowedStates` and Jev never sees it as an option.
- **Triggers** (10.3). Fixed per role in data, not read out of an order.
- **Fallbacks.** Role defaults in code, used whenever the backend is unavailable.

### 10.1 The call: `POST /api/decide`

One call per deciding actor. This reverses the more obvious design of batching a
whole side into one call: unrelated material in the state acts as a distractor and
costs accuracy, and asking "which behavior should actor p1 use" inside a state
describing eight actors is exactly the kind of indirection the model handles
worst. Each actor gets its own small state.

Everything numeric is bucketed in code before it is sent. No coordinates, no hit
point totals, no distances in units.

State sent:

```json
{
  "character": {
    "role": "a spellcaster who attacks from a distance and is weak in close combat",
    "condition": "bloodied",
    "survivable_hits": "two more hits would kill this character",
    "current_behavior": "standing still and shooting",
    "ready_abilities": [
      "Arc Bolt: a weak attack that can be fired from a long way off"
    ],
    "unavailable_abilities": ["Glyph of Slowing", "Arcane Mark"],
    "room_to_back_away": "open"
  },
  "orders": {
    "given_directly_to_this_character": "keep your distance and shoot",
    "given_to_the_whole_party": "stay spread out, nobody dies"
  },
  "enemy": {
    "kind": "goblin",
    "condition": "scratched",
    "hits_to_finish": "it will take several more hits to kill",
    "how_close": "almost within reach",
    "moving_toward_the_character": true,
    "reach": "can only attack from close enough to touch",
    "about_to_attack": false
  }
}
```

Both orders are sent verbatim. The field names carry the precedence, and the
instruction repeats it, because this is the one judgment the no-compile design
hands to the model that a code merge would have settled: when the two orders
disagree, Jev decides. Omit either field entirely when it is empty rather than
sending an empty string. Put a conflicting pair in the golden tests (section 13).

Bucketing rules, all computed in code. Percentage alone is not enough for
retreat — send `condition` plus lethality phrases. Nothing numeric in the digest.

| Field | Buckets / phrases |
|---|---|
| `condition` | untouched (>85%), scratched (60–85%), bloodied (35–60%), badly hurt (15–35%), at death's door (≤15%). Schmitt-trigger hysteresis (±4pt exit bands) keeps the previous label on the actor for deterministic replays |
| `survivable_hits` | on character: `ceil(hp / worstIncomingHit)` where worstIncomingHit is the highest single-hit damage among **living hostiles on the field**. Phrases: 1 → "the next hit will kill this character"; 2 → "two more hits would kill this character"; 3 → "three more hits would kill this character"; 4+ → "can take several more hits". Omit when no living hostile |
| `hits_to_finish` | on enemy: `ceil(enemy.hp / bestReadyAttackDamage)` using the actor's highest-damage **ready** ability. Phrases: 1 → "one more hit will kill it"; 2 → "two more hits will kill it"; 3 → "three more hits will kill it"; 4+ → "it will take several more hits to kill" |
| `how_close` | within reach, almost within reach, a short run away, a long way off, across the arena |
| `room_to_back_away` | open, limited, cornered (from wall distance along the away vector) |
| `about_to_attack` | true if the enemy is mid-windup |

`condition` replaces the old single `health` key on both character and enemy.

Questions, one call:

```json
{
  "behavior": {
    "type": "choice",
    "instructions": "Which behavior should this character use right now? Follow the order given directly to this character. Where that order is silent, follow the order given to the whole party.",
    "criteria": {
      "skirmish": "Back away from the enemy while attacking it, staying out of its reach",
      "close_and_attack": "Walk straight at the enemy and fight it up close",
      "hold_and_shoot": "Stand still and attack anything within range",
      "retreat": "Run away from the enemy and do not attack"
    }
  },
  "range_band": {
    "type": "choice",
    "instructions": "How far from the enemy should this character try to stay right now?",
    "criteria": {
      "contact": "Close enough to touch the enemy",
      "just_clear": "Just outside the enemy's reach",
      "well_clear": "Well away from the enemy but still able to shoot it",
      "disengaged": "Across the arena, out of the fight"
    }
  },
  "ability": {
    "type": "choice",
    "instructions": "Which of the character's ready abilities should it use next?",
    "criteria": { "arc_bolt": "A weak attack that can be fired from a long way off" }
  },
  "in_trouble": {
    "type": "noul",
    "instructions": "The character is in immediate danger of being hit by the enemy."
  }
}
```

`range_band` is always asked and states that do not use it ignore it. Questions in
one call are evaluated in parallel and adding them barely changes response time,
so a question that is sometimes useful costs less than the branching needed to
decide whether to ask it. Code maps the band name to units through `bands.json`.
The client may pin the band for a state and drop the question, which is the
cheaper option if the answer turns out to track `behavior` exactly.

Target selection is a Choice over enemy ids only when more than one enemy is
present. With one enemy, code picks it and the question is not asked. Do not ask
the model something code can compute exactly.

### 10.2 Confidence gating and hysteresis

The single biggest failure mode for a model-driven FSM is thrashing: switching
behavior every decision tick and never committing to anything. Jev returns both a
distribution and a confidence, so the fix is mechanical
(https://docs.typesafe.ai/patterns/confidence-routing):

```ts
const next = answers.behavior;
const currentP = next.probabilities[actor.state] ?? 0;

if (!encounter.allowedStates.includes(next.choice)) {
  keepCurrent();                                  // should be unreachable, log it
} else if (next.confidence >= 0.70) {
  switchTo(next.choice);
} else if (next.confidence >= 0.45 && next.probabilities[next.choice] - currentP > 0.15) {
  switchTo(next.choice);                          // clear enough margin over what we are doing
} else {
  keepCurrent();                                  // model is unsure, do not flip
}
```

Plus a hard floor: no behavior switch within 0.6s of the last one, regardless of
confidence, except when a trigger fires.

Sustained low confidence on `behavior` is the signal that an order is not reading
clearly. Surface it in the actor sheet rather than swallowing it: an order the
model cannot act on is a UX problem the player can fix by rewording, and they can
only do that if they can see it.

### 10.3 Triggers

Conditions code evaluates every tick with no network call. Fixed per role in
`data/triggers.json`, not derived from any order. This is what gives an actor a
fast reaction time despite a multi-second decision cadence:

- `survivable_hits` resolves to the one-hit phrase (next hit kills) and `retreat`
  is allowed: request a decision immediately (prefer early call over forced state)
- current target dead: clear target, request a decision immediately
- enemy inside contact range while the actor is in `hold_and_shoot`: request a
  decision immediately rather than waiting out the interval

A trigger can force a state or force an early call. Prefer forcing an early call.
A trigger that forces a state is the client overruling the order, and every one of
those is a place the player's prompt stops mattering.

### 10.4 Cadence

- Base interval 2.0s per actor, actors staggered evenly across the interval
- Additionally on material events: target dies, `condition` band changes,
  `survivable_hits` phrase/count changes, a new order is submitted, `how_close`
  bucket changes
- Hard floor of 0.75s between calls for the same actor
- Timeout 1200ms, then keep the current behavior. Discard any response more than
  one interval stale
- One in-flight call per actor. A new trigger while a call is in flight cancels
  and reissues rather than queueing

The 2.0s interval is a placeholder. The docs describe Jev as fast and show that
batching questions into one call is much cheaper and faster than splitting them
(https://docs.typesafe.ai/cookbooks/parallel_questions reports 12.2x cheaper and
10.0x faster for a 13-question batch), but they give no absolute latency figure I
can cite. Section 10.6 makes the number fall out of normal play instead of a
separate spike: run a fight, read the meter, set the interval. If p95 lands well
under 500ms, drop the interval and make the tactical pause opt-in. If it is over a
second, the pause stays and the trigger list in 10.3 gets longer.

### 10.5 Validation and fallback

Treat the response as untrusted despite being typed:

1. Schema parse fails, or `choice` is not in `allowedStates`: keep current behavior
2. Ability choice naming something not ready: drop it, use the role's default
   ability order
3. Missing answers: keep current behavior, no error
4. HTTP error, timeout, or rate limit: fall to `offlinePolicy.ts`, which runs the
   actor kind's role default state and band

The game must stay playable with the backend down, which also means it stays
playable in a test. Show degraded mode in the HUD so it is never mistaken for a
balance result. The JS SDK exposes typed errors (`RateLimitError`,
`APITimeoutError`, `APIConnectionError`) and a configurable `RetryPolicy`:
https://docs.typesafe.ai/sdk/javascript/api


### 10.6 Telemetry

Instrumented from the first commit, not added later. Every call through
`net/jev.ts` records one sample:

```ts
interface CallSample {
  t: number;              // performance.now() at request start
  kind: 'decide';         // one call site, kept as a field for later ones
  actorId: ActorId | null;
  ms: number;             // round trip, measured client-side
  inputTokens: number;    // response.usage.input_tokens
  outputTokens: number;   // response.usage.output_tokens
  ok: boolean;
  errorKind?: 'timeout' | 'rate_limit' | 'connection' | 'http' | 'schema';
}
```

A rolling window aggregates and emits every 5 seconds, wall clock, independent of
the sim clock and unaffected by tactical pause (a paused window reports zero calls
rather than skipping the emit, so gaps in the log mean the loop stalled):

```
[jev 5s] calls 7 | ms avg 212 p95 340 max 351
         tokens in 2,184 out 336 | in/call 312 | errors 0 | mode live
```

Emitted to `console.info` and to a rolling in-memory buffer. Session totals
(`calls`, `tokens in`, `tokens out`, `avg ms`) render in the status bar so cost
per fight is visible while playing rather than reconstructed afterward. Cumulative
token counts also print once on match end, tagged with the seed, so a logged run
can be compared against a later one after the state digest changes size.

The averages are per window, not cumulative, because the number that matters is
whether latency degrades as actor count rises. A cumulative mean hides that.

Two thresholds worth wiring to a visible warning rather than a silent log line:
p95 above the 1200ms timeout, and any `rate_limit` error. Both change what the
game does, so both belong on screen.


---

## 11. UI, phone first

### Portrait layout

```
+------------------------------+
| status bar: seed, timer,     |  ~6%
| speed toggle, backend state  |
+------------------------------+
|                              |
|          ARENA               |  ~62%
|    (letterboxed canvas)      |
|                              |
+------------------------------+
| selected actor sheet, or     |  ~32%
| collapsed control bar        |
+------------------------------+
```

- Respect `env(safe-area-inset-*)`. Minimum tap target 44 css px
- Puck hit radius is `max(visualRadiusPx * 1.4, 22px)`
- Landscape: arena left, sheet as a right-hand column

### Selection and prompting

1. Tap a puck. Sim time scale drops to 0 (tactical pause, default) or 0.15 (slow-mo)
2. The bottom sheet expands: name, health, current behavior, the behavior
   probability bars, the current standing order, a multiline input, last 5 decisions
3. Type the order, tap Send. The order is stored on the actor and a decision is
   requested immediately, with a spinner on the actor until it lands
4. Tap the scrim or the same puck to close and resume

The party order has its own entry point: a button in the collapsed control bar,
not a puck. Same sheet, same input, `scope: party`. It also pauses.

Each actor sheet shows both orders in force, the actor's own and the party's, so
it is clear what was sent. Precedence between them is Jev's judgment rather than a
code merge, so showing the inputs is the only way the player can tell why a
character did what it did.

Tactical pause is not a nicety. Typing a sentence on a phone takes 10 to 20
seconds and the reference fight is over in 11.

### Fog of war

Enemy orders are hidden. Tapping a goblin opens a reduced sheet: kind, health
bucket, and the behavior it is visibly performing. No standing order, no
probability bars, no decision log.

The same line holds in the request bodies. An actor's `decide` state contains its
own orders and its own view, never the opposing side's orders. With one
call per actor this is automatic, but it is a rule to keep when batching is
reconsidered later, because a shared state would leak the player's order into the
goblin's decision and quietly make the enemy clairvoyant.

What stays visible is anything the player could observe by watching: position,
movement, health, wind-ups, and which ability just resolved. The behavior tag on
an enemy is derived from observed movement, not read from its decision.

A single `?debug=1` flag reveals everything for both sides: full sheets, both
orders, all probability bars, and every raw answer.
Off by default, labeled on screen when on, and never used for a balance reading
that gets written down.

### The probability panel

Jev returns a full distribution on every Choice, which replaces the explanation
string a generative model would have produced, and is better for this game.
Render the behavior Choice as four horizontal bars with the confidence value
beside them. The player watches the distribution shift as they edit the order.
That is the feedback loop the whole prototype depends on, and it costs nothing
extra because the numbers are already in the response.

Show the same bars for the ability Choice in a debug toggle.

### Arena rendering, back to front

1. Floor: flat fill, 1u grid at 8% opacity
2. Ground effects: filled circles at 25% opacity
3. Pucks
4. Glyph: monospace, centered, sized to `radius * 1.2`
5. Health: arc around the rim, 3px, depleting clockwise from 12 o'clock
6. Wind-up: expanding ring from the caster, completing at resolve
7. Selection: 2px dashed ring plus a thin line to the current target
8. Damage numbers: rise 1u over 0.6s, fade out
9. Behavior tag: 3-letter abbreviation under the puck, selected actor only

Color is never the only signal. Side comes from fill versus outline, health from
arc length, behavior from the text tag.

---

## 12. The reference fight

One Arcanist, one Goblin, opposite ends of the arena, starting gap 12u.

### Case A: default behavior, expected loss

Arcanist in `hold_and_shoot`, Goblin in `close_and_attack`.

| t | Event |
|---|---|
| 0.00 | Goblin starts moving, 12u gap |
| 0.83 | Goblin enters Arc Bolt range (9u) |
| 1.03 | First Arc Bolt resolves, Goblin 18/20 |
| 2.94 | Goblin reaches melee range (1.4u), having crossed 10.6u at 3.6 u/s |
| 3.29 | First Cleaver resolves, Arcanist 18/24 |
| 4.49 | Arcanist 12/24 |
| 5.69 | Arcanist 6/24 |
| 6.89 | Arcanist dead. Six bolts landed, Goblin ends at 8/20 |

Result: loss, enemy at 40%. Close enough to feel winnable, which is the point.

### Case B: prompted skirmish, expected win

Order along the lines of "keep your distance and shoot". Jev picks `skirmish`
with `well_clear`.

Per-shot cycle at `moveSpeed 5.0` versus `3.6`:

```
rooted during windup  0.2s  ->  gap changes by -0.72u
free movement         0.8s  ->  gap changes by +1.12u
net per 1.0s cycle                      +0.40u
```

The gap holds or widens, so the Goblin never reaches melee. Ten bolts at roughly
one per second kills it in about 11s. The Arcanist takes 0 damage on a clean run,
more if it gets cornered early.

### Tuning targets

| Scenario | Target |
|---|---|
| Default `hold_and_shoot` | Loses, 6-8s, enemy left at 30-50% |
| Prompted `skirmish` | Wins, 10-13s, player above 50% |
| `close_and_attack` (wrong prompt) | Loses faster than default, under 6s |

All numbers above are derived from the stat blocks in this document and need
playtest confirmation. If `skirmish` is a clean shutout at full health, do not
nerf the player. Add a Goblin lunge (3u dash, 6s cooldown) in v0.2 so kiting has
to be prompted well rather than merely prompted.

---

## 13. File layout

```
/src
  main.ts                 loop, time scale, wiring
  sim/
    rng.ts                mulberry32
    world.ts              World, spawn, queries (nearest, hostiles, gap)
    actor.ts              Actor factory from data
    step.ts               fixed-step update: states, casts, collision, deaths
    abilities.ts          cast, resolve, effect application
    states/
      index.ts            StateId -> handler registry
      closeAndAttack.ts
      holdAndShoot.ts
      skirmish.ts
      retreat.ts
    steering.ts           intent + separation + wall repulsion
    buckets.ts            geometry and condition/lethality -> named buckets. NO model calls here
  data/
    classes.json          4 archetypes, 4 abilities each, with blurbs
    abilities.json
    monsters.json
    states.json           id, criteria string, param schema
    bands.json            range band id -> [min, max] units
  render/
    canvas.ts
    hud.ts
    probabilityBars.ts
  ui/
    select.ts             hit testing, tactical pause
    orderSheet.ts         bottom sheet, prompt input, actor and party scopes
    fog.ts                what a sheet may show for an enemy
  net/
    jev.ts                thin client over @typesafe/sdk, records CallSample
    questions.ts          question builders, criteria strings live here
    decide.ts             cadence, triggers, hysteresis, in-flight guard
    digest.ts             actor -> state object sent to Jev, fog of war enforced
    offlinePolicy.ts      deterministic fallback, also used by headless tests
    telemetry.ts          5s rolling window, session totals
  replay.ts               record and play back decision logs
/api
  decide.ts               Vercel function, holds TYPESAFE_API_KEY
/test
  fight.spec.ts           headless reference fight, both cases
  questions.spec.ts       golden order + situation -> expected behavior choice
```

Keep `sim/` free of imports from `render/`, `ui/`, and `net/`. It must run
headless in a test. The headless reference fight is the balance regression test.

`questions.spec.ts` is the other regression test and matters more than it looks:
a set of 15 to 20 pairs of a written order and a situation digest, each with the
behavior Jev should pick. Include at least three where the actor order and the
party order disagree. Run it every time a criteria string is reworded. Criteria
wording is the real source code of this game's behavior layer, and it is the only
part of the behavior layer a unit test can reach.

---

## 14. Acceptance criteria for v0.1

Split by who checks them, per the working practices in section 4.

### Automated, in the test suite

- [ ] Sim runs at a fixed 60Hz step and produces identical results for the same
      seed and decision log
- [ ] Arcanist and Goblin spawn, move, collide, attack, die
- [ ] All four behaviors reachable and correct against synthetic answer sets
- [ ] Case A reproduces as a loss and Case B as a win, headless
- [ ] No coordinate, hit point total, HP percentage, or unit distance appears
      anywhere in a request body sent to Jev (condition / survivable_hits /
      hits_to_finish phrases only — never raw HP or %)
- [ ] A player actor's digest never contains an enemy order, and the reverse
- [ ] Behavior does not thrash: no more than 4 behavior switches in the Case B fight
- [ ] With the backend stubbed to fail, the fight still completes on role defaults
- [ ] Malformed, stale, and error responses never crash and never leave an actor
      in a state outside `allowedStates`
- [ ] `questions.spec.ts` passes, including at least three actor-versus-party
      order conflicts

### Checked by hand, on a phone

- [ ] Tapping a puck pauses the sim and opens the sheet on a 390px viewport with
      no layout breakage and no keyboard occlusion
- [ ] Submitting an order visibly changes behavior within one second of resume
- [ ] Behavior probability bars render and visibly change between two different
      orders on the same situation
- [ ] Tapping the goblin shows health and observed behavior only, with no order
      or probabilities, and `?debug=1` reveals all of it
- [ ] A party order alone changes behavior for an actor with no order of its own
- [ ] Degraded mode is visible in the HUD when the backend is blocked
- [ ] A telemetry line emits every 5s during play, including windows with zero
      calls, and session token totals render in the status bar

---

## 15. Decisions taken

| Question | Decision |
|---|---|
| Enemy orders visible? | No. Fog of war, section 11. `?debug=1` for development |
| What does an order bind to? | The actor. A party order also exists, sent alongside it |
| Prose compiled into a policy? | No. Orders go into the state of every call. Jev picks the state, the client owns the strategy |
| Party scaling | Deferred. One call per actor. Revisit with the cookbooks below |
| Sub-second reactions through the model? | No. Client-owned, in code |
| Order screening for adversarial text | Not for a single-player prototype |
| Latency and cost | Measured in play, section 10.6, rather than assumed |

## 16. Still open

1. The decision interval, which section 10.6 exists to settle. 2.0s is a
   placeholder and should be changed once there is a p95 to look at.
2. Party scaling, when it arrives. Candidate references, none verified against a
   multi-actor state: speculative fan-out
   (https://docs.typesafe.ai/patterns/fan-out) for putting many actors'
   questions in one call, and the parallel questions cookbook
   (https://docs.typesafe.ai/cookbooks/parallel_questions) for what batching
   actually saves. Both need testing against the context-rot cost in section 2,
   since a batched call reintroduces exactly the large mixed state that per-actor
   calls avoid. The cheaper first move is not batching at all: only call for
   actors whose buckets changed since their last decision.
3. Order precedence is a model judgment now, not a code merge. If the golden
   tests show Jev mixing the two orders unpredictably, the fallback is to drop
   the party order from the state and have the client concatenate it into the
   actor's order text when the actor has none.
4. Order screening becomes necessary the moment orders are shared, competitive,
   or visible to another player's model. The guardrails pattern covers it:
   https://docs.typesafe.ai/cookbooks/llm_guardrails