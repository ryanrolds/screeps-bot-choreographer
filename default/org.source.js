class Source {
    constructor(source) {
        this.id = source.id
        this.gameObject = source
    }
    tick() {
        //console.log(this)
    }
    toString() {
        return `---- Source ${this.id}`
    }
}

module.exports = Source
