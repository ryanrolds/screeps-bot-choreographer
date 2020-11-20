const tracing = require('lib.tracing')

const RUNNING = module.exports.RUNNING = 'running'
const SUCCESS = module.exports.SUCCESS = 'success'
const FAILURE = module.exports.FAILURE = 'failure'

module.exports.SelectorNode = (id, children) => {
    return {
        id,
        children,
        tickChildren: function(actor, trace) {
            let i = getState(actor, this.id)
            for (; i < children.length; i++) {
                //console.log("selector child", this.id, i, actor.name)
                const child = children[i]
                const result = child.tick(actor, trace)
                switch (result) {
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
        },
        tick: function(actor, trace) {
            trace = trace.begin(this.id)

            const result = this.tickChildren(actor, trace)

            trace.end()

            return result
        }
    }
}

module.exports.SequenceNode = (id, children) => {
    return {
        id, // used track state in memory
        children,
        tickChildren: function(actor, trace) {
            let i = getState(actor, this.id)
            //console.log("sequence child", this.id, i, actor.name)
            for (; i < children.length; i++) {
                let result = children[i].tick(actor, trace)
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
        },
        tick: function(actor, trace) {
            trace = trace.begin(this.id)

            const result = this.tickChildren(actor, trace)

            trace.end()

            return result
        }
    }
}

module.exports.RepeatUntilFailure = (id, node) => {
    return {
        id,
        node,
        tickNode: function(actor, trace) {
            let result = this.node.tick(actor, trace)
            if (result === FAILURE) {
                return FAILURE
            }

            return RUNNING
        },
        tick: function(actor, trace) {
            trace = trace.begin(this.id)

            const result = this.tickNode(actor, trace)

            trace.end()

            return result
        }
    }
}

module.exports.RepeatUntilSuccess = (id, node) => {
    return {
        id,
        node,
        tickNode: function(actor, trace) {
            let result = this.node.tick(actor, trace)
            if (result === SUCCESS) {
                return SUCCESS
            }

            return RUNNING
        },
        tick: function(actor, trace) {
            trace = trace.begin(this.id)

            const result = this.tickNode(actor, trace)

            trace.end()

            return result
        }
    }
}

module.exports.LeafNode = (id, behavior) => {
    return {
        id,
        behavior,
        tickNode: function(actor, trace) {
            //console.log("leaf", this.id, actor.name)

            return this.behavior(actor, trace)
        },
        tick: function(actor, trace) {
            trace = trace.begin(this.id)

            const result = this.tickNode(actor, trace)

            trace.end()

            return result
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
