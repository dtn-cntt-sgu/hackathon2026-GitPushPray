// chrome.* tối giản cho kiểm thử background trong Node (không phải bản mô phỏng đầy đủ).
type Listener = (msg: unknown, sender: { tab?: { id: number } }, sendResponse: (r: unknown) => void) => boolean | void;

function area() {
  let data: Record<string, unknown> = {};
  const changeListeners: ((c: Record<string, { newValue?: unknown }>) => void)[] = [];
  return {
    _dump: () => data,
    async get(key: string | null) {
      if (key === null) return structuredClone(data);
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(obj: Record<string, unknown>) {
      data = { ...data, ...structuredClone(obj) };
      changeListeners.forEach((l) => l(Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }]))));
    },
    async remove(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      data = Object.fromEntries(Object.entries(data).filter(([k]) => !list.includes(k)));
      changeListeners.forEach((l) => l(Object.fromEntries(list.map((k) => [k, { newValue: undefined }]))));
    },
    async clear() {
      const keys = Object.keys(data);
      data = {};
      changeListeners.forEach((l) => l(Object.fromEntries(keys.map((k) => [k, { newValue: undefined }]))));
    },
    onChanged: { addListener: (l: (c: Record<string, { newValue?: unknown }>) => void) => changeListeners.push(l) },
  };
}

export function installFakeChrome() {
  const runtimeListeners: Listener[] = [];
  /** Phản hồi giả của content script theo tabId. */
  const tabHandlers = new Map<number, (msg: unknown) => unknown>();
  const badge = { text: '' };
  /** Alarm không tự kêu, test gọi fireAlarm để mô phỏng. */
  const alarms = new Map<string, number>();
  const alarmListeners: ((a: { name: string }) => void)[] = [];

  const dispatch = (msg: unknown, sender: { tab?: { id: number } }) =>
    new Promise((resolve) => {
      for (const l of runtimeListeners) {
        const keep = l(msg, sender, resolve);
        if (!keep) resolve(undefined);
      }
    });

  const chromeFake = {
    storage: { session: area(), local: area() },
    runtime: {
      onMessage: { addListener: (l: Listener) => runtimeListeners.push(l) },
      sendMessage: (msg: unknown) => dispatch(msg, {}),
      getManifest: () => ({ version: '0.5.0' }),
    },
    tabs: {
      async sendMessage(tabId: number, msg: unknown) {
        const h = tabHandlers.get(tabId);
        if (!h) throw new Error('no receiver');
        return h(msg);
      },
      onRemoved: { addListener: (l: (id: number) => void) => (chromeFake as any)._onRemoved.push(l) },
    },
    _onRemoved: [] as ((id: number) => void)[],
    sidePanel: { setPanelBehavior: async () => { } },
    action: {
      setBadgeText: async ({ text }: { text: string }) => {
        badge.text = text;
      },
      setBadgeBackgroundColor: async () => { },
    },
    permissions: { contains: async () => false, request: async () => true },
    alarms: {
      create: async (name: string, info: { when: number }) => void alarms.set(name, info.when),
      clear: async (name: string) => alarms.delete(name),
      onAlarm: { addListener: (l: (a: { name: string }) => void) => alarmListeners.push(l) },
    },
  };
  (globalThis as any).chrome = chromeFake;

  return {
    chrome: chromeFake,
    badge,
    /** Gửi từ side panel. */
    panel: (msg: unknown) => dispatch(msg, {}),
    /** Gửi từ content script của tab. */
    content: (tabId: number, msg: unknown) => dispatch(msg, { tab: { id: tabId } }),
    onTab: (tabId: number, h: (msg: unknown) => unknown) => tabHandlers.set(tabId, h),
    closeTab: (tabId: number) => chromeFake._onRemoved.forEach((l) => l(tabId)),
    alarms,
    fireAlarm: (name: string) => {
      alarms.delete(name);
      alarmListeners.forEach((l) => l({ name }));
    },
  };
}