import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Export configured or null to avoid crash on createClient if keys are missing
export const supabase = (supabaseUrl && supabaseAnonKey)
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

if (!supabase) {
    console.warn('Supabase credentials missing. Project will require VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to function.');
}
