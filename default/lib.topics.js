
class Topics {
    constructor() {
        this.topics = {}
    }
    getTopic(topic){
        if (!this.topics[topic]) {
            return null
        }

        return this.topics[topic]
    }
    createTopic(topic) {
        this.topics[topic] = []
        return this.topics[topic]
    }
    addRequest(topicID, priority, details) {
        let topic = this.getTopic(topicID)
        if (!topic) {
            topic = this.createTopic(topicID)
        }

        const request = {
            priority,
            details
        }

        console.log("topic add", topicID, priority, JSON.stringify(details))

        topic.push(request)
        this.topics[topicID] = _.sortBy(topic, 'priority')
    }
    getNextRequest(topicID) {
        const topic = this.getTopic(topicID)
        if (!topic) {
            return null
        }

        let request = topic.pop()
        return request
    }
    getLength(topicID) {
        const topic =  this.topics[topicID]

        console.log(topicID, JSON.stringify(this.topics))

        if (!topic) {
            return 0
        }

        return topic.length
    }
    getCounts() {
        return _.reduce(this.topics, (acc, topic, key) => {
            acc[key] = topic.length

            return acc
        }, {})
    }
}

module.exports = Topics
