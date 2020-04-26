import { chunkedMTU } from "./constants";

export { pack, unpack } from "peerjs-js-binarypack";

// Binary stuff
let _dataCount = 1;

export function chunk(
  blob: Blob,
): { __peerData: number; n: number; total: number; data: Blob }[] {
  const chunks = [];
  const size = blob.size;
  const total = Math.ceil(size / chunkedMTU);

  let index = 0;
  let start = 0;

  while (start < size) {
    const end = Math.min(size, start + chunkedMTU);
    const b = blob.slice(start, end);

    const chunk = {
      __peerData: _dataCount,
      n: index,
      data: b,
      total,
    };

    chunks.push(chunk);

    start = end;
    index++;
  }

  _dataCount++;

  return chunks;
}

export function blobToArrayBuffer(
  blob: Blob,
  cb: (arg: ArrayBuffer | null) => void,
): FileReader {
  const fr = new FileReader();

  fr.onload = function (evt) {
    if (evt.target) {
      cb(evt.target.result as ArrayBuffer);
    }
  };

  fr.readAsArrayBuffer(blob);

  return fr;
}

export function binaryStringToArrayBuffer(
  binary: string,
): ArrayBuffer | SharedArrayBuffer {
  const byteArray = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    byteArray[i] = binary.charCodeAt(i) & 0xff;
  }

  return byteArray.buffer;
}
