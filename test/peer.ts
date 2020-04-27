import "./setup";
import { Peer } from "../src/peer";
import { Server } from "mock-socket";
import {
  ConnectionType,
  ServerMessageType,
  PeerErrorType,
  PeerEventType,
} from "../src/enums";

const createMockServer = (): Server => {
  const fakeURL = "ws://localhost:8080/peerjs?key=peerjs&id=1&token=testToken";
  const mockServer = new Server(fakeURL);

  mockServer.on("connection", (socket) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket as any).on("message", () => {
      socket.send("test message from mock server");
    });

    socket.send(JSON.stringify({ type: ServerMessageType.Open }));
  });

  return mockServer;
};
describe("Peer", function () {
  describe("after construct without parameters", function () {
    it("shouldn't contains any connection", function () {
      const peer = new Peer();

      expect(peer.open).toBe(false);
      expect(peer.connections).toEqual({});
      expect(peer.id).toBeNull();
      expect(peer.disconnected).toBe(false);
      expect(peer.destroyed).toBe(false);

      peer.destroy();
    });
  });

  describe("after construct with parameters", function () {
    it("should contains id and key", function () {
      const peer = new Peer("1", { key: "anotherKey" });

      expect(peer.id).toBe("1");
      expect(peer.options.key).toBe("anotherKey");

      peer.destroy();
    });
  });

  describe("after call to peer #2", function () {
    let mockServer: Server;

    beforeAll(function () {
      mockServer = createMockServer();
    });

    it("Peer#1 should has id #1", function (done) {
      const peer1 = new Peer("1", { port: 8080, host: "localhost" });
      expect(peer1.open).toBe(false);

      const mediaOptions = {
        metadata: { var: "123" },
        constraints: {
          mandatory: {
            OfferToReceiveAudio: true,
            OfferToReceiveVideo: true,
          },
        },
      };

      const track = new MediaStreamTrack();
      const mediaStream = new MediaStream([track]);

      const mediaConnection = peer1.call("2", mediaStream, { ...mediaOptions });

      expect(mediaConnection).toBeDefined();
      if (!mediaConnection) throw new Error("invalid state");

      expect(typeof mediaConnection.connectionId).toBe("string");
      expect(mediaConnection.type).toBe(ConnectionType.Media);
      expect(mediaConnection.peer).toBe("2");
      expect(mediaConnection.options).toStrictEqual(
        expect.objectContaining(mediaOptions),
      );
      expect(mediaConnection.metadata).toStrictEqual(mediaOptions.metadata);
      expect(mediaConnection.peerConnection?.getSenders()[0].track?.id).toBe(
        track.id,
      );

      peer1.once("open", (id) => {
        expect(id).toBe("1");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((peer1 as any)._lastServerId).toBe("1");
        expect(peer1.disconnected).toBe(false);
        expect(peer1.destroyed).toBe(false);
        expect(peer1.open).toBe(true);

        peer1.destroy();

        expect(peer1.disconnected).toBe(true);
        expect(peer1.destroyed).toBe(true);
        expect(peer1.open).toBe(false);
        expect(peer1.connections).toStrictEqual({});

        done();
      });
    });

    afterAll(function () {
      mockServer.stop();
    });
  });

  describe("reconnect", function () {
    let mockServer: Server;

    beforeAll(function () {
      mockServer = createMockServer();
    });

    it("connect to server => disconnect => reconnect => destroy", function (done) {
      const peer1 = new Peer("1", { port: 8080, host: "localhost" });

      peer1.once("open", () => {
        expect(peer1.open).toBe(true);

        peer1.once("disconnected", () => {
          expect(peer1.disconnected).toBe(true);
          expect(peer1.destroyed).toBe(false);
          expect(peer1.open).toBe(false);

          peer1.once("open", (id) => {
            expect(id).toBe("1");
            expect(peer1.disconnected).toBe(false);
            expect(peer1.destroyed).toBe(false);
            expect(peer1.open).toBe(true);

            peer1.once("disconnected", () => {
              expect(peer1.disconnected).toBe(true);
              expect(peer1.destroyed).toBe(false);
              expect(peer1.open).toBe(false);

              peer1.once("close", () => {
                expect(peer1.disconnected).toBe(true);
                expect(peer1.destroyed).toBe(true);
                expect(peer1.open).toBe(false);

                done();
              });
            });

            peer1.destroy();
          });

          peer1.reconnect();
        });

        peer1.disconnect();
      });
    });

    it("disconnect => reconnect => destroy", function (done) {
      mockServer.stop();

      const peer1 = new Peer("1", { port: 8080, host: "localhost" });

      peer1.once("disconnected", (id) => {
        expect(id).toBe("1");
        expect(peer1.disconnected).toBe(true);
        expect(peer1.destroyed).toBe(false);
        expect(peer1.open).toBe(false);

        peer1.once("open", (id) => {
          expect(id).toBe("1");
          expect(peer1.disconnected).toBe(false);
          expect(peer1.destroyed).toBe(false);
          expect(peer1.open).toBe(true);

          peer1.once("disconnected", () => {
            expect(peer1.disconnected).toBe(true);
            expect(peer1.destroyed).toBe(false);
            expect(peer1.open).toBe(false);

            peer1.once("close", () => {
              expect(peer1.disconnected).toBe(true);
              expect(peer1.destroyed).toBe(true);
              expect(peer1.open).toBe(false);

              done();
            });
          });

          peer1.destroy();
        });

        mockServer = createMockServer();

        peer1.reconnect();
      });
    });

    it("destroy peer if no id and no connection", function (done) {
      mockServer.stop();

      const peer1 = new Peer({ port: 8080, host: "localhost" });

      peer1.once(PeerEventType.Error, (error) => {
        expect(error.type).toBe(PeerErrorType.ServerError);

        peer1.once(PeerEventType.Close, () => {
          expect(peer1.disconnected).toBe(true);
          expect(peer1.destroyed).toBe(true);
          expect(peer1.open).toBe(false);

          done();
        });

        mockServer = createMockServer();
      });
    });

    afterAll(function () {
      mockServer.stop();
    });
  });
});
