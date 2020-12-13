const MEMORY = require('constants.memory')

module.exports.setup = (memory, prefix, setPoint, p, i, d) => {
    if (!setPoint || !p) {
        throw new Error("set: missing setpoint or p")
    }

    memory[`${prefix}${MEMORY.PID_SUFFIX_SETPOINT}`] = setPoint
    memory[`${prefix}${MEMORY.PID_SUFFIX_P}`] = p
    memory[`${prefix}${MEMORY.PID_SUFFIX_I}`] = i || 0
    memory[`${prefix}${MEMORY.PID_SUFFIX_D}`] = d || 0
}

module.exports.update = (memory, prefix, value, time) => {
    const setPoint = memory[`${prefix}${MEMORY.PID_SUFFIX_SETPOINT}`]
    const p = memory[`${prefix}${MEMORY.PID_SUFFIX_P}`]
    const i = memory[`${prefix}${MEMORY.PID_SUFFIX_I}`] || 0
    const d = memory[`${prefix}${MEMORY.PID_SUFFIX_D}`] || 0

    console.log("pid", setPoint, p, i, d)

    if (!setPoint || !p) {
        throw new Error("update: missing setpoint or p")
    }

    const err = value - setPoint

    const prevTime = memory[`${prefix}${MEMORY.PID_SUFFIX_TIME}`] || time
    const dt = time - prevTime

    const prevIntegral = memory[`${prefix}${MEMORY.PID_SUFFIX_INTEGRAL}`] || 0
    const integral = prevIntegral + (err * dt * i)

    const prevErr = memory[`${prefix}${MEMORY.PID_SUFFIX_ERROR}`] || err

    console.log(setPoint, p, i, d, prevTime, dt, prevIntegral, integral, err, prevErr)

    let det = 0
    if (dt > 0) {
        det = -((err - prevErr) / dt)
    }

    memory[`${prefix}${MEMORY.PID_SUFFIX_ERROR}`] = err
    memory[`${prefix}${MEMORY.PID_SUFFIX_TIME}`] = time
    memory[`${prefix}${MEMORY.PID_SUFFIX_INTEGRAL}`] = integral

    return p * err + integral + d * det
}


