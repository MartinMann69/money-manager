'use strict';

/* =====================================================================
   Sync through a private GitHub Gist.
   - Each device keeps a full copy in localStorage.
   - Every record has an updatedAt timestamp; deleted records are kept as
     tombstones, so merging two copies is safe: the newest version wins.
   - With a passphrase, the data is encrypted (AES-GCM, PBKDF2 key) before
     it is uploaded.
   ===================================================================== */

const SYNC_FILE = 'moneymanager-data.json';
const SYNC_KEY = 'mm-sync-v1';
const SYNC_COLLS = ['items', 'budgets', 'txs', 'credits', 'goals', 'wishes'];

function mergeData(a, b) {
  a = a || {}; b = b || {};
  const as = a.settings || {}, bs = b.settings || {};
  const out = { version: 1, settings: (bs.updatedAt || 0) > (as.updatedAt || 0) ? bs : as };
  for (const k of SYNC_COLLS) {
    const map = new Map();
    for (const r of [...(a[k] || []), ...(b[k] || [])]) {
      if (!r || !r.id) continue;
      const ex = map.get(r.id);
      if (!ex || (r.updatedAt || 0) > (ex.updatedAt || 0)) map.set(r.id, r);
    }
    out[k] = [...map.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  }
  return out;
}

const SyncCrypto = {
  iterations: 250000,
  cache: null, // { pass, salt, key }
  toB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  fromB64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); },
  async key(pass, saltB64, iterations) {
    if (this.cache && this.cache.pass === pass && this.cache.salt === saltB64 && this.cache.iter === iterations) return this.cache.key;
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: this.fromB64(saltB64), iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    this.cache = { pass, salt: saltB64, iter: iterations, key };
    return key;
  },
  async encrypt(obj, pass) {
    // reuse the salt (and derived key) while the passphrase is the same — deriving is slow on phones
    const salt = this.cache && this.cache.pass === pass && this.cache.iter === this.iterations
      ? this.cache.salt : this.toB64(crypto.getRandomValues(new Uint8Array(16)));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.key(pass, salt, this.iterations);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return JSON.stringify({ app: 'money-manager', enc: 'aes-256-gcm/pbkdf2-sha256', iter: this.iterations, salt, iv: this.toB64(iv), data: this.toB64(ct) });
  },
  async decrypt(env, pass) {
    const key = await this.key(pass, env.salt, env.iter || this.iterations);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.fromB64(env.iv) }, key, this.fromB64(env.data));
    return JSON.parse(new TextDecoder().decode(pt));
  },
};

const Sync = {
  cfg: {},
  status: 'off',
  error: '',
  timer: null,
  running: false,
  again: false,
  onChange: () => {},

  init() {
    try { this.cfg = JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch { this.cfg = {}; }
    this.set(this.enabled() ? 'idle' : 'off');
    if (this.enabled()) this.run();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.run(); });
    window.addEventListener('online', () => this.run());
    setInterval(() => { if (document.visibilityState === 'visible') this.run(); }, 120000);
  },
  saveCfg() { localStorage.setItem(SYNC_KEY, JSON.stringify(this.cfg)); },
  enabled() { return !!this.cfg.token; },
  set(status, error = '') { this.status = status; this.error = error; this.onChange(); },

  connect(token, passphrase) {
    this.cfg = { token, passphrase };
    this.saveCfg();
    this.run();
  },
  disconnect() {
    clearTimeout(this.timer);
    this.cfg = {};
    localStorage.removeItem(SYNC_KEY);
    this.set('off');
  },
  schedule() {
    if (!this.enabled()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), 1500);
  },

  async api(path, opts = {}) {
    const res = await fetch('https://api.github.com' + path, {
      ...opts,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.cfg.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch { /* ignore */ }
      let text = `GitHub error ${res.status}${msg ? ': ' + msg : ''}`;
      if (res.status === 401) text = 'The GitHub token is wrong or has expired. Disconnect and connect again with a new token.';
      else if (res.status === 403 || (res.status === 404 && path.startsWith('/gists?'))) text = `GitHub refused access${msg ? ` (${msg})` : ''}. Make sure the token has the "Gists: Read and write" permission.`;
      const e = new Error(text);
      e.status = res.status;
      throw e;
    }
    return res.json();
  },

  async findGist() {
    for (let page = 1; page <= 10; page++) {
      const list = await this.api(`/gists?per_page=100&page=${page}`);
      const g = list.find(x => x.files && x.files[SYNC_FILE]);
      if (g) return g.id;
      if (list.length < 100) break;
    }
    return null;
  },

  async readContent(gist) {
    const f = gist.files && gist.files[SYNC_FILE];
    if (!f) return null;
    if (f.truncated) return (await fetch(f.raw_url, { cache: 'no-store' })).text();
    return f.content;
  },

  /** returns { data, encrypted } */
  async decode(text) {
    const obj = JSON.parse(text);
    if (obj && obj.enc) {
      if (!this.cfg.passphrase) throw new Error('The synced data is encrypted. Disconnect and connect again with your passphrase.');
      try { return { data: await SyncCrypto.decrypt(obj, this.cfg.passphrase), encrypted: true }; }
      catch { throw new Error('Wrong passphrase — the synced data could not be decrypted. Disconnect and connect again with the right passphrase.'); }
    }
    return { data: obj, encrypted: false };
  },

  async encode(data) {
    return this.cfg.passphrase ? SyncCrypto.encrypt(data, this.cfg.passphrase) : JSON.stringify(data);
  },

  async run() {
    if (!this.enabled()) return;
    if (this.running) { this.again = true; return; }
    if (!navigator.onLine) { this.set('offline'); return; }
    this.running = true;
    clearTimeout(this.timer);
    this.set('syncing');
    try {
      let remote = null, remoteEncrypted = false;
      if (!this.cfg.gistId) { this.cfg.gistId = await this.findGist(); this.saveCfg(); }
      if (this.cfg.gistId) {
        try {
          const text = await this.readContent(await this.api('/gists/' + this.cfg.gistId));
          if (text) ({ data: remote, encrypted: remoteEncrypted } = await this.decode(text));
        } catch (e) {
          if (e.status === 404) { this.cfg.gistId = null; this.saveCfg(); } else throw e;
        }
      }
      const merged = mergeData(Store.data, remote);
      const mergedStr = JSON.stringify(merged);
      if (JSON.stringify(mergeData(Store.data, null)) !== mergedStr) Store.replace(merged);
      const remoteUpToDate = remote
        && JSON.stringify(mergeData(remote, null)) === mergedStr
        && remoteEncrypted === !!this.cfg.passphrase;
      if (!remoteUpToDate) {
        const content = await this.encode(merged);
        if (this.cfg.gistId) {
          await this.api('/gists/' + this.cfg.gistId, { method: 'PATCH', body: JSON.stringify({ files: { [SYNC_FILE]: { content } } }) });
        } else {
          const g = await this.api('/gists', { method: 'POST', body: JSON.stringify({ description: 'Money Manager sync data (do not edit)', public: false, files: { [SYNC_FILE]: { content } } }) });
          this.cfg.gistId = g.id;
        }
      }
      this.cfg.lastSync = Date.now();
      this.saveCfg();
      this.set('ok');
    } catch (e) {
      console.warn('Sync failed', e);
      this.set(navigator.onLine ? 'error' : 'offline', e.message || String(e));
    } finally {
      this.running = false;
      if (this.again) { this.again = false; this.run(); }
    }
  },
};
