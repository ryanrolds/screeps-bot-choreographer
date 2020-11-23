const Colony = require('org.colony')
const WarParty = require('org.warparty')

class Kingdom {
    constructor(colonies) {
        this.colonies = Object.values(colonies).map((colony) => {
            return new Colony(colony)
        })

        this.warParties = Object.values(Game.flags).reduce((parties, flag) => {
            if (flag.name.startsWith("attack")) {
                parties[flag.name] = new WarParty(flag)
            }

            return parties
        }, {})
    }
    tick() {
        Object.values(this.colonies).forEach((colony) => {
            colony.tick()
        })

        Object.values(this.warParties).forEach((party) => {
            party.tick()
        })
    }
}

module.exports = Kingdom
