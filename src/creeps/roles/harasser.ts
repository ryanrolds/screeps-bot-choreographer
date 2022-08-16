import {AllowedCostMatrixTypes} from '../../lib/costmatrix_cache';
import {FindPathPolicy} from '../../lib/pathing';
import {Tracer} from '../../lib/tracing';
import {Kernel} from '../../os/kernel/kernel';
import {Priorities} from '../../os/scheduler';
import * as behaviorTree from '../behavior/behaviortree';
import {RUNNING, SUCCESS} from '../behavior/behaviortree';
import {behaviorBoosts} from '../behavior/boosts';
import * as behaviorMovement from '../behavior/movement';

export const ROLE_HARASSER = 'harasser';
export const MEMORY_HARASS_BASE = 'harasser.target_base';
const MEMORY_HARASS_ROOMS = 'harasser.target_rooms';
const MEMORY_HARASS_VISITED = 'harasser.visited';
const MEMORY_HARASS_CURRENT = 'harasser.current';
const MEMORY_HARASS_CREEP_TARGET = 'harasser.creep_target';

const harasserPolicy: FindPathPolicy = {
  room: {
    avoidHostileRooms: false,
    avoidFriendlyRooms: false,
    avoidRoomsWithKeepers: false,
    avoidRoomsWithTowers: true,
    avoidUnloggedRooms: false,
    sameRoomStatus: true,
    costMatrixType: AllowedCostMatrixTypes.COMMON,
  },
  destination: {
    range: 1,
  },
  path: {
    allowIncomplete: true,
    maxSearchRooms: 12,
    maxOps: 5000,
    maxPathRooms: 6,
    ignoreCreeps: true,
    sourceKeeperBuffer: 3,
  },
};

export const HarasserDefinition = {
  base: [MOVE, RANGED_ATTACK],
  parts: [MOVE, HEAL, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, TOUGH, MOVE, RANGED_ATTACK],
  boosts: ['rangedAttack'],
  energyLimit: 0,
  energyMinimum: 550,
  ignoreSpawnEnergyLimit: false,
  processPriority: Priorities.ATTACK,
  skippable: false,
};

const behavior = behaviorTree.sequenceNode(
  'harasser_root',
  [
    behaviorTree.leafNode(
      'pick_next_room',
      (creep: Creep, _trace: Tracer, _kernel: Kernel) => {
        let targetRooms = creep.memory[MEMORY_HARASS_ROOMS];
        if (!targetRooms) {
          const targetBase = creep.memory[MEMORY_HARASS_BASE];
          targetRooms = _.values(Game.map.describeExits(targetBase));
          creep.memory[MEMORY_HARASS_ROOMS] = _.shuffle(targetRooms);
        }

        // Depending on the number of target rooms we have visited, rotate through the list
        const roomCount = creep.memory[MEMORY_HARASS_VISITED] || 0;
        creep.memory[MEMORY_HARASS_CURRENT] = targetRooms[roomCount % targetRooms.length];

        return SUCCESS;
      },
    ),
    behaviorTree.repeatUntilConditionMet(
      'stop_and_attack',
      (creep: Creep, trace: Tracer, _kernel: Kernel): boolean => {
        // if we reach the target room, move to attack phase
        if (creep.memory[MEMORY_HARASS_CURRENT] === creep.room.name) {
          return true;
        }

        const creepHeal = scoreHealing(creep, true);
        // Check for creeps weaker than us
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS, {
          filter: (hostile: Creep) => {
            return hostile.owner.username !== 'Source Keeper' &&
              scoreAttacking(hostile) < creepHeal;
          },
        });

        trace.info(`Harasser ${creep.name} has ${hostiles.length} hostiles`);

        // If there are weaker creeps, move to attack phase
        return hostiles.length > 0;
      },
      behaviorMovement.cachedMoveToRoom(MEMORY_HARASS_CURRENT, harasserPolicy),
    ),
    behaviorTree.leafNode(
      'attack_phase',
      (creep: Creep, trace: Tracer, kernel: Kernel) => {
        trace.info('harass room', {room: creep.memory[MEMORY_HARASS_CURRENT]});

        // Heal if damaged and have heal parts
        if (creep.hits < creep.hitsMax && creep.getActiveBodyparts(HEAL) > 0) {
          creep.heal(creep);
        }

        const creepHeal = scoreHealing(creep, true);
        const dontAttack = kernel.getDontAttack();

        let hostiles = creep.room.find(FIND_HOSTILE_CREEPS, {
          filter: (c: Creep) => {
            return c.owner.username !== 'Source Keeper';
          },
        });

        // filter out friendlies and neutrals
        hostiles = hostiles.filter((c: Creep) => {
          return dontAttack.indexOf(c.owner?.username) === -1;
        });

        // if strong hostiles our job is done, move to the next room
        const strongHostiles = _.filter(hostiles, (c: Creep) => {
          return scoreAttacking(c) > creepHeal;
        });

        if (strongHostiles.length > 0) {
          trace.warn('defenders present', {num: strongHostiles.length});
          return SUCCESS; // GO TO THE NEXT ROOM
        }

        let weakCreep = null;

        const targetId = creep.memory[MEMORY_HARASS_CREEP_TARGET];
        if (targetId) {
          const target = Game.getObjectById(targetId);
          if (target) {
            trace.info('have target', {target: targetId});
            weakCreep = target;
          } else {
            delete creep.memory[MEMORY_HARASS_CREEP_TARGET];
          }
        }

        // TODO, attack when getting attacked - don't focus on the weakest creep

        if (!weakCreep) {
          // if we have weak hostiles, attack them
          const weakHostiles = _.difference(hostiles, strongHostiles);
          if (weakHostiles.length > 0) {
            trace.info('picking creep', {num: weakHostiles.length});
            weakCreep = creep.pos.findClosestByRange(weakHostiles);
            creep.memory[MEMORY_HARASS_CREEP_TARGET] = weakCreep.id;
          }
        }

        if (weakCreep) {
          trace.info('attacking weak creep', {id: weakCreep.id});
          const range = creep.pos.getRangeTo(weakCreep);
          if (range <= 3) {
            trace.info('attack closest', {target: weakCreep.id});
            creep.rangedAttack(weakCreep);
          }

          if (range > 3) {
            creep.moveTo(weakCreep);
          }

          return RUNNING;
        }

        // attack containers if not one of my bases
        const baseRoom = kernel.getPlanner().getBaseByRoom(creep.room.name);
        if (!baseRoom) {
          // if there are containers, destroy them
          const containers = creep.room.find(FIND_STRUCTURES, {
            filter: (s: Structure) => {
              return s.structureType === STRUCTURE_CONTAINER;
            },
          });
          if (containers.length > 0) {
            const container = creep.pos.findClosestByRange(containers);
            const range = creep.pos.getRangeTo(container);
            if (range <= 3) {
              trace.info('attack container', {target: container.id});
              creep.rangedAttack(container);
            }

            if (range > 3) {
              creep.moveTo(container);
            }

            return RUNNING;
          }
        }

        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'harass_room_done',
      (creep: Creep, _trace: Tracer, _kernel: Kernel) => {
        // if we are not in target room, don't switch rooms (we probably picked
        // on someone along the way)
        if (creep.room.name !== creep.memory[MEMORY_HARASS_CURRENT]) {
          return SUCCESS;
        }

        // Increment visited count, moving us to the next room in the list
        const roomCount = creep.memory[MEMORY_HARASS_VISITED] || 0;
        creep.memory[MEMORY_HARASS_VISITED] = roomCount + 1;
        return SUCCESS;
      },
    ),
  ],
);

export const roleHarasser = {
  run: behaviorTree.rootNode('harasser', behaviorBoosts(behavior)),
};

export function scoreHealing(creep: Creep, healSelf = false) {
  let toughBonus = 1;
  return _.reduce(creep.body, (healing, part) => {
    // Don't count damaged parts
    if (part.hits < 1) {
      return healing;
    }

    if (part.type === HEAL) {
      let multiplier = 1;
      if (part.boost) {
        multiplier = BOOSTS[HEAL][part.boost].heal;
      }
      return healing + (healSelf ? HEAL_POWER : RANGED_HEAL_POWER) * multiplier;
    }

    // TODO this need to be solved with a dynamic programming problem that
    // looks at each part and sums a healing bonus for teach toughness part
    // up to whatever the damage per tick may be
    if (healSelf && part.type === TOUGH && part.boost) {
      toughBonus = _.min([BOOSTS[TOUGH][part.boost].damage, toughBonus]);
    }

    return healing;
  }, 0);
}

export function scoreAttacking(creep: Creep) {
  return _.reduce(creep.body, (dmg, part) => {
    if (part.type === ATTACK) {
      let multiplier = 1;
      if (part.boost) {
        multiplier = BOOSTS[ATTACK][part.boost].attack;
      }
      return dmg + ATTACK_POWER * multiplier;
    }

    if (part.type === RANGED_ATTACK) {
      let multiplier = 1;
      if (part.boost) {
        multiplier = BOOSTS[RANGED_ATTACK][part.boost].rangedAttack;
      }
      return dmg + RANGED_ATTACK_POWER * multiplier;
    }

    return dmg;
  }, 0);
}
