const OrgBase = require('org.base')

const MEMORY = require('constants.memory')
const { TOPIC_ROOM_LINKS } = require('constants.topics')
const { WORKER_HAULER, WORKER_REMOTE_HARVESTER, WORKER_MINER,
    WORKER_HARVESTER, WORKER_REMOTE_MINER, WORKER_REMOTE_HAULER } = require('constants.creeps')
const { PRIORITY_HARVESTER, PRIORITY_MINER, PRIORITY_HAULER, PRIORITY_REMOTE_HAULER,
    PRIORITY_REMOTE_MINER } = require('constants.priorities')

class Link extends OrgBase {
    constructor(parent, link) {
        super(parent, link.id)

        this.gameObject = link

        this.fullness = link.store.getUsedCapacity(RESOURCE_ENERGY) / link.store.getCapacity(RESOURCE_ENERGY)

        this.isNearRC = link.pos.findInRange(FIND_MY_STRUCTURES, 5, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_CONTROLLER
            }
        }).length > 0
        this.isNearStorage = link.pos.findInRange(FIND_MY_STRUCTURES, 2, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_STORAGE
            }
        }).length > 0
        this.isNearSource = link.pos.findInRange(FIND_SOURCES, 2).length > 0
    }
    update() {
        console.log(this)

        if ((this.isNearRC || this.isNearStorage) && this.fullness < 0.97) {
            // Request enough energy to fill
            this.sendRequest(TOPIC_ROOM_LINKS, this.fullness, {
                REQUESTER_ID: this.id,
                REQUESTER_ROOM: this.gameObject.room.id,
                AMOUNT: this.gameObject.store.getFreeCapacity()
            })
        }
    }
    process() {
        // If near source or storage and has at least 50%
        if (this.isNearStorage && this.fullness > 0.03) {
            // Check requests
            const request = this.getNextRequest(TOPIC_ROOM_LINKS)
            if (request && request.details.REQUESTER_ID != this.id) {
                const requester = Game.getObjectById(request.details.REQUESTER_ID)
                this.gameObject.transferEnergy(requester, request.details.AMOUNT)
            }
        }
    }
    toString() {
        return `---- Link - ID: ${this.id}, NearStorage: ${this.isNearStorage}, ` +
            `NearSource: ${this.isNearSource}, NearRC: ${this.isNearRC}, Fullness: ${this.fullness}`
    }
}

module.exports = Link
