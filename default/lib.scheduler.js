
const doEvery = (ttl, memory, key) => (action) => {
  let lastCall = 0;

  if (memory && key) {
    lastCall = memory[key] || 0;
  }

  const tick = function(...args) {
    if (lastCall + ttl <= Game.time) {
      lastCall = Game.time;

      if (memory && key) {
        memory[key] = lastCall;
      }

      return action(...args);
    }

    return null;
  };

  tick.reset = () => {
    lastCall = 0;
  };

  return tick;
};

module.exports = {
  doEvery,
};
