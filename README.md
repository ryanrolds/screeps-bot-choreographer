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
* Buy/sell minerals
* React and distribute compounds with a focus on "upgrade" boost
* Explore rooms and store notes in memory

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
- [ ] Auto-construction of roads to remote sources
- [ ] Improved defenders that hide in ramparts
- [ ] Auto attack of weaker Overmind players
- [ ] Intra-shared movement and claiming
- [ ] Collect Power
- [ ] Create Power Creeps
- [ ] Harvest commodities

#### Considering

- [ ] Automatic layout and expansion

## Setup

> Backup your existing scripts.

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

## Operation

The AI will focus on establishing an economy, build, repair, and defend the colonies. The build manager will spawn at least one Upgrader and will add more if there is energy above the defense reserve.
### Creeps

* Harvester - Harvests and brings energy back to Spawner/Origin
* Miner - Harvests and places energy in nearby container
* Hauler - Picks up and takes energy in containers to colony storage, also picks up dropped resources
* Builder - Harvest/pick up energy in room and completes construction
* Repairer - Harvest/pick up energy in room and repair structures
* Defender - Attacks hostiles creeps in room
* Explorer - Goes to rooms in domain to get visibility (triggers remote harvesting)
* Distributor - Moves energy from Containers/Storage into Spawner, Turrets, Labs, and other colony core structures
* Reserver - Claims/Reserves rooms
* Attacker - Rally at Attack Flag and attack hostiles in room

### Colony

The `./src/main.ts` file contains a `KingdomConfig` that defines the rooms that should be considered part of the Kingdom. Rooms inside the Kingdom will be reserved/claimed in the order they appear in the list. Sources present in the Kingdom's Domain will be harvested.

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
* Build Storage when permitted, will triggers spawning of Distributors (specialized Colony core haulers)

### Defense

> On the roadmap and coming up soon

When a hostile is present in the colony's domain all energy, except to maintain energy collection, will be used to produce Defenders. Early versions will pool Defenders in spawn rooms and energy will go to Turrets before the spawners and extensions.

Later versions will respond to hostile presence by sending groups of Defenders to the room being occupied. Also, non-combatant creeps in occupied rooms will withdraw to origin.

### Flags

#### Attack

When an Attack Flag (`attack*`) is four attackers will be spawned to form a squad. The quad will move to the flag and attack any hostile, towers, walls, etc.. in range of the flag.

## Design

> The entire section, including subheadings, are a work in progress.

### Structure

1. Kingdom
2. Colony, War Party, Scribe
3. Rooms, Spawns, Sources, Storage (WIP)
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
