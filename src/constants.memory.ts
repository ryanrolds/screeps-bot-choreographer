// General role memory IDs
export const MEMORY_ROLE = 'role';

// Old source memory ID (deprecated)
export const MEMORY_SOURCE = 'source';
export const MEMORY_SOURCE_ROOM = 'source_room';
export const MEMORY_SOURCE_POSITION = 'source_position';
export const MEMORY_SOURCE_CONTAINER = 'source_container';

// General movement memory IDs (use this for nearly all movement)
export const MEMORY_DESTINATION = 'destination';
export const MEMORY_DESTINATION_ROOM = 'destination_room';
export const MEMORY_DESTINATION_SHARD = 'destination_shard';
export const PATH_CACHE = 'path_cache';
export const MEMORY_DESTINATION_POS = 'destination_pos';

// Used for debugging, don't use for decision making, use MEMORY_BASE instead
export const MEMORY_ORIGIN_SHARD = 'shard';
export const MEMORY_ORIGIN = 'origin';

// Long term memory IDs
export const MEMORY_WITHDRAW = 'withdraw';
export const MEMORY_WITHDRAW_ROOM = 'withdraw_room';
export const MEMORY_DROPOFF = 'transfer';
export const MEMORY_CLAIM = 'claim';
export const MEMORY_RESERVE = 'reserve';
export const MEMORY_FLAG = 'flag';
export const MEMORY_BASE = 'base';
export const MEMORY_START_TICK = 'start_tick';
export const MEMORY_COMMUTE_DURATION = 'commute_duration';

// Assign
export const MEMORY_ASSIGN_SHARD = 'assignment_shard';
export const MEMORY_ASSIGN_ROOM = 'assignment_room';
export const MEMORY_ASSIGN_ROOM_POS = 'assignment_room_pos';

// base task
export const MEMORY_TASK_REQUESTER = 'task_requestor';
export const MEMORY_TASK_TYPE = 'task_type';
export const MEMORY_TASK_REASON = 'task_reason';
export const TASK_ID = 'task_id';
export const TASK_PHASE = 'task_phase';
export const TASK_TTL = 'task_ttl';

// haul task
export const MEMORY_HAUL_PICKUP = 'haul_pickup';
export const MEMORY_HAUL_RESOURCE = 'haul_resource';
export const MEMORY_HAUL_AMOUNT = 'haul_amount';
export const MEMORY_HAUL_DROPOFF = 'haul_dropoff';

// reactor
export const REACTOR_TASK = 'ractor_task';
export const REACTOR_TTL = 'reactor_ttl';

// terminal
export const TERMINAL_TASK = 'terminal_task';
export const TERMINAL_TASK_TYPE = 'terminal_task_type';

// buy/sell task
export const MEMORY_ORDER_TYPE = 'order_type';
export const MEMORY_ORDER_RESOURCE = 'order_resource';
export const MEMORY_ORDER_AMOUNT = 'order_amount';

// transfer task
export const TRANSFER_ROOM = 'transfer_room';
export const TRANSFER_DESTINATION = 'transfer_destination';
export const TRANSFER_RESOURCE = 'transfer_resource';
export const TRANSFER_AMOUNT = 'transfer_amount';

// boosts
export const PREPARE_BOOSTS = 'prepare_boosts';
export const DESIRED_BOOSTS = 'desired_boosts';

// Attacker
export const MEMORY_ATTACK = 'attack';
export const MEMORY_HEAL = 'heal';
export const MEMORY_POSITION_X = 'position_x';
export const MEMORY_POSITION_Y = 'position_y';
export const MEMORY_POSITION_ROOM = 'position_room';

// Reaction status
export const REACTION_STATUS_ROOM = 'reaction_room';
export const REACTION_STATUS_LAB = 'reaction_lab';
export const REACTION_STATUS_RESOURCE = 'reaction_resource';
export const REACTION_STATUS_RESOURCE_AMOUNT = 'reaction_resource_amount';
export const REACTION_STATUS_PHASE = 'reaction_status_phase';

// Room status
export const ROOM_STATUS_NAME = 'room_status_name';
export const ROOM_STATUS_LEVEL = 'room_status_level';
export const ROOM_STATUS_LEVEL_COMPLETED = 'room_status_level_completed';
export const ROOM_STATUS_ENERGY = 'room_status_energy';
export const ROOM_STATUS_ALERT_LEVEL = 'room_status_alert_level';
export const ROOM_STATUS_TERMINAL = 'room_status_terminal';

// PID Controller prefixes
export const PID_PREFIX_HAULERS = 'haulers_';

// PID Controller suffixes
export const PID_SUFFIX_P = 'pid_p';
export const PID_SUFFIX_I = 'pid_i';
export const PID_SUFFIX_D = 'pid_d';
export const PID_SUFFIX_INTEGRAL = 'pid_integral';
export const PID_SUFFIX_TIME = 'pid_time';
export const PID_SUFFIX_ERROR = 'pid_error';
export const PID_SUFFIX_SETPOINT = 'pid_setpoint';

// Room state
export const ROOM_DAMAGED_STRUCTURES_LIST = 'damaged_structure_list';
export const ROOM_DAMAGED_STRUCTURES_TIME = 'damaged_structure_time';
export const ROOM_NEEDS_ENERGY_LIST = 'needs_energy_list';
export const ROOM_NEEDS_ENERGY_TIME = 'needs_energy_time';

// Reactor tasks
export const REACTOR_TASK_TYPE = 'reactor_task_type';
export const REACTOR_INPUT_A = 'reactor_input_a';
export const REACTOR_INPUT_B = 'reactor_input_b';
export const REACTOR_OUTPUT = 'reactor_output';
export const REACTOR_AMOUNT = 'reactor_amount';

// Defense parties
export const MEMORY_DEFENSE_IN_POSITION = 'defense_in_position';
export const MEMORY_DEFENSE_PARTY = 'defense_party';

// Party
export const MEMORY_PARTY_ID = 'party_id';
export const MEMORY_PARTY_POSITION = 'party_position';

// Idle at parking lot
export const MEMORY_IDLE = 'idle';
