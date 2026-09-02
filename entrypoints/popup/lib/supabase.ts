import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.WXT_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.WXT_SUPABASE_ANON_KEY;

// chrome.storage.local, not localStorage: the session must be readable from
// both the popup document and the background service worker (which has no
// localStorage at all).
const chromeStorageAdapter = {
  async getItem(key: string) {
    const result = await browser.storage.local.get(key);
    return (result[key] as string) ?? null;
  },
  async setItem(key: string, value: string) {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key: string) {
    await browser.storage.local.remove(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: chromeStorageAdapter,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
