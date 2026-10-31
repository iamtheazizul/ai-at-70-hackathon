import { describe, expect, it } from "vitest";
import { tripSummary } from "../src/mvp/summary";

describe("caregiver summary", () => {
  it("fills the fixed template", () => {
    const text = tripSummary({
      shopper: "Ross",
      store: "Sample Store (not a surveyed map)",
      items: [
        { name: "Orange juice", status: "found", substituteName: null },
        { name: "Green yogurt", status: "substituted", substituteName: "Plain yogurt" },
        { name: "Bread", status: "skipped", substituteName: null },
        { name: "Dragon fruit", status: "missing", substituteName: null },
        { name: "Eggs", status: "open", substituteName: null },
      ],
    });
    expect(text).toBe(
      [
        "Trip summary for Ross at Sample Store (not a surveyed map).",
        "Completed 2 of 5 items.",
        "Found: Orange juice.",
        "Could not find: Dragon fruit.",
        "Substituted: Green yogurt with Plain yogurt.",
        "Skipped: Bread.",
        "Still open: Eggs.",
      ].join("\n"),
    );
  });

  it("writes None for empty sections", () => {
    const text = tripSummary({
      shopper: "Ross",
      store: "Sample Store (not a surveyed map)",
      items: [],
    });
    expect(text).toContain("Found: None.");
    expect(text).toContain("Skipped: None.");
    expect(text).toContain("Completed 0 of 0 items.");
  });
});
