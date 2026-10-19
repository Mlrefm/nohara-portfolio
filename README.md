# Nohara Yousif Odeesh, portfolio site

Vite, vanilla JS, canvas. Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

```bash
npm install
npm run dev
```

Open the local URL Vite prints (usually http://localhost:5173).

The live site reads `public/content.json`. Assets live in `public/`: `stills/`, `clips/`, `portrait.jpeg`, and the CV.

## Studio (admin)

`/admin/` is a private desk for copy, projects, images, films, and documents. It is not linked from the public site.

GitHub Pages cannot run a server, so the live password cannot sit in the page as plain text. On first setup a GitHub token (Contents: Read and write) is sealed inside the admin password with PBKDF2 and AES-GCM (`studio.lock.json`). After that the client only needs the username and password. Publish writes `public/content.json` and `public/uploads/`, which triggers Pages to rebuild.

Do the first setup as soon as `/admin/` is live, before sharing the site. Use a long password (at least 10 characters). Do not give the client the GitHub token.

### Local

Copy `.env.example` to `.env.local`, set `ADMIN_USER` / `ADMIN_PASS`, then open http://localhost:5173/admin/.

To create the live key from your machine instead of the public URL, set `VITE_ADMIN_API=github` in `.env.local`.

### Live (GitHub Pages)

1. Create a fine-grained GitHub token for this repo with **Contents: Read and write**.
2. Open `/admin/` on the live site (or local with `VITE_ADMIN_API=github`).
3. Fill owner, repo, token, admin username, and password.
4. Give the client only that username and password.

Files up to 20 MB. After Publish, wait about a minute for Pages.

Optional stronger setup: `cd api && npx wrangler deploy`, set secrets `ADMIN_USER`, `ADMIN_PASS`, `SESSION_SECRET`, `GITHUB_TOKEN`, then put the Worker URL in `public/admin-config.json` as `api`.
