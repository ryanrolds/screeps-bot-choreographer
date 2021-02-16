const IGNORE_CREEPS = 'ignore_creeps';

const FLAGS = {
  [IGNORE_CREEPS]: false,
};

const getFlag = (key) => {
  return FLAGS[key] || null;
};

const setFlag = (key, value) => {
  FLAGS[key] = value;
};

module.exports = {
  [IGNORE_CREEPS]: IGNORE_CREEPS,
  getFlag,
  setFlag,
};
