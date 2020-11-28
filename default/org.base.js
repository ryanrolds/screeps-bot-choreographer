class OrgBase {
    constructor(parent, id) {
        this.parent = parent
        this.id = id
    }
    getID() {
        return this.id
    }
    getParent() {
        return this.parent
    }
    getKingdom() {
        return this.getParent().getColony()
    }
    getColony() {
        return this.getParent().getColony()
    }
    getRoom() {
        return this.getParent().getColony()
    }
    getStats() {
        return this.getParent().getStats()
    }
    sendRequest(topic, priority, request) {
        const parent = this.getParent()
        if (!parent) {
            return
        }

        parent.sendRequest(topic, priority, request)
    }
    getNextRequest(topic) {
        const parent = this.getParent()
        if (!parent) {
            return null
        }

        return parent.getNextRequest(topic)
    }
    getTopicLength(topic) {
        const parent = this.getParent()
        if (!parent) {
            return null
        }

        return parent.getTopicLength(topic)
    }
}

module.exports = OrgBase
