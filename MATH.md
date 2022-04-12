# Screeps math

Organizing my thoughts and ideas on math relationships in the game.

## Sieging

Towers:
- Attack effectiveness	600 hits at range ≤5 to 150 hits at range ≥20
- Heal effectiveness	400 hits at range ≤5 to 100 hits at range ≥20
- Repair effectiveness	800 hits at range ≤5 to 200 hits at range ≥20

RCL 3: 1 tower
RCL 5: 2 towers
RCL 7: 3 towers
RCL 8: 6 towers

Tower tanking:
* 50 parts = 600 dmg/pt / 12 heal/pt
* No boosts: 13 healing parts per creep in quad, 3250 energy for healing parts per creep
* 2x boost: 7 healing parts per creep in quad, 1750 energy for healing parts per creep
* 3x boost: 5 healing parts per creep in quad, 1250 energy for healing parts per creep
* 4x boost: 4 healing parts per creep in quad, 1000 energy for healing parts per creep

Creeps:
- ATTACK 80/energy
  - Attacks another creep/structure with 30 hits per tick in a short-ranged attack.
- RANGED_ATTACK 150/energy
  - Attacks another single creep/structure with 10 hits per tick in a long-range attack up to 3 squares long.
  - Attacks all hostile creeps/structures within 3 squares range with 1-4-10 hits (depending on the range).
- HEAL 250/energy
  - Heals self or another creep restoring 12 hits per tick in short range or 4 hits per tick at a distance.

## Max Creep energy by RCL

1. 300 energy = 1 spawner (300 energy)
2. 550 energy = 1 spawner (300) + 5 extensions @ 50 (250 energy)
3. 800 = 1 spawner (300) + 10 extensions @ 50 (500)
4. 1300 = 1 spawner (300) + 20 extensions @ 50 (1000)
5. 1800 = 1 spawner (300) + 30 extensions @ 50 (1500)
6. 2300 = 1 spawner (300) + 40 extensions @ 50 (2000)
  * Get 3 labs, can be used to boost healing making it 2x, 3x, and 4x more effective
  * Per tower, 25 heal parts @ 2x, 17 heal parts @ 3x, 13 heal parts @ 4x
  * Assertion: 4 (4x) or 5 (3x) heal parts per creep in a quad may be possible
7. 5600 = 2 spawner (600) + 50 extensions @ 100 (5000)
8. 12900 = 3 spawner (900) + 60 extensions @ 200 (12000)

## Room siege assertions

* RCL 1 can siege RCL <=2
  * Not enough energy or labs to siege a room with a tower
* RCL 2 can siege RCL <=2
  * Not enough energy or labs to siege a room with a tower
* RCL 3 can siege RCL <=2
  * Not enough energy or labs to siege a room with a tower
* RCL 4 can siege RCL <=2
  * Not enough energy or labs to siege a room with a tower
* RCL 5 can siege RCL <=2
  * Not enough energy or labs to siege a room with a tower
* RCL 6 w/ 2x boost can siege RCL <=4
  * With >=2x boosts there is enough energy to siege a room with a tower
* RCL 7 can siege RCL <=4
* RCL 7 w/ 2x boost can siege RCL <=6 (not sure about this)
  * With 2x boosts (3500 energy, 14 parts)
* RCL 7 w/ 3x boosts can siege RCL <=6
* RCL 7 w/ 4x boosts can siege RCL <=7 (not sure about this)
* RCL 8 can siege RCL <=6
  * Enough energy for 2 towers (26 parts, 6500 energy), but probably not for 3 towers (39 parts, 9750 energy)
* RCL 8 w/ 2x boost can siege RCL <=8 (not sure about this)
  * With 2x, 10500 energy (36 parts) is need for 6 towers
* RCL 8 w/ 3x boosts can siege RCL <=8
  * With 3x, 7500 energy (30 parts) is need for 6 towers
* RCL 8 w/ 4x boosts can siege RCL <=9 (not sure about this)
  * With 4x, 6000 energy (24 parts) is need for 6 towers

## Ideas

* Rooms that are attacking (yellow alert) ensure that 4x or 3x boosts are available for spawning a quad at all times
* Classify RCLs by attack and defense capabilities
  * Number of towers it can tank?
  * Attacker's room RCL required to break room?
* Probably need to redo how labs are managed to ensure that all needed boosts are readily available
