/**
 * What counts as an acceptable pad password.
 *
 * Stricter than it would be for a login, because there is no reset and no
 * rate limit: the pad is a file anyone can fetch, so a weak password can be
 * attacked offline at whatever speed the attacker's hardware allows. Length is
 * what defeats that, not punctuation, so length is what is asked for.
 */

const MIN_LENGTH = 12;

/** Rejected outright: the ones that appear at the top of every wordlist. */
const OBVIOUS = new Set([
  "password",
  "password1",
  "password123",
  "123456789012",
  "qwertyuiop",
  "letmein12345",
  "sprintpad",
  "sprintpad123",
]);

export type PasswordProblem = "empty" | "short" | "obvious";

export function passwordProblem(password: string): PasswordProblem | null {
  if (password === "") return "empty";
  if (password.length < MIN_LENGTH) return "short";

  const flattened = password.toLowerCase().replace(/\s+/g, "");
  if (OBVIOUS.has(flattened)) return "obvious";
  // A single character repeated is long without being any harder to guess.
  if (new Set(flattened).size <= 2) return "obvious";
  return null;
}

export function describePasswordProblem(problem: PasswordProblem): string {
  switch (problem) {
    case "empty":
      return "Choose a password. It is the key to this pad and cannot be reset.";
    case "obvious":
      return "That one is too easy to guess. A few unrelated words work well.";
    default:
      return `Use at least ${MIN_LENGTH} characters — a few unrelated words work well. It cannot be reset.`;
  }
}
