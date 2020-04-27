import { WebSocket } from "mock-socket";

const fakeGlobals = {
  WebSocket,
  MediaStream: class MediaStream {
    private _tracks: MediaStreamTrack[] = [];

    constructor(tracks?: MediaStreamTrack[]) {
      if (tracks) {
        this._tracks = tracks;
      }
    }

    getTracks(): MediaStreamTrack[] {
      return this._tracks;
    }

    addTrack(track: MediaStreamTrack) {
      this._tracks.push(track);
    }
  },
  MediaStreamTrack: class MediaStreamTrack {
    kind = "";
    id: string;

    private static _idCounter = 0;

    constructor() {
      this.id = `track#${fakeGlobals.MediaStreamTrack._idCounter++}`;
    }
  },
  RTCPeerConnection: class RTCPeerConnection {
    private _senders: RTCRtpSender[] = [];

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    close() {}

    addTrack(track: MediaStreamTrack): RTCRtpSender {
      const newSender = new RTCRtpSender();
      newSender.replaceTrack(track);

      this._senders.push(newSender);

      return newSender;
    }

    // removeTrack(_: RTCRtpSender): void { }

    getSenders(): RTCRtpSender[] {
      return this._senders;
    }
  },
  RTCRtpSender: class RTCRtpSender {
    readonly dtmf: RTCDTMFSender | null = null;
    readonly rtcpTransport: RTCDtlsTransport | null = null;
    track: MediaStreamTrack | null = null;
    readonly transport: RTCDtlsTransport | null = null;

    replaceTrack(withTrack: MediaStreamTrack | null): Promise<void> {
      this.track = withTrack;

      return Promise.resolve();
    }
  },
};

Object.assign(globalThis, fakeGlobals);
