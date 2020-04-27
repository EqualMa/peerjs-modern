import { EventEmitter } from "eventemitter3";
import { Peer } from "../peer";
import { ConnectionType } from "../enums";
import { BaseConnectionOptions, ServerMessage } from ".";

export abstract class BaseConnection extends EventEmitter {
  protected _open = false;

  readonly metadata: unknown;
  connectionId: string | undefined;

  peerConnection: RTCPeerConnection | null = null;

  abstract get type(): ConnectionType;

  get open() {
    return this._open;
  }

  constructor(
    readonly peer: string,
    public provider: Peer,
    readonly options: BaseConnectionOptions,
  ) {
    super();

    this.metadata = options.metadata;
  }

  abstract close(): void;

  abstract handleMessage<P = unknown>(message: ServerMessage<P>): void;
}
