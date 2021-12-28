
const MEMORY_OBJECT_TTL = 5000;

type MemoryObject = {
  id: string;
  time: number;
  value: any;
}

export const prepareMemory = () => {
  // Ensure Memory storage is ready
  if (!(Memory as any).proc) {
    (Memory as any).proc = {};
  }
}

export const removeOldMemoryObjects = () => {
  const now = Game.time;
  const memory = Memory as any;
  const proc = memory.proc;

  for (const key in proc) {
    const obj = proc[key];
    if (obj.time < now - MEMORY_OBJECT_TTL) {
      delete proc[key];
    }
  }
}

export class PersistentMemory {
  memoryId: string;

  constructor(id: string) {
    this.memoryId = id;
  }

  getMemory(): any {
    const memoryObject = (Memory as any).proc[this.memoryId] || {};
    if (!memoryObject) {
      return null;
    }

    // Don't return exceptionally old memory objects
    if (memoryObject.time < Game.time - MEMORY_OBJECT_TTL) {
      return null;
    }

    return memoryObject.value;
  }

  setMemory(value: any): void {
    (Memory as any).proc[this.memoryId] = {
      id: this.memoryId,
      time: Game.time,
      value: value
    };
  }
}
