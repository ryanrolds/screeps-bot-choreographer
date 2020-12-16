// General role memory IDs
const MEMORY_ROLE = module.exports.MEMORY_ROLE = 'role'

// Old source memory ID (deprecated)
const MEMORY_SOURCE = module.exports.MEMORY_SOURCE = 'source'
const MEMORY_SOURCE_ROOM = module.exports.MEMORY_SOURCE_ROOM = 'source'

// General movement memory IDs (use this for nearly all movement)
const MEMORY_DESTINATION = module.exports.MEMORY_DESTINATION = 'destination'
const MEMORY_DESTINATION_ROOM = module.exports.MEMORY_DESTINATION_ROOM = 'destination_room'

// Long term memory IDs
const MEMORY_HARVEST = module.exports.MEMORY_HARVEST = 'harvest'
const MEMORY_HARVEST_CONTAINER = module.exports.MEMORY_HARVEST_CONTAINER = 'harvest_container'
const MEMORY_HARVEST_ROOM = module.exports.MEMORY_HARVEST_ROOM = 'harvest_room'
const MEMORY_WITHDRAW = module.exports.MEMORY_WITHDRAW = 'withdraw'
const MEMORY_WITHDRAW_ROOM = module.exports.MEMORY_WITHDRAW_ROOM = 'withdraw_room'
const MEMORY_TRANSFER = module.exports.MEMORY_DROPOFF = 'transfer'
const MEMORY_CLAIM = module.exports.MEMORY_CLAIM = 'claim'
const MEMORY_RESERVE = module.exports.MEMORY_RESERVE = 'reserve'
const MEMORY_ORIGIN = module.exports.MEMORY_ORIGIN = 'origin'
const MEMORY_FLAG = module.exports.MEMORY_FLAG = 'flag'
const MEMORY_ASSIGN_ROOM = module.exports.MEMORY_ASSIGN_ROOM = 'assignment_room'
const MEMORY_COLONY = module.exports.MEMORY_COLONY = 'colony'
module.exports.MEMORY_START_TICK = 'start_tick'
module.exports.MEMORY_COMMUTE_DURATION = 'commute_duration'

// V3 - base task
const MEMORY_TASK_REQUESTER = module.exports.MEMORY_TASK_REQUESTER = 'task_requestor'
const MEMORY_TASK_TYPE = module.exports.MEMORY_TASK_TYPE = 'task_type'
const MEMORY_TASK_REASON = module.exports.MEMORY_TASK_REASON = 'task_reason'

// V3 - haul task
const MEMORY_HAUL_PICKUP = module.exports.MEMORY_HAUL_PICKUP = 'haul_pickup'
const MEMORY_HAUL_RESOURCE = module.exports.MEMORY_HAUL_RESOURCE = 'haul_resource'
const MEMORY_HAUL_DROPOFF = module.exports.MEMORY_HAUL_DROPOFF = 'haul_dropoff'

// Attacker
module.exports.MEMORY_ATTACK = 'attack'
module.exports.MEMORY_HEAL = 'heal'
module.exports.MEMORY_POSITION_X = 'position_x'
module.exports.MEMORY_POSITION_Y = 'position_y'
module.exports.MEMORY_POSITION_ROOM = 'position_room'

// PID Controller prefixes
module.exports.PID_PREFIX_HAULERS = 'haulers_'

// PID Controller suffixes
module.exports.PID_SUFFIX_P = 'pid_p'
module.exports.PID_SUFFIX_I = 'pid_i'
module.exports.PID_SUFFIX_D = 'pid_d'
module.exports.PID_SUFFIX_INTEGRAL = 'pid_integral'
module.exports.PID_SUFFIX_TIME = 'pid_time'
module.exports.PID_SUFFIX_ERROR = 'pid_error'
module.exports.PID_SUFFIX_SETPOINT = 'pid_setpoint'
