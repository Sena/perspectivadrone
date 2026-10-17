// Guarda de versão do Playwright: o lockfile e as imagens do container (CI,
// regen e Docker local) precisam contar a MESMA versão. Um drift silencioso
// aqui invalida as baselines visuais (imagem diferente => render diferente).
import { readFileSync } from "node:fs";

const IMAGE_FILES = [
  ".github/workflows/playwright.yml",
  ".github/workflows/regen-baselines.yml",
  "docker-compose.yml",
];

const lock = readFileSync("pnpm-lock.yaml", "utf8");
const lockMatch = lock.match(/'@playwright\/test@(\d+\.\d+\.\d+)'/);
if (!lockMatch) {
  console.error("FAIL: nao encontrei '@playwright/test@x.y.z' no pnpm-lock.yaml");
  process.exit(1);
}
const lockVersion = lockMatch[1];

let failed = false;
console.log(`pnpm-lock.yaml -> @playwright/test@${lockVersion}`);
for (const file of IMAGE_FILES) {
  const text = readFileSync(file, "utf8");
  const imageMatch = text.match(/mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-jammy/);
  if (!imageMatch) {
    failed = true;
    console.log(`FAIL ${file} -> imagem playwright:v*-jammy nao encontrada`);
    continue;
  }
  const imageVersion = imageMatch[1];
  const ok = imageVersion === lockVersion;
  if (!ok) failed = true;
  console.log(`${ok ? "OK  " : "FAIL"} ${file} -> playwright:v${imageVersion}-jammy`);
}

if (failed) {
  console.error("");
  console.error("Versões divergentes: suba a tag da imagem (vX.Y.Z-jammy) junto com o @playwright/test, no mesmo commit.");
  process.exit(1);
}
console.log("Tudo alinhado.");
