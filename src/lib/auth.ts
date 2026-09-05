import { isAddress, type Address, type Hex } from "viem";
import { publicClient } from "./chain";

export class AuthError extends Error {}

/**
 * Proof that a request came from a particular wallet.
 *
 * `creator_address` on a slate is whatever the browser typed into the request
 * body — nobody signed for it, so it cannot decide who may unlist a slate. A
 * delete gated on an unauthenticated address is not authorization, it is a
 * label. So destructive actions ask the wallet to sign a statement naming the
 * exact slate, and the server checks the signature actually recovers to the
 * address claiming it.
 *
 * Verification goes through a public client rather than viem's standalone
 * helper because a Base Account is a smart contract wallet: its signatures are
 * ERC-1271, validated by calling the account, not by recovering a public key.
 * Checking these off-chain would reject every Base App user.
 */
const MAX_AGE_MS = 5 * 60 * 1000;

export type SignedIntent = {
  address: string;
  signature: string;
  issuedAt: string;
};

/**
 * The exact bytes the wallet is asked to sign.
 *
 * Naming the action and the subject matters: a signature over a vague string
 * could be replayed against a different slate, or harvested from one prompt and
 * used for another. The timestamp bounds replay in time; the slate id bounds it
 * in scope.
 */
export function unlistMessage(slateId: string, address: string, issuedAt: string): string {
  return [
    "Slate",
    "",
    `Unlist basket: ${slateId}`,
    `Wallet: ${address.toLowerCase()}`,
    `Time: ${issuedAt}`,
    "",
    "This removes the basket from the public feed. It does not move any funds.",
  ].join("\n");
}

/**
 * Verify a signed intent, or throw.
 *
 * Returns the lowercased address so callers cannot accidentally compare a
 * checksummed string against the lowercased column.
 */
export async function verifyUnlistIntent(
  slateId: string,
  intent: SignedIntent,
): Promise<Address> {
  if (!intent?.address || !isAddress(intent.address)) {
    throw new AuthError("A wallet address is required.");
  }
  if (!intent.signature || !/^0x[0-9a-fA-F]+$/.test(intent.signature)) {
    throw new AuthError("A signature is required.");
  }

  const issuedAt = Date.parse(intent.issuedAt ?? "");
  if (!Number.isFinite(issuedAt)) throw new AuthError("The request is missing a timestamp.");

  const age = Date.now() - issuedAt;
  // A window in both directions: clocks drift, and a signature from the future
  // is as suspicious as a stale one.
  if (age > MAX_AGE_MS || age < -MAX_AGE_MS) {
    throw new AuthError("That signature has expired. Try again.");
  }

  const address = intent.address as Address;
  const message = unlistMessage(slateId, address, intent.issuedAt);

  let valid = false;
  try {
    valid = await publicClient().verifyMessage({
      address,
      message,
      signature: intent.signature as Hex,
    });
  } catch (error) {
    console.error("[auth] signature verification failed", error);
    throw new AuthError("Could not verify that signature.");
  }

  if (!valid) throw new AuthError("That signature does not match the wallet.");

  return address.toLowerCase() as Address;
}
