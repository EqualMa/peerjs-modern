import { EventEmitter } from "eventemitter3";
import type { Peer } from "../peer";
import type {
  ConnectionType,
  ServerMessageType,
  SerializationType,
  ConnectionEventType,
} from "../enums";
import type { MediaConnectionOptions } from "./media";
import type { DataConnectionOptions } from "./data";

export interface ServerMessageBase {
  type: ServerMessageType;
  payload: unknown;
  src: string;
}

interface ServerOfferMessageBase<T extends ConnectionType> {
  type: T;
  sdp: RTCSessionDescriptionInit;
  browser: string;
}
export interface ServerOfferMediaConnectionMessage
  extends MediaConnectionOptions,
    ServerOfferMessageBase<ConnectionType.Media> {
  connectionId: string;
}

export interface ServerOfferDataConnectionMessage
  extends DataConnectionOptions,
    ServerOfferMessageBase<ConnectionType.Data> {
  connectionId: string;
}

export interface ServerOfferMessage extends ServerMessageBase {
  type: ServerMessageType.Offer;
  payload: ServerOfferMediaConnectionMessage | ServerOfferDataConnectionMessage;
}

export interface ServerErrorMessage extends ServerMessageBase {
  type: ServerMessageType.Error;
  payload: {
    msg: Error | string;
  };
}

export interface ServerAnswerMessage extends ServerMessageBase {
  type: ServerMessageType.Answer;
  payload: {
    sdp: RTCSessionDescriptionInit | undefined;
  };
}

export interface ServerCandidateMessage extends ServerMessageBase {
  type: ServerMessageType.Candidate;
  payload: {
    candidate: RTCIceCandidateInit;
  };
}

export interface ServerSimpleMessage extends ServerMessageBase {
  type:
    | ServerMessageType.Open
    | ServerMessageType.IdTaken
    | ServerMessageType.InvalidKey
    | ServerMessageType.Leave
    | ServerMessageType.Expire;
}

export type ServerMessage =
  | ServerOfferMessage
  | ServerErrorMessage
  | ServerAnswerMessage
  | ServerCandidateMessage
  | ServerSimpleMessage;

export interface BaseConnectionOptions {
  connectionId?: string;
  label?: string;
  metadata?: unknown;
  serialization?: SerializationType;
  reliable?: boolean;
  constraints?: RTCOfferOptions;
  sdpTransform?: Function;
}

export abstract class BaseConnection<
  O extends BaseConnectionOptions = BaseConnectionOptions,
  E extends ConnectionEventType = ConnectionEventType
> extends EventEmitter<
  | E
  | ConnectionEventType.Close
  | ConnectionEventType.Error
  | ConnectionEventType.IceStateChanged
> {
  protected _open = false;

  readonly metadata: unknown;
  abstract connectionId: string;

  peerConnection: RTCPeerConnection | null = null;

  abstract get type(): ConnectionType;

  get open() {
    return this._open;
  }

  protected _provider: Peer | null;
  get provider(): Peer {
    if (!this._provider) throw new Error("provider is invalid");
    return this._provider;
  }

  constructor(readonly peer: string, provider: Peer, readonly options: O) {
    super();
    this._provider = provider;
    this.metadata = options.metadata;
  }

  abstract close(): void;

  abstract handleMessage(message: ServerMessage): void;
}
