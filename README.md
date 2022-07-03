# Screeps AI

An AI for [Screeps](screeps.com).

* [Game Docs](https://docs.screeps.com)
* [API Docs](https://docs.screeps.com/api)

#### Key Features:

* Creep logic implemented using Behavior Trees (BT)
* Tracing (metrics, logging) and Feature Flag logic to aid development/debugging
* Remote harvesting/mining
* Miners w/ container and haulers
* Buy/sell minerals
* React and distribute compounds with a focus on "upgrade" boost
* Explore rooms and store notes in memory
* Haulers managed by PID controller
* Scheduler & Processes
* Message bus w/ topics for IPC
* Event streams
* Automatic expansion and base building
* HUD

#### Roadmap:

- [x] Sustainably upgrade RCL in tutorial room
- [x] Scale creep parts based on room capacity
- [x] Organize logic and fix how builders and repairers source their energy
- [x] Implement behavior tree
- [x] Migrate creep roles to behavior tree
- [x] Storage construction triggers Distributors and prioritized Storage usage
- [x] Attack flag
- [x] Refactor movement and storage selection (more hauling with fewer Distributors)
- [x] Kingdom refactor
- [x] Refactor creep manager
- [x] Track time between end and start of spawns and increase/decrease min energy (Spawn Time Governor)
- [x] Auto-defence of owned rooms
- [x] Scale number of repairers based on repair needs of the room
- [x] Scale number of builders based on number of construction sites in room
- [x] Scale number of haulers based on fullness/rate of harvesting
- [x] Refactor and support multiple spawners in room
- [x] Auto-manage Upgraders per spawn (maximize what the economy can support - net zero energy)
- [x] Auto return-to-home and defense of remote harvesters
- [x] Don't require Build flags, staff rooms w/ construction sites, use flags to prioritize nearby sites
- [x] Refactor role and spawn logic to support easy addition of creep roles
- [x] Implement Scheduler, Process, and other OS components
- [x] Move Creeps to scheduler
- [x] Auto attack of weaker players
- [x] Intra-shared movement and claiming
- [X] Proper event stream
- [X] Auto-construction of roads to remote sources
- [X] Automatic layout and expansion
- [X] System for a Room and Map(beta) HUD
- [ ] Scale creep parts and remote mining based on spawner saturation
- [ ] Remove "org" model
  - [ ] Room
    - [x] Move hostile tracking (deleted logic)
    - [ ] Move defense
    - [ ] Move tracking of damaged creeps
    - [ ] Move structure repairing
    - [ ] Move sharing of boost details
    - [ ] Move resource tracking
  - [ ] Observer (move into Base Observer)
  - [ ] Colony
  - [ ] Kingdom
    - [ ] Use AI for accessing topics, planner, scheduler, etc...
    - [ ] Move path cache, cost matrix cache, and resource gov. to AI
  - [ ] Refactor Resource Governor into a Process\
    - [ ] Move to TypeScript
- [ ] All of project on TypeScript
- [ ] Refactor PID controller
- [ ] Influence map library
- [ ] Move creep definitions into individual creep files
- [ ] TD: Room process and sources processes no longer require room visibility
- [ ] TD: Replace spawn topics (TTL) with event streams (manages own queue)
- [ ] TD: Cleanup old construction sites automatically
- [ ] Harvest commodities & factory
- [ ] Process thread API (automatically run threads and sleep based on)
- [ ] Process stats and scheduler report
- [ ] Factor room resources when selecting new base
- [ ] Sieging of RCL>=7 rooms
- [ ] Quads moving coherently 100% of time
- [ ] Replace references to 'colony' with 'base'
- [ ] Buff ramparts and walls to withstand nuke
- [ ] Move all data sharing between processes to topics/IPC (remove direct access)
- [ ] Improved defenders that hide in ramparts
- [ ] Collect Power
- [ ] Create & drive Power Creeps
- [ ] Apply buffer to lvl 8 rooms
- [ ] Allow buffer manager to nuke and time sending attackers
- [ ] Police portal rooms
- [ ] Attack other players getting commodities/power


## Setup

> Backup your existing scripts.

> Note this project uses LF, not CRLF, and the linter will complain if it files with CRLFs.
> The project is setup for [EditorConfig](https://editorconfig.org/). Please use that.

Requirements:
  * Node 16+

```
npm install grunt-cli -g
npm install
```

Create `.screeps.json` and provide credentials:
```
{
  "email": "<email>",
  "token": "<token>",
  "branch": "default",
  "ptr": false,
  "private": {
    "username": "<username>",
    "password": "<password>",
    "branch": "default",
    "ptr": false
  }
}
```

> Token is gotten from the the account settings in the Screeps client. The private username and password for private servers are set via the private server CLI tool.

## Running

After making changes run linting, tests, and TS complication with `grunt`.

Uploading of built TS+JS can be done by running `grunt <world>` where `<world>` can be `mmo`, `private`, or `local`.

## Structure

Screeps does not allow the uploading of source maps. So, to keep the stack traces from the game similar to the
source good the directory has a flat structure and is not combined into single JS file. This may change in the future depending on the pain.

The source is prefixed to group files by their type/purpose:
- Behavior - Files containing behavior trees for creeps
- Constants - Shared constants
- Helpers - Shared functions
- Lib - Shared libraries
- Org - Tree of logic execute each tick (deprecated in favor of Runnables)
- OS - Scheduler, Process, and other OS-level components
- Roles - Behavior trees for Creep roles
- Runnable - AI processes
- Topic - Process IPC

First-class technical concepts:
- AI - Root object for the AI
- Kingdom - Represents a shard and hold references to shared data and objects
- Scribe - Aggregates game state and persists room details in case the we lose visibility
- Caches - Cost Matrices and Path
- Scheduler - Tracks, schedules, and execute processes
- Process - A runnable unit for work, wrapper for AI logic run during a tick
- Topics - Priority queues organized into topics
- Event Streams - Event streams and consumer groups
- Tracer - Logging, tracing, and metrics

The AI strategy is contained mostly in the Runnables and the Roles, which will sure the shared constants, functions, and libraries.

Communication between processes and other components is almost entirely done over Topics and Event Streams, items not using these methods are being moved to using them as needed.

## Operation

The AI will focus on establishing an economy, build, repair, and defend it's bases. The build manager will spawn at least one Upgrader and will add more if there is energy above the defense reserve.

There are some debugging tools built into the project:

* Run and draw path - `AI.getPathDebugger().debug(new RoomPosition(11, 12, 'W8N4'), new RoomPosition(25,25,'W7N6'), 1, 'warparty')`
* Clear path - `AI.getPathDebugger().clear()`
* Run and draw cost matrix - `AI.getCostMatrixDebugger().debug("W8N4", 'open_space')`
* Cost matrix clear - `AI.getCostMatrixDebugger().clear()`
* Get debug info on path cache - `AI.kingdom.getPathCache().debug()`
* Attack a room (requires rally_<room> flag) - `AI.scheduler.processMap['war_manager'].runnable.targetRoom = 'E16S51'`
* Look at central planning results - `AI.getPlannerDebugger().debug()`
* Look at min cut output - `AI.getMinCutDebugger().debug(AI.getKingdom(), 'W6N1')`
* Get cached room details from Scribe - `JSON.stringify(AI.getKingdom().getScribe().getRoomById('W8N4'))`
* Launch Nuke - `AI.kingdom.sendRequest('nuker_targets', 1, {position: '28,35,E19S49'}, 100)`


```
// Example of converting old base to being automated
AI.getKingdom().getPlanner().baseConfigs['E22S49'].origin = new RoomPosition(42,16,'E22S49')
AI.getKingdom().getPlanner().baseConfigs['E22S49'].automated = true
```

There are a couple of helpful global variables:

> Many of these persist between restarts, so make sure to unset them when you're finished with them.

* `METRIC_REPORT=true|false` - Will output aggregated tracing metric data to the console
* `METRIC_CONSOLE=true|false` - Will output tracing metric data to the console
* `METRIC_FILTER=<prefix>|null` - Will cause Tracer to report metrics for metrics that start with `<prefix>`
* `METRIC_MIN=<min ms>|0` - (default 0.5ms) Will cause Tracer to report metrics that are greater than `<min ms>`
* `LOG_WHEN_PID='<prefix>'|null` - Logs with tracers matching the prefix will be output to the console
* `RESET_PIDS=true|false` - Will reset the PID controllers - useful when PID controllers are spawning too many haulers

## Stats

Statistics for the dashboards are written to memory under `stats`. Its setup to be consumed by [my fork of screeps-grafana](https://github.com/ryanrolds/screeps-grafana).

## Strategy

### Central Planning

### Base

The `./src/main.ts` file contains a `KingdomConfig` that defines the rooms that should be considered part of the Kingdom. Rooms inside the Kingdom will be reserved/claimed in the order they appear in the list. Sources present in the Kingdom's Domain will be harvested.

> Make sure to update the list when setting up the project

### Build priorities

### Economy & Market

### Defense

### Offense

### Creeps

* Attacker - Rally at Attack Flag and attack hostiles in room
* Builder - Harvest/pick up energy in room and completes construction
* Defender - Attacks hostiles creeps in room
* Defender Drone -
* Distributor - Moves energy from Containers/Storage into Spawner, Turrets, Labs, and other colony core structures
* Explorer - Goes to rooms in domain to get visibility (triggers remote harvesting)
* Harvester - Harvests and brings energy back to Spawner/Origin
* Hauler - Picks up and takes energy in containers to colony storage, also picks up dropped resources
* Miner - Harvests and places energy in nearby container
* Repairer - Harvest/pick up energy in room and repair structures
* Reserver - Claims/Reserves rooms
* Upgrader - Upgrades room controllers

#### Parties

Groups of creeps, typically called a quad, are represented by a single party, which is a process that assigns member creeps move, attack, and heal orders. Parties are created by a manager process, see `runnable.manager.buffer` and `runnable.manager.war`.

## Design (out-of-date but helpful)

> The entire section, including subheadings, are a work in progress.

The Kingdom model work was completed, greatly improving the structure of the business logic. Since completing that work the next major hurdle has been CPU usage. The addition of the Tracing library and plumbing it through the business logic and creeps logic has greatly aided improving CPU usage. As the project approaches the theoretical work limit (100 creeps at ~0.2 cpu/tick - one intent per tick) the need to move to a scheduler has become strongly needed. It's too easy to expand and exhaust the CPU reserver/bucket.

Implementing a scheduler and deferring lower priority work to the next tick is needed. At this time I'm in process of implementing a schedule, process, and additional OS components to manage the increasing CPU demands of the AI/system.

TODO - Add additional context around the current design

### Structure

1. AI
2. Scheduler
3. Kernel (old generation)
4. Managers and other processes (new generation)
5. Behavior Trees - Bulk of the creep logic
6. Behaviors - Individual creep behaviors
7. Topics - IPC

### Processes

| Process | ID  | Priority | Description |
| ------- | --- | -------- | ----------- |
| Central Planning | central_planning | | |
| Kingdom | kingdom_model |
| Kingdom Governor |
| Colony Manager |
| Room Manager |
| Defense Manager | defense_manager | | |
| Buffer Manager |
| Invader Manager |
| War Manager | war_manager | | |
| Creep Manager |
| Path Debugger |
| Cost Matrix Debugger |
| Observer | <id>
| Colony | <colony id>        |
| Room | <room name>
| Spawn Manager | spawns_<room name> |
| Tower |
| Nuker |
| Link Manager |
| Lab Manager |
| Reactor |
| Booster |
| Source |
| Mineral |
| Construction |
| War Party |
| Defense Party |
| Creep | <name> |


### Topics

The codebase is currently of two minds. Previous generations of the code (org.*) allowed direct access to each other's data. Initially this wasn't a major issue, but as complexity and the scheduler was introduced keeping data up-to-date for other logic became problematic. Also, the tightly coupling was a major problem.

The older generation need job queues for hauling, spawning, and other tasks. Priorities lists with item TTLs are used as topics. Kingdoms, Colony's, and Rooms (Org Rooms) each have its own set of topics. It's important to send requests to the right set of topics.

A second need arose, event streams. The priority queue is currently abused to provide event streams. Event stream consumers scan the whole topic, but don't remove any items. It's important to set lowish TTLs to prevent the streams from becoming too large.

Moving forward, all sharing of information must be done through topics, not direct access to memory. There are couple of places that are still using direct access, but they are being refactored out. Also, the constant used for the topic ID should be moved to the same file as the producer of the topic. Creeps are a notable exception to this rule. Currently the creep logic is strongly coupled with the Kernel logic. As much logic as possible is being removed from the kernel in an effort to reduce the per-tick cost of updating the kernel. However, creeps are often accessing a lot of the same game state to make decision. Over-time the kernel will be reduced to just what the creeps need and likely moved.

Eventually a proper event stream, with consumer offsets, will be implemented.

### Behavior Trees

This section will outline the BT's organizational strategy. Ideally, the `behavior.*` files would provide a well organized and DRY set of logic that can be composed to produce complex behavior.
