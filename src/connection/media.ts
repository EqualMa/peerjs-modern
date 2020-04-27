import { randomToken } from "../util/id";
import logger from "../logger";
import { Negotiator } from "../negotiator";
import {
  ConnectionType,
  ConnectionEventType,
  ServerMessageType,
} from "../enums";
import type { Peer } from "../peer";
import { BaseConnection, ServerMessage, BaseConnectionOptions } from "./base";

export interface AnswerOption {
  sdpTransform?: Function;
}

export interface MediaConnectionOptions extends BaseConnectionOptions {
  _stream: MediaStream | null;
  _payload?: MediaConnectionOptions;
}
/**
 * Wraps the streaming interface between two Peers.
 */
export class MediaConnection extends BaseConnection<MediaConnectionOptions> {
  private static readonly ID_PREFIX = "mc_";

  private __negotiator: Negotiator<this> | null = null;
  private get _negotiator(): Negotiator<this> {
    if (!this.__negotiator) throw new Error("negotiator is invalid");
    return this.__negotiator;
  }
  private _localStream: MediaStream | null = null;
  private _remoteStream: MediaStream | null = null;

  connectionId: string;

  get type(): ConnectionType.Media {
    return ConnectionType.Media;
  }

  get localStream(): MediaStream {
    if (!this._localStream) throw new Error("_localStream is invalid");
    return this._localStream;
  }
  get remoteStream(): MediaStream | null {
    return this._remoteStream;
  }

  constructor(peerId: string, provider: Peer, options: MediaConnectionOptions) {
    super(peerId, provider, options);

    this._localStream = this.options._stream;
    this.connectionId =
      this.options.connectionId || MediaConnection.ID_PREFIX + randomToken();

    this.__negotiator = new Negotiator(this);

    if (this._localStream) {
      this._negotiator.startConnection({
        _stream: this._localStream,
        originator: true,
      });
    }
  }

  addStream(remoteStream: MediaStream) {
    logger.log("Receiving stream", remoteStream);

    this._remoteStream = remoteStream;
    super.emit(ConnectionEventType.Stream, remoteStream); // Should we call this `open`?
  }

  handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case ServerMessageType.Answer:
        // Forward to negotiator
        this._negotiator.handleSDP(message.type, message.payload.sdp);
        this._open = true;
        break;
      case ServerMessageType.Candidate:
        this._negotiator.handleCandidate(message.payload.candidate);
        break;
      default:
        logger.warn(
          `Unrecognized message type:${message.type} from peer:${this.peer}`,
        );
        break;
    }
  }

  answer(stream: MediaStream, options: AnswerOption = {}): void {
    if (this._localStream) {
      logger.warn(
        "Local stream already exists on this MediaConnection. Are you answering a call twice?",
      );
      return;
    }

    this._localStream = stream;

    if (options && options.sdpTransform) {
      this.options.sdpTransform = options.sdpTransform;
    }

    this._negotiator.startConnection({
      ...this.options._payload,
      _stream: stream,
    } as never);
    // Retrieve lost messages stored because PeerConnection not set up.
    const messages = this.provider._getMessages(this.connectionId);

    for (const message of messages) {
      this.handleMessage(message);
    }

    this._open = true;
  }

  /**
   * Exposed functionality for users.
   */

  /** Allows user to close connection. */
  close(): void {
    if (this._negotiator) {
      this._negotiator.cleanup();
      this.__negotiator = null;
    }

    this._localStream = null;
    this._remoteStream = null;

    if (this.provider) {
      this.provider._removeConnection(this);

      this._provider = null;
    }

    if (this.options && this.options._stream) {
      this.options._stream = null;
    }

    if (!this.open) {
      return;
    }

    this._open = false;

    super.emit(ConnectionEventType.Close);
  }
}
