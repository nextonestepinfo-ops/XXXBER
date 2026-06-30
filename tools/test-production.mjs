import fs from "node:fs";
import assert from "node:assert/strict";

const HTML = fs.readFileSync("index.html", "utf8");

function appScript() {
  return [...HTML.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(match => match[1].includes("const API_URL"))[1];
}

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
    }
  };
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
      if (options.successFalse) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: false, error: "gas rejected save" })
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

    if (options.nonJsonGet) {
      return {
        ok: true,
        status: 200,
        text: async () => "<html>not json</html>"
      };
    }
    if (options.failGet) {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ success: false, error: "simulated load failure" })
      };
    }
    const parsed = new URL(String(url));
    assert.equal(parsed.searchParams.get("action"), "get");
    const key = parsed.searchParams.get("key");
    const value = remoteStore.has(key) ? JSON.stringify(remoteStore.get(key)) : "";
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, value })
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function extractRuntime() {
  const script = appScript();
  const runtimeBlock = script.match(/const API_URL[\s\S]*?\/\/ ─── Receipt Viewer \(QR code destination\) ───/)[0];
  const updateTabsBlock = script.match(/const updateTabs = async tabs => \{[\s\S]*?  \};\r?\n  const updateStaff = async list => \{/)[0].replace(/\r?\n  const updateStaff = async list => \{$/, "");
  return { runtimeBlock, updateTabsBlock };
}

function createRuntime(runtimeBlock, { storage, fetchImpl }) {
  const documentObject = {
    createElement() {
      return {
        href: "",
        download: "",
        style: {},
        click() {},
        remove() {}
      };
    },
    body: { appendChild() {} }
  };

  return new Function(
    "localStorage",
    "fetch",
    "console",
    "window",
    "document",
    "Blob",
    "URL",
    `${runtimeBlock}
return {
  STORAGE_KEY,
  TABS_STORAGE_KEY,
  SYNC_OUTBOX_KEY,
  saveData,
  loadData,
  retrySyncOutbox,
  getSyncOutbox,
  setSyncOutbox,
  mergeEntriesByIdentity,
  mergeOpenTabsById
};`
  )(
    storage,
    fetchImpl,
    console,
    { storage: { get: async () => null } },
    documentObject,
    class Blob {},
    { createObjectURL: () => "", revokeObjectURL: () => {} }
  );
}

async function run() {
  const { runtimeBlock, updateTabsBlock } = extractRuntime();

  {
    const remote = new Map();
    const runtime = createRuntime(runtimeBlock, { storage: createStorage(), fetchImpl: createFetch(remote) });
    const entry = { id: "entry-a", customerName: "A", amount: 1000 };
    const result = await runtime.saveData(runtime.STORAGE_KEY, [entry]);
    assert.equal(result.success, true);
    assert.deepEqual(remote.get(runtime.STORAGE_KEY), [entry]);
    assert.equal(runtime.getSyncOutbox().length, 0);
  }

  {
    const remote = new Map();
    const runtime = createRuntime(runtimeBlock, { storage: createStorage(), fetchImpl: createFetch(remote, { failPost: true }) });
    await assert.rejects(() => runtime.saveData(runtime.STORAGE_KEY, [{ id: "entry-b" }]), /simulated save failure/);
    assert.equal(runtime.getSyncOutbox().length, 1);
    assert.equal(remote.has(runtime.STORAGE_KEY), false);
  }

  {
    const remote = new Map();
    const runtime = createRuntime(runtimeBlock, { storage: createStorage(), fetchImpl: createFetch(remote, { successFalse: true }) });
    await assert.rejects(() => runtime.saveData(runtime.STORAGE_KEY, [{ id: "entry-c" }]), /gas rejected save/);
    assert.equal(runtime.getSyncOutbox().length, 1);
  }

  {
    const remote = new Map();
    const runtime = createRuntime(runtimeBlock, { storage: createStorage(), fetchImpl: createFetch(remote, { failGet: true }) });
    await assert.rejects(() => runtime.loadData(runtime.STORAGE_KEY), /simulated load failure/);
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
    const storage = createStorage({ "sales-manager-entries": JSON.stringify([localDuplicate, localOnly]) });
    const runtime = createRuntime(runtimeBlock, { storage, fetchImpl: createFetch(remote) });
    const loaded = await runtime.loadData(runtime.STORAGE_KEY);
    assert.equal(loaded.length, 2);
    assert.equal(loaded.some(entry => entry.id === "local-only"), true);
  }

  {
    const remote = new Map();
    const storage = createStorage({
      "sales-manager-sync-outbox": JSON.stringify([
        { id: "q1", key: "sales-manager-entries", data: [{ id: "queued-entry" }], createdAt: "now" }
      ])
    });
    const runtime = createRuntime(runtimeBlock, { storage, fetchImpl: createFetch(remote) });
    const result = await runtime.retrySyncOutbox();
    assert.deepEqual(result, { retried: 1, remaining: 0 });
    assert.deepEqual(remote.get(runtime.STORAGE_KEY), [{ id: "queued-entry" }]);
  }

  {
    const remote = new Map([["sales-manager-open-tabs", [{ id: "tab-a", name: "A" }]]]);
    const runtime = createRuntime(runtimeBlock, { storage: createStorage(), fetchImpl: createFetch(remote) });
    let capturedTabs = null;
    let saveStatus = "";
    const errors = [];
    const updateTabs = new Function(
      "isLoaded",
      "loadError",
      "openTabs",
      "setOpenTabs",
      "setSaveStatus",
      "saveData",
      "loadData",
      "TABS_STORAGE_KEY",
      "mergeOpenTabsById",
      "markSyncState",
      "console",
      "handleSaveError",
      "showSaved",
      `${updateTabsBlock}
return updateTabs;`
    )(true, "", [], value => { capturedTabs = value; }, value => { saveStatus = value; }, runtime.saveData, runtime.loadData, runtime.TABS_STORAGE_KEY, runtime.mergeOpenTabsById, () => {}, console, (label, err) => errors.push({ label, err }), () => { saveStatus = "保存しました"; });
    await updateTabs([{ id: "tab-b", name: "B" }]);
    assert.deepEqual(capturedTabs.map(tab => tab.id).sort(), ["tab-a", "tab-b"]);
    assert.deepEqual(remote.get(runtime.TABS_STORAGE_KEY).map(tab => tab.id).sort(), ["tab-a", "tab-b"]);
    assert.equal(errors.length, 0);
    assert.equal(saveStatus, "保存しました");
  }

  {
    const remote = new Map([["sales-manager-open-tabs", [
      { id: "tab-a", name: "A" },
      { id: "tab-b", name: "B" },
      { id: "tab-c", name: "C" }
    ]]]);
    const runtime = createRuntime(runtimeBlock, { storage: createStorage(), fetchImpl: createFetch(remote) });
    let capturedTabs = null;
    const updateTabs = new Function(
      "isLoaded",
      "loadError",
      "openTabs",
      "setOpenTabs",
      "setSaveStatus",
      "saveData",
      "loadData",
      "TABS_STORAGE_KEY",
      "mergeOpenTabsById",
      "markSyncState",
      "console",
      "handleSaveError",
      "showSaved",
      `${updateTabsBlock}
return updateTabs;`
    )(
      true,
      "",
      [{ id: "tab-a", name: "A" }, { id: "tab-b", name: "B" }],
      value => { capturedTabs = value; },
      () => {},
      runtime.saveData,
      runtime.loadData,
      runtime.TABS_STORAGE_KEY,
      runtime.mergeOpenTabsById,
      () => {},
      console,
      () => {},
      () => {}
    );
    await updateTabs([{ id: "tab-b", name: "B edited" }]);
    assert.deepEqual(capturedTabs.map(tab => tab.id).sort(), ["tab-b", "tab-c"]);
    assert.equal(capturedTabs.find(tab => tab.id === "tab-b").name, "B edited");
  }

  {
    const remote = new Map([["sales-manager-open-tabs", [{ id: "server-only", name: "Server" }]]]);
    const runtime = createRuntime(runtimeBlock, { storage: createStorage(), fetchImpl: createFetch(remote, { nonJsonGet: true }) });
    let capturedTabs = null;
    let saveStatus = "";
    let marked = 0;
    const errors = [];
    const updateTabs = new Function(
      "isLoaded",
      "loadError",
      "openTabs",
      "setOpenTabs",
      "setSaveStatus",
      "saveData",
      "loadData",
      "TABS_STORAGE_KEY",
      "mergeOpenTabsById",
      "markSyncState",
      "console",
      "handleSaveError",
      "showSaved",
      `${updateTabsBlock}
return updateTabs;`
    )(
      true,
      "",
      [],
      value => { capturedTabs = value; },
      value => { saveStatus = value; },
      runtime.saveData,
      runtime.loadData,
      runtime.TABS_STORAGE_KEY,
      runtime.mergeOpenTabsById,
      () => { marked += 1; },
      console,
      (label, err) => errors.push({ label, err }),
      () => { saveStatus = "保存しました"; }
    );
    await updateTabs([{ id: "local-only", name: "Local" }]);
    assert.deepEqual(capturedTabs.map(tab => tab.id), ["local-only"]);
    assert.deepEqual(remote.get(runtime.TABS_STORAGE_KEY).map(tab => tab.id), ["server-only"]);
    assert.equal(runtime.getSyncOutbox().length, 1);
    assert.equal(runtime.getSyncOutbox()[0].key, runtime.TABS_STORAGE_KEY);
    assert.deepEqual(runtime.getSyncOutbox()[0].data.map(tab => tab.id), ["local-only"]);
    assert.equal(errors.length, 0);
    assert.equal(marked, 1);
    assert.equal(saveStatus, "端末保存済み（未同期）");
  }

  console.log("production tests passed");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
