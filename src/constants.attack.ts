export const ATTACK_ROOM_TTL = 100;
export enum AttackStatus {
  REQUESTED = 'requested',
  COMPLETED = 'completed',
};

export type AttackRequest = {
  status: AttackStatus;
  roomId: string;
};

export enum Phase {
  PHASE_MARSHAL = 'marshal',
  PHASE_EN_ROUTE = 'en_route',
  PHASE_ATTACK = 'attack',
};
