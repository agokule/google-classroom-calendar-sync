// An error whose message is written for the user and should be shown
// as-is (no stack trace) — e.g. "run `classroom-sync login` first". The
// CLI prints these and exits 1; the TUI shows them and keeps running.
export class UserError extends Error {
  override name = 'UserError';
}
