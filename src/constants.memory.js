// General role memory IDs
module.exports.MEMORY_ROLE = 'role';

// Old source memory ID (deprecated)
module.exports.MEMORY_SOURCE = 'source';
module.exports.MEMORY_SOURCE_ROOM = 'source';

// General movement memory IDs (use this for nearly all movement)
module.exports.MEMORY_DESTINATION = 'destination';
module.exports.MEMORY_DESTINATION_ROOM = 'destination_room';
module.exports.MEMORY_DESTINATION_SHARD = 'destination_shard';
module.exports.PATH_CACHE = 'path_cache';
module.exports.MEMORY_DESTINATION_POS = 'destination_pos';

// Long term memory IDs
module.exports.MEMORY_HARVEST = 'harvest';
module.exports.MEMORY_HARVEST_CONTAINER = 'harvest_container';
module.exports.MEMORY_HARVEST_ROOM = 'harvest_room';
module.exports.MEMORY_WITHDRAW = 'withdraw';
module.exports.MEMORY_WITHDRAW_ROOM = 'withdraw_room';
module.exports.MEMORY_DROPOFF = 'transfer';
module.exports.MEMORY_CLAIM = 'claim';
module.exports.MEMORY_RESERVE = 'reserve';
module.exports.MEMORY_ORIGIN_SHARD = 'shard';
module.exports.MEMORY_ORIGIN = 'origin';
module.exports.MEMORY_FLAG = 'flag';
module.exports.MEMORY_COLONY = 'colony';
module.exports.MEMORY_START_TICK = 'start_tick';
module.exports.MEMORY_COMMUTE_DURATION = 'commute_duration';

// Assign
module.exports.MEMORY_ASSIGN_SHARD = 'assignment_shard';
module.exports.MEMORY_ASSIGN_ROOM = 'assignment_room';
module.exports.MEMORY_ASSIGN_SHARD = 'assignment_shard';
module.exports.MEMORY_ASSIGN_ROOM_POS = 'assignment_room_pos';

// base task
module.exports.MEMORY_TASK_REQUESTER = 'task_requestor';
module.exports.MEMORY_TASK_TYPE = 'task_type';
module.exports.MEMORY_TASK_REASON = 'task_reason';
module.exports.TASK_ID = 'task_id';
module.exports.TASK_PHASE = 'task_phase';
module.exports.TASK_TTL = 'task_ttl';

// haul task
module.exports.MEMORY_HAUL_PICKUP = 'haul_pickup';
module.exports.MEMORY_HAUL_RESOURCE = 'haul_resource';
module.exports.MEMORY_HAUL_AMOUNT = 'haul_amount';
module.exports.MEMORY_HAUL_DROPOFF = 'haul_dropoff';

// reactor
module.exports.REACTOR_TASK = 'ractor_task';
module.exports.REACTOR_TTL = 'reactor_ttl';

// terminal
module.exports.TERMINAL_TASK = 'terminal_task';
module.exports.TERMINAL_TASK_TYPE = 'terminal_task_type';

// buy/sell task
module.exports.MEMORY_ORDER_TYPE = 'order_type';
module.exports.MEMORY_ORDER_RESOURCE = 'order_resource';
module.exports.MEMORY_ORDER_AMOUNT = 'order_amount';

// transfer task
module.exports.TRANSFER_ROOM = 'transfer_room';
module.exports.TRANSFER_DESTINATION = 'transfer_destination';
module.exports.TRANSFER_RESOURCE = 'transfer_resource';
module.exports.TRANSFER_AMOUNT = 'transfer_amount';

// boosts
module.exports.PREPARE_BOOSTS = 'prepare_boosts';
module.exports.DESIRED_BOOSTS = 'desired_boosts';

// Attacker
module.exports.MEMORY_ATTACK = 'attack';
module.exports.MEMORY_HEAL = 'heal';
module.exports.MEMORY_POSITION_X = 'position_x';
module.exports.MEMORY_POSITION_Y = 'position_y';
module.exports.MEMORY_POSITION_ROOM = 'position_room';

// PID Controller prefixes
module.exports.PID_PREFIX_HAULERS = 'haulers_';

// PID Controller suffixes
module.exports.PID_SUFFIX_P = 'pid_p';
module.exports.PID_SUFFIX_I = 'pid_i';
module.exports.PID_SUFFIX_D = 'pid_d';
module.exports.PID_SUFFIX_INTEGRAL = 'pid_integral';
module.exports.PID_SUFFIX_TIME = 'pid_time';
module.exports.PID_SUFFIX_ERROR = 'pid_error';
module.exports.PID_SUFFIX_SETPOINT = 'pid_setpoint';

// Room state
module.exports.ROOM_DAMAGED_STRUCTURES_LIST = 'damaged_structure_list';
module.exports.ROOM_DAMAGED_STRUCTURES_TIME = 'damaged_structure_time';
module.exports.ROOM_NEEDS_ENERGY_LIST = 'needs_energy_list';
module.exports.ROOM_NEEDS_ENERGY_TIME = 'needs_energy_time';

// Reactor tasks
module.exports.REACTOR_TASK_TYPE = 'reactor_task_type';
module.exports.REACTOR_INPUT_A = 'reactor_input_a';
module.exports.REACTOR_INPUT_B = 'reactor_input_b';
module.exports.REACTOR_OUTPUT = 'reactor_output';
module.exports.REACTOR_AMOUNT = 'reactor_amount';

// Defense parties
module.exports.MEMORY_DEFENSE_IN_POSITION = 'defense_in_position';
module.exports.MEMORY_DEFENSE_PARTY = 'defense_party';
