// Email-safe characters only, not "anything but whitespace/@" — that would also accept
// surrounding punctuation a caller forgot to strip.
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function validateEmail(candidate: string): boolean {
  return EMAIL_PATTERN.test(candidate);
}
