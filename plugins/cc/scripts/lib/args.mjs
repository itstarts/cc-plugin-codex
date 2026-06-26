export function parseArgs(argv, spec = {}) {
  const boolSet = new Set(spec.boolean ?? []);
  const strSet = new Set(spec.string ?? []);
  const flags = {};
  const values = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      const name = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
      if (boolSet.has(name)) {
        flags[name] = true;
        continue;
      }
      if (strSet.has(name)) {
        if (eq !== -1) {
          values[name] = tok.slice(eq + 1);
        } else if (i + 1 < argv.length) {
          values[name] = argv[++i];
        } else {
          values[name] = "";
        }
        continue;
      }
      positional.push(tok); // 未声明标志，原样保留
      continue;
    }
    positional.push(tok);
  }
  return { flags, values, positional };
}
