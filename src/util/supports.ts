import * as spt from "../supports";
import { defaultConfig } from "./constants";

export const browser = spt.getBrowser();
export const browserVersion = spt.getVersion();

export interface SupportsObject {
  browser: boolean;
  webRTC: boolean;
  audioVideo: boolean;
  data: boolean;
  binaryBlob: boolean;
  reliable: boolean;
}

function initSupports() {
  const supported: SupportsObject = {
    browser: spt.isBrowserSupported(),
    webRTC: spt.isWebRTCSupported(),
    audioVideo: false,
    data: false,
    binaryBlob: false,
    reliable: false,
  };

  if (!supported.webRTC) return supported;

  let pc: RTCPeerConnection | undefined;

  try {
    pc = new RTCPeerConnection(defaultConfig);

    supported.audioVideo = true;

    let dc: RTCDataChannel | undefined;

    try {
      dc = pc.createDataChannel("_PEERJSTEST", { ordered: true });
      supported.data = true;
      supported.reliable = !!dc.ordered;

      // Binary test
      try {
        dc.binaryType = "blob";
        supported.binaryBlob = !spt.isIOS;
      } catch (err) {
        spt.reportFeatureNotSupported("binary blob in data channel", err);
      }
    } catch (err) {
      spt.reportFeatureNotSupported("data channel", err);
    } finally {
      if (dc) {
        dc.close();
      }
    }
  } catch (err) {
    spt.reportFeatureNotSupported("audio video in RTCPeerConnection", err);
  } finally {
    if (pc) {
      pc.close();
    }
  }

  return supported;
}

/** Lists which features are supported */
export const supports: SupportsObject = initSupports();
