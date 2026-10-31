import { describe, expect, it } from "vitest";
import { aisleFor, resolveExact, searchCatalog, substituteFor } from "../src/mvp/catalog";
import { demoCatalog } from "../src/mvp/demo";

describe("name and synonym search", () => {
  it("resolves OJ to orange juice and its sample aisle", () => {
    const product = resolveExact("OJ", demoCatalog);
    expect(product?.name).toBe("Orange juice");
    expect(aisleFor(product!.id, demoCatalog.storeId, demoCatalog)).toBe("Aisle 6, drinks");
  });

  it("resolves the green yogurt and garbanzo beans", () => {
    expect(resolveExact("the green yogurt", demoCatalog)?.name).toBe("Green yogurt");
    expect(resolveExact("garbanzo beans", demoCatalog)?.name).toBe("Chickpeas");
  });

  it("leaves unknowns unresolved and does not invent an aisle", () => {
    expect(resolveExact("dragon fruit", demoCatalog)).toBeNull();
    expect(searchCatalog("dragon fruit", demoCatalog)).toEqual([]);
  });

  it("does not merge whole milk and oat milk", () => {
    expect(resolveExact("milk", demoCatalog)).toBeNull();
    const names = searchCatalog("milk", demoCatalog).map((product) => product.name).sort();
    expect(names).toEqual(["Oat milk", "Whole milk"]);
  });
});

describe("substitute rules", () => {
  it("uses a database rule for orange juice", () => {
    expect(substituteFor(1, demoCatalog.storeId, demoCatalog)?.name).toBe("Apple juice");
  });

  it("does not invent a substitute", () => {
    expect(substituteFor(6, demoCatalog.storeId, demoCatalog)).toBeNull();
    expect(substituteFor(999, demoCatalog.storeId, demoCatalog)).toBeNull();
  });
});
