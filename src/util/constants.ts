export const CLOUD_HOST = "0.peerjs.com";
export const CLOUD_PORT = 443;

/** Browsers that need chunking */
export const chunkedBrowsers = { Chrome: 1, chrome: 1 };
export const chunkedMTU = 16300; // The original 60000 bytes setting does not work when sending data from Firefox to Chrome, which is "cut off" after 16384 bytes and delivered individually.

/** browser-agnostic default config */
export const defaultConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:0.peerjs.com:3478",
      username: "peerjs",
      credential: "peerjsp",
    },
  ],
  sdpSemantics: "unified-plan",
};
