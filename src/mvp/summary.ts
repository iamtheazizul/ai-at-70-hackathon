import type { SummaryItem } from "./types";

function line(label: string, values: string[]): string {
  return `${label}: ${values.length > 0 ? values.join(", ") : "None"}.`;
}

/** Fixed sentences. No language model. */
export function tripSummary(input: {
  shopper: string;
  store: string;
  items: SummaryItem[];
}): string {
  const found = input.items.filter((item) => item.status === "found").map((item) => item.name);
  const missing = input.items.filter((item) => item.status === "missing").map((item) => item.name);
  const skipped = input.items.filter((item) => item.status === "skipped").map((item) => item.name);
  const open = input.items.filter((item) => item.status === "open").map((item) => item.name);
  const substituted = input.items
    .filter((item) => item.status === "substituted")
    .map((item) => `${item.name} with ${item.substituteName ?? "a listed substitute"}`);

  const completed = found.length + substituted.length;
  return [
    `Trip summary for ${input.shopper} at ${input.store}.`,
    `Completed ${completed} of ${input.items.length} items.`,
    line("Found", found),
    line("Could not find", missing),
    line("Substituted", substituted),
    line("Skipped", skipped),
    line("Still open", open),
  ].join("\n");
}
