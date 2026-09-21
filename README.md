# Arena Prompt Combat (`arena-raid`)

Top-down arena skirmish. Every actor is a puck driven by a finite state machine. You don’t steer movement or attacks directly — you select a puck and type a plain-English standing order. TypeSafe’s Jev model picks which behavior each actor runs as the fight develops.

v0.1 is one Arcanist vs one Goblin, tuned so default behavior loses and a correctly prompted skirmish wins. Prompting is the thing that decides the fight.

Full design: [`spec.md`](./spec.md).

## Run locally

```bash
npm install
npm run dev
```

Opens Vite on port **5173**. Without `TYPESAFE_API_KEY`, `/api/decide` falls back to an offline policy so the game still runs.

Optional live Jev:

```bash
cp .env.example .env
# set TYPESAFE_API_KEY=… in .env
```

`.env` is server-side only (Vite plugin / `api/decide`); never expose the key to the client.

## Tests

```bash
npm test
```

Runs Vitest unit tests (`test/**/*.spec.ts`). Does **not** call live Jev and does **not** run the skirmish calibration suite (excluded in `vite.config.ts`).

### Skirmish calibration (live Jev)

```bash
npm run calibrate:skirmish
# optional: npm run calibrate:skirmish -- --repeats=5
# optional: npm run calibrate:skirmish -- --class=vanguard
```

Hits live Jev, costs tokens, requires `TYPESAFE_API_KEY`, and is **not** part of `npm test` / CI. Details: [`test/calibration/README.md`](./test/calibration/README.md).

## Architecture (pointers)

| Area | Role |
|------|------|
| `src/sim/` | Deterministic sim: world, actors, states, steering, buckets |
| `src/net/` | Digest → questions → decide (Jev or offline), hysteresis |
| `api/decide.ts` | `POST /api/decide` proxy (Vercel + mirrored in Vite) |
| `src/ui/` | Selection, standing-order sheet, tactical pause |
| `src/render/` | Canvas draw |
| `src/data/` | Classes, abilities, states, bands (criteria strings) |

Player digests include role, abilities, orders, plus health/lethality
(`condition`, `survivable_hits`, enemy `hits_to_finish`) but omit danger
framing (`how_close`, `about_to_attack`, `room_to_back_away`). See
`buildDigest` in `src/net/digest.ts`.
