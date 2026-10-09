#!/usr/bin/env node
// Issues Songbe licence keys. This is the seller's tool: it needs the private key, which is never in this repository.
//   SONGBE_LICENCE_PRIVATE=/path/to/private.pem node tools/licence.mjs issue --to="Nguyen Van A" [--email=a@b.c] [--days=365] [--plan=studio]
//   node tools/licence.mjs read <key>        what a key says, and whether this build of Songbe accepts it
//   node tools/licence.mjs keys <folder>     a new key pair: the private part to keep secret, the public part to paste into src/licence.mjs
// A key without --days never runs out. Keep a list of the keys you issue (the id is printed): a key cannot be taken back.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readKey, writeKey } from '../src/licence.mjs';

const [cmd, ...rest] = process.argv.slice(2), opt = (name) => rest.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3), word = rest.find((x) => !x.startsWith('--'));
try {
  if (cmd === 'issue') {
    const where = process.env.SONGBE_LICENCE_PRIVATE;
    if (!where || !fs.existsSync(where)) throw new Error('set SONGBE_LICENCE_PRIVATE to the file that holds the private key');
    const days = opt('days') ? +opt('days') : null;
    if (days !== null && !(days > 0)) throw new Error('--days is a number of days');
    const key = writeKey({ to: opt('to'), email: opt('email') || null, plan: opt('plan') || 'studio', until: days ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : null }, fs.readFileSync(where, 'utf8'));
    const says = readKey(key);
    if (!says.ok) throw new Error('the key just written is not accepted by this build: is the public key in src/licence.mjs the partner of this private key?');
    console.log(key); console.error(`for ${says.to}${says.email ? ` <${says.email}>` : ''} · ${says.plan} · ${says.until ? 'until ' + says.until : 'never runs out'} · id ${says.id}`);
  } else if (cmd === 'read') {
    const says = readKey(word); console.log(JSON.stringify(says, null, 1)); if (!says.ok) process.exitCode = 1;
  } else if (cmd === 'keys') {
    if (!word) throw new Error('into which folder?');
    const priv = path.join(word, 'songbe_licence_private.pem'), pub = path.join(word, 'songbe_licence_public.pem');
    if (fs.existsSync(priv)) throw new Error(`${priv} is already there; a new pair would make every key issued so far worthless`);
    const pair = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(priv, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 }); fs.writeFileSync(pub, pair.publicKey.export({ type: 'spki', format: 'pem' }));
    console.log(`private key: ${priv} (keep it secret)\npublic key, for src/licence.mjs:\n${fs.readFileSync(pub, 'utf8')}`);
  } else console.log('node tools/licence.mjs issue --to="Name" [--email=…] [--days=365] [--plan=studio]   |   read <key>   |   keys <folder>');
} catch (e) { console.error('licence: ' + e.message); process.exitCode = 1; }
