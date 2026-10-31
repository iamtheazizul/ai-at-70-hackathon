import { aisleFor, resolveExact, searchCatalog, substituteFor } from "./mvp/catalog";
import { matchCommand } from "./mvp/commands";
import { demoCatalog, demoPastItems, demoStore, DEMO_NOTE } from "./mvp/demo";
import { loadRemoteCatalog } from "./mvp/remote";
import { tripSummary } from "./mvp/summary";
import type { Catalog, ItemStatus, PastTripItem, Product } from "./mvp/types";
import { myUsual } from "./mvp/usual";

interface Entry {
  key: string;
  rawText: string;
  productId: number | null;
  name: string;
  aisle: string | null;
  status: ItemStatus;
  substituteName: string | null;
}

type Screen = "prepare" | "trip" | "summary";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("#app mount point missing from index.html");
// Typed non-null so the render functions below need no repeated guard.
const app: HTMLDivElement = appRoot;
if (!app) throw new Error("Missing #app");

let catalog: Catalog = demoCatalog;
let pastItems: PastTripItem[] = demoPastItems;
let storeName = demoStore.name;
let note = DEMO_NOTE;
let source = "Bundled demonstration catalog.";

let screen: Screen = "prepare";
let query = "";
let entries: Entry[] = [];
let index = 0;
let paused = false;
let message = "";
let transcript = "";
let commandResult = "";
let keyCount = 1;

function current(): Entry | null {
  return entries[index] ?? null;
}

function addProduct(product: Product): void {
  const aisle = aisleFor(product.id, catalog.storeId, catalog);
  entries.push({
    key: `e${keyCount++}`,
    rawText: product.name,
    productId: product.id,
    name: product.name,
    aisle,
    status: "open",
    substituteName: null,
  });
  query = "";
  render();
}

function addWritten(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const exact = resolveExact(trimmed, catalog);
  if (exact) {
    addProduct(exact);
    return;
  }
  entries.push({
    key: `e${keyCount++}`,
    rawText: trimmed,
    productId: null,
    name: trimmed,
    aisle: null,
    status: "open",
    substituteName: null,
  });
  query = "";
  render();
}

function useUsual(): void {
  const usual = myUsual(pastItems, catalog.products);
  entries = usual.map((product) => ({
    key: `e${keyCount++}`,
    rawText: product.name,
    productId: product.id,
    name: product.name,
    aisle: aisleFor(product.id, catalog.storeId, catalog),
    status: "open" as const,
    substituteName: null,
  }));
  render();
}

function advance(): void {
  if (index < entries.length - 1) index += 1;
}

function applyCommand(text: string): void {
  const command = matchCommand(text);
  commandResult = command ? `Matched: ${command}` : "No matching command.";
  if (!command || screen !== "trip") {
    render();
    return;
  }
  const item = current();
  if (command === "pause") {
    paused = !paused;
    message = paused ? "Paused." : "Continuing.";
  } else if (command === "done") {
    screen = "summary";
    paused = false;
  } else if (command === "where" && item) {
    message = item.aisle ?? "No aisle on file. This item is not in the catalog.";
  } else if (command === "repeat" && item) {
    message = item.aisle ? `${item.name}. ${item.aisle}.` : `${item.name}. No aisle on file.`;
  } else if (command === "skip" && item && !paused) {
    item.status = "skipped";
    message = `Skipped ${item.name}.`;
    advance();
  } else if (command === "next" && !paused) {
    if (index < entries.length - 1) {
      advance();
      message = "Next item.";
    } else {
      message = "No next item.";
    }
  }
  render();
}

function markFound(): void {
  const item = current();
  if (!item || paused) return;
  item.status = "found";
  message = `Got ${item.name}.`;
  advance();
  render();
}

function markMissing(): void {
  const item = current();
  if (!item || paused) return;
  const substitute = item.productId == null ? null : substituteFor(item.productId, catalog.storeId, catalog);
  if (substitute) {
    item.status = "substituted";
    item.substituteName = substitute.name;
    message = `Substituted ${item.name} with ${substitute.name}.`;
  } else {
    item.status = "missing";
    message = `Could not find ${item.name}. No substitute rule.`;
  }
  advance();
  render();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function render(): void {
  app.replaceChildren();
  const main = el("main");
  main.append(el("h1", { text: "Shoptimal" }));
  main.append(el("p", { class: "banner", id: "data-note", text: `${note} ${source}` }));

  if (screen === "prepare") renderPrepare(main);
  else if (screen === "trip") renderTrip(main);
  else renderSummary(main);

  app.append(main);
}

function renderPrepare(main: HTMLElement): void {
  main.append(el("p", { class: "hint", text: storeName }));
  const label = el("label", { for: "search", text: "Add an item" });
  const input = el("input", { id: "search", type: "text", value: query, autocomplete: "off" });
  input.addEventListener("input", () => {
    query = input.value;
    render();
    const next = document.querySelector<HTMLInputElement>("#search");
    next?.focus();
    const length = next?.value.length ?? 0;
    next?.setSelectionRange(length, length);
  });
  main.append(label, input);

  const results = el("ul", { id: "results", class: "results" });
  for (const product of searchCatalog(query, catalog)) {
    const button = el("button", { type: "button", text: product.name });
    button.addEventListener("click", () => addProduct(product));
    results.append(el("li", {}, [button]));
  }
  main.append(results);

  const exact = resolveExact(query, catalog);
  if (query.trim() && !exact && searchCatalog(query, catalog).length === 0) {
    const unresolved = el("button", {
      type: "button",
      class: "text-action",
      id: "add-written",
      text: `Keep "${query.trim()}" with no aisle`,
    });
    unresolved.addEventListener("click", () => addWritten(query));
    main.append(unresolved);
    main.append(el("p", { class: "hint", text: "Not in the catalog. No aisle will be assigned." }));
  }

  const usual = el("button", { type: "button", class: "text-action", id: "my-usual", text: "My usual" });
  usual.addEventListener("click", useUsual);
  main.append(usual);

  const list = el("ol", { id: "list", class: "list" });
  for (const entry of entries) {
    const aisle = entry.aisle ?? "No aisle";
    list.append(el("li", { text: `${entry.name} — ${aisle}` }));
  }
  main.append(list);

  const start = el("button", { type: "button", class: "primary", id: "start", text: "Start trip" });
  start.disabled = entries.length === 0;
  start.addEventListener("click", () => {
    screen = "trip";
    index = 0;
    paused = false;
    message = "";
    commandResult = "";
    render();
  });
  main.append(start);
}

function renderTrip(main: HTMLElement): void {
  const item = current();
  main.append(el("p", { id: "progress", text: `Item ${Math.min(index + 1, entries.length)} of ${entries.length}` }));
  if (paused) main.append(el("p", { class: "paused", id: "paused", text: "Paused" }));
  if (item) {
    main.append(el("h2", { id: "item-name", text: item.name }));
    main.append(el("p", { id: "aisle", text: item.aisle ?? "No aisle on file." }));
  }
  if (message) main.append(el("p", { class: "message", id: "message", text: message }));

  if (!paused) {
    const actions = el("div", { class: "actions" });
    const got = el("button", { type: "button", class: "primary", id: "got-it", text: "Got it" });
    const missing = el("button", { type: "button", class: "primary secondary", id: "cant-find", text: "Can't find it" });
    got.addEventListener("click", markFound);
    missing.addEventListener("click", markMissing);
    actions.append(got, missing);
    main.append(actions);
  }

  const bench = el("section", { class: "bench" });
  bench.append(el("label", { for: "transcript", text: "Voice command transcript" }));
  bench.append(el("p", { class: "hint", text: "Next, Repeat, Where am I, Skip, Pause, Done." }));
  const field = el("input", { id: "transcript", type: "text", value: transcript, autocomplete: "off" });
  field.addEventListener("input", () => {
    transcript = field.value;
  });
  const match = el("button", { type: "button", id: "match", text: "Match command" });
  match.addEventListener("click", () => applyCommand(transcript));
  bench.append(field, match);

  const Speech = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
  if (Speech) {
    const listen = el("button", { type: "button", id: "listen", text: "Listen" });
    listen.addEventListener("click", () => {
      const recognition = new Speech();
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        const heard = event.results[0]?.[0]?.transcript ?? "";
        transcript = heard;
        applyCommand(heard);
      };
      recognition.start();
    });
    bench.append(listen);
  }

  if (commandResult) bench.append(el("p", { id: "command-result", text: commandResult }));
  main.append(bench);
}

function renderSummary(main: HTMLElement): void {
  const text = tripSummary({
    shopper: "Ross",
    store: storeName,
    items: entries.map((entry) => ({
      name: entry.name,
      status: entry.status,
      substituteName: entry.substituteName,
    })),
  });
  main.append(el("h2", { text: "Caregiver summary" }));
  const block = el("pre", { id: "summary" });
  block.textContent = text;
  main.append(block);
  const back = el("button", { type: "button", class: "text-action", id: "back", text: "Back to list" });
  back.addEventListener("click", () => {
    screen = "prepare";
    render();
  });
  main.append(back);
}

async function boot(): Promise<void> {
  render();
  const remote = await loadRemoteCatalog(
    import.meta.env.VITE_SUPABASE_URL ?? "",
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
  );
  if (remote && remote.catalog.products.length > 0) {
    catalog = remote.catalog;
    pastItems = remote.pastItems;
    storeName = remote.storeName;
    note = remote.note || DEMO_NOTE;
    source = "Loaded from Supabase.";
  }
  render();
}

void boot();
