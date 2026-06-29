import fs from "node:fs";
import assert from "node:assert/strict";

const ROOT_HTML = fs.readFileSync("index.html", "utf8");
const RECOVERY_HTML = fs.readFileSync("recovery/index.html", "utf8");

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map.entries());
    }
  };
}

async function buildPatchedHtml() {
  const bootScript = [...RECOVERY_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  let written = "";
  const fakeDocument = {
    getElementById() {
      return { innerHTML: "" };
    },
    open() {},
    write(value) {
      written += value;
    },
    close() {}
  };

  const previous = {
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    document: globalThis.document,
    fetch: globalThis.fetch,
    Blob: globalThis.Blob,
    URL: globalThis.URL
  };

  globalThis.window = {
    RECOVERY_SEED_DATA: { keys: {} },
    location: { search: "", pathname: "/recovery/" },
    history: { replaceState() {} }
  };
  globalThis.localStorage = createStorage();
  globalThis.document = fakeDocument;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => ROOT_HTML
  });
  globalThis.Blob = class Blob {};
  globalThis.URL = {
    createObjectURL() {
      return "";
    },
    revokeObjectURL() {}
  };

  try {
    new Function(bootScript)();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(written.includes("async function saveData(key, data, options = {})"), "patched saveData missing");
    assert.ok(written.includes("function exportRecoveryJson()"), "recovery export panel missing");
    assert.ok(written.includes("const receiptApiUrl = getRecoveryWriteApiUrl()"), "receipt API guard missing");
    assert.ok(written.includes("端末に保存（本番未送信）"), "local-only saved message missing");
    return written;
  } finally {
    globalThis.window = previous.window;
    globalThis.localStorage = previous.localStorage;
    globalThis.document = previous.document;
    globalThis.fetch = previous.fetch;
    globalThis.Blob = previous.Blob;
    globalThis.URL = previous.URL;
  }
}

function extractRuntime(patchedHtml) {
  const appScript = [...patchedHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(match => match[1].includes("const PRODUCTION_READ_API_URL"))[1];
  const runtimeBlock = appScript.match(/const PRODUCTION_READ_API_URL[\s\S]*?\/\/ ─── Receipt Viewer \(QR code destination\) ───/)[0];
  const updateTabsBlock = appScript.match(/const updateTabs = async tabs => \{[\s\S]*?  \};\r?\n  const updateStaff = async list => \{/)[0].replace(/\r?\n  const updateStaff = async list => \{$/, "");
  return { appScript, runtimeBlock, updateTabsBlock };
}

function createFetch(remoteStore, options = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (options.throwNetwork) throw new Error("simulated network error");
    if (init.method === "POST") {
      if (options.failPost) {
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ success: false, error: "simulated save failure" })
        };
      }
      const payload = JSON.parse(init.body);
      assert.equal(payload.action, "set");
      remoteStore.set(payload.key, JSON.parse(payload.value));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true })
      };
    }

    const parsed = new URL(String(url));
    assert.equal(parsed.searchParams.get("action"), "get");
    const key = parsed.searchParams.get("key");
    const value = remoteStore.has(key) ? JSON.stringify(remoteStore.get(key)) : "";
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, value })
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function createRuntime(runtimeBlock, { storage, fetchImpl }) {
  const windowObject = {
    RECOVERY_SEED_DATA: { keys: {} },
    location: { search: "", pathname: "/recovery/" },
    history: { replaceState() {} }
  };
  const documentObject = {
    createElement() {
      return {
        style: {},
        click() {},
        remove() {}
      };
    },
    body: { appendChild() {} },
    getElementById() {
      return null;
    }
  };

  return new Function(
    "window",
    "localStorage",
    "fetch",
    "console",
    "alert",
    "setTimeout",
    "setInterval",
    "document",
    "Blob",
    "URL",
    `${runtimeBlock}
return {
  STORAGE_KEY,
  TABS_STORAGE_KEY,
  RECOVERY_CONFIG_STORAGE_KEY,
  RECOVERY_OUTBOX_KEY,
  saveData,
  loadData,
  getRecoveryOutbox,
  getRecoveryWriteApiUrl,
  mergeEntriesByIdentity
};`
  )(
    windowObject,
    storage,
    fetchImpl,
    console,
    () => {},
    () => {},
    () => {},
    documentObject,
    class Blob {},
    { createObjectURL: () => "", revokeObjectURL: () => {} }
  );
}

async function run() {
  const patchedHtml = await buildPatchedHtml();
  const { runtimeBlock, updateTabsBlock } = extractRuntime(patchedHtml);

  {
    const remote = new Map();
    const storage = createStorage({ "xxxber-recovery-api-url": "http://local.test/gas" });
    const fetchImpl = createFetch(remote);
    const runtime = createRuntime(runtimeBlock, { storage, fetchImpl });
    const entry = { id: "entry-a", customerName: "A", amount: 1000 };
    const result = await runtime.saveData(runtime.STORAGE_KEY, [entry]);
    assert.equal(result.success, true);
    assert.deepEqual(remote.get(runtime.STORAGE_KEY), [entry]);
    assert.equal(runtime.getRecoveryOutbox().length, 0);
  }

  {
    const remote = new Map();
    const storage = createStorage({ "xxxber-recovery-api-url": "http://local.test/gas" });
    const fetchImpl = createFetch(remote, { failPost: true });
    const runtime = createRuntime(runtimeBlock, { storage, fetchImpl });
    await assert.rejects(() => runtime.saveData(runtime.STORAGE_KEY, [{ id: "entry-b" }]), /simulated save failure/);
    assert.equal(runtime.getRecoveryOutbox().length, 1);
    assert.equal(remote.has(runtime.STORAGE_KEY), false);
  }

  {
    const remote = new Map();
    const storage = createStorage();
    const fetchImpl = createFetch(remote);
    const runtime = createRuntime(runtimeBlock, { storage, fetchImpl });
    const result = await runtime.saveData(runtime.STORAGE_KEY, [{ id: "entry-local" }]);
    assert.equal(result.localOnly, true);
    assert.equal(fetchImpl.calls.length, 0);
    assert.equal(runtime.getRecoveryOutbox().length, 1);
  }

  {
    const remoteEntry = {
      id: "server-a",
      datetime: "2026-06-01T10:00:00",
      customerName: "Same",
      staff: "Staff",
      payMethod: "cash",
      amount: 1000,
      subtotal: 910,
      tax: 90,
      cardFee: 0
    };
    const localDuplicate = { ...remoteEntry, id: "local-duplicate" };
    const localOnly = { id: "local-only", customerName: "B", amount: 2000 };
    const remote = new Map([["sales-manager-entries", [remoteEntry]]]);
    const storage = createStorage({
      "xxxber-recovery-api-url": "http://local.test/gas",
      "sales-manager-entries": JSON.stringify([localDuplicate, localOnly])
    });
    const runtime = createRuntime(runtimeBlock, { storage, fetchImpl: createFetch(remote) });
    const loaded = await runtime.loadData(runtime.STORAGE_KEY);
    assert.equal(loaded.length, 2);
    assert.equal(loaded.some(entry => entry.id === "local-only"), true);
  }

  {
    const remote = new Map([["sales-manager-open-tabs", [{ id: "tab-a", name: "A" }]]]);
    const storage = createStorage({ "xxxber-recovery-api-url": "http://local.test/gas" });
    const fetchImpl = createFetch(remote);
    const runtime = createRuntime(runtimeBlock, { storage, fetchImpl });
    let capturedTabs = null;
    const updateTabs = new Function(
      "isLoaded",
      "loadError",
      "openTabs",
      "setOpenTabs",
      "saveData",
      "loadData",
      "TABS_STORAGE_KEY",
      "console",
      `${updateTabsBlock}
return updateTabs;`
    )(true, null, [], value => { capturedTabs = value; }, runtime.saveData, runtime.loadData, runtime.TABS_STORAGE_KEY, console);
    await updateTabs([{ id: "tab-b", name: "B" }]);
    assert.deepEqual(capturedTabs.map(tab => tab.id).sort(), ["tab-a", "tab-b"]);
    assert.deepEqual(remote.get(runtime.TABS_STORAGE_KEY).map(tab => tab.id).sort(), ["tab-a", "tab-b"]);
  }

  {
    const remote = new Map([["sales-manager-open-tabs", [
      { id: "tab-a", name: "A" },
      { id: "tab-b", name: "B" },
      { id: "tab-c", name: "C" }
    ]]]);
    const storage = createStorage({ "xxxber-recovery-api-url": "http://local.test/gas" });
    const fetchImpl = createFetch(remote);
    const runtime = createRuntime(runtimeBlock, { storage, fetchImpl });
    let capturedTabs = null;
    const updateTabs = new Function(
      "isLoaded",
      "loadError",
      "openTabs",
      "setOpenTabs",
      "saveData",
      "loadData",
      "TABS_STORAGE_KEY",
      "console",
      `${updateTabsBlock}
return updateTabs;`
    )(
      true,
      null,
      [{ id: "tab-a", name: "A" }, { id: "tab-b", name: "B" }],
      value => { capturedTabs = value; },
      runtime.saveData,
      runtime.loadData,
      runtime.TABS_STORAGE_KEY,
      console
    );
    await updateTabs([{ id: "tab-b", name: "B edited" }]);
    assert.deepEqual(capturedTabs.map(tab => tab.id).sort(), ["tab-b", "tab-c"]);
    assert.equal(capturedTabs.find(tab => tab.id === "tab-b").name, "B edited");
  }

  console.log("recovery tests passed");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
