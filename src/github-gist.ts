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
//   4. Copy the token, then in your shell:
//        export GIST_TOKEN=github_pat_xxxxxxxx
//      Never hardcode it here, especially since this is published.
//   (If your account still only offers classic tokens for gists,
//   Tokens (classic) with just the "gist" scope checked also works —
//   pass it the same way via GIST_TOKEN.)
//
// "Secret" gist is GitHub's actual term — there's no true "private,
// only-me" gist. Secret means unlisted: not on your public profile,
// not indexed by GitHub or web search. It is NOT access-controlled —
// anyone who has the URL can read it, indefinitely. Treat the URL
// itself as the secret, the same way the old Google Calendar "secret
// address in iCal format" worked.

import * as fs from 'fs';
import { ensureConfigDir, GIST_ID_FILE, OUTPUT_FILE } from './config';

const GIST_FILENAME = 'classroom.ics';
const API = 'https://api.github.com/gists';
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

export async function publishToGist(icsContent: string): Promise<string | null> {
  const token = process.env.GIST_TOKEN;
  if (!token) return null; // opt-in feature; do nothing if not configured

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

export async function runSyncGist(): Promise<void> {
  if (!process.env.GIST_TOKEN) {
    console.error('GIST_TOKEN is not set. See the setup instructions at the top of src/github-gist.ts.');
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_FILE)) {
    console.error(`No ${OUTPUT_FILE} found. Run \`classroom-sync run\` first.`);
    process.exit(1);
  }

  const ics = fs.readFileSync(OUTPUT_FILE, 'utf8');
  const url = await publishToGist(ics);
  console.log('Published to:', url);
}
