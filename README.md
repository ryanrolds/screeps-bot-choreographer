# Screeps

An AI for [Screeps](screeps.com).

[Game Docs](https://docs.screeps.com)
[API Docs](https://docs.screeps.com/api)

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
- [ ] Attack flag
- [ ] Auto-defence of owned rooms
- [ ] Scale number of repairers based on repair/decay rate for the room
- [ ] Scale number of builders based on number of construction sites in room
- [ ] Storage construction tiggers Distributors and prioritized Storage usage
- [ ] Auto-manage Upgraders per spawn (maximize what the econmoy can support - net zero energy)
- [ ] Auto return-to-home and defense of remote harvesters
- [ ] Refactor role and spawn logic to support easy addition of creep roles
- [ ] Auto-contruction of roads to remote sources

#### Considering

- [ ] Automatic layout and expansion

## Setup

> Backup your existing scripts.

Copy the repo's `./default` contents in to your "default" screeps directory. You can also checkout this repo into the directory.

Personally, I use WSL2 (Ubuntu), VS Code (`code .` in WSL2), and Git to do developement. Saving files in VS Code should trigger auto-upload to server. Opening the Screeps code directory in VSC without involving the WSL2 (PowerShell) should work.

#### Key locations
* `C:\Users\<user>\AppData\Local\Screeps\scripts\screeps.com\default` (Screeps code diretory)
* `%localappdata%Screeps\scripts\screeps.com\default` (Screeps code diretory - but easier)
* `/mnt/c/Users/<user>/AppData/Local/Screeps/scripts/screeps.com/default` (WSL2)

## Operation

The AI will focus on stablishing an economy, build, repair, and defend your colony. The build manager will spawn at least one Upgrader and will add more as long as the economy, contruction projects, and repairs are staffed.

### Creeps

* Harvester
* Miner
* Hauler
*

### Colony

The `./default/main.js` file contains a list of room names that should be considered the domain of the Colony. Rooms inside the Colony Domain will be reserved/claimed in the order they appear in the list (TODO). Sources present in the Colony Domain will be harvested.

> Make sure to update the list when setting up the project

### Build priorities

1. Harvesters, miners, and haulers
2. 1 upgrader
3. If attack flags, all energy goes into spawning Attackers (in-development)
4. 1 Repairer for each room with structures (like road and containers)
5. 2 Builders for each Build flag
6. Max 3 upgraders in each room with a Spawner

### Economy & Building

It's up to you to choose the rooms in your Domain. You must also place construction sites.

#### Do these things

* Build Containers next to harvester, this will trigger Miners (specialized harvesters) and Haulers to spawn
* Always be building maximum allowed Extensions
* Always place your Turrets in your spawn rooms
* Build Containers near Spawners, will be used as buffer and trigger spawning of Distributors (TODO)
* Build Storage when permitted, will tigger spawning of Distributors (specialized Spawner haulers) (TODO)

### Defense

> On the roadmap and coming up soon

When a hostile is present in the colony's domain all energy, except to maintain energy collection, will be used to produce Defenders. Early versions will pool Defenders in spawn rooms and energy will go to Turrents before the spawners and extensions.

Later versions will respond to hostile presence by sending groups of Defenders to the room being occupied. Also, non-combatent creeps in occupied rooms will withdraw to origin.

### Flags

#### Building

Creating flags prefixed with `build` will dispatch builders to the room. The manager will staff with 2 Builders.

#### Attack

> Current focus of development. Not implement.

 When an Attack Flag (`attack*`) is placed all Builder and Upgrader spawning is halted, except to maintain a minimum 1 Upgrader. All of that energy is used to produce attackers. Attackers will move to the flag and attack any hostile it sees, even if not in the flag's room.

