import bands from '../data/bands.json';
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

const DEFAULT_ALLOWED_STATES: StateId[] = [
  'hold_and_shoot',
  'close_and_attack',
  'skirmish',
  'retreat',
];

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

  const questions: QuestionMap = {
    behavior: {
      type: 'choice',
      instructions: playerControlled
        ? hasDirect
          ? `${orderBlock}Which behavior best carries out the standing order given directly to this character? Where that order is silent, follow the order given to the whole party. The character order is authoritative: pick the strategy it asks for, even if the fight looks dangerous.`
          : `${orderBlock}Which behavior best carries out the order given to the whole party? Use the character's condition when the party order distinguishes healthy vs hurt. The party order is authoritative.`
        : 'Which behavior should this character use right now? Follow the order given directly to this character. Where that order is silent, follow the order given to the whole party.',
      criteria: behaviorCriteria,
    },
    range_band: {
      type: 'choice',
      instructions: playerControlled
        ? hasDirect
          ? `${orderBlock}Given the standing order, how far from the enemy should this character try to stay?`
          : `${orderBlock}Given the party order and the character's condition, how far from the enemy should this character try to stay?`
        : 'How far from the enemy should this character try to stay right now?',
      criteria: bandCriteria,
    },
  };

  if (!playerControlled) {
    questions.in_trouble = {
      type: 'noul',
      instructions: 'The character is in immediate danger of being hit by the enemy.',
    };
  }

  if (Object.keys(abilityCriteria).length > 0) {
    questions.ability = {
      type: 'choice',
      instructions: playerControlled
        ? hasDirect
          ? `${orderBlock}Which ready ability best fits the standing order?`
          : `${orderBlock}Which ready ability best fits the party order?`
        : "Which of the character's ready abilities should it use next?",
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
