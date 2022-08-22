/**
 * Base Creep Spawning
 *
 * Tracks the spawns in a base, pull events from the spawn topic, and spawns the requested creeps.
 *
 * TODO - Move to topic with base id in the name - IN PROGRESS
 */
import * as CREEPS from '../constants/creeps';
import {DEFINITIONS} from '../constants/creeps';
import * as MEMORY from '../constants/memory';
import * as TOPICS from '../constants/topics';
import {
  getDashboardStream, getLinesStream, HudEventSet, HudIndicator, HudIndicatorStatus,
  HudLine
} from '../debug/hud';
import {Event} from '../lib/event_broker';
import {Request, TopicKey} from '../lib/topics';
import {Tracer} from '../lib/tracing';
import {PortalEntry} from '../managers/scribe';
import {
  Base, BaseThreadFunc, getBasePrimaryRoom, getStoredResourceAmount,
  threadBase
} from '../os/kernel/base';
import {Kernel} from '../os/kernel/kernel';
import {RunnableResult, running, terminate} from '../os/process';
import {threadBaseRoom} from '../os/threads/base_room';
import {PrepareBoostDetails} from './booster';

const SPAWN_TTL = 5;
const REQUEST_BOOSTS_TTL = 5;
const PROCESS_EVENTS_TTL = 20;
const MIN_ENERGY_HELP_NEIGHBOR = 20000;

const INITIAL_TOPIC_LENGTH = 9999;
const RED_TOPIC_LENGTH = 10;
const YELLOW_TOPIC_LENGTH = 5;

export const SPAWN_REQUEST_ROLE = 'role';
export const SPAWN_REQUEST_SPAWN_MIN_ENERGY = 'spawn_min_energy';
export const SPAWN_REQUEST_PARTS = 'parts';
const UTILIZATION_CARDINALITY = 150;
const MIN_UTILIZATION_SAMPLES = 30;

export type SpawnRequestDetails = {
  role: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  memory: any;
  energyLimit?: number;
  parts?: BodyPartConstant[],
}

export function createSpawnRequest(priority: number, ttl: number, role: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  memory: any, parts: BodyPartConstant[], energyLimit: number): Request<SpawnRequestDetails> {
  return {
    priority,
    ttl,
    details: {
      role,
      memory,
      energyLimit,
      parts,
    },
  };
}

export function getShardSpawnTopic(): TopicKey {
  return 'shard_spawn';
}

export function getBaseSpawnTopic(baseId: string): TopicKey {
  return `base_${baseId}_spawn`;
}

export type SpawnUtilizationUpdate = {
  utilization: number;
}

export function createUtilizationUpdate(utilization: number): SpawnUtilizationUpdate {
  return {
    utilization,
  };
}

export function getBaseSpawnUtilizationTopic(baseId: string): string {
  return `base_${baseId}_spawn_utilization`;
}

export default class SpawnManager {
  private id: string;
  private baseId: string;
  private utilization: number[] = [];

  private eventsThread: BaseThreadFunc;
  private spawnThread: BaseThreadFunc

  constructor(id: string, baseId: string) {
    this.id = id;
    this.baseId = baseId;

    this.spawnThread = threadBaseRoom('spawn_thread', SPAWN_TTL)(this.spawning.bind(this));
    this.eventsThread = threadBase('produce_events_thread',
      PROCESS_EVENTS_TTL)((trace, kernel, base) => {
        this.processEvents(trace, kernel, base);
      });
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('spawn_manager_run');

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('no base, terminating', {baseId: this.baseId});
      trace.end();
      return terminate();
    }

    const room = getBasePrimaryRoom(base);
    if (!room) {
      trace.error('no room object,', {base});
      trace.end();
      return running();
    }

    trace.info('Spawn manager run', {id: this.id, baseId: this.baseId});

    this.spawnThread(trace, kernel, base, room);
    this.eventsThread(trace, kernel, base);

    trace.end();
    return running();
  }

  spawning(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    const spawns = room.find<StructureSpawn>(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_SPAWN,
    });

    // If there are no spawns then we should request another base in the kernel produce the creep
    if (spawns.length === 0) {
      let request: Request<SpawnRequestDetails> = null;
      // eslint-disable-next-line no-cond-assign
      while (request = kernel.getTopics().getNextRequest<SpawnRequestDetails>(getBaseSpawnTopic(base.id))) {
        trace.notice('sending spawn request to shard/neighbors', {request: request});
        kernel.getTopics().addRequestV2<SpawnRequestDetails>(getShardSpawnTopic(), request);
      }

      return;
    }

    // iterate spawns and fetch next request if idle
    spawns.forEach((spawn: StructureSpawn) => {
      const isIdle = !spawn.spawning;
      const spawnEnergy = spawn.room.energyAvailable;
      const energyCapacity = spawn.room.energyCapacityAvailable;
      const energyPercentage = spawnEnergy / energyCapacity;

      trace.info('spawn status', {
        id: spawn.id,
        isIdle,
        spawnEnergy,
        energyCapacity,
        energyPercentage,
      });

      // track utilization
      this.utilization.push(isIdle ? 0 : 1);
      if (this.utilization.length > UTILIZATION_CARDINALITY) {
        this.utilization.shift();
      }

      // currently spawning something
      if (!isIdle) {
        trace.getMetricsCollector().counter('spawn_busy', 1, {spawn: spawn.id, base: base.id});
        handleActiveSpawning(kernel, base, spawn, trace)
        return;
      }

      // check if spawner has energy
      if (!isSpawnerEnergyReady(kernel, base, spawn, trace)) {
        trace.getMetricsCollector().counter('spawn_not_enough_energy', 1, {spawn: spawn.id, base: base.id});
        trace.info('spawner not ready, skipping', {spawn: spawn.id, spawnEnergy, energyCapacity});
        return;
      }

      const request = getNextRequest(kernel, base, spawn, trace);
      if (request) {
        // determine topic pressure
        const spawnTopicSize = kernel.getTopics().getLength(getBaseSpawnTopic(base.id));
        const spawnTopicBackPressure = Math.floor(energyCapacity * (1 - (0.09 * spawnTopicSize)));
        let energyLimit = _.max([300, spawnTopicBackPressure]);

        // Allow request to override energy limit
        if (request.details.energyLimit) {
          energyLimit = request.details.energyLimit;
        }

        trace.notice('spawning', {id: this.id, spawnEnergy, energyLimit, request});
        trace.getMetricsCollector().counter('spawn_spawning', 1, {spawn: spawn.id, base: base.id});
        createCreep(base, room.name, spawn, request, spawnEnergy, energyLimit, trace);
        return;
      }

      trace.getMetricsCollector().counter('spawn_no_request', 1, {spawn: spawn.id, base: base.id});
      handleIdle(trace);
    });
  }

  processEvents(trace: Tracer, kernel: Kernel, base: Base) {
    const baseRoom = getBasePrimaryRoom(base);
    if (!baseRoom) {
      trace.error('no primary room for base', {base: base.id});
      return;
    }
    const roomName = baseRoom.name;

    const baseTopic = kernel.getTopics().getTopic(getBaseSpawnTopic(base.id));

    let utilization = 0;
    if (this.utilization.length) {
      utilization = _.sum(this.utilization) / this.utilization.length;
    }

    if (this.utilization.length > MIN_UTILIZATION_SAMPLES) {
      const utilizationStream = kernel.getBroker().getStream(getBaseSpawnUtilizationTopic(base.id));
      utilizationStream.publish(new Event(this.id, Game.time, "set", createUtilizationUpdate(utilization)));
    }

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
      room: baseRoom.name,
      order: 5,
      text: `Next spawn: ${creeps.join(',')}, Utilization: ${utilization.toFixed(2)}, Topic length: ${topicLength}`,
      time: Game.time,
    };
    const event = new Event(this.id, Game.time, HudEventSet, line);
    trace.info('produce_events', {event});
    kernel.getBroker().getStream(getLinesStream()).publish(event);

    const indicatorStream = kernel.getBroker().getStream(getDashboardStream());

    // Processes
    let processStatus = HudIndicatorStatus.Green;
    if (topicLength === INITIAL_TOPIC_LENGTH) {
      processStatus = HudIndicatorStatus.Stale;
    } else if (topicLength > RED_TOPIC_LENGTH) {
      processStatus = HudIndicatorStatus.Red;
    } else if (topicLength > YELLOW_TOPIC_LENGTH) {
      processStatus = HudIndicatorStatus.Yellow;
    }

    const spawnLengthIndicator: HudIndicator = {
      room: roomName,
      key: 'spawn_length',
      display: 'S',
      status: processStatus,
    };
    indicatorStream.publish(new Event(this.id, Game.time, HudEventSet, spawnLengthIndicator));
  }
}

function peekNextNeighborRequest(kernel: Kernel, base: Base, trace: Tracer): Request<SpawnRequestDetails> {
  trace.info("peeking neighbor request", {baseRoom: base.primary, baseNeighbors: base.neighbors});
  const topic = kernel.getTopics();
  const requests = topic.getTopic(getShardSpawnTopic())
  if (!requests) {
    return null;
  }

  // Reverse message so we get higher priority first
  return getNextNeighborRequestFilter(kernel, base, requests.reverse(), trace);
}

function getNextNeighborRequest(kernel: Kernel, base: Base, trace: Tracer): Request<SpawnRequestDetails> {
  trace.info("getting neighbor request", {baseRoom: base.primary, baseNeighbors: base.neighbors});
  const topic = kernel.getTopics();
  return topic.getMessageOfMyChoice(getShardSpawnTopic(), (messages) => {
    // Reverse message so we get higher priority first
    return getNextNeighborRequestFilter(kernel, base, messages.reverse(), trace);
  });
}

function requestBoosts(kernel: Kernel, base: Base, spawn: StructureSpawn, boosts, priority: number) {
  const request = {
    priority: priority,
    ttl: REQUEST_BOOSTS_TTL + Game.time,
    details: {
      [MEMORY.TASK_ID]: `bp-${spawn.id}-${Game.time}`,
      [MEMORY.PREPARE_BOOSTS]: boosts,
    }
  }

  kernel.getTopics().addRequestV2<PrepareBoostDetails>(TOPICS.BOOST_PREP, request);
}

function isSpawnerEnergyReady(kernel: Kernel, base: Base, spawn: StructureSpawn, trace: Tracer): boolean {
  const spawnEnergy = spawn.room.energyAvailable;

  // check minimum energy
  let minEnergy = 300;
  // TODO factor number of crepes in base for minimum energy
  //const numCreeps = kernel.getCreepsManager().getCreepsByBase(base.id).length;
  minEnergy = _.max([300, minEnergy]);
  if (spawnEnergy < minEnergy) {
    trace.info('low energy, not spawning', {id: spawn.id, spawnEnergy, minEnergy});
    return false;
  }

  return true;
}

function getNextRequest(kernel: Kernel, base: Base, spawn: StructureSpawn,
  trace: Tracer): Request<SpawnRequestDetails> {
  const spawnEnergy = spawn.room.energyAvailable;
  const energyCapacity = spawn.room.energyCapacityAvailable;

  // check local requests
  let localRequest = kernel.getTopics().peekNextRequest<SpawnRequestDetails>(getBaseSpawnTopic(base.id));
  if (localRequest && !isRequestEnergyReady(kernel, base, spawn, localRequest, trace)) {
    trace.info('local request not ready, skipping', {spawn: spawn.id, spawnEnergy, energyCapacity});
    localRequest = null;
  }

  // Check if we have a reserve of energy and can help neighbors
  let neighborRequest = null;
  const storageEnergy = getStoredResourceAmount(base, RESOURCE_ENERGY) || 0;
  if (storageEnergy >= MIN_ENERGY_HELP_NEIGHBOR) {
    neighborRequest = peekNextNeighborRequest(kernel, base, trace);
    if (neighborRequest && !isRequestEnergyReady(kernel, base, spawn, neighborRequest, trace)) {
      trace.info('neighbor request not ready, skipping', {spawn: spawn.id, spawnEnergy, energyCapacity});
      neighborRequest = null;
    }
  } else {
    trace.info('reserve energy too low, dont handle requests from other neighbors',
      {storageEnergy, baseId: base.id});
  }

  trace.info('spawn requests', {localRequest, neighborRequest});

  let requestSource = null;

  // Select local request if available
  if (localRequest) {
    trace.info('found local request', {localRequest});
    requestSource = 'local';
  }

  // If no request selected and neighbor request available, select neighbor request
  if (!localRequest && neighborRequest) {
    trace.warn('found neighbor request', {neighborRequest});
    requestSource = 'neighbor';
  }

  // If local priority w/ bonus is less than neighbor priority, select neighbor request
  if ((localRequest?.priority + 1) < neighborRequest?.priority) {
    trace.warn('neighbor request has higher priority', {neighborRequest, localRequest});
    requestSource = 'neighbor';
  }

  let request = null;

  // Take the request off the right queue
  switch (requestSource) {
    case 'local':
      trace.info('spawning from local request', {localRequest});
      request = kernel.getTopics().getNextRequest(getBaseSpawnTopic(base.id))
      break;
    case 'neighbor':
      trace.info('spawning from neighbor request', {neighborRequest});
      request = getNextNeighborRequest(kernel, base, trace);
      break;
    default:
      trace.info('no request found, skipping', {request});
      break;
  }

  return request;
}

function isRequestEnergyReady(kernel: Kernel, base: Base, spawn: StructureSpawn,
  request: Request<SpawnRequestDetails>, trace: Tracer): boolean {
  const spawnEnergy = spawn.room.energyAvailable;
  const energyCapacity = spawn.room.energyCapacityAvailable;

  const requestMinEnergy = request.details[SPAWN_REQUEST_SPAWN_MIN_ENERGY] || 0;
  if (spawnEnergy < requestMinEnergy) {
    trace.warn('base does not have energy', {requestMinEnergy, spawnEnergy, request});
    return false;
  }

  // get role from definition
  const role: string = request.details[SPAWN_REQUEST_ROLE];
  const definition = DEFINITIONS.get(role);
  if (!definition) {
    trace.error('unknown role', {role});
    return false;
  }

  // the soft min is only enforced if the base has enough capacity to meet it
  if (definition.softEnergyMinimum && definition.softEnergyMinimum < energyCapacity &&
    spawnEnergy < definition.softEnergyMinimum) {
    trace.info('no enough energy (soft)', {spawnEnergy, energyCapacity, definition});
    return false;
  }

  // if definition has a minimum energy requirement, check if we have enough energy
  if (definition.energyMinimum && spawnEnergy < definition.energyMinimum) {
    trace.warn('not enough energy (hard)', {spawnEnergy, definition});
    return false;
  }

  return true;
}

function handleActiveSpawning(kernel: Kernel, base: Base, spawn: StructureSpawn, trace: Tracer): void {
  const creep = Game.creeps[spawn.spawning.name];

  spawn.room.visual.text(
    spawn.spawning.name + '🛠️',
    spawn.pos.x - 1,
    spawn.pos.y,
    {align: 'right', opacity: 0.8},
  );

  const role: string = creep.memory[MEMORY.MEMORY_ROLE];
  const definition = CREEPS.DEFINITIONS.get(role);
  if (!definition) {
    trace.error('unknown role', {creepName: creep.name, role});
    return;
  }

  const boosts = definition.boosts;
  const priority = definition.processPriority;

  trace.info('spawning', {creepName: creep.name, role, boosts, priority});
  trace.getMetricsCollector().gauge('spawn_spawning_role', spawn.spawning.remainingTime,
    {spawn: spawn.id, role});

  if (boosts) {
    requestBoosts(kernel, base, spawn, boosts, priority);
  }

  return;
}

function handleIdle(trace: Tracer): void {
  trace.info('no request');
}

function createCreep(base: Base, room: string, spawn: StructureSpawn, request: Request<SpawnRequestDetails>,
  energy: number, energyLimit: number, trace: Tracer) {
  const role: string = request.details[SPAWN_REQUEST_ROLE];
  let parts = request.details[SPAWN_REQUEST_PARTS] || null;
  const memory = request.details.memory || {};

  const definition = DEFINITIONS.get(role);
  if (!definition) {
    trace.error('no definition for role', {role});
    return;
  }

  const ignoreSpawnEnergyLimit = definition.ignoreSpawnEnergyLimit || false;
  if (energy > energyLimit && !ignoreSpawnEnergyLimit) {
    energy = energyLimit;
  }

  const roleEnergyLimit = definition.energyLimit;
  if (roleEnergyLimit && energy > roleEnergyLimit) {
    energy = roleEnergyLimit;
  }

  trace.info("parts before", {parts});

  // if parts not provided, work them out from the definition
  if (!parts || !parts.length) {
    parts = getBodyParts(definition, energy);
  }

  trace.info("parts after", {parts});

  const name = [role, Game.shard.name, Game.time].join('_');

  // Requests to the kernel should include the destination base, don't overwrite it
  if (!memory[MEMORY.MEMORY_BASE]) {
    memory[MEMORY.MEMORY_BASE] = base.id;
  }

  // Used for debugging, don't use for decision making, use MEMORY_BASE instead
  memory[MEMORY.MEMORY_ORIGIN_SHARD] = Game.shard.name;
  memory[MEMORY.MEMORY_ORIGIN] = room;

  memory[MEMORY.MEMORY_ROLE] = role;
  memory[MEMORY.DESIRED_BOOSTS] = definition.boosts;

  const result = spawn.spawnCreep(parts, name, {memory});
  if (result !== OK) {
    trace.error('spawn error', {result, spawn: spawn.id, name, parts});
  }
}

function getBodyParts(definition, maxEnergy) {
  let base = definition.base.slice(0);
  let i = 0;

  while (true) { // eslint-disable-line no-constant-condition
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

function getNextNeighborRequestFilter(kernel: Kernel, base: Base, messages,
  trace: Tracer): Request<SpawnRequestDetails> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return _.find(messages, (message: any) => {
    // Select message if portal nearby
    // RAKE check distance on other side of the portal too
    const assignedShard = message.details.memory[MEMORY.MEMORY_ASSIGN_SHARD] || null;
    if (assignedShard && assignedShard != Game.shard.name) {
      trace.warn('request in another shard', {assignedShard, shard: Game.shard.name});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const portals: PortalEntry[] = kernel.getScribe().
        getPortals(assignedShard).filter((portal) => {
          const distance = Game.map.getRoomLinearDistance(baseRoom.name,
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
      destinationRoom = baseRoom;
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

    // If the room is part of a base, check if the base is a neighbor
    const destinationBase = kernel.getPlanner().getBaseByRoom(destinationRoom);
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
}
