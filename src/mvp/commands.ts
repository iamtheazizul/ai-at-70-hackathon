import type { CommandId } from "./types";

/** Fixed phrases only. Word-boundary match. No paraphrases. */
const PHRASES: readonly { id: CommandId; phrase: string }[] = [
  { id: "where", phrase: "where am i" },
  { id: "next", phrase: "next" },
  { id: "repeat", phrase: "repeat" },
  { id: "skip", phrase: "skip" },
  { id: "pause", phrase: "pause" },
  { id: "done", phrase: "done" },
];

export function normalizeTranscript(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchCommand(transcript: string): CommandId | null {
  const text = normalizeTranscript(transcript);
  if (!text) return null;

  const hits = PHRASES.filter((command) => {
    const pattern = new RegExp(`(?:^|\\s)${command.phrase}(?:\\s|$)`);
    return pattern.test(text);
  });
  if (hits.length === 0) return null;

  hits.sort((a, b) => b.phrase.length - a.phrase.length);
  return hits[0]?.id ?? null;
}
