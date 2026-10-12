# Afters

Chicago rave calendar. Editors drop a flyer screenshot or ticket link, it gets read and pinned to the right night. Anyone can sign in with email and tap "I'm going!".

- Static site, no build step: `index.html`, `styles.css`, `app.js`, `config.js`
- Data, logins, flyer storage and the `parse-event` reader (OpenAI) live in Supabase project `chicagoraves`
- Deploy: import this repo on Vercel, framework preset "Other", no build command

After the first deploy, add the Vercel URL in Supabase → Authentication → URL Configuration (Site URL + Redirect URLs) so sign-in links come back to the site.
