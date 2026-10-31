import { readFileSync } from "node:fs";

function loadEnv(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    values[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return values;
}

function redact(text, secret) {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

const env = loadEnv(new URL("../.env", import.meta.url));
const secret = env.SUPABASE_SECRET_KEY ?? "";
const url = env.SUPABASE_URL ?? "";
const ref = url.replace("https://", "").replace(".supabase.co", "");
const sql = readFileSync(new URL("../supabase/migrations/0001_mvp.sql", import.meta.url), "utf8");

if (!secret || !ref) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  process.exit(1);
}

const attempts = [
  {
    name: "management-bearer",
    url: `https://api.supabase.com/v1/projects/${ref}/database/query`,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  },
  {
    name: "management-apikey",
    url: `https://api.supabase.com/v1/projects/${ref}/database/query`,
    headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  },
];

let applied = false;
for (const attempt of attempts) {
  const response = await fetch(attempt.url, {
    method: "POST",
    headers: attempt.headers,
    body: JSON.stringify({ query: sql }),
  });
  const body = redact(await response.text(), secret);
  console.log(`${attempt.name} status ${response.status}`);
  console.log(body.slice(0, 500));
  if (response.ok) {
    applied = true;
    break;
  }
}

if (!applied) {
  const probe = await fetch(`https://${ref}.supabase.co/pg/query`, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "select 1 as ok" }),
  });
  const probeBody = redact(await probe.text(), secret);
  console.log(`pg-query status ${probe.status}`);
  console.log(probeBody.slice(0, 300));
  if (probe.ok) {
    const apply = await fetch(`https://${ref}.supabase.co/pg/query`, {
      method: "POST",
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });
    const applyBody = redact(await apply.text(), secret);
    console.log(`pg-query apply status ${apply.status}`);
    console.log(applyBody.slice(0, 500));
    if (apply.ok) process.exit(0);
  }
  process.exit(1);
}
