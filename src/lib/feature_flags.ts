const FLAGS = {};

export const getFlag = (key: string): boolean | null => {
  return FLAGS[key] || null;
};

export const setFlag = (key: string, value: boolean) => {
  FLAGS[key] = value;
};
