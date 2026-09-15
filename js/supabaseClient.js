const SUPABASE_URL = "https://yhwqxgeyzvvqxobmrzlt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlod3F4Z2V5enZ2cXhvYm1yemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NTAxMzMsImV4cCI6MjEwNDIyNjEzM30.efDZgbWiCwYqJasksrS3DzgCjF5xlaNLn-hN_AL8A9U";

export function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export async function getSupabaseClient() {
  if (!hasSupabaseConfig()) return null;

  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm");
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export function getSupabasePublicUrl(bucket, path) {
  if (!SUPABASE_URL || !bucket || !path) return "";
  if (/^(https?:|\.\/|\/)/.test(path)) return path;
  const safePath = `${path}`.split("/").map(encodeURIComponent).join("/");
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${safePath}`;
}
