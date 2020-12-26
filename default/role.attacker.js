const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')

const MEMORY = require('constants.memory')

const behavior = behaviorTree.SequenceNode(
    "attacker_root",
    [
        behaviorTree.LeafNode(
            'move_node',
            (creep) => {
                const x = creep.memory[MEMORY.MEMORY_POSITION_X]
                const y = creep.memory[MEMORY.MEMORY_POSITION_Y]
                const roomId = creep.memory[MEMORY.MEMORY_POSITION_ROOM]
                if (!x || !y || !roomId) {
                    return SUCCESS
                }

                const position = new RoomPosition(x, y, roomId)

                if (creep.pos.isEqualTo(position)) {
                    return SUCCESS
                }

                const result = creep.moveTo(position, {reusePath: 0, ignoreCreeps: true})

                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'attack_node',
            (creep) => {
                const attack = creep.memory[MEMORY.MEMORY_ATTACK]
                if (!attack) {
                    return SUCCESS
                }

                const target = Game.getObjectById(attack)
                if (!creep.pos.inRangeTo(target, 1)) {
                    return SUCCESS
                }

                const result = creep.attack(target)

                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'heal_node',
            (creep) => {
                const heal = creep.memory[MEMORY.MEMORY_HEAL]
                if (!heal) {
                    return SUCCESS
                }

                const target = Game.getObjectById(heal)
                if (!creep.pos.inRangeTo(target, 1)) {
                    return SUCCESS
                }

                const result = creep.heal(target)

                return SUCCESS
            }
        ),
    ]
)

module.exports = {
    run: (creep, trace) => {
        const roleTrace = trace.begin('attacker')

        let result = behavior.tick(creep, roleTrace)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: attacker failure", creep.name)
        }

        roleTrace.end()
    }
}
