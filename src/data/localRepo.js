// Store repository backed by the browser's localStorage. Holds several stores.
//
// Every repository (this one, and the database one later) has the same shape, so the UI
// doesn't care where data lives:
//   listStores()      → [{id, name, address, placed, aisleCount, updatedAt}]
//   getStore(id)      → store object or null
//   saveStore(S)      → saves (insert or update)
//   deleteStore(id)
// All methods return promises, because a database call takes time.

const KEY = "aisle-mapper-v3";
const OLD_KEY = "aisle-mapper-v2"; // single-store format from earlier versions

function read() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.stores) return d;
  } catch (e) { /* storage blocked or corrupt */ }
  const d = { stores: {} };
  try { // migrate the old single store, if any
    const old = JSON.parse(localStorage.getItem(OLD_KEY));
    if (old && Array.isArray(old.aisles)) { old.id = old.id || "migrated-store"; d.stores[old.id] = old; }
  } catch (e) { /* nothing to migrate */ }
  return d;
}

function write(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* storage full or blocked */ }
}

export const localRepo = {
  async listStores() {
    return Object.values(read().stores)
      .map((S) => ({ id: S.id, name: S.name || "Untitled store", address: S.address || "", placed: !!S.placed, stage: S.stage, aisleCount: S.aisles.length, updatedAt: S.updatedAt || 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async getStore(id) {
    const S = read().stores[id];
    return S ? structuredClone(S) : null;
  },
  async saveStore(S) {
    const d = read();
    S.updatedAt = Date.now();
    d.stores[S.id] = S;
    write(d);
  },
  async deleteStore(id) {
    const d = read();
    delete d.stores[id];
    write(d);
  },
};
