# Setting up accounts

Keepclear works without accounts. Once you finish these steps, people can sign in with email, Google or Apple, and their plan saves to your database and syncs across devices.

Everything runs on [Supabase](https://supabase.com) (free plan). No server code is needed.

## 1. Create the Supabase project

1. Sign up at supabase.com and create a new project. Save the database password somewhere safe.
2. Open **SQL Editor**, click **New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. This creates the `user_data` table and the rules that keep each person's data private.

## 2. Connect the site to the project

1. In Supabase, go to **Project Settings** > **API Keys** (or **Data API**). Copy:
   - the **Project URL** (looks like `https://abcd1234.supabase.co`)
   - the **publishable key** (starts with `sb_publishable_`), or the legacy **anon** key
2. Paste them into [`src/js/config.js`](src/js/config.js), or send them to Claude to do it.

The publishable key is safe to put in the website; the database rules protect the data. **Never** use the `secret` or `service_role` key in the site.

## 3. Tell Supabase where your site lives

**Authentication** > **URL Configuration**:

- **Site URL:** your live address, like `https://keep-clear.vercel.app` (or your own domain later)
- **Redirect URLs:** add each place you'll sign in from:
  - `https://keep-clear.vercel.app`
  - `http://localhost:4178` (local testing)

Sign-in only returns to addresses on this list.

## 4. Email sign-in

On by default. People type their email and get a sign-in link; there are no passwords to manage.

Supabase's built-in email sender only sends a few emails per hour, which is fine for testing. Before real people use it, add your own email provider under **Authentication** > **Emails** > **SMTP Settings** (Resend has a free tier).

The link has to be opened in the same browser where it was requested.

## 5. Google sign-in

1. Go to [Google Cloud Console](https://console.cloud.google.com), create a project, and set up the **OAuth consent screen** (app name Keepclear, your email, and your site's domain).
2. **APIs & Services** > **Credentials** > **Create credentials** > **OAuth client ID** > **Web application**.
   - **Authorized JavaScript origins:** your site, like `https://keep-clear.vercel.app`
   - **Authorized redirect URIs:** `https://YOUR-PROJECT.supabase.co/auth/v1/callback` (Supabase shows the exact one on its Google provider page)
3. Copy the **Client ID** and **Client secret** into Supabase: **Authentication** > **Sign In / Providers** > **Google**, then enable it.

## 6. Apple sign-in (optional)

This needs a paid **Apple Developer Program** membership ($99/year).

1. In the Apple Developer portal, create an **App ID** with **Sign in with Apple** turned on.
2. Create a **Services ID**. Configure Sign in with Apple on it with your site's domain and the return URL `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
3. Create a **Key** with Sign in with Apple enabled and download the `.p8` file.
4. In Supabase, **Authentication** > **Sign In / Providers** > **Apple**: enter the Services ID, Team ID, Key ID and the key, then enable it.
5. In [`src/js/config.js`](src/js/config.js), change `providers` to `['google', 'apple']` so the button appears.

Apple's generated secret expires every 6 months. Supabase's Apple provider page explains how to renew it.

## 7. Deploy

Commit and push. Vercel redeploys, and a **Sign in** button appears at the bottom of the side menu and in Settings.

## Good to know

- **Free projects pause after a week with no activity.** Data is kept; resume the project from the Supabase dashboard. The paid plan doesn't pause.
- **Signing out** removes the plan from that browser (it stays in the account), so shared computers stay private.
- **Two devices editing at once:** the save that reaches the database first wins, and the other device gets a **Keep mine** option.
- **The Claude artifact version** never shows sign-in; accounts only work on the real website.
