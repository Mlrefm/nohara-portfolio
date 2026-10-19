# Nohara Yousif Odeesh, portfolio site

Vite, vanilla JS, canvas. Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

```bash
npm install
npm run dev
```

Open the local URL Vite prints (usually http://localhost:5173).

The live site reads `public/content.json` (and, once connected, the studio API). Assets live in `public/`: `stills/`, `clips/`, `portrait.jpeg`, and the CV.

## Studio (admin)

`/admin/` is a private desk for copy, projects, images, films, and documents. It is not linked from the public site.

Locally, copy `.env.example` to `.env.local` and set `ADMIN_USER` / `ADMIN_PASS`, then open http://localhost:5173/admin/.

Production uses a small Cloudflare Worker plus R2 so the password never sits in the GitHub Pages files. Publish writes `content.json` and uploads; the public site picks them up on the next load.
