import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompt";

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
    expect(prompt).toContain("How do processes and threads differ?");
  });

  it("instructs the model to use only sources, cite numbers, and admit missing answers", () => {
    const prompt = buildPrompt("What is a process?", [
      { fileName: "notes.txt", content: "A process is a running program." },
    ]);
    // Check required instruction concepts, not full sentences or section labels.
    expect(prompt).toMatch(/only[^.\n]*sources/i);

    expect(prompt).toMatch(/cite[^.\n]*numbers/i);
    expect(prompt).toMatch(/sources[^.\n]*do not cover[^.\n]*don['’]t know/i);
  });

  it("explicitly reports no sources while preserving the question and fallback instruction", () => {
    const prompt = buildPrompt("What will be on the exam?", []);
    expect(prompt).toMatch(/no sources/i);
    expect(prompt.match(/don['’]t know/gi)).toHaveLength(1);
    expect(prompt).toContain("What will be on the exam?");
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
    expect(buildPrompt(question, chunks)).toContain(question);
  });
});
