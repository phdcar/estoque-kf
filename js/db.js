// Armazenamento local (IndexedDB). Tudo fica no aparelho até a etapa de sincronização.
const DB_NAME = 'estoque-kf';
const DB_VER = 2;
let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        const mk = (n, o) => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, o); };
        mk('products', { keyPath: 'id' });
        mk('photos', { keyPath: 'id' });
        mk('counts', { keyPath: 'id' });
        mk('settings');
        // versão 0.7: movimentos (entradas, saídas, perdas...) e pedidos de compra
        mk('moves', { keyPath: 'id' });
        mk('orders', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(stores, mode, fn) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let result;
    const r = fn(t);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transação cancelada'));
  });
}

export const db = {
  get: (store, key) => run(store, 'readonly', t => t.objectStore(store).get(key)),
  all: (store) => run(store, 'readonly', t => t.objectStore(store).getAll()),
  put: (store, value, key) => run(store, 'readwrite', t =>
    key === undefined ? t.objectStore(store).put(value) : t.objectStore(store).put(value, key)),
  del: (store, key) => run(store, 'readwrite', t => t.objectStore(store).delete(key)),
  // grava vários registros de uma vez (tudo ou nada)
  putMany: (store, values) => run(store, 'readwrite', t => {
    const s = t.objectStore(store);
    values.forEach(v => s.put(v));
  }),
  clearStore: (store) => run(store, 'readwrite', t => t.objectStore(store).clear()),
  // apaga os dados do estoque deste celular (ao sair da conta); a nuvem continua com tudo
  clearData: () => run(['products', 'photos', 'counts', 'settings', 'moves', 'orders'], 'readwrite', t => {
    ['products', 'photos', 'counts', 'settings', 'moves', 'orders'].forEach(n => t.objectStore(n).clear());
  }),
  // grava produtos e movimentos (e opcionalmente outros registros) na mesma transação
  saveMoves: (products, moves, extra = {}) => run(['products', 'moves', 'counts', 'orders'], 'readwrite', t => {
    const ps = t.objectStore('products');
    products.forEach(p => ps.put(p));
    const ms = t.objectStore('moves');
    moves.forEach(m => ms.put(m));
    if (extra.count) t.objectStore('counts').put(extra.count);
    if (extra.order) t.objectStore('orders').put(extra.order);
  }),
  // conferência: atualiza produtos e grava o registro na mesma transação
  saveCount: (products, count) => run(['products', 'counts'], 'readwrite', t => {
    const ps = t.objectStore('products');
    products.forEach(p => ps.put(p));
    t.objectStore('counts').put(count);
  }),
};
