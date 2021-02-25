const IGNORE_CREEPS = 'ignore_creeps';
const USE_PATH_CACHE = 'use_path_cache';
const USE_PATH_SEARCH = 'use_path_search';
const USE_SERIALIZED_PATH = 'use_serialized_path';
const USE_HEAP_PATH_CACHE = 'use_heap_path_cache';

const FLAGS = {
  [IGNORE_CREEPS]: false,
  [USE_PATH_CACHE]: true,
  [USE_PATH_SEARCH]: true,
  [USE_SERIALIZED_PATH]: false,
  [USE_HEAP_PATH_CACHE]: true,
};

const getFlag = (key) => {
  return FLAGS[key] || null;
};

const setFlag = (key, value) => {
  FLAGS[key] = value;
};

module.exports = {
  IGNORE_CREEPS: IGNORE_CREEPS,
  USE_PATH_CACHE: USE_PATH_CACHE,
  USE_PATH_SEARCH: USE_PATH_SEARCH,
  USE_SERIALIZED_PATH: USE_SERIALIZED_PATH,
  USE_HEAP_PATH_CACHE: USE_HEAP_PATH_CACHE,
  getFlag,
  setFlag,
};
