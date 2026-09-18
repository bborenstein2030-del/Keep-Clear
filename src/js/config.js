/* Account settings. Leave supabaseUrl empty to run Keepclear without sign-in.
   The publishable (anon) key is meant to be public: Row Level Security in
   supabase/schema.sql is what keeps each person's data private.
   Never put a secret or service_role key here. */
window.KEEPCLEAR_CONFIG = {
  supabaseUrl: 'https://xsnzfsrpuoqdqylqdvje.supabase.co',
  supabaseKey: 'sb_publishable_h2Y4OTetDCcAYzfeE15-Gg_1w35vsKE', // publishable key: safe to be public
  // Sign-in buttons to offer. Each one only appears once it's turned on in Supabase
  // (Authentication > Sign In / Providers), so nothing shows up broken.
  providers: ['google', 'apple'],
};
