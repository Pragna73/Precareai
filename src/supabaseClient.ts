import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  ((import.meta as any).env?.VITE_SUPABASE_URL as string) ||
  "https://wwgogvotlkgbigwihgyl.supabase.co";

const supabaseAnonKey =
  ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string) ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Z29ndm90bGtnYmlnd2loZ3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MjY3MzksImV4cCI6MjEwMTQwMjczOX0.jnC2VsIJBwizcPYGB-YQDQwTxVAcK6_umuRoUI6-TNM";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
