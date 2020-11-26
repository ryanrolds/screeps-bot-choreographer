const Colony = require('org.colony')
const WarParty = require('org.warparty')
const OrgBase = require('org.base')
const Topics = require('lib.topics')

class Kingdom extends OrgBase {
    constructor(colonies) {
        super(null, 'kingdom')

        this.topics = new Topics()
        this.stats = {
            rooms: {},
            sources: {},
            spawns: {}
        }

        this.colonies = Object.values(colonies).map((colony) => {
            return new Colony(this, colony)
        })

        this.warParties = Object.values(Game.flags).reduce((parties, flag) => {
            if (flag.name.startsWith("attack")) {
                parties[flag.name] = new WarParty(this, flag)
            }

            return parties
        }, {})
    }
    update() {
        console.log(this)

        Object.values(this.warParties).forEach((party) => {
            party.update()
        })

        Object.values(this.colonies).forEach((colony) => {
            colony.update()
        })
    }
    process() {
        Object.values(this.warParties).forEach((party) => {
            party.process()
        })

        Object.values(this.colonies).forEach((colony) => {
            colony.process()
        })
    }
    toString() {
        return `---- Kingdom - #Colonies: ${this.colonies.length}`
    }
    // Request handling
    sendRequest(topic, priority, request) {
        this.topics.addRequest(topic, priority, request)
    }
    getNextRequest(topic) {
        return this.topics.getNextRequest(topic)
    }
    getColony() {
        throw new Error("a kingdom is not a colony")
    }
    getStats() {
        return this.stats
    }
    updateStats() {
        const stats = this.getStats()

        stats.time = Game.time

        // Collect GCL stats
        stats.gcl = {}
        stats.gcl.progress      = Game.gcl.progress;
        stats.gcl.progressTotal = Game.gcl.progressTotal;
        stats.gcl.level         = Game.gcl.level;

        // Collect CPU stats
        stats.cpu = {}
        stats.cpu.bucket        = Game.cpu.bucket;
        stats.cpu.limit         = Game.cpu.limit;
        stats.cpu.used          = Game.cpu.getUsed();

        stats.creeps = _.countBy(Game.creeps, (creep) => {
            return creep.memory.role
        })

        Memory.stats = stats
    }
}

module.exports = Kingdom
