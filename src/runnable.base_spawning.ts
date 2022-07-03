/**
 * Base Creep Spawning
 *
 * Tracks the spawns in a base, pull events from the spawn topic, and spawns the requested creeps.
 *
 * TODO - Move to topic with base id in the name - IN PROGRESS
 */
import {Base} from "./config";
import * as CREEPS from "./constants.creeps";
import {DEFINITIONS} from './constants.creeps';
import * as MEMORY from "./constants.memory";
import * as TOPICS from "./constants.topics";
import {Event} from "./lib.event_broker";
import {Request, RequestDetails, TopicKey} from "./lib.topics";
import {Tracer} from './lib.tracing';
import {running, terminate} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";
import {getDashboardStream, getLinesStream, HudEventSet, HudIndicator, HudIndicatorStatus, HudLine} from "./runnable.debug_hud";

const SPAWN_TTL = 5;
const REQUEST_BOOSTS_TTL = 5;
const MAX_COLONY_SPAWN_DISTANCE = 5;
const PRODUCE_EVENTS_TTL = 20;

const INITIAL_TOPIC_LENGTH = 9999;
const RED_TOPIC_LENGTH = 10;
const YELLOW_TOPIC_LENGTH = 5;

export const SPAWN_REQUEST_ROLE = "role";
export const SPAWN_REQUEST_SPAWN_MIN_ENERGY = "spawn_min_energy";
export const SPAWN_REQUEST_PARTS = "parts";

type SpawnRequestDetails = {
  role: string;
  memory: any;
  energyLimit: number;
}

type SpawnRequest = Request & {
  details: SpawnRequestDetails;
};

type TopicProvider = {
  sendRequest(topic: TopicKey, priority: number, details: RequestDetails, ttl: number)
  sendRequestV2(topic: TopicKey, request: Request)
}

export function createSpawnRequest(priority: number, ttl: number, role: string,
  memory: any, energyLimit: number): SpawnRequest {
  return {
    priority,
    ttl,
    details: {
      role,
      memory,
      energyLimit,
    }
  };
}

export function getShardSpawnTopic(): TopicKey {
  return 'shard_spawn';
}

export function getBaseSpawnTopic(baseId: string): TopicKey {
  return `base_${baseId}_spawn`;
}

export default class SpawnManager {
  id: string;
  spawnIds: Id<StructureSpawn>[];
  checkCount: number = 0;

  consumeEventsThread: ThreadFunc;
  threadSpawn: ThreadFunc

  constructor(id: string) {
    this.id = id;

    this.threadSpawn = thread('spawn_thread', SPAWN_TTL)((trace, kingdom, base) => {

      // NOTE made some changes while looking at this file 7/2/22
      this.spawnIds = roomObject.find<StructureSpawn>(FIND_MY_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_SPAWN && structure.isActive(),
      }).map(spawn => spawn.id);

      this.spawning(trace, kingdom, base);
    });

    this.consumeEventsThread = thread('produce_events_thread',
      PRODUCE_EVENTS_TTL)((trace, kingdom, base) => {
        this.consumeEvents(trace, kingdom, base)
      });
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('spawn_manager_run');

    const roomObject: Room = this.orgRoom.getRoomObject()
    if (!roomObject) {
      trace.error('no room object', {room: this.orgRoom.id});
      trace.end();
      return terminate();
    }

    const base = kingdom.getPlanner().getBaseByRoom(this.orgRoom.id);
    if (!base) {
      trace.error('no base config for room', {room: this.orgRoom.id});
      trace.end();
      return terminate();
    }

    trace.log('Spawn manager run', {id: this.id, spawnIds: this.spawnIds});

    this.threadSpawn(trace, kingdom, base);
    this.consumeEventsThread(trace, kingdom, base);

    trace.end();
    return running();
  }

  spawning(trace: Tracer, kernel: Kernel, base: Base) {
    // If there are no spawns then we should request another base in the kingdom produce the creep
    if (this.spawnIds.length === 0) {
      trace.warn('base has no spawns', {id: this.id, spawnIds: this.spawnIds});

      let request: SpawnRequest = null;
      while (request = kingdom.getNextRequest(getBaseSpawnTopic(base.id))) {
        trace.notice('sending kingdom spawn request', {request: request});
        kingdom.sendRequest(getShardSpawnTopic(), request.priority, request.details,
          request.ttl);
      }

      return;
    }

    // iterate spawns and fetch next request if idle
    this.spawnIds.forEach((id) => {
      const spawn = Game.getObjectById(id);
      if (!spawn) {
        return;
      }

      const isIdle = !spawn.spawning;
      const spawnEnergy = spawn.room.energyAvailable;
      const energyCapacity = spawn.room.energyCapacityAvailable;
      const energyPercentage = spawnEnergy / energyCapacity;

      trace.info('spawn status', {id, isIdle, spawnEnergy, energyCapacity, energyPercentage})

      if (!isIdle) {
        const creep = Game.creeps[spawn.spawning.name];

        spawn.room.visual.text(
          spawn.spawning.name + '🛠️',
          spawn.pos.x - 1,
          spawn.pos.y,
          {align: 'right', opacity: 0.8},
        );

        const role = creep.memory[MEMORY.MEMORY_ROLE];

        if (!CREEPS.DEFINITIONS[role]) {
          trace.error('unknown role', {creepName: creep.name, role});
          return;
        }

        const boosts = CREEPS.DEFINITIONS[role].boosts;
        const priority = CREEPS.DEFINITIONS[role].processPriority;

        trace.log('spawning', {creepName: creep.name, role, boosts, priority});

        if (boosts) {
          this.requestBoosts(spawn, boosts, priority);
        }

        return;
      }

      const spawnTopicSize = kingdom.getTopicLength(getBaseSpawnTopic(base.id));
      const spawnTopicBackPressure = Math.floor(energyCapacity * (1 - (0.09 * spawnTopicSize)));
      let energyLimit = _.max([300, spawnTopicBackPressure]);

      let minEnergy = 300;
      const numCreeps = (this.orgRoom as any).getColony().numCreeps;

      minEnergy = _.max([300, minEnergy]);

      const next = kingdom.peekNextRequest(getBaseSpawnTopic(base.id));
      trace.info('spawn idle', {
        spawnTopicSize, numCreeps, spawnEnergy, minEnergy,
        spawnTopicBackPressure, next
      });

      if (spawnEnergy < minEnergy) {
        trace.info("low energy, not spawning", {id: this.id, spawnEnergy, minEnergy})
        return;
      }

      let request = null;
      const localRequest = kingdom.getNextRequest(getBaseSpawnTopic(base.id));

      let neighborRequest = null;
      const storageEnergy = spawn.room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
      if (storageEnergy < 100000) {
        trace.warn('reserve energy too low, dont handle requests from other neighbors', {storageEnergy});
      } else {
        neighborRequest = this.getNeighborRequest(kingdom, base, trace);
      }

      trace.info('spawn request', {localRequest, neighborRequest});

      // Select local request if available
      if (localRequest) {
        trace.info('found local request', {localRequest});
        request = localRequest;
      }

      // If no request selected and neighbor request available, select neighbor request
      if (!request && neighborRequest) {
        trace.warn('found neighbor request', {neighborRequest});
        request = neighborRequest;
      }

      // No request, so we are done
      if (!request) {
        trace.info("no request");
        return
      }

      // If local priority w/ bonus is less than neighbor priority, select neighbor request
      if ((request.priority + 1) < neighborRequest?.priority) {
        trace.warn("neighbor request has higher priority", {neighborRequest, request});
        request = neighborRequest;
      }

      const role = request.details.role;
      const definition = DEFINITIONS[role];
      if (definition.energyMinimum && spawnEnergy < definition.energyMinimum) {
        trace.warn('not enough energy', {spawnEnergy, request, definition});
        return;
      }

      // Allow request to override energy limit
      if (request.details.energyLimit) {
        energyLimit = request.details.energyLimit;
      }

      const requestMinEnergy = request.details[SPAWN_REQUEST_SPAWN_MIN_ENERGY] || 0;
      if (spawnEnergy < requestMinEnergy) {
        trace.warn('colony does not have energy', {requestMinEnergy, spawnEnergy, request});
        return;
      }

      trace.info("spawning", {id: this.id, role, spawnEnergy, energyLimit, request});

      this.createCreep(spawn, request.details[SPAWN_REQUEST_ROLE], request.details[SPAWN_REQUEST_PARTS] || null,
        request.details.memory, spawnEnergy, energyLimit);
    });
  }

  getNeighborRequest(kernel: Kernel, base: Base, trace: Tracer) {
    const topic = this.orgRoom.getKingdom().getTopics()
    const request = topic.getMessageOfMyChoice(getShardSpawnTopic(), (messages) => {
      // Reverse message so we get higher priority first
      const selected = _.find(messages.reverse(), (message: any) => {
        // Select message if portal nearby
        // RAKE check distance on other side of the portal too
        const assignedShard = message.details.memory[MEMORY.MEMORY_ASSIGN_SHARD] || null;
        if (assignedShard && assignedShard != Game.shard.name) {
          trace.warn('request in another shard', {assignedShard, shard: Game.shard.name});
          let portals: any[] = this.orgRoom.getKingdom().getScribe()
            .getPortals(assignedShard).filter((portal) => {
              const distance = Game.map.getRoomLinearDistance(this.orgRoom.id,
                portal.pos.roomName);
              return distance < 2;
            });

          if (!portals.length) {
            return false;
          }

          return true;
        }

        // Determine destination room
        let destinationRoom = null;
        const baseRoom = message.details.memory[MEMORY.MEMORY_BASE];
        if (baseRoom) {
          destinationRoom = baseRoom
        }
        const assignedRoom = message.details.memory[MEMORY.MEMORY_ASSIGN_ROOM];
        if (assignedRoom) {
          destinationRoom = assignedRoom;
        }
        const positionRoom = message.details.memory[MEMORY.MEMORY_POSITION_ROOM];
        if (positionRoom) {
          destinationRoom = positionRoom;
        }

        // If no destination room, can be produced by anyone
        if (!destinationRoom) {
          trace.warn('no destination room, can be produced by anyone', {message});
          return true;
        }

        // If the room is part of a colony, check if the colony is a neighbor
        const destinationBase = kingdom.getPlanner().getBaseByRoom(destinationRoom);
        if (destinationBase) {
          const isNeighbor = base.neighbors.some((neighborId) => {
            return neighborId == destinationBase.id;
          });
          if (isNeighbor) {
            return true;
          }
        }

        return false;
      });

      if (!selected) {
        return null;
      }

      return selected;
    });

    return request;
  }

  consumeEvents(trace: Tracer, kernel: Kernel, base: Base) {
    const baseTopic = kingdom.getTopics().getTopic(getBaseSpawnTopic(base.id));

    let creeps = [];
    let topicLength = 9999;
    if (baseTopic) {
      topicLength = baseTopic.length;
      creeps = baseTopic.map((message) => {
        return `${message.details[SPAWN_REQUEST_ROLE]}(${message.priority},${message.ttl - Game.time})`;
      });
    }

    const line: HudLine = {
      key: `${this.id}`,
      room: this.orgRoom.id,
      order: 5,
      text: `Next spawn: ${creeps.join(',')}`,
      time: Game.time,
    };
    const event = new Event(this.id, Game.time, HudEventSet, line);
    trace.log('produce_events', event);
    kingdom.getBroker().getStream(getLinesStream()).publish(event)

    const indicatorStream = kingdom.getBroker().getStream(getDashboardStream());

    // Processes
    let processStatus = HudIndicatorStatus.Green;
    if (topicLength === INITIAL_TOPIC_LENGTH) {
      processStatus = HudIndicatorStatus.Stale;
    } else if (topicLength > RED_TOPIC_LENGTH) {
      processStatus = HudIndicatorStatus.Red;
    } else if (topicLength > YELLOW_TOPIC_LENGTH) {
      processStatus = HudIndicatorStatus.Yellow;
    }

    const roomName = this.orgRoom.id;
    const spawnLengthIndicator: HudIndicator = {
      room: roomName,
      key: 'spawn_length',
      display: 'S',
      status: processStatus
    };
    indicatorStream.publish(new Event(this.id, Game.time, HudEventSet, spawnLengthIndicator));
  }

  createCreep(spawner: StructureSpawn, role, parts: BodyPartConstant[], memory, energy: number, energyLimit: number) {
    return createCreep((this.orgRoom as any).getColony().id, (this.orgRoom as any).id, spawner,
      role, parts, memory, energy, energyLimit);
  }

  requestBoosts(spawn: StructureSpawn, boosts, priority: number) {
    (this.orgRoom as any).sendRequest(TOPICS.BOOST_PREP, priority, {
      [MEMORY.TASK_ID]: `bp-${spawn.id}-${Game.time}`,
      [MEMORY.PREPARE_BOOSTS]: boosts,
    }, REQUEST_BOOSTS_TTL);
  }
}

function createCreep(colony, room, spawn, role, parts, memory, energy, energyLimit) {
  const definition = DEFINITIONS[role];

  const ignoreSpawnEnergyLimit = definition.ignoreSpawnEnergyLimit || false;
  if (energy > energyLimit && !ignoreSpawnEnergyLimit) {
    energy = energyLimit;
  }

  const roleEnergyLimit = definition.energyLimit;
  if (roleEnergyLimit && energy > roleEnergyLimit) {
    energy = roleEnergyLimit;
  }

  // if parts not provided, work them out from the definition
  if (!parts) {
    parts = getBodyParts(definition, energy);
  };

  const name = [role, Game.shard.name, Game.time].join('_');

  // Requests to the kingdom should include the destination colony, don't overwrite it
  if (!memory[MEMORY.MEMORY_BASE]) {
    memory[MEMORY.MEMORY_BASE] = colony;
  }

  // Used for debugging, don't use for decision making, use MEMORY_BASE instead
  memory[MEMORY.MEMORY_ORIGIN_SHARD] = Game.shard.name;
  memory[MEMORY.MEMORY_ORIGIN] = room;

  memory[MEMORY.MEMORY_ROLE] = role;
  memory[MEMORY.DESIRED_BOOSTS] = definition.boosts;

  //   `${parts}, ${JSON.stringify(memory)}`);

  const result = spawn.spawnCreep(parts, name, {memory});
  return result;
};

function getBodyParts(definition, maxEnergy) {
  let base = definition.base.slice(0);
  let i = 0;

  while (true) {
    const nextPart = definition.parts[i % definition.parts.length];
    const estimate = base.concat([nextPart]).reduce((acc, part) => {
      return acc + BODYPART_COST[part];
    }, 0);

    if (estimate <= maxEnergy && base.length < 50) {
      base.push(nextPart);
    } else {
      break;
    }

    i++;
  }

  base = _.sortBy(base, (part) => {
    switch (part) {
      case TOUGH:
        return 0;
      case WORK:
      case CARRY:
        return 1;
      case MOVE:
        return 2;
      case ATTACK:
        return 8;
      case RANGED_ATTACK:
        return 9;
      case HEAL:
        return 10;
      default:
        return 1;
    }
  });

  return base;
}
