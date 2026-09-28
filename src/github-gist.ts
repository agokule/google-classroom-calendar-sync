// Optional: publishes the generated .ics to a secret GitHub Gist, so
// something like Noctalia (once it can subscribe to a plain URL) can
// pull your calendar without ever touching your Google session.
//
// Setup (one-time):
//   1. github.com -> Settings -> Developer settings -> Personal access
//      tokens -> Fine-grained tokens -> Generate new token.
//   2. Resource owner: yourself. Repository access: doesn't matter,
//      this only touches gists.
//   3. Under "Account permissions", set "Gists" to Read and write.
//   4. Copy the token and save it with `classroom-sync config` (stored in
//      ~/.classroom-sync/settings.json, owner-readable only), or export
//      it in your shell instead, which takes priority:
//        export GIST_TOKEN=github_pat_xxxxxxxx
//      Never hardcode it here, especially since this is published.
//   (If your account still only offers classic tokens for gists,
//   Tokens (classic) with just the "gist" scope checked also works.)
//
// "Secret" gist is GitHub's actual term — there's no true "private,
// only-me" gist. Secret means unlisted: not on your public profile,
// not indexed by GitHub or web search. It is NOT access-controlled —
// anyone who has the URL can read it, indefinitely. Treat the URL
// itself as the secret, the same way the old Google Calendar "secret
// address in iCal format" worked.

import * as fs from 'node:fs';
import { ensureConfigDir, gistToken, GIST_ID_FILE, OUTPUT_FILE } from './config.js';
import { UserError } from './errors.js';

const GIST_FILENAME = 'classroom.ics';
const API = 'https://api.github.com/gists';
const USER_API = 'https://api.github.com/user';
const API_VERSION = '2026-03-10';

interface GistFile {
  content: string;
}

interface GistResponse {
  id: string;
  owner: { login: string };
  files: Record<string, GistFile>;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'classroom-session-sync',
    'Content-Type': 'application/json',
  };
}

function rawUrl(gist: GistResponse): string {
  // Deliberately built without a commit hash. GitHub's own API response
  // embeds a hash-pinned raw_url per file (one specific revision) — this
  // form omits it, which always resolves to the latest revision instead,
  // so the URL you give your calendar app never has to change.
  return `https://gist.githubusercontent.com/${gist.owner.login}/${gist.id}/raw/${GIST_FILENAME}`;
}

/**
 * Returns the GitHub login the token belongs to, or null if GitHub
 * rejects it. This only proves the token is live — not that it has the
 * Gists permission; a publish is the only real test of that.
 */
export async function checkGistToken(token: string): Promise<string | null> {
  const res = await fetch(USER_API, { headers: authHeaders(token) });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GitHub token check failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { login: string }).login;
}

export async function publishToGist(token: string, icsContent: string): Promise<string> {
  ensureConfigDir();
  const headers = authHeaders(token);
  let gistId: string | null = fs.existsSync(GIST_ID_FILE)
    ? fs.readFileSync(GIST_ID_FILE, 'utf8').trim()
    : null;

  if (gistId) {
    const res = await fetch(`${API}/${gistId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content: icsContent } } }),
    });
    if (res.ok) return rawUrl((await res.json()) as GistResponse);
    if (res.status !== 404) {
      throw new Error(`gist update failed: ${res.status} ${await res.text()}`);
    }
    gistId = null; // stale id (gist deleted?) - fall through and recreate
  }

  const res = await fetch(API, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      description: 'Classroom calendar feed (auto-generated, not indexed)',
      public: false, // secret, not truly private - see comment above
      files: { [GIST_FILENAME]: { content: icsContent } },
    }),
  });
  if (!res.ok) throw new Error(`gist creation failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as GistResponse;
  fs.writeFileSync(GIST_ID_FILE, data.id);
  return rawUrl(data);
}

/** Publishes the on-disk OUTPUT_FILE and returns its stable raw URL. */
export async function syncGist(): Promise<string> {
  const token = gistToken();
  if (!token) {
    throw new UserError(
      'No GitHub token configured. Save one with `classroom-sync config` (it explains\n' +
      'how to create one), or set the GIST_TOKEN environment variable.'
    );
  }

  if (!fs.existsSync(OUTPUT_FILE)) {
    throw new UserError(`No ${OUTPUT_FILE} found. Run \`classroom-sync run\` first.`);
  }

  return publishToGist(token.token, fs.readFileSync(OUTPUT_FILE, 'utf8'));
}

export async function runSyncGist(): Promise<void> {
  console.log('Published to:', await syncGist());
}
