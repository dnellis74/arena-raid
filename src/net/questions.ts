import bands from '../data/bands.json' with { type: 'json' };
import encounters from '../data/encounters.json' with { type: 'json' };
import prompts from '../data/prompts.json' with { type: 'json' };
import { getAbility } from '../sim/actor.ts';
import { BEHAVIOR_CRITERIA, type AbilityId, type Actor, type StateId } from '../sim/types.ts';
import type { DecideDigest } from './digest.ts';

export interface QuestionMap {
  [id: string]:
    | {
        type: 'choice';
        instructions: string;
        criteria: Record<string, string>;
      }
    | {
        type: 'noul';
        instructions: string;
      };
}

const DEFAULT_ALLOWED_STATES = encounters.referenceFight.allowedStates as StateId[];

type PromptVariants = {
  player_direct?: string;
  player_party?: string;
  ai: string;
};

function fillPrompt(
  variants: PromptVariants,
  opts: { playerControlled: boolean; hasDirect: boolean; orderBlock: string },
): string {
  const template = opts.playerControlled
    ? opts.hasDirect
      ? (variants.player_direct ?? variants.player_party ?? variants.ai)
      : (variants.player_party ?? variants.ai)
    : variants.ai;
  return template.replaceAll('{orderBlock}', opts.orderBlock);
}

/**
 * Build the decide question set for an actor + digest (production path used by
 * calibration). Defaults to the reference-fight allowed states.
 */
export function buildDecideQuestions(
  actor: Actor,
  digest: DecideDigest,
  allowedStates: StateId[] = DEFAULT_ALLOWED_STATES,
): QuestionMap {
  return buildQuestions(actor, allowedStates, digest);
}

/**
 * Build Jev questions for one actor.
 *
 * Player-controlled: strategy selection from the standing order only — no danger
 * Noul that frames the situation as something to escape. Enemy/AI keeps the
 * fuller situational question set.
 */
export function buildQuestions(
  actor: Actor,
  allowedStates: StateId[],
  digest: DecideDigest,
): QuestionMap {
  const behaviorCriteria: Record<string, string> = {};
  for (const s of allowedStates) {
    behaviorCriteria[s] = BEHAVIOR_CRITERIA[s];
  }

  const bandCriteria: Record<string, string> = {};
  for (const [id, b] of Object.entries(bands)) {
    bandCriteria[id] = b.criteria;
  }

  const abilityCriteria: Record<string, string> = {};
  for (const id of actor.abilities) {
    if ((actor.cooldowns[id] ?? 0) > 0) continue;
    const ab = getAbility(id);
    abilityCriteria[id] = capitalize(ab.blurb);
  }

  const playerControlled = actor.side === 'player';
  const orderBlock = formatOrderBlock(digest, actor);
  const hasDirect = Boolean(
    digest.orders?.given_directly_to_this_character?.trim() ||
      actor.standingOrder?.trim(),
  );
  const fill = (variants: PromptVariants) =>
    fillPrompt(variants, { playerControlled, hasDirect, orderBlock });

  const questions: QuestionMap = {
    behavior: {
      type: 'choice',
      instructions: fill(prompts.behavior),
      criteria: behaviorCriteria,
    },
    range_band: {
      type: 'choice',
      instructions: fill(prompts.range_band),
      criteria: bandCriteria,
    },
  };

  if (!playerControlled) {
    questions.in_trouble = {
      type: 'noul',
      instructions: fill(prompts.in_trouble),
    };
  }

  if (Object.keys(abilityCriteria).length > 0) {
    questions.ability = {
      type: 'choice',
      instructions: fill(prompts.ability),
      criteria: abilityCriteria,
    };
  }

  return questions;
}

/** Quote standing / party orders so the verbatim prompt is in Choice instructions. */
function formatOrderBlock(digest: DecideDigest, actor: Actor): string {
  const direct = (
    digest.orders?.given_directly_to_this_character ??
    actor.standingOrder ??
    ''
  ).trim();
  const party = (
    digest.orders?.given_to_the_whole_party ??
    actor.partyOrder ??
    ''
  ).trim();
  const lines: string[] = [];
  if (direct) {
    lines.push(
      `Standing order given directly to this character (authoritative): "${direct}".`,
    );
  }
  if (party) {
    lines.push(
      direct
        ? `Order given to the whole party (where the character order is silent): "${party}".`
        : `Order given to the whole party (authoritative): "${party}".`,
    );
  }
  return lines.length ? `${lines.join(' ')} ` : '';
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Golden expectations: order + situation → expected behavior (for offline / tests). */
export interface GoldenCase {
  id: string;
  standingOrder: string | null;
  partyOrder: string | null;
  situation: Partial<DecideDigest>;
  expectedBehavior: StateId;
  expectedAbility?: AbilityId;
}
