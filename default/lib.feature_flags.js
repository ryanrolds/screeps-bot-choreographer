const PERSISTENT_TOPICS = 'PERSISTENT_TOPICS';

const FLAGS = {
  [PERSISTENT_TOPICS]: true,
};

const getFlag = (key) => {
  return FLAGS[key] || null;
};

const setFlag = (key, value) => {
  FLAGS[key] = value;
};

module.exports = {
  [PERSISTENT_TOPICS]: PERSISTENT_TOPICS,
  getFlag,
  setFlag,
};
