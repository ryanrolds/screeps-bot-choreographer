const DO_NOT_RESET_TOPICS_EACH_TICK = 'DO_NOT_RESET_TOPICS_EACH_TICK';

const FLAGS = {
  [DO_NOT_RESET_TOPICS_EACH_TICK]: false,
};

const getFlag = (key) => {
  return FLAGS[key] || null;
};

const setFlag = (key, value) => {
  FLAGS[key] = value;
};

module.exports = {
  [DO_NOT_RESET_TOPICS_EACH_TICK]: DO_NOT_RESET_TOPICS_EACH_TICK,
  getFlag,
  setFlag,
};
