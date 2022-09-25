# Screeps Bot - Choreographer

An bot for [Screeps](screeps.com). Implemented following the OS pattern with processes communicating via
Message Queues and Event Streams. Named after [Choreography in Event-Driven Architecture)[https://www.linkedin.com/pulse/orchestration-vs-choreography-why-do-some-architects-run-paul-perez/?trk=articles_directory].

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
* Scheduler & Processes & Threads
* Message bus w/ topics for IPC
* Event streams w/ consumers
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
- [x] Remove "org" model
  - [ ] Room
    - [ ] Move hostile tracking (deleted logic)
    - [ ] Move defense
    - [x] Move tracking of damaged creeps
    - [x] Move structure repairing
    - [ ] Move sharing of boost details
    - [ ] Move resource tracking
  - [x] Observer (move into Base Observer)
  - [x] Colony
  - [x] Kingdom
    - [x] Use AI for accessing topics, planner, scheduler, etc...
    - [x] Move path cache, cost matrix cache, and resource gov. to AI
  - [x] Refactor Resource Governor into a Process
    - [x] Move to TypeScript
- [x] Replace references to 'colony' with 'base'
- [ ] Refactor thread API
  - [ ] Strongly typed thread API
  - [ ] Automatically run threads and sleep main process correct amount of time
- [ ] No explicit Any rule
  - [ ] Scribe memory
  - [ ] Global/heap variables
  - [ ] War Manager memory
  - [ ] Central Planning memory
  - [ ] Persistent memory
- [ ] Switch first links to be controller and source, update miner to keep link full when not mining
- [ ] Double buffer topics when TTLing messages
- [x] All of project on TypeScript
- [ ] Fix restoring of Room Entries
- [ ] Refactor PID controller
- [ ] Influence map library
- [ ] Move creep definitions into individual creep files
- [ ] TD: Room process and sources processes no longer require room visibility
- [ ] TD: Replace spawn topics (TTL) with event streams (manages own queue)
- [x] Cleanup old construction sites automatically
- [ ] Scale creep parts and remote mining based on spawner saturation
- [ ] Harvest commodities & factory
- [ ] Process stats and scheduler report
- [ ] Factor room resources when selecting new base
- [ ] Sieging of RCL>=7 rooms
- [ ] Quads moving coherently 100% of time
- [ ] Buff ramparts and walls to withstand nuke
- [ ] Move all data sharing between processes to topics/IPC (remove direct access)
- [ ] Improved defenders that hide in ramparts
- [ ] Collect Power
- [ ] Create & drive Power Creeps
- [ ] Apply buffer to lvl 8 rooms
- [ ] Allow buffer manager to nuke and time sending attackers
- [ ] Police portal rooms
- [ ] Attack other players getting commodities/power

## Usage as bot in private server

1. Install the bot
```
npm install screeps-bot-choreographer --save
```
2. Add `"choreographer": "node_modules/screeps-bot-choreographer/dist/main.js"` to mods.json


## Building and running as a player

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

First-class business logic concepts:
- AI - Root object for the AI
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
* Attack a room - `AI.getTopics().addRequestV2('attack_room', {priority: 1, details: {status: "requested", roomId: "E58N42"}, ttl: 100})`
* Look at base expansion planning - `AI.getBasesDebugger().debug()`
* Look at min cut output - `AI.getMinCutDebugger().debug(AI.getKingdom(), 'W6N1')`
* Get cached room details from Scribe - `JSON.stringify(AI.getKingdom().getScribe().getRoomById('W8N4'))`
* Launch Nuke - `AI.kingdom.sendRequest('nuker_targets', 1, {position: '28,35,E19S49'}, 100)`
* Muster locations `AI.getMusterDebugger().debug('W21S34')`

There are a couple of helpful global variables:

> Many of these persist between restarts, so make sure to unset them when you're finished with them.

* `METRIC_REPORT=true|false` - Will output aggregated tracing metric data to the console
* `METRIC_CONSOLE=true|false` - Will output tracing metric data to the console
* `METRIC_FILTER=<prefix>|null` - Will cause Tracer to report metrics for metrics that start with `<prefix>`
* `METRIC_MIN=<min ms>|0` - (default 0.5ms) Will cause Tracer to report metrics that are greater than `<min ms>`
* `LOG_WHEN_PID='<prefix>'|null` - Logs with tracers matching the prefix will be output to the console
* `LOG_COLOR=true|false` - Will colorize the console output
* `RESET_PIDS=true|false` - Will reset the PID controllers - useful when PID controllers are spawning too many haulers
