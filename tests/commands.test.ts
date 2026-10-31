import { describe, expect, it } from "vitest";
import { matchCommand } from "../src/mvp/commands";

describe("keyword commands", () => {
  it.each([
    ["Next", "next"],
    ["please next", "next"],
    ["Repeat", "repeat"],
    ["Where am I?", "where"],
    ["where am i now", "where"],
    ["Skip", "skip"],
    ["skip it", "skip"],
    ["Pause", "pause"],
    ["Done.", "done"],
    ["I am done", "done"],
  ])("matches %j as %s", (transcript, expected) => {
    expect(matchCommand(transcript)).toBe(expected);
  });

  it.each([
    "move on",
    "go forward",
    "say that again",
    "what aisle is this",
    "where is the milk",
    "I am finished",
    "skipping",
    "pardon",
    "condone",
    "",
  ])("does not match %j", (transcript) => {
    expect(matchCommand(transcript)).toBeNull();
  });
});
