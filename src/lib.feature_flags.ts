export const IGNORE_CREEPS = 'ignore_creeps';
export const USE_PATH_CACHE = 'use_path_cache';
export const USE_PATH_SEARCH = 'use_path_search';
export const USE_SERIALIZED_PATH = 'use_serialized_path';
export const USE_HEAP_PATH_CACHE = 'use_heap_path_cache';
export const CREEPS_USE_MANAGER = 'use_creep_manager';

const FLAGS = {
  [IGNORE_CREEPS]: false, // TODO remove
  [USE_PATH_CACHE]: true, // TODO remove
  [USE_PATH_SEARCH]: true, // TODO remove
  [USE_SERIALIZED_PATH]: false, // TODO remove
  [USE_HEAP_PATH_CACHE]: true, // TODO Remove
  [CREEPS_USE_MANAGER]: true,
};

export const getFlag = (key: string): boolean | null => {
  return FLAGS[key] || null;
};

export const setFlag = (key: string, value: boolean) => {
  FLAGS[key] = value;
};
