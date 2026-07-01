import assert from "node:assert/strict";
import test from "node:test";
import { chunkTranscript } from "../src/summarizer.js";

test("chunkTranscript keeps short transcripts as one chunk", () => {
  assert.deepEqual(chunkTranscript("alpha\nbeta", 20), ["alpha\nbeta"]);
});

test("chunkTranscript splits on transcript lines first", () => {
  const chunks = chunkTranscript("alpha beta\ngamma delta\nepsilon zeta", 20);

  assert.deepEqual(chunks, ["alpha beta", "gamma delta", "epsilon zeta"]);
  assert.ok(chunks.every((chunk) => chunk.length <= 20));
});

test("chunkTranscript splits long lines on word boundaries", () => {
  const chunks = chunkTranscript("one two three four five six seven", 12);

  assert.deepEqual(chunks, ["one two", "three four", "five six", "seven"]);
  assert.ok(chunks.every((chunk) => chunk.length <= 12));
});

test("chunkTranscript hard-splits words longer than the chunk size", () => {
  const chunks = chunkTranscript("abcdefghijklmnop", 5);

  assert.deepEqual(chunks, ["abcde", "fghij", "klmno", "p"]);
  assert.ok(chunks.every((chunk) => chunk.length <= 5));
});
