const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const { MEMORY_FLAG } = require('constants.memory')

const selectSite = behaviorTree.LeafNode(
    'selectSite',
    (creep) => {
        let sites = creep.pos.findInRange(FIND_CONSTRUCTION_SITES)
        if (!sites || !sites.length) {
            return behaviorTree.FAILURE
        }

        sites = _.sortBy(sites, (site) => {
            switch (site.structureType) {
            case STRUCTURE_SPAWN:
                return 0
            case STRUCTURE_EXTENSION:
                return 1
            case STRUCTURE_STORAGE:
            case STRUCTURE_CONTAINER:
                return 1
            case STRUCTURE_TOWER:
                return 2
            case STRUCTURE_ROAD:
                return 11
            case STRUCTURE_RAMPART:
            case STRUCTURE_WALL:
                return 12
            default:
                return 10
            }
        })


        behaviorMovement.setDestination(creep, target.id, target.room.id)

        return behaviorTree.SUCCESS
    }
)

const selectSiteNearFlag = behaviorTree.LeafNode(
    'selectSiteNearFlag',
    (creep) => {
        const flagID = creep.memory[MEMORY_FLAG]
        if (!flagID) {
            return FAILURE
        }

        const flag = Game.flags[flagID]
        if (!flag) {
            return FAILURE
        }

        if (!flag.room) {
            return FAILURE
        }

        const target = flag.pos.findClosestByPath(FIND_CONSTRUCTION_SITES)
        if (!target) {
            return FAILURE
        }

        behaviorMovement.setDestination(creep, target.id, target.room.id)
        return SUCCESS
    }
)

const build = behaviorTree.LeafNode(
    'build',
    (creep) => {
        let destination = Game.getObjectById(creep.memory.destination)
        if (!destination) {
            return FAILURE
        }

        let result = creep.build(destination)
        if (result === ERR_NOT_ENOUGH_RESOURCES) {
            return SUCCESS
        }
        if (result === ERR_INVALID_TARGET) {
            return FAILURE
        }
        if (result != OK) {
            return FAILURE
        }
        if (creep.store.getUsedCapacity() === 0) {
            return SUCCESS
        }

        return RUNNING
    }
)

module.exports = {
    selectSite,
    build,
    selectSiteNearFlag
}
