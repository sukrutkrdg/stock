/**
 * The money field, character by character.
 *
 * A number input bound to a number cannot be emptied — `Number("")` is 0, the
 * zero is written back, and typing an amount means deleting a digit you never
 * entered. These cases are the ones that made that field unusable.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeAmount, parseAmount } from "../src/lib/amount.ts";

test("the field can be emptied", () => {
  assert.equal(sanitizeAmount(""), "");
  assert.equal(parseAmount(""), 0);
});

test("typing a number from empty never grows a leading zero", () => {
  let text = "";
  for (const key of ["2", "5"]) text = sanitizeAmount(text + key);
  assert.equal(text, "25");
});

test("a leading zero is dropped as soon as a digit follows it", () => {
  assert.equal(sanitizeAmount("0"), "0");
  assert.equal(sanitizeAmount("05"), "5");
  assert.equal(sanitizeAmount("0025"), "25");
});

test("a decimal being typed survives each keystroke", () => {
  assert.equal(sanitizeAmount("0."), "0.");
  assert.equal(sanitizeAmount("0.5"), "0.5");
  assert.equal(sanitizeAmount("12."), "12.");
  assert.equal(sanitizeAmount("12.5"), "12.5");
});

test("a comma decimal is accepted — phone keypads produce one", () => {
  assert.equal(sanitizeAmount("12,50"), "12.50");
});

test("letters and symbols are refused", () => {
  assert.equal(sanitizeAmount("2a5"), "25");
  assert.equal(sanitizeAmount("$25"), "25");
  assert.equal(sanitizeAmount("-25"), "25");
});

test("only one decimal point survives, at two places", () => {
  assert.equal(sanitizeAmount("1.2.3"), "1.23");
  assert.equal(sanitizeAmount("1.239"), "1.23");
});

test("parsing a partial value does not throw or produce NaN", () => {
  for (const partial of ["", ".", "0.", "12."]) {
    const value = parseAmount(partial);
    assert.ok(Number.isFinite(value), `${JSON.stringify(partial)} -> ${value}`);
  }
});

test("sanitising is stable — running it twice changes nothing", () => {
  for (const input of ["", "0", "25", "0.5", "12.50", "1.2.3", "abc"]) {
    const once = sanitizeAmount(input);
    assert.equal(sanitizeAmount(once), once, input);
  }
});
