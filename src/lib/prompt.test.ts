import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompt.js";

describe("buildPrompt", () => {
  it("includes every filename and chunk numbered in input order", () => {
    const chunks = [
      {
        fileName: "lecture3.pdf",
        content: "A process has its own address space.",
      },
      {
        fileName: "lab.txt",
        content: "Threads share an address space.\nThey have separate stacks.",
      },
      {
        fileName: "lecture3.pdf",
        content: "Scheduling selects the next task.",
      },
    ];
    const prompt = buildPrompt("How do processes and threads differ?", chunks);
    let previousPosition = -1;
    for (const [index, chunk] of chunks.entries()) {
      const entry = `[${index + 1}] ${chunk.fileName}: ${chunk.content}`;
      expect(prompt).toContain(entry);
      const position = prompt.indexOf(entry);
      expect(position).toBeGreaterThan(previousPosition);
      previousPosition = position;
    }
    expect(prompt).toContain(
      "Student question:\nHow do processes and threads differ?",
    );
  });

  it("instructs the model to use only sources, cite numbers, and admit missing answers", () => {
    const prompt = buildPrompt("What is a process?", [
      { fileName: "notes.txt", content: "A process is a running program." },
    ]);
    expect(prompt).toMatch(/using only the sources/i);
    expect(prompt).toMatch(/do not use outside knowledge/i);
    expect(prompt).toMatch(/cite.*bracketed numbers/i);
    expect(prompt).toMatch(
      /if the sources do not cover the question, say you don't know/i,
    );
  });

  it("explicitly reports no sources while preserving the question and fallback instruction", () => {
    const prompt = buildPrompt("What will be on the exam?", []);
    expect(prompt).toContain("Sources:\nNo sources were provided.");
    expect(prompt).toMatch(
      /say you don't know the answer from the provided sources/i,
    );
    expect(prompt).toContain("Student question:\nWhat will be on the exam?");
    expect(prompt).not.toMatch(/\[\d+\] .*:/);
  });

  it("preserves multiline questions and source text without modifying the inputs", () => {
    const chunk = Object.freeze({
      fileName: "résumé.txt",
      content: "First line\nSecond line: π",
    });
    const chunks = Object.freeze([chunk]);
    const question = "Explain π.\nGive an example.";
    expect(buildPrompt(question, chunks)).toContain(
      `[1] résumé.txt: ${chunk.content}`,
    );
    expect(buildPrompt(question, chunks)).toContain(
      `Student question:\n${question}`,
    );
  });
});
