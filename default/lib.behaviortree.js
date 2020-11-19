const RUNNING = module.exports.RUNNING = 'running'
const SUCCESS = module.exports.SUCCESS = 'success'
const FAILURE = module.exports.FAILURE = 'failure'

module.exports.SelectorNode = (id, children) => {
    return {
        id,
        children,
        tick: function(actor) {
            let i = getState(actor, this.id)

            //console.log("selector child", this.id, i, actor.name)

            for (; i < children.length; i++) {
                switch (children[i].tick(actor)) {
                case RUNNING:
                    setState(actor, this.id, i)
                    return RUNNING
                case FAILURE:
                    continue
                case SUCCESS:
                    return SUCCESS
                }
            }

            return FAILURE
        }
    }
}

module.exports.SequenceNode = (id, children) => {
    return {
        id, // used track state in memory
        children,
        tick: function(actor) {
            let i = getState(actor, this.id)

            //console.log("sequence child", this.id, i, actor.name)

            for (; i < children.length; i++) {
                let result = children[i].tick(actor)
                switch (result) {
                case RUNNING:
                    setState(actor, this.id, i)
                    return RUNNING
                case FAILURE:
                    return FAILURE;
                case SUCCESS:
                    continue
                }
            }

            return SUCCESS
        }
    }
}

module.exports.RepeatUntilFailure = (id, node) => {
    return {
        id,
        node,
        tick: function(actor) {
            let result = this.node.tick(actor)
            if (result === FAILURE) {
                return FAILURE
            }

            return RUNNING
        }
    }
}

module.exports.RepeatUntilSuccess = (id, node) => {
    return {
        id,
        node,
        tick: function(actor) {
            let result = this.node.tick(actor)
            if (result === SUCCESS) {
                return SUCCESS
            }

            return RUNNING
        }
    }
}

module.exports.LeafNode = (id, behavior) => {
    return {
        id,
        behavior,
        tick: function(actor) {
            //console.log("leaf", this.id, actor.name)

            return this.behavior(actor)
        }
    }
}

function getState(actor, id) {
    let i = 0;

    if (actor.memory[id]) {
        i = actor.memory[id]
    }

    //console.log("getting state", actor, id, i)

    delete actor.memory[id]

    return i
}

function setState(actor, id, value) {
    //console.log("setting state", actor, id, value)
    actor.memory[id] = value
}
