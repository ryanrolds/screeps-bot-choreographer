const OrgBase = require('org.base')

class Tower extends OrgBase {
    constructor(parent, tower) {
        super(parent, tower.id)

        this.gameObject = tower

        // TODO port tower logic over
    }
    update() {
        console.log(this)
    }
    process() {

    }
    toString() {
        return `---- Tower - ID: ${this.id}`
    }
}

module.exports = Tower
