import "./setup";
import * as c from "../src/util/constants";
import * as id from "../src/util/id";

describe("util#constants", function () {
  describe("#chunkedMTU", function () {
    it("should be 16300", function () {
      expect(c.chunkedMTU).toBe(16300);
    });
  });
  describe("#id", function () {
    it("validateId should validate id", function () {
      expect(id.validateId("")).toBe(true);
      expect(id.validateId("1")).toBe(true);
      expect(id.validateId("#")).toBe(false);
    });
    it("randomToken should gen token", function () {
      expect(id.randomToken()).toBe("testtoken");
    });
  });
});
