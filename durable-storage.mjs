import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Only these top-level documents belong to the learner transaction. Other
// files retain ordinary filesystem behavior, including preview/test files.
const DOCUMENT_NAMES = new Set(['profile.json', 'current-session.json', 'long-term-memory.md',
  'learning-ledger.json', 'maintained-memory.json', 'relationship-state.json', 'opening-history.json','persona-continuity.json']);
const transactions = new AsyncLocalStorage();
let configuredStore = null;
const absolutePath = path => resolve(path instanceof URL ? fileURLToPath(path) : path);
const pathKey = path => process.platform === 'win32' ? absolutePath(path).toLowerCase() : absolutePath(path);
const now = () => new Date().toISOString();

function storageError(code, message) {
  return Object.assign(new Error(message), { code });
}

function missingDocument(path) {
  return Object.assign(new Error(`ENOENT: no durable document, open '${path}'`), { code: 'ENOENT', path });
}

function atomicWrite(path, text) {
  const destination = absolutePath(path);
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true });
    renameSync(temporary, destination);
  } finally {
    // Only our uniquely named temporary file may be removed. A rename failure
    // must leave the previous readable document untouched.
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function documentText(text) {
  if (typeof text === 'string') return text;
  if (Buffer.isBuffer(text)) return text.toString('utf8');
  throw new TypeError('Document contents must be text or a UTF-8 Buffer.');
}

class DurableStorage {
  constructor(root) {
    this.root = absolutePath(root);
    this.databasePath = join(this.root, 'learner-state.sqlite');
    this.backupPath = null;
    this.closed = false;
    this.owner = null;
    this.warnings = new Map();
    this.paths = new Map([...DOCUMENT_NAMES].map(name => [pathKey(join(this.root, name)), name]));
    mkdirSync(this.root, { recursive: true });
    this.database = new DatabaseSync(this.databasePath);
    try {
      const version = this.database.prepare('PRAGMA user_version').get().user_version;
      if (version !== 0 && version !== 1) throw new Error(`Unsupported durable database version: ${version}`);
      const checked = this.database.prepare('PRAGMA quick_check(1)').get();
      if (checked.quick_check !== 'ok') throw new Error(`Durable database integrity error: ${checked.quick_check}`);
      this.database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
      `);
      this.readMeta = this.database.prepare('SELECT value FROM metadata WHERE key = ?');
      this.writeMeta = this.database.prepare('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      this.readDoc = this.database.prepare('SELECT content FROM documents WHERE name = ?');
      this.writeDoc = this.database.prepare(`INSERT INTO documents(name, content, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`);
      this.readCheckpoint = this.database.prepare('SELECT data, updated_at FROM checkpoints WHERE id = ?');
      this.writeCheckpoint = this.database.prepare(`INSERT INTO checkpoints(id, data, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`);
      this.removeCheckpoint = this.database.prepare('DELETE FROM checkpoints WHERE id = ?');
      if (this.readMeta.get('initialized')?.value !== '1') this.migrate();
      this.backupPath = this.readMeta.get('backup_path')?.value || null;
      const documents = this.database.prepare('SELECT name, content FROM documents').all();
      for (const row of documents) {
        if (!DOCUMENT_NAMES.has(row.name)) throw new Error('Durable database contains an unmanaged document path.');
      }
      this.exportMirrors(new Map(documents.map(row => [row.name, row.content])));
    } catch (error) {
      this.database.close();
      this.closed = true;
      throw error; // Never replace or remigrate a damaged existing database.
    }
  }

  migrate() {
    const legacy = [...DOCUMENT_NAMES].filter(name => existsSync(join(this.root, name)));
    let backupPath = null;
    const documents = new Map();
    if (legacy.length) {
      backupPath = mkdtempSync(join(this.root, 'legacy-documents-backup-'));
      for (const name of legacy) {
        const source = join(this.root, name);
        if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink()) {
          throw new Error(`Refusing to migrate a non-regular learner document: ${name}`);
        }
        const backup = join(backupPath, name);
        copyFileSync(source, backup, constants.COPYFILE_EXCL);
        documents.set(name, readFileSync(backup, 'utf8'));
      }
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      // Another process may have initialized between opening and importing.
      if (this.readMeta.get('initialized')?.value !== '1') {
        const timestamp = now();
        for (const [name, content] of documents) this.writeDoc.run(name, content, timestamp);
        this.writeMeta.run('backup_path', backupPath || '');
        this.writeMeta.run('revision', '0');
        this.writeMeta.run('initialized', '1');
        this.database.exec('PRAGMA user_version = 1');
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  assertOpen() {
    if (this.closed) throw storageError('DURABLE_STORAGE_CLOSED', 'The durable store is closed.');
  }

  context() {
    this.assertOpen();
    const context = transactions.getStore();
    if (context?.store !== this) return null;
    if (!context.active) throw storageError('DURABLE_TRANSACTION_FINISHED', 'This async transaction has already finished.');
    return context;
  }

  writableContext() {
    const context = this.context();
    if (this.owner && this.owner !== context) {
      throw storageError('DURABLE_STORAGE_BUSY', 'A learner transaction is in progress; retry after it finishes.');
    }
    return context;
  }

  documentName(path) { return this.paths.get(pathKey(path)) || null; }

  read(name, path, encoding) {
    const context = this.context();
    const content = context?.documents.has(name) ? context.documents.get(name) : this.readDoc.get(name)?.content;
    if (content === undefined) throw missingDocument(path);
    return encoding == null ? Buffer.from(content, 'utf8') : Buffer.from(content, 'utf8').toString(encoding);
  }

  exists(name) {
    const context = this.context();
    return Boolean(context?.documents.has(name) || this.readDoc.get(name));
  }

  write(name, text) {
    const context = this.writableContext();
    const content = documentText(text);
    if (context) context.documents.set(name, content);
    else this.commit({ documents: new Map([[name, content]]), checkpoints: new Map(), revision: this.revision() });
  }

  revision() {
    const revision = Number(this.readMeta.get('revision')?.value);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Durable database revision is invalid.');
    return revision;
  }

  commit(context) {
    this.assertOpen();
    if (!context.documents.size && !context.checkpoints.size) return;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (this.revision() !== context.revision) {
        throw storageError('DURABLE_STORAGE_CONFLICT', 'The durable database changed during this transaction; retry with fresh state.');
      }
      const timestamp = now();
      for (const [name, text] of context.documents) this.writeDoc.run(name, text, timestamp);
      for (const [id, row] of context.checkpoints) {
        if (row === null) this.removeCheckpoint.run(id);
        else this.writeCheckpoint.run(id, row.data, row.updatedAt);
      }
      this.writeMeta.run('revision', String(context.revision + 1));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    // The commit is already durable. Export failure is a warning, never a
    // failed archive: retrying it as a rollback would duplicate learning data.
    this.exportMirrors(context.documents);
  }

  exportMirrors(documents) {
    for (const [name, text] of documents) {
      const path = join(this.root, name);
      try {
        if (!existsSync(path) || readFileSync(path, 'utf8') !== text) atomicWrite(path, text);
        this.warnings.delete(name);
      } catch (error) {
        this.warnings.set(name, { path, message: error.message, updatedAt: now() });
      }
    }
  }

  async transaction(asyncFn) {
    this.assertOpen();
    this.context(); // Reject work inherited from an already completed context.
    if (this.owner) throw storageError('DURABLE_STORAGE_BUSY', 'A learner transaction is already in progress.');
    if (typeof asyncFn !== 'function') throw new TypeError('A transaction requires a callback.');
    const context = { store: this, active: true, documents: new Map(), checkpoints: new Map(), revision: this.revision() };
    this.owner = context;
    try {
      const result = await transactions.run(context, asyncFn);
      this.commit(context);
      return result;
    } finally {
      context.active = false;
      this.owner = null;
    }
  }

  checkpoint(id, data) {
    const context = this.writableContext();
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('A checkpoint requires a nonempty string ID.');
    const serialized = JSON.stringify(data);
    if (serialized === undefined) throw new TypeError('A checkpoint requires JSON data.');
    const row = { data: serialized, updatedAt: now() };
    if (context) context.checkpoints.set(id, row);
    else this.commit({ documents: new Map(), checkpoints: new Map([[id, row]]), revision: this.revision() });
  }

  getCheckpoint(id) {
    const context = this.context();
    const row = context?.checkpoints.has(id) ? context.checkpoints.get(id) : this.readCheckpoint.get(id);
    return row ? JSON.parse(row.data) : null;
  }

  listCheckpoints() {
    const context = this.context();
    const rows = new Map(this.database.prepare('SELECT id, data, updated_at FROM checkpoints').all()
      .map(row => [row.id, { data: row.data, updatedAt: row.updated_at }]));
    for (const [id, row] of context?.checkpoints || []) {
      if (row === null) rows.delete(id);
      else rows.set(id, row);
    }
    return [...rows].map(([id, row]) => ({ id, data: JSON.parse(row.data), updatedAt: row.updatedAt }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  }

  deleteCheckpoint(id) {
    const context = this.writableContext();
    if (context) context.checkpoints.set(id, null);
    else this.commit({ documents: new Map(), checkpoints: new Map([[id, null]]), revision: this.revision() });
  }

  status() {
    return { enabled: !this.closed, root: this.root, databasePath: this.databasePath,
      backupPath: this.backupPath, transactionActive: Boolean(this.owner), warnings: structuredClone([...this.warnings.values()]) };
  }

  close() {
    if (this.closed) return;
    if (this.owner) throw storageError('DURABLE_STORAGE_BUSY', 'Cannot close a store during a learner transaction.');
    this.database.close();
    this.closed = true;
    if (configuredStore === this) configuredStore = null;
  }
}

export function configureDurableStorage(root) {
  if (typeof root !== 'string' || !root.trim()) throw new TypeError('An explicit learner storage root is required.');
  if (configuredStore) {
    if (pathKey(configuredStore.root) === pathKey(root)) return configuredStore;
    throw storageError('DURABLE_STORAGE_BUSY', 'Close the existing learner store before configuring another root.');
  }
  const store = new DurableStorage(root);
  configuredStore = store;
  return store;
}

export function readDocument(path, encoding = 'utf8') {
  const name = configuredStore?.documentName(path);
  return name ? configuredStore.read(name, path, encoding) : readFileSync(path, encoding);
}

export function documentExists(path) {
  const name = configuredStore?.documentName(path);
  return name ? configuredStore.exists(name) : existsSync(path);
}

export function writeDocument(path, text) {
  const name = configuredStore?.documentName(path);
  if (name) configuredStore.write(name, text);
  else atomicWrite(path, documentText(text));
}
