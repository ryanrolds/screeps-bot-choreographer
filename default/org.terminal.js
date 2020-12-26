const OrgBase = require('org.base')
const TOPICS = require('constants.topics')
const MEMORY = require('constants.memory')
const TASKS = require('constants.tasks')
const PRIORITIES = require('constants.priorities')

class Terminal extends OrgBase {
    constructor(parent, terminal) {
        super(parent, terminal.id)

        this.terminal = terminal
        this.room = parent.getRoomObject()
    }
    update() {
        console.log(this)

        const task = this.room.memory[MEMORY.TERMINAL_TASK]

        console.log(this.getRoom().getAmountInReserve(RESOURCE_ENERGY), task)
        if (task) {
            const details = task.details
            console.log("have", this.id, task.details[MEMORY.TERMINAL_TASK_TYPE], JSON.stringify(task))

            switch(task.details[MEMORY.TERMINAL_TASK_TYPE]) {
                case TASKS.TASK_TRANSFER:
                    this.transferResource(details)
                    break
                case TASKS.TASK_MARKET_ORDER:
                    //this.marketOrder(details)
                    break
            }
        } else {
            console.log(this.getRoom().getAmountInReserve(RESOURCE_ENERGY))

            if (this.getRoom().getAmountInReserve(RESOURCE_ENERGY) < 2000) {
                const reserve = this.getRoom().getReserveStructureWithRoomForResource(RESOURCE_ENERGY)
                if (!reserve) {
                    return
                }

                const details = {
                    [MEMORY.MEMORY_TASK_TYPE]:  TASKS.HAUL_TASK,
                    [MEMORY.MEMORY_HAUL_PICKUP]: this.terminal.id,
                    [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
                    [MEMORY.MEMORY_HAUL_AMOUNT]: 1000,
                    [MEMORY.MEMORY_HAUL_DROPOFF]: reserve.id
                }

                console.log("terminal resource send", JSON.stringify(details))

                this.sendRequest(TOPICS.TOPIC_HAUL_TASK, 1, details)

            }
        }
    }
    process() {
        //console.log(JSON.stringify(this.terminal))

        if (!this.room.memory[MEMORY.TERMINAL_TASK]) {
            const task = this.getNextRequest(TOPICS.TOPIC_TERMINAL_TASK)
            if (task) {
                //console.log("got", this.id, JSON.stringify(task))
                this.room.memory[MEMORY.TERMINAL_TASK] = task
            }
        }
    }
    transferResource(task) {

    }
    marketOrder(task) {
        const orderType = task[MEMORY.MEMORY_ORDER_TYPE]
        const resource = task[MEMORY.MEMORY_ORDER_RESOURCE]
        const amount = task[MEMORY.MEMORY_ORDER_AMOUNT]

        if (this.terminal.store.getUsedCapacity(resource) < amount) {
            const reserve = this.getRoom().getReserveStructureWithMostOfAResource(resource)
            if (!reserve) {
                return
            }

            const details = {
                [MEMORY.MEMORY_TASK_TYPE]:  TASKS.HAUL_TASK,
                [MEMORY.MEMORY_HAUL_PICKUP]: reserve.id,
                [MEMORY.MEMORY_HAUL_RESOURCE]: resource,
                [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
                [MEMORY.MEMORY_HAUL_DROPOFF]: this.terminal.id
            }

            console.log("terminal resource haul", JSON.stringify(details))

            this.sendRequest(TOPICS.TOPIC_HAUL_TASK, 1, details)

            return
        }

        let marketOrderType = null
        if (orderType === ORDER_SELL) {
            marketOrderType = ORDER_BUY
        } else if(orderType === ORDER_BUY) {
            marketOrderType = ORDER_SELL
        }

        let orders = Game.market.getAllOrders({type: marketOrderType, resourceType: resource})
        if (!orders.length) {
            console.log("Market - no orders for", orderType, resource, amount)
            return
        }

        orders = _.sortBy(orders, 'price').reverse()
        console.log("orders", JSON.stringify(orders))
        const order = orders[0]

        const dealAmount = Math.min(amount, order.remainingAmount)
        const energyRequired = Game.market.calcTransactionCost(dealAmount, this.room.name, order.roomName)
        console.log("energy required", energyRequired, dealAmount, this.room.name, order.roomName)

        if (this.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < energyRequired) {
            const reserve = this.parent.getRoom().getReserveStructureWithMostOfAResource(resource)

            const details = {
                [MEMORY.MEMORY_TASK_TYPE]:  TASKS.HAUL_TASK,
                [MEMORY.MEMORY_HAUL_PICKUP]: reserve.id,
                [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
                [MEMORY.MEMORY_HAUL_AMOUNT]: energyRequired,
                [MEMORY.MEMORY_HAUL_DROPOFF]: this.terminal.id
            }

            console.log("terminal energy haul", JSON.stringify(details))

            this.sendRequest(TOPICS.TOPIC_HAUL_TASK, 1, details)

            return
        }

        if (this.terminal.cooldown) {
            return
        }

        let result = Game.market.deal(order.id, dealAmount, this.room.name)
        console.log("deal", result)

        if (result == OK) {

        }
    }
    toString() {
        return `-- Terminal`
    }
    updateStats() {
        const stats = this.getStats()
    }
}

module.exports = Terminal
