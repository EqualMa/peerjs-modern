import { ServerMessageType } from "../enums";

export * from "./data";
export * from "./media";

export interface ServerMessage<P = unknown> {
  type: ServerMessageType;
  payload: P;
  src: string;
}

export interface BaseConnectionOptions {
  label?: string;
  metadata?: unknown;
  serialization?: string;
  reliable?: boolean;
}
