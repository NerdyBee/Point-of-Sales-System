/**
 * Number boxes start at 0, and typing into them gave "0250" instead of 250. This drops the
 * leading zeros as people type, in every number box in the app ("0.5" is left alone).
 * Runs before React reads the value (capture phase on the document), so state stays in step.
 */
export function stripLeadingZerosWhileTyping() {
  document.addEventListener(
    "input",
    (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "number") return;
      const cleaned = input.value.replace(/^(-?)0+(?=\d)/, "$1");
      if (cleaned !== input.value) input.value = cleaned;
    },
    true
  );
}
