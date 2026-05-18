import type { HTMLElement } from "node-html-parser";

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function htmlText(element: HTMLElement): string {
  // textContent decodes HTML entities such as &amp;, unlike rawText/innerText.
  return normalizeWhitespace(element.textContent);
}
