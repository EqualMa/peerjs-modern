import { webRTCAdapter } from "./adapter";
import logger from "./logger";

export function reportFeatureNotSupported(
  feature: string,
  error?: Error | string,
) {
  if (error) logger.warn(`${feature} is not supported due to`, error);
  else logger.warn(`${feature} is not supported`);
}

export const isIOS = ["iPad", "iPhone", "iPod"].includes(navigator.platform);
export const supportedBrowsers = ["firefox", "chrome", "safari"];
export const minFirefoxVersion = 59;
export const minChromeVersion = 72;
export const minSafariVersion = 605;

export function isWebRTCSupported(): boolean {
  return typeof RTCPeerConnection !== "undefined";
}

export function getBrowser(): string {
  return webRTCAdapter.browserDetails.browser;
}

export function getVersion(): number {
  return webRTCAdapter.browserDetails.version || 0;
}

export function isBrowserSupported(): boolean {
  const browser = getBrowser();
  const version = getVersion();

  const validBrowser = supportedBrowsers.includes(browser);

  if (!validBrowser) return false;

  if (browser === "chrome") return version >= minChromeVersion;
  if (browser === "firefox") return version >= minFirefoxVersion;
  if (browser === "safari") return !isIOS && version >= minSafariVersion;

  return false;
}

export function isUnifiedPlanSupported(): boolean {
  const browser = getBrowser();
  const version = webRTCAdapter.browserDetails.version || 0;

  if (browser === "chrome" && version < 72) return false;
  if (browser === "firefox" && version >= 59) return true;
  if (
    !window.RTCRtpTransceiver ||
    !("currentDirection" in RTCRtpTransceiver.prototype)
  )
    return false;

  let tempPc: RTCPeerConnection | undefined;
  let supported = false;

  try {
    tempPc = new RTCPeerConnection();
    tempPc.addTransceiver("audio");
    supported = true;
  } catch (err) {
    reportFeatureNotSupported("unified plan");
  } finally {
    if (tempPc) {
      tempPc.close();
    }
  }

  return supported;
}

export function supportsInfoToString(): string {
  return `Supports:
    browser:${getBrowser()}
    version:${getVersion()}
    isIOS:${isIOS}
    isWebRTCSupported:${isWebRTCSupported()}
    isBrowserSupported:${isBrowserSupported()}
    isUnifiedPlanSupported:${isUnifiedPlanSupported()}`;
}
