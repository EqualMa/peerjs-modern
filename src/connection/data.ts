import logger from "../logger";
import { Negotiator } from "../negotiator";
import {
  ConnectionType,
  ConnectionEventType,
  SerializationType,
  ServerMessageType,
} from "../enums";
import type { Peer } from "../peer";
import { BaseConnection, ServerMessage, BaseConnectionOptions } from "./base";
import { EncodingQueue } from "../encoding-queue";

import { randomToken } from "../util/id";
import { chunkedMTU } from "../util/constants";
import { supports } from "../util/supports";
import * as bin from "../util/binary";

type RTCDataChannelSendableData = Parameters<RTCDataChannel["send"]>[0];

export interface DataConnectionOptions extends BaseConnectionOptions {
  _payload?: DataConnectionOptions;
}

/**
 * Wraps a DataChannel between two Peers.
 */
export class DataConnection extends BaseConnection<DataConnectionOptions> {
  connectionId: string;
  private static readonly ID_PREFIX = "dc_";
  private static readonly MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024;

  private __negotiator: Negotiator<this> | null = null;
  private get _negotiator(): Negotiator<this> {
    if (!this.__negotiator) throw new Error("negotiator is invalid");
    return this.__negotiator;
  }
  readonly label: string;
  readonly serialization: SerializationType;
  readonly reliable: boolean;
  stringify: (data: unknown) => string = JSON.stringify;
  parse: <T>(data: string) => T = JSON.parse;

  get type(): ConnectionType.Data {
    return ConnectionType.Data;
  }

  private _buffer: RTCDataChannelSendableData[] = [];
  private _bufferSize = 0;
  private _buffering = false;
  private _chunkedData: {
    [id: number]: {
      data: Blob[];
      count: number;
      total: number;
    };
  } = {};

  private _dc: RTCDataChannel | null = null;
  private __encodingQueue: EncodingQueue | null = new EncodingQueue();
  private get _encodingQueue(): EncodingQueue {
    if (!this.__encodingQueue) throw new Error("_encodingQueue is invalid");
    return this.__encodingQueue;
  }

  get dataChannel(): RTCDataChannel {
    if (!this._dc)
      throw new Error("RTCDataChannel in DataConnection is invalid");
    return this._dc;
  }

  get bufferSize(): number {
    return this._bufferSize;
  }

  constructor(peerId: string, provider: Peer, options: DataConnectionOptions) {
    super(peerId, provider, options);

    this.connectionId =
      this.options.connectionId || DataConnection.ID_PREFIX + randomToken();

    this.label = this.options.label || this.connectionId;
    this.serialization = this.options.serialization || SerializationType.Binary;
    this.reliable = !!this.options.reliable;

    this._encodingQueue.on("done", (ab: ArrayBuffer) => {
      this._bufferedSend(ab);
    });

    this._encodingQueue.on("error", () => {
      logger.error(
        `DC#${this.connectionId}: Error occured in encoding from blob to arraybuffer, close DC`,
      );
      this.close();
    });

    this.__negotiator = new Negotiator(this);

    this._negotiator.startConnection(
      (this.options._payload || {
        originator: true,
      }) as never,
    );
  }

  /** Called by the Negotiator when the DataChannel is ready. */
  initialize(dc: RTCDataChannel): void {
    this._dc = dc;
    this._configureDataChannel();
  }

  private _configureDataChannel(): void {
    if (!supports.binaryBlob || supports.reliable) {
      this.dataChannel.binaryType = "arraybuffer";
    }

    this.dataChannel.onopen = () => {
      logger.log(`DC#${this.connectionId} dc connection success`);
      this._open = true;
      this.emit(ConnectionEventType.Open);
    };

    this.dataChannel.onmessage = (e) => {
      logger.log(`DC#${this.connectionId} dc onmessage:`, e.data);
      this._handleDataMessage(e);
    };

    this.dataChannel.onclose = () => {
      logger.log(`DC#${this.connectionId} dc closed for:`, this.peer);
      this.close();
    };
  }

  // Handles a DataChannel message.
  private _handleDataMessage({
    data,
  }: {
    data: Blob | ArrayBuffer | string;
  }): void {
    const datatype = data.constructor;

    const isBinarySerialization =
      this.serialization === SerializationType.Binary ||
      this.serialization === SerializationType.BinaryUTF8;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let deserializedData: any = data;

    if (isBinarySerialization) {
      if (datatype === Blob) {
        // Datatype should never be blob
        bin.blobToArrayBuffer(data as Blob, (ab) => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const unpackedData = bin.unpack(ab!);
          this.emit(ConnectionEventType.Data, unpackedData);
        });
        return;
      } else if (datatype === ArrayBuffer) {
        deserializedData = bin.unpack(data as ArrayBuffer);
      } else if (datatype === String) {
        // String fallback for binary data for browsers that don't support binary yet
        const ab = bin.binaryStringToArrayBuffer(data as string);
        deserializedData = bin.unpack(ab);
      }
    } else if (this.serialization === SerializationType.JSON) {
      deserializedData = this.parse(data as string);
    }

    // Check if we've chunked--if so, piece things back together.
    // We're guaranteed that this isn't 0.
    if (deserializedData.__peerData) {
      this._handleChunk(deserializedData);
      return;
    }

    super.emit(ConnectionEventType.Data, deserializedData);
  }

  private _handleChunk(data: {
    __peerData: number;
    n: number;
    total: number;
    data: Blob;
  }): void {
    const id = data.__peerData;
    const chunkInfo = this._chunkedData[id] || {
      data: [],
      count: 0,
      total: data.total,
    };

    chunkInfo.data[data.n] = data.data;
    chunkInfo.count++;
    this._chunkedData[id] = chunkInfo;

    if (chunkInfo.total === chunkInfo.count) {
      // Clean up before making the recursive call to `_handleDataMessage`.
      delete this._chunkedData[id];

      // We've received all the chunks--time to construct the complete data.
      const data = new Blob(chunkInfo.data);
      this._handleDataMessage({ data });
    }
  }

  /**
   * Exposed functionality for users.
   */

  /** Allows user to close connection. */
  close(): void {
    this._buffer = [];
    this._bufferSize = 0;
    this._chunkedData = {};

    if (this._negotiator) {
      this._negotiator.cleanup();
      this.__negotiator = null;
    }

    if (this.provider) {
      this.provider._removeConnection(this);

      this._provider = null;
    }

    if (this.dataChannel) {
      this.dataChannel.onopen = null;
      this.dataChannel.onmessage = null;
      this.dataChannel.onclose = null;
      this._dc = null;
    }

    if (this._encodingQueue) {
      this._encodingQueue.destroy();
      this._encodingQueue.removeAllListeners();
      this.__encodingQueue = null;
    }

    if (!this.open) {
      return;
    }

    this._open = false;

    super.emit(ConnectionEventType.Close);
  }

  /** Allows user to send data. */
  send<T>(data: T, chunked?: boolean): void {
    if (!this.open) {
      super.emit(
        ConnectionEventType.Error,
        new Error(
          "Connection is not open. You should listen for the `open` event before sending messages.",
        ),
      );
      return;
    }

    if (this.serialization === SerializationType.JSON) {
      this._bufferedSend(this.stringify(data));
    } else if (
      this.serialization === SerializationType.Binary ||
      this.serialization === SerializationType.BinaryUTF8
    ) {
      const blob = bin.pack(data);

      if (!chunked && blob.size > chunkedMTU) {
        this._sendChunks(blob);
        return;
      }

      if (!supports.binaryBlob) {
        // We only do this if we really need to (e.g. blobs are not supported),
        // because this conversion is costly.
        this._encodingQueue.enque(blob);
      } else {
        this._bufferedSend(blob);
      }
    } else {
      this._bufferedSend((data as unknown) as RTCDataChannelSendableData);
    }
  }

  private _bufferedSend(msg: RTCDataChannelSendableData): void {
    if (this._buffering || !this._trySend(msg)) {
      this._buffer.push(msg);
      this._bufferSize = this._buffer.length;
    }
  }

  // Returns true if the send succeeds.
  private _trySend(msg: RTCDataChannelSendableData): boolean {
    if (!this.open) {
      return false;
    }

    if (this.dataChannel.bufferedAmount > DataConnection.MAX_BUFFERED_AMOUNT) {
      this._buffering = true;
      setTimeout(() => {
        this._buffering = false;
        this._tryBuffer();
      }, 50);

      return false;
    }

    try {
      this.dataChannel.send(msg);
    } catch (e) {
      logger.error(`DC#:${this.connectionId} Error when sending:`, e);
      this._buffering = true;

      this.close();

      return false;
    }

    return true;
  }

  // Try to send the first message in the buffer.
  private _tryBuffer(): void {
    if (!this.open) {
      return;
    }

    if (this._buffer.length === 0) {
      return;
    }

    const msg = this._buffer[0];

    if (this._trySend(msg)) {
      this._buffer.shift();
      this._bufferSize = this._buffer.length;
      this._tryBuffer();
    }
  }

  private _sendChunks(blob: Blob): void {
    const blobs = bin.chunk(blob);
    logger.log(`DC#${this.connectionId} Try to send ${blobs.length} chunks...`);

    for (const blob of blobs) {
      this.send(blob, true);
    }
  }

  handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case ServerMessageType.Answer:
        this._negotiator.handleSDP(message.type, message.payload.sdp);
        break;
      case ServerMessageType.Candidate:
        this._negotiator.handleCandidate(message.payload.candidate);
        break;
      default:
        logger.warn(
          "Unrecognized message type:",
          message.type,
          "from peer:",
          this.peer,
        );
        break;
    }
  }
}
