/**
 * Kille — Publik Supabase-konfiguration.
 *
 * OBS: Endast den PUBLIKA anon-nyckeln får ligga här. Den är avsedd att skickas
 * till webbläsaren och skyddas av Row Level Security + RPC-funktioner i
 * databasen (se supabase/schema.sql). Service-role- och secret-nycklar får
 * ALDRIG hamna i klientkoden.
 *
 * Värdena kan överstyras per enhet via localStorage-nycklarna
 * `kille_supabase_url` och `kille_supabase_key` (t.ex. för test mot en annan
 * instans) utan att koden behöver ändras.
 */

const DEFAULT_URL = 'https://cdzzhevddtdjouapjbtu.supabase.co';
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkenpoZXZkZHRkam91YXBqYnR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NTQ4NDAsImV4cCI6MjEwMDEzMDg0MH0.hLWK85nSQX0JQLWoBNvuKXrMIXWeR-pIsgw-rXsUNVk';

function override(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(key) || fallback;
}

export const SUPABASE_URL = override('kille_supabase_url', DEFAULT_URL).replace(/\/$/, '');
export const SUPABASE_ANON_KEY = override('kille_supabase_key', DEFAULT_ANON_KEY);

/** True om en Supabase-instans är konfigurerad (grupp-läge är då möjligt). */
export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
