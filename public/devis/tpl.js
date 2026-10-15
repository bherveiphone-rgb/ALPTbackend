/* Remplace les variables {{nom}} d'un modèle d'email (même syntaxe que côté serveur). */
export const render = (tpl, vars) => String(tpl || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => vars[k] ?? "");
