/* Account settings. Leave supabaseUrl empty to run Keepclear without sign-in.
   The publishable (anon) key is meant to be public: Row Level Security in
   supabase/schema.sql is what keeps each person's data private.
   Never put a secret or service_role key here. */
window.KEEPCLEAR_CONFIG = {
  supabaseUrl: '',          // e.g. 'https://abcd1234.supabase.co'
  supabaseKey: '',          // Project Settings > API Keys > publishable key (or the legacy anon key)
  providers: ['google'],    // add 'apple' once Sign in with Apple is configured in Supabase
};
