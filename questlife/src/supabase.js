import { createClient } from '@supabase/supabase-js';

// These values are replaced by the user with their own Supabase project credentials.
// See SETUP.md for instructions.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || '';

export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export const isSupabaseReady = () => !!supabase;

// ─── Load full game state from Supabase ───────────────────────────────────────
export async function loadFromSupabase() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('game_state')
      .select('*')
      .eq('id', 'main')
      .single();
    if (error || !data) return null;
    return data.state;
  } catch {
    return null;
  }
}

// ─── Save full game state to Supabase ─────────────────────────────────────────
export async function saveToSupabase(state) {
  if (!supabase) return;
  try {
    await supabase
      .from('game_state')
      .upsert({ id: 'main', state, updated_at: new Date().toISOString() });
  } catch (e) {
    console.warn('Supabase save failed:', e);
  }
}

// ─── Subscribe to real-time changes ───────────────────────────────────────────
export function subscribeToState(onUpdate) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel('game_state_changes')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'game_state',
      filter: 'id=eq.main',
    }, (payload) => {
      if (payload.new?.state) onUpdate(payload.new.state);
    })
    .subscribe();
  return () => supabase.removeChannel(channel);
}
