let isActive = false
let metrics = []

const reset = () => {
    metrics = []
}

const setActive = () => {
    isActive = true
}

const startTrace = (name) => {
    return {
        name,
        start: Game.cpu.getUsed(),
        begin: function(name) {
            return startTrace(`${this.name}.${name}`)
        },
        end: function() {
            if (!isActive) {
                return
            }

            const end = Game.cpu.getUsed()
            const cpuTime = end - this.start
            metrics.push({key: name, value: cpuTime})

            //console.log(`TRACE: ${name} CPUTime: ${cpuTime}`)
        }
    }
}

const report = () => {
    if (!isActive) {
        return
    }

    let total = 0
    let summary = _.reduce(metrics, (acc, timing) => {
        let metric = acc[timing.key] || {
            key: timing.key,
            total: 0,
            count: 0
        }

        metric.count++
        metric.total += timing.value

        acc[timing.key] = metric
        return acc
    }, {})

    summary = _.reduce(summary, (result, metric) => {
        result.push(metric)
        return result
    }, [])

    summary = _.sortBy(summary, (metric) => {
        return metric.total / metric.count
    })

    console.log('------- CPU Usage report --------')

    summary.reverse().forEach((metric) => {
        console.log(`* ${(metric.total / metric.count).toFixed(2)}, ${metric.count.toFixed(2)},` +
            ` ${metric.total.toFixed(2)} - ${metric.key}`)
    })
}

module.exports = {
    reset,
    setActive,
    startTrace,
    report
}
