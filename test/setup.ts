import "./faker";
import { supports } from "../src/util/supports";

//enable support for WebRTC
supports.audioVideo = true;

jest.mock("../src/util/id", () => {
  const actual = jest.requireActual("../src/util/id");
  return {
    ...actual,
    randomToken(): string {
      return "testtoken";
    },
  };
});
