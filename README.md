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
- [ ] Buff ramparts and walls to withstand nuke
- [ ] Quads moving coherently 100% of time
- [ ] Harass remote mining rooms
- [ ] Proper event stream
- [ ] Move Org/Kingdom work to scheduler
- [ ] Auto-construction of roads to remote sources
- [ ] Improved defenders that hide in ramparts
- [ ] Collect Power
- [ ] Create & drive Power Creeps
- [ ] Harvest commodities
- [ ] Move all data sharing between processes to topics/IPC (remove direct access)
- [ ] Automatic layout and expansion
- [ ] Apply buffer to lvl8 rooms
- [ ] Allow buffer manager to nuke and time sending attackers
- [ ] Police portal rooms
- [ ] Attack other players getting commodities/power


## Setup

> Backup your existing scripts.

> Note this project uses LF, not CRLF, and the linter will complain if it files with CRLFs.
> The project is setup for [EditorConfig](https://editorconfig.org/). Please use that.

```
npm install
```

Create `.screeps.json` and provide credentials:
```
{
  "email": "<email>",
  "password": "<password>",
  "branch": "default",
  "ptr": false
}
```

## Running

After making changes run linting, tests, and TS complication with `grunt`.

Uploading of built TS+JS can be done by running `grunt upload`.

## Stats

Statistics for the dashboards are written to memory under `stats`. Its setup to be consumed by [my fork of screeps-grafana](https://github.com/ryanrolds/screeps-grafana).

## Operation

The AI will focus on establishing an economy, build, repair, and defend the colonies. The build manager will spawn at least one Upgrader and will add more if there is energy above the defense reserve.

There are some debugging tools built into the project:

* Run and draw path - `AI.getPathDebugger().debug(new RoomPosition(11, 12, 'W8N4'), new RoomPosition(25,25,'W7N6'), 1, 'warparty')`
* Clear path - `AI.getPathDebugger().clear()`
* Run and draw cost matrix - `AI.getCostMatrixDebugger().debug("W8N4", 'open_space')`
* Cost matrix clear - `AI.getCostMatrixDebugger().clear()`
* Get debug info on path cache - `AI.kingdom.getPathCache().debug()`
* Attack a room (requires rally_<room> flag) - `AI.scheduler.processMap['war_manager'].runnable.targetRoom = 'E16S51'`
* Look at expand results - `AI.getExpandDebugger().debug()`

There are a couple of helpful global variables:

> TODO all these global variables should be replaced with a at runtime configurable process accessible through AI

* `METRIC_FILTER=<prefix>` - Will cause Tracer to report metrics for metrics that start with `<prefix>`
* `METRIC_MIN=<min ms>` - (default 0.5ms) Will cause Tracer to report metrics that are greater than `<min ms>`
* `LOG_WHEN_ID='<prefix>'` - Logs with tracers matching the prefix will be output to the console
* `RESET_PIDS=true` - Will reset the PID controllers - useful when PID controllers are spawning too many haulers
* `TRACING_ACTIVE=true` - Will output tracing metric data to the console
* `TRACING_FILTER=<prefix>` - only print traces with a key that stats with the prefix

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

### Parties

Groups of creeps, typically called a quad, are represented by a single party, which is a process that assigns member creeps move, attack, and heal orders. Parties are created by a manager process, see `runnable.manager.buffer` and `runnable.manager.war`.

### Colony

The `./src/main.ts` file contains a `KingdomConfig` that defines the rooms that should be considered part of the Kingdom. Rooms inside the Kingdom will be reserved/claimed in the order they appear in the list. Sources present in the Kingdom's Domain will be harvested.

> Make sure to update the list when setting up the project

### Build priorities

1. If spawn Storage/Containers, spawn Distributors (1/5 the number of extensions)
2. Harvesters, miners, and haulers
3. Minimum of 1 Upgrader
4. Build explorer and get visibility in rooms in Colony Domain
5. If attack flags, all energy goes into spawning Attackers
6. 1 Repairer for each room with structures (like road and containers)
7. 1 Builder for every 10 constructions sites in a room
8. Max 3 Upgraders in each room with a Spawner

### Economy & Building

It's up to you to choose the rooms in your Domain. You must also place construction sites.

Automated building may be added in the future.

#### Do these things

* Build Containers next to harvester, this will trigger Miners (specialized harvesters) and Haulers to spawn
* Always be building maximum allowed Extensions
* Always place your Turrets in your spawn rooms
* Build Containers near Spawners, will be used as buffer and trigger spawning of Distributors
* Build Storage when permitted, will triggers spawning of Distributors (specialized Colony core haulers)

### Defense

> Active development

### Offense

> Active development

### Flags

#### Attack

When an Attack Flag (`attack*`) is four attackers will be spawned to form a squad. The quad will move to the flag and attack any hostile, towers, walls, etc.. in range of the flag.

#### Defend

TODO

#### Station

TODO

## Design

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
| Central Planning |
| Kingdom | kingdom_model |
| Kingdom Governor |
| Colony Manager |
| Room Manager |
| Defense Manager |
| Buffer Manager |
| Invader Manager |
| War Manager |
| Creep Manager |
| Path Debugger |
| Cost Matrix Debugger |
| Observer | <id>
| Colony | <colony id>        |
| Room | <room name>
| Spawn Manager |
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
