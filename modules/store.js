/* Persistance JSON simple (un fichier par collection, écriture atomique). */
import fs from "fs";
import path from "path";

export function makeStore(dataDir, seeds, { mergeSettings } = {}) {
  const file = n => path.join(dataDir, `devis-${n}.json`);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  for (const [n, v] of Object.entries(seeds)) if (!fs.existsSync(file(n))) fs.writeFileSync(file(n), JSON.stringify(v, null, 2));
  const get = n => {
    if (!fs.existsSync(file(n))) return structuredClone(seeds[n] ?? []);
    const v = JSON.parse(fs.readFileSync(file(n), "utf8"));
    return n === "settings" && mergeSettings ? mergeSettings(v) : v;
  };
  const set = (n, v) => {
    const tmp = file(n) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
    fs.renameSync(tmp, file(n));
  };
  /** Lit, modifie via fn (qui peut retourner une valeur), réécrit. */
  const update = (n, fn) => { const v = get(n); const r = fn(v); set(n, v); return r; };
  return { get, set, update, names: () => Object.keys(seeds) };
}
