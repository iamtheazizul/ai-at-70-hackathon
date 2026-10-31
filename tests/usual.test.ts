import { describe, expect, it } from "vitest";
import { demoPastItems, demoProducts } from "../src/mvp/demo";
import { myUsual } from "../src/mvp/usual";

describe("my usual", () => {
  it("keeps items found on at least two trips", () => {
    const names = myUsual(demoPastItems, demoProducts).map((product) => product.name);
    expect(names).toEqual(["Bread", "Orange juice", "Whole milk"]);
  });
});
