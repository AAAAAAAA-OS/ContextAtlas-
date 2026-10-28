import fs from 'node:fs';
import ts from 'typescript';
for (const name of ['engine']) {
  const input = new URL(`../src/${name}.ts`, import.meta.url);
  const result = ts.transpileModule(fs.readFileSync(input, 'utf8'), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}, fileName: input.pathname,
  });
  fs.writeFileSync(new URL(`../src/${name}.mjs`, import.meta.url), result.outputText);
}
