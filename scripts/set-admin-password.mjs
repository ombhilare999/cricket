#!/usr/bin/env node
// Set (or change) the admin password and the GitHub token it unlocks.
//
//   npm run set-admin-password
//
// Asks for the password and a fine-grained GitHub token (Repository access: only
// ombhilare999/cricket; Permissions: Contents → Read and write). Writes the encrypted result to
// data/admin-key.json. Commit and push that file. Leave the token empty for a view-only admin page.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { seal, unseal } from '../assets/js/lib/vault.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => rl.output.write(s.startsWith(question) ? s : s.replace(/[^\r\n]/g, '*'));
    rl.question(question, (a) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(a.trim());
    });
  });
}

const password = process.env.ADMIN_PASSWORD || (await ask('Admin password: ', true));
if (!password) throw new Error('A password is required.');
if (!process.env.ADMIN_PASSWORD && (await ask('Repeat password: ', true)) !== password) throw new Error('Passwords do not match.');
const token = process.env.ADMIN_GITHUB_TOKEN ?? (await ask('GitHub token (empty = view-only): ', true));

const box = await seal(password, { token: token || null });
if (!(await unseal(password, box))) throw new Error('Self-check failed.');
writeFileSync(join(ROOT, 'data/admin-key.json'), JSON.stringify(box, null, 1) + '\n');
console.log(`Wrote data/admin-key.json (${token ? 'with' : 'without'} a GitHub token). Commit and push it.`);
