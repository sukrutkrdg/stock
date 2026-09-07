/**
 * Editing a money field.
 *
 * A number input bound straight to a number cannot be cleared: emptying it
 * makes `Number("")` zero, the zero is written back, and the caret ends up to
 * the right of a digit the user never typed — so entering 25 means deleting a
 * 0 you cannot select. The field therefore holds the raw string the user is
 * typing, including the empty one, and a number is derived from it only where
 * a number is actually needed.
 */

/** Keeps what someone can plausibly be part-way through typing. */
export function sanitizeAmount(input: string): string {
  // Commas are how much of the world writes a decimal point, and a phone
  // keypad will happily produce one.
  const normalised = input.replace(",", ".").replace(/[^\d.]/g, "");

  const [whole, ...rest] = normalised.split(".");
  const decimals = rest.join("").slice(0, 2);

  // Leading zeros are dropped except for the "0." someone is mid-way through.
  const trimmed = whole.replace(/^0+(?=\d)/, "");

  if (rest.length === 0) return trimmed;
  return `${trimmed === "" ? "0" : trimmed}.${decimals}`;
}

/** The value to act on. An empty or partial field is simply not a number yet. */
export function parseAmount(input: string): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : 0;
}
