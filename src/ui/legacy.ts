// One-time migration from the app's former name (WOWDB) to DBWOW.
// Copies per-browser settings and learning progress to the new keys so
// students keep their progress, trophies and preferences.
const KEYS = ['learning', 'learningMode', 'last', 'activePractical'];
export function migrateLegacyStorage() {
  try {
    for (const k of KEYS) {
      const oldKey = `wowdb.${k}`, newKey = `dbwow.${k}`;
      const v = localStorage.getItem(oldKey);
      if (v !== null) {
        if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, v);
        localStorage.removeItem(oldKey);
      }
    }
  } catch { /* storage unavailable: nothing to migrate */ }
}
migrateLegacyStorage();
