# Screeps

An AI for [Screeps](screeps.com).

* [Game Docs](https://docs.screeps.com)
* [API Docs](https://docs.screeps.com/api)

#### Key Features:

* Creep logic implemented using Behavior Trees (BT)
* Tracing w/ report plumbed through BTs
* Flag directed building (`build*`), creep manager staffs flags
* Remote harvesting
* Miners w/ container and haulers

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
- [ ] Track time between end and start of spawns and increase/decrease min energy (Spawn Time Governor)
- [ ] Auto-defence of owned rooms
- [x] Scale number of repairers based on repair needs of the room
- [x] Scale number of builders based on number of construction sites in room
- [ ] Scale number of haulers based on fullness/rate of harvesting
- [x] Refactor and support multiple spawners in room
- [ ] Auto-manage Upgraders per spawn (maximize what the economy can support - net zero energy)
- [ ] Auto return-to-home and defense of remote harvesters
- [x] Don't require Build flags, staff rooms w/ construction sites, use flags to prioritize nearby sites
- [ ] Refactor role and spawn logic to support easy addition of creep roles
- [ ] Auto-construction of roads to remote sources

#### Considering

- [ ] Automatic layout and expansion

## Setup

> Backup your existing scripts.

Copy the repo's `./default` contents in to your "default" Screeps directory. You can also checkout this repo into the directory.

Personally, I use WSL2 (Ubuntu), VS Code (`code .` in WSL2), and Git to do development. Saving files in VS Code should trigger auto-upload to server. Opening the Screeps code directory in VSC without involving the WSL2 (PowerShell) should work.

#### Key locations
* `C:\Users\<user>\AppData\Local\Screeps\scripts\screeps.com\default` (Screeps code directory)
* `%localappdata%Screeps\scripts\screeps.com\default` (Screeps code directory - but easier)
* `/mnt/c/Users/<user>/AppData/Local/Screeps/scripts/screeps.com/default` (WSL2)

## Operation

The AI will focus on establishing an economy, build, repair, and defend the colony. The build manager will spawn at least one Upgrader and will add more as long as the economy, construction projects, and repairs are staffed.

### Creeps

* Harvester - Harvests and brings energy back to Spawner/Origin
* Miner - Harvests and places energy in nearby container
* Hauler - Picks up and takes energy in containers to Origin spawner, extractor, turret, storage
* Builder - Harvest/pick up energy in room and completes construction
* Repairer - Harvest/pick up energy in room and repair structures
* Defender - Attacks hostiles creeps in room
* Explorer - Goes to rooms in domain to get visibility (triggers remote harvesting)
* Distributor - Moves energy from Containers/Storage into Spawner, Turrets
* Claimer - Claims/Reserves rooms (TODO)
* Attacker - Rally at Attack Flag and attack hostiles in room (TODO)
* SanitationEng - Do I need someone to pick up ruins and dropped energy (CONSIDERING)

### Colony

The `./default/main.js` file contains a list of room names that should be considered the domain of the Colony. Rooms inside the Colony Domain will be reserved/claimed in the order they appear in the list (TODO). Sources present in the Colony Domain will be harvested.

> Make sure to update the list when setting up the project

### Build priorities

1. If spawn Storage/Containers, spawn Distributors (1/5 the number of extensions)
2. Harvesters, miners, and haulers
3. Minimum of 1 Upgrader
4. Build explorer and get visibility in rooms in Colony Domain
5. If attack flags, all energy goes into spawning Attackers (in-development)
6. 1 Repairer for each room with structures (like road and containers)
7. 2 Builders for each Build flag
8. Max 3 Upgraders in each room with a Spawner

### Economy & Building

It's up to you to choose the rooms in your Domain. You must also place construction sites.

#### Do these things

* Build Containers next to harvester, this will trigger Miners (specialized harvesters) and Haulers to spawn
* Always be building maximum allowed Extensions
* Always place your Turrets in your spawn rooms
* Build Containers near Spawners, will be used as buffer and trigger spawning of Distributors
* Build Storage when permitted, will triggers spawning of Distributors (specialized Spawner haulers)

### Defense

> On the roadmap and coming up soon

When a hostile is present in the colony's domain all energy, except to maintain energy collection, will be used to produce Defenders. Early versions will pool Defenders in spawn rooms and energy will go to Turrets before the spawners and extensions.

Later versions will respond to hostile presence by sending groups of Defenders to the room being occupied. Also, non-combatant creeps in occupied rooms will withdraw to origin.

### Flags

#### Building

Creating flags prefixed with `build` will dispatch builders to the room. The manager will staff with 2 Builders.

#### Attack

> Current focus of development. Not implement.

When an Attack Flag (`attack*`) is placed all Builder and Upgrader spawning is halted, except to maintain a minimum 1 Upgrader. All of that energy is used to produce attackers. Attackers will move to the flag and attack any hostile it sees, even if not in the flag's room.

## Design

> The entire section, including subheadings, are a work in progress.

Design and layout of of the AI and it's source code. I'm actively migrating from the Manager+Domain model to a much more structured Kingdom model. Objects in the structure can request prioritized actions (creep spawn, defenders, etc...) from the Colony, which if important enough will request it from the rest of the colonies in the Kingdom.

The Kingdom model is currently being built and it's not making any decisions or driving any in-game actions. I'm taking a very methodical approach to not destabilize the game. The work is mostly going through the Manager model and identifying where specific pieces of data and logic should fit into the model. Ideally, switching will cause very little behavior changes in the AI.

### Structure

1. Kingdom
2. Colony, War Party
3. Sources, Rooms, Spawns
4. Creeps, Towers
5. Behavior Trees
6. Behaviors

### Memory

WIP

### Topics

WIP

### Behavior Trees

This section will outline the BT's organizational strategy. Ideally, the `behavior.*` files would provide a well organized and DRY set of logic that can be composed to produce complex behavior.

### Stats & Dashboard

WIP
