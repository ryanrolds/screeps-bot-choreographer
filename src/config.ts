
export interface ColonyConfig {
  id: String;
  primary: String;
  rooms: String[];
}

export interface KingdomConfig {
  [key: string]: ColonyConfig;
}
