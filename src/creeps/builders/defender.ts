import {Tracer} from '../lib/lib.tracing';

const _QUAD_SIZE = 4;

type BoostMultipliers = {
  'heal': number;
  'attack': number;
  'rangedAttack': number; // TODO double check this key
  'move': number;
  'tough': number;
}

export function buildDefender(
  requiredTanking: number,
  maxEnergy: number,
  multipliers: BoostMultipliers,
  trace: Tracer,
): [parts: BodyPartConstant[], ok: boolean] {
  let healParts = 0;
  let moveParts = 0;
  let attackParts = 0;
  let rangedAttackParts = 0;
  let toughParts = 0;

  let neededEnergy = 0;

  const healingTick = Math.floor(12 * multipliers.heal);
  const movingTick = Math.floor(2 * multipliers.move);

  // if we have energy for a healing part, include at least one healing part
  if (maxEnergy > 380) { // heal, attack, move
    requiredTanking = _.max([requiredTanking, 1]);
  }

  trace.info('buildAttacker', {
    requiredTanking,
    maxEnergy,
    multipliers,
  });

  while (true) { // eslint-disable-line no-constant-condition
    const numNonMoveParts = healParts + attackParts + toughParts + rangedAttackParts;
    const numParts = numNonMoveParts + moveParts;
    // Cannot have more than 50 parts
    if (numParts >= 50) {
      // trace.info('cannot have more than 50 parts', {healParts, moveParts, attackParts, toughParts});
      break;
    }

    let ΔHealParts = 0;
    let ΔMoveParts = 0;
    const ΔAttackParts = 0;
    let ΔRangedAttackParts = 0;
    const ΔToughParts = 0;
    let ΔEnergy = 0;

    if (moveParts * movingTick <= numNonMoveParts) {
      ΔMoveParts += 1;
      // trace.info('adding move parts', {ΔMoveParts});
    } else if (healParts * healingTick < requiredTanking) {
      ΔHealParts += 1;
      // trace.info('adding heal parts', {
      //   ΔHealParts,
      //   healParts,
      //   healingTick,
      //   totalHealingTick: healParts * healingTick
      // });
    } else {
      // TODO generalize builder to work with attack and defenders, this is the only
      // part of this that actually varies
      ΔRangedAttackParts += 1;
      // trace.info('adding ranged attack parts', {ΔRangedAttackParts});
    }

    const ΔHealPartsEnergy = ΔHealParts * BODYPART_COST[HEAL];
    const ΔMovePartsEnergy = ΔMoveParts * BODYPART_COST[MOVE];
    const ΔAttackPartsEnergy = ΔAttackParts * BODYPART_COST[ATTACK];
    const ΔRangedAttackPartsEnergy = ΔRangedAttackParts * BODYPART_COST[RANGED_ATTACK];
    const ΔToughPartsEnergy = ΔToughParts * BODYPART_COST[TOUGH];
    ΔEnergy += ΔHealPartsEnergy + ΔMovePartsEnergy + ΔAttackPartsEnergy + ΔRangedAttackPartsEnergy +
      ΔToughPartsEnergy;

    // trace.info('pass', {ΔEnergy, ΔHealParts, ΔMoveParts, ΔAttackParts, ΔToughParts});

    // If the next pass requires too much energy, we are done
    if (neededEnergy + ΔEnergy > maxEnergy) {
      // trace.info('pass requires too much energy', {ΔEnergy});
      break;
    }

    healParts += ΔHealParts;
    attackParts += ΔAttackParts;
    rangedAttackParts += ΔRangedAttackParts;
    moveParts += ΔMoveParts;
    toughParts += ΔToughParts;
    neededEnergy += ΔEnergy;
  }

  let numNonMoveParts = healParts + attackParts + toughParts;
  let numParts = numNonMoveParts + moveParts;
  let availableMove = moveParts * movingTick - numNonMoveParts;
  while (numParts + availableMove < 50 && availableMove > 0 && maxEnergy >= neededEnergy + BODYPART_COST[TOUGH]) {
    // trace.info('adding tough parts', {numParts, availableMove, neededEnergy, maxEnergy});
    toughParts += 1;
    neededEnergy += BODYPART_COST[TOUGH];

    numNonMoveParts = healParts + attackParts + toughParts;
    numParts = numNonMoveParts + moveParts;
    availableMove = moveParts * movingTick - numNonMoveParts;
  }

  let ok = false;
  if (healParts * healingTick >= requiredTanking && rangedAttackParts >= 1) {
    ok = true;
  }

  trace.info('final parts', {ok, healParts, moveParts, attackParts, toughParts, neededEnergy, maxEnergy});

  const body: BodyPartConstant[] = [];
  let partsCount = 0;

  // Add heal and move (2:1) parts to front
  while (healParts) {
    if (moveParts && partsCount % movingTick === 0) {
      body.unshift(MOVE);
      moveParts--;
      // partsCount++;
    }

    body.unshift(HEAL);
    healParts--;
    partsCount++;
  }

  // Add ranged attack and move parts (2:1) to front
  while (rangedAttackParts) {
    if (moveParts && partsCount % movingTick === 0) {
      body.unshift(MOVE);
      moveParts--;
      // partsCount++;
    }

    body.unshift(RANGED_ATTACK);
    rangedAttackParts--;
    partsCount++;
  }

  // Add attack and move parts (2:1) to front
  while (attackParts) {
    if (moveParts && partsCount % movingTick === 0) {
      body.unshift(MOVE);
      moveParts--;
      // partsCount++;
    }

    body.unshift(ATTACK);
    attackParts--;
    partsCount++;
  }

  // Add remaining move parts to front
  while (moveParts) {
    body.unshift(MOVE);
    moveParts--;
    // partsCount++;
  }

  // Add tough parts to front
  while (toughParts) {
    body.unshift(TOUGH);
    toughParts--;
    partsCount++;
  }

  return [body, ok];
}
