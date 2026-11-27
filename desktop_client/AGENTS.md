# Fortis Desktop Client

Electron POS terminal app. It activates a terminal, signs in staff and runs billing at the counter.
It uses the backend API at `/api/v1` (contract: `../backend/endpoints-details.md`). Mockups in `designs/`:
`terminal_activation.html`, `sign_in.html`, `universal_loader.html`.

## Commands

```bash
npm start                 # electron-forge start (dev, Vite HMR)
npm run package | make    # package / build installers (Squirrel, ZIP, deb, rpm)
npm run lint | lint:fix   # oxlint + oxfmt
npm run typecheck         # tsc --noEmit
```

## Stack

- Electron 45 + Electron Forge 8 with the Vite plugin. TypeScript (strict, no `any`).
- Check Electron and Forge APIs with context7 before using them.
- Renderer: React with the libraries below. Install each one the first time a feature needs it:
  - **Tailwind CSS** for all styling.
  - **shadcn/ui** for UI primitives. Add components with the shadcn CLI; don't hand-roll one shadcn already provides.
  - **react-icons** for icons.
  - **react-hook-form** (`useForm`) + **zod** schema + `zodResolver` from **@hookform/resolvers/zod** for every form.

## Layout

```
src/main.ts                       main process (windows, app lifecycle, privileged work)
src/preload.ts                    contextBridge: the only bridge between main and renderer
src/renderer.ts, index.html, src/index.css    renderer entry
src/components/shared/            components used by 2+ screens
src/components/<page_name>/<Component>.tsx    components for one screen
src/hooks/                        custom hooks (use<Name>.ts)
src/types/shared/                 cross-screen types
src/types/<page_name>/*.ts        types for one screen
src/api/                          typed functions that call the backend, grouped by resource
forge.config.mts, vite.{main,preload,renderer}.config.mts    build config
```

- Split every screen into components under `src/components/<page_name>/`. Screen files only compose them.
- Put reusable stateful or effect logic in a custom hook in `src/hooks/`, not inline in components.
- Derive types from zod schemas (`z.infer`) where possible.
- Every backend call goes through `src/api/`. Components never call `fetch` directly.
- Server Components don't exist in Electron. Keep renderer components presentational and put privileged work
  (tokens, file system, devices, printers) in the main process behind typed IPC.

## Security rules

- Keep `contextIsolation` on, `nodeIntegration` off and the sandbox on.
- Expose only narrow, typed functions through `contextBridge` in `src/preload.ts`. Never expose `ipcRenderer`
  itself.
- Validate every IPC payload in the main process (with zod).
- Don't weaken the fuses in `forge.config.mts`.
- Open DevTools only in development. Note: `src/main.ts` currently calls `openDevTools()` unconditionally.

## Rules

- Build the UI from the `designs/` mockups and keep the Fortis palette. Never ship the mockups' CDN Tailwind script.
- Run `npm run lint` and `npm run typecheck` before calling work done, and check the change in the running app
  (`npm start`).
