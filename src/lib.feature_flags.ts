export const IGNORE_CREEPS = 'ignore_creeps';
export const USE_PATH_CACHE = 'use_path_cache';
export const USE_PATH_SEARCH = 'use_path_search';
export const USE_SERIALIZED_PATH = 'use_serialized_path';
export const USE_HEAP_PATH_CACHE = 'use_heap_path_cache';

const FLAGS = {
  [IGNORE_CREEPS]: false,
  [USE_PATH_CACHE]: true,
  [USE_PATH_SEARCH]: true,
  [USE_SERIALIZED_PATH]: false,
  [USE_HEAP_PATH_CACHE]: true,
};

export const getFlag = (key: string): boolean | null => {
  return FLAGS[key] || null;
};

export const setFlag = (key: string, value: boolean) => {
  FLAGS[key] = value;
};
