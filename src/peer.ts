import { EventEmitter } from "eventemitter3";
import logger, { LogLevel } from "./logger";
import { Socket } from "./socket";
import {
  MediaConnection,
  DataConnection,
  BaseConnection,
  ServerMessage,
} from "./connection";
import {
  ConnectionType,
  PeerErrorType,
  PeerEventType,
  SocketEventType,
  ServerMessageType,
  SerializationType,
} from "./enums";
import { API } from "./api";
import { randomToken, validateId } from "./util/id";
import { supports } from "./util/supports";
import * as c from "./util/constants";
import { isSecure } from "./util/secure";

export interface PeerConnectOptions {
  label?: string;
  metadata?: unknown;
  serialization?: SerializationType;
  reliable?: boolean;
}

export interface CallOptions {
  metadata?: unknown;
  sdpTransform?: Function;
}

export interface AnswerOptions {
  sdpTransform?: Function;
}

export interface PeerOptions {
  key: string;
  host: string;
  port: number;
  path: string;
  secure: boolean;
  config: RTCConfiguration;
  /** 1: Errors, 2: Warnings, 3: All logs */
  debug: LogLevel;
  token: string;
  pingInterval?: number;
  logFunction?: (logLevel: LogLevel, ...rest: unknown[]) => void;
}

const PEER_DEFAULT_KEY = "peerjs";

function normalizePeerOptions(opts: Partial<PeerOptions> = {}): PeerOptions {
  // Detect relative URL host.
  let host: string = opts.host || c.CLOUD_HOST;
  if (host === "/") host = window.location.hostname;

  let path = "/";
  // Set path correctly.
  if (opts.path) {
    path = opts.path;
    if (!path.startsWith("/")) path = "/" + path;
    if (!opts.path.endsWith("/")) path = path + "/";
  }

  // Set whether we use SSL to same as current host
  const secure: boolean =
    opts.secure === undefined && host !== c.CLOUD_HOST
      ? isSecure()
      : host === c.CLOUD_HOST;

  return {
    debug: opts.debug || LogLevel.Disabled,
    host,
    port: opts.port || c.CLOUD_PORT,
    path,
    key: opts.key || PEER_DEFAULT_KEY,
    token: opts.token || randomToken(),
    config: opts.config || c.defaultConfig,
    logFunction: undefined,
    secure,
    pingInterval: opts.pingInterval,
  };
}

/**
 * A peer who can initiate connections with other peers.
 */
export class Peer extends EventEmitter {
  private readonly _options: PeerOptions;
  private readonly _api: API;
  private readonly _socket: Socket;

  private _id: string | null = null;
  private __lastServerId: string | null = null;
  private get _lastServerId(): string {
    if (!this.__lastServerId)
      throw new Error("_lastServerId is not a valid string");
    return this.__lastServerId;
  }

  // States.
  private _destroyed = false; // Connections have been killed
  private _disconnected = false; // Connection to PeerServer killed but P2P connections still active
  private _open = false; // Sockets and such are not yet open.
  private readonly _connections: Map<string, BaseConnection[]> = new Map(); // All connections for this peer.
  private readonly _lostMessages: Map<string, ServerMessage[]> = new Map(); // src => [list of messages]

  get id() {
    return this._id;
  }

  get options() {
    return this._options;
  }

  get open() {
    return this._open;
  }

  get socket() {
    return this._socket;
  }

  /**
   * @deprecated
   * Return type will change from Object to Map<string,[]>
   */
  get connections(): Record<string, BaseConnection> {
    const plainConnections = Object.create(null);

    for (const [k, v] of this._connections) {
      plainConnections[k] = v;
    }

    return plainConnections;
  }

  get destroyed() {
    return this._destroyed;
  }
  get disconnected() {
    return this._disconnected;
  }

  constructor(id?: string, options?: Partial<PeerOptions>);
  constructor(options?: Partial<PeerOptions>);
  constructor(
    id?: string | Partial<PeerOptions>,
    options?: Partial<PeerOptions>,
  ) {
    super();

    let userId: string | undefined;

    // Deal with overloading
    if (id && typeof id === "object") {
      options = id;
    } else if (id) {
      userId = id.toString();
    }

    // Configurize options
    const opts = normalizePeerOptions(options);
    this._options = opts;

    // Set a custom log function if present
    if (opts.logFunction) {
      logger.setLogFunction(opts.logFunction);
    }
    logger.logLevel = opts.debug;

    this._api = new API({
      host: opts.host,
      key: opts.key,
      path: opts.path,
      port: opts.port,
      secure: opts.secure,
    });

    this._socket = this._createServerConnection();

    // Sanity checks
    // Ensure WebRTC supported
    if (!supports.audioVideo && !supports.data) {
      this._delayedAbort(
        PeerErrorType.BrowserIncompatible,
        "The current browser does not support WebRTC",
      );
      return;
    }

    // Ensure alphanumeric id
    if (!!userId && !validateId(userId)) {
      this._delayedAbort(PeerErrorType.InvalidID, `ID "${userId}" is invalid`);
      return;
    }

    if (userId) {
      this._initialize(userId);
    } else {
      this._api
        .retrieveId()
        .then((id) => this._initialize(id))
        .catch((error) => this._abort(PeerErrorType.ServerError, error));
    }
  }

  private _createServerConnection(): Socket {
    const socket = new Socket(
      this._options.secure,
      this._options.host,
      this._options.port,
      this._options.path,
      this._options.key,
      this._options.pingInterval,
    );

    socket.on(SocketEventType.Message, (data: ServerMessage) => {
      this._handleMessage(data);
    });

    socket.on(SocketEventType.Error, (error: string) => {
      this._abort(PeerErrorType.SocketError, error);
    });

    socket.on(SocketEventType.Disconnected, () => {
      if (this.disconnected) {
        return;
      }

      this.emitError(PeerErrorType.Network, "Lost connection to server.");
      this.disconnect();
    });

    socket.on(SocketEventType.Close, () => {
      if (this.disconnected) {
        return;
      }

      this._abort(
        PeerErrorType.SocketClosed,
        "Underlying socket is already closed.",
      );
    });

    return socket;
  }

  /** Initialize a connection with the server. */
  private _initialize(id: string): void {
    this._id = id;
    this.socket.start(id, this._options.token);
  }

  /** Handles messages from the server. */
  private _handleMessage(message: ServerMessage): void {
    const peerId = message.src;

    switch (message.type) {
      case ServerMessageType.Open: // The connection to the server is open.
        this.__lastServerId = this.id;
        this._open = true;
        this.emit(PeerEventType.Open, this.id);
        break;
      case ServerMessageType.Error: // Server error.
        this._abort(PeerErrorType.ServerError, message.payload.msg);
        break;
      case ServerMessageType.IdTaken: // The selected ID is taken.
        this._abort(PeerErrorType.UnavailableID, `ID "${this.id}" is taken`);
        break;
      case ServerMessageType.InvalidKey: // The given API key cannot be found.
        this._abort(
          PeerErrorType.InvalidKey,
          `API KEY "${this._options.key}" is invalid`,
        );
        break;
      case ServerMessageType.Leave: // Another peer has closed its connection to this peer.
        logger.log(`Received leave message from ${peerId}`);
        this._cleanupPeer(peerId);
        this._connections.delete(peerId);
        break;
      case ServerMessageType.Expire: // The offer sent to a peer has expired without response.
        this.emitError(
          PeerErrorType.PeerUnavailable,
          `Could not connect to peer ${peerId}`,
        );
        break;
      case ServerMessageType.Offer: {
        const payload = message.payload;
        // we should consider switching this to CALL/CONNECT, but this is the least breaking option.
        const connectionId = payload.connectionId;
        let connection = this.getConnection(peerId, connectionId);

        if (connection) {
          connection.close();
          logger.warn(
            `Offer received for existing Connection ID:${connectionId}`,
          );
        }

        // Create a new connection.
        if (payload.type === ConnectionType.Media) {
          connection = new MediaConnection(peerId, this, {
            connectionId: connectionId,
            _payload: payload,
            _stream: null,
            metadata: payload.metadata,
          });
          this._addConnection(peerId, connection);
          this.emit(PeerEventType.Call, connection);
        } else if (payload.type === ConnectionType.Data) {
          connection = new DataConnection(peerId, this, {
            connectionId: connectionId,
            _payload: payload,
            metadata: payload.metadata,
            label: payload.label,
            serialization: payload.serialization,
            reliable: payload.reliable,
          });
          this._addConnection(peerId, connection);
          this.emit(PeerEventType.Connection, connection);
        } else {
          logger.warn(`Received malformed connection type:${payload["type"]}`);
          return;
        }

        // Find messages.
        const messages = this._getMessages(connectionId);
        for (const message of messages) {
          connection.handleMessage(message);
        }

        break;
      }
      default: {
        // TODO need stricter
        const payload = message["payload"];
        const type = message["type"];
        if (!payload) {
          logger.warn(
            `You received a malformed message from ${peerId} of type ${type}`,
          );
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const connectionId = (payload as any).connectionId;
        const connection = this.getConnection(peerId, connectionId);

        if (connection && connection.peerConnection) {
          // Pass it on.
          connection.handleMessage(message);
        } else if (connectionId) {
          // Store for possible later use
          this._storeMessage(connectionId, message);
        } else {
          logger.warn("You received an unrecognized message:", message);
        }
        break;
      }
    }
  }

  /** Stores messages without a set up connection, to be claimed later. */
  private _storeMessage(connectionId: string, message: ServerMessage): void {
    let msgs = this._lostMessages.get(connectionId);
    if (!msgs) {
      msgs = [];
      this._lostMessages.set(connectionId, msgs);
    }
    msgs.push(message);
  }

  /** Retrieve messages from lost message store */
  //TODO Change it to private
  public _getMessages(connectionId: string): ServerMessage[] {
    const messages = this._lostMessages.get(connectionId);

    if (messages) {
      this._lostMessages.delete(connectionId);
      return messages;
    }

    return [];
  }

  /**
   * Returns a DataConnection to the specified peer. See documentation for a
   * complete list of options.
   */
  connect(
    peer: string,
    options: PeerConnectOptions = {},
  ): DataConnection | undefined {
    if (this.disconnected) {
      logger.warn(
        "You cannot connect to a new Peer because you called " +
          ".disconnect() on this Peer and ended your connection with the " +
          "server. You can create a new Peer to reconnect, or call reconnect " +
          "on this peer if you believe its ID to still be available.",
      );
      this.emitError(
        PeerErrorType.Disconnected,
        "Cannot connect to new Peer after disconnecting from server.",
      );
      return;
    }

    const dataConnection = new DataConnection(peer, this, options);
    this._addConnection(peer, dataConnection);
    return dataConnection;
  }

  /**
   * Returns a MediaConnection to the specified peer. See documentation for a
   * complete list of options.
   */
  call(
    peer: string,
    stream: MediaStream,
    options: CallOptions = {},
  ): MediaConnection | undefined {
    if (this.disconnected) {
      logger.warn(
        "You cannot connect to a new Peer because you called " +
          ".disconnect() on this Peer and ended your connection with the " +
          "server. You can create a new Peer to reconnect.",
      );
      this.emitError(
        PeerErrorType.Disconnected,
        "Cannot connect to new Peer after disconnecting from server.",
      );
      return;
    }

    if (!stream) {
      logger.error(
        "To call a peer, you must provide a stream from your browser's `getUserMedia`.",
      );
      return;
    }

    const mediaConnection = new MediaConnection(peer, this, {
      ...options, // TODO stricter
      _stream: stream,
    });
    this._addConnection(peer, mediaConnection);
    return mediaConnection;
  }

  /** Add a data/media connection to this peer. */
  private _addConnection(peerId: string, connection: BaseConnection): void {
    logger.log(
      `add connection ${connection.type}:${connection.connectionId} to peerId:${peerId}`,
    );

    let conns = this._connections.get(peerId);
    if (!conns) {
      conns = [];
      this._connections.set(peerId, conns);
    }
    conns.push(connection);
  }

  //TODO should be private
  _removeConnection(connection: BaseConnection): void {
    const connections = this._connections.get(connection.peer);

    if (connections) {
      const index = connections.indexOf(connection);

      if (index !== -1) {
        connections.splice(index, 1);
      }
    }

    //remove from lost messages
    this._lostMessages.delete(connection.connectionId);
  }

  /** Retrieve a data/media connection for this peer. */
  getConnection(peerId: string, connectionId: string): null | BaseConnection {
    const connections = this._connections.get(peerId);
    if (!connections) {
      return null;
    }

    for (const connection of connections) {
      if (connection.connectionId === connectionId) {
        return connection;
      }
    }

    return null;
  }

  private _delayedAbort(type: PeerErrorType, message: string | Error): void {
    setTimeout(() => {
      this._abort(type, message);
    }, 0);
  }

  /**
   * Emits an error message and destroys the Peer.
   * The Peer is not destroyed if it's in a disconnected state, in which case
   * it retains its disconnected state and its existing connections.
   */
  private _abort(type: PeerErrorType, message: string | Error): void {
    logger.error("Aborting!");

    this.emitError(type, message);

    if (!this._lastServerId) {
      this.destroy();
    } else {
      this.disconnect();
    }
  }

  /** Emits a typed error message. */
  emitError(type: PeerErrorType, err: string | Error): void {
    logger.error("Error:", err);

    let error: Error & { type?: PeerErrorType };

    if (typeof err === "string") {
      error = new Error(err);
    } else {
      error = err;
    }

    error.type = type;

    this.emit(PeerEventType.Error, error);
  }

  /**
   * Destroys the Peer: closes all active connections as well as the connection
   *  to the server.
   * Warning: The peer can no longer create or accept connections after being
   *  destroyed.
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }

    logger.log(`Destroy peer with ID:${this.id}`);

    this.disconnect();
    this._cleanup();

    this._destroyed = true;

    this.emit(PeerEventType.Close);
  }

  /** Disconnects every connection on this peer. */
  private _cleanup(): void {
    for (const peerId of this._connections.keys()) {
      this._cleanupPeer(peerId);
      this._connections.delete(peerId);
    }

    this.socket.removeAllListeners();
  }

  /** Closes all connections to this peer. */
  private _cleanupPeer(peerId: string): void {
    const connections = this._connections.get(peerId);

    if (!connections) return;

    for (const connection of connections) {
      connection.close();
    }
  }

  /**
   * Disconnects the Peer's connection to the PeerServer. Does not close any
   *  active connections.
   * Warning: The peer can no longer create or accept connections after being
   *  disconnected. It also cannot reconnect to the server.
   */
  disconnect(): void {
    if (this.disconnected) {
      return;
    }

    const currentId = this.id;

    logger.log(`Disconnect peer with ID:${currentId}`);

    this._disconnected = true;
    this._open = false;

    this.socket.close();

    this.__lastServerId = currentId;
    this._id = null;

    this.emit(PeerEventType.Disconnected, currentId);
  }

  /** Attempts to reconnect with the same ID. */
  reconnect(): void {
    if (this.disconnected && !this.destroyed) {
      logger.log(
        `Attempting reconnection to server with ID ${this._lastServerId}`,
      );
      this._disconnected = false;
      this._initialize(this._lastServerId);
    } else if (this.destroyed) {
      throw new Error(
        "This peer cannot reconnect to the server. It has already been destroyed.",
      );
    } else if (!this.disconnected && !this.open) {
      // Do nothing. We're still connecting the first time.
      logger.error(
        "In a hurry? We're still trying to make the initial connection!",
      );
    } else {
      throw new Error(
        `Peer ${this.id} cannot reconnect because it is not disconnected from the server!`,
      );
    }
  }

  /**
   * Get a list of available peer IDs. If you're running your own server, you'll
   * want to set allow_discovery: true in the PeerServer options. If you're using
   * the cloud server, email team@peerjs.com to get the functionality enabled for
   * your key.
   */
  listAllPeers(cb: (peers: unknown[]) => void): void {
    this._api
      .listAllPeers()
      .then((peers) => {
        if (typeof cb === "function") cb(peers);
      })
      .catch((error) => this._abort(PeerErrorType.ServerError, error));
  }
}
