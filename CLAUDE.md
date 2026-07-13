# CLAUDE.md — TAP·TAP

Ce fichier est lu automatiquement par Claude Code au démarrage de chaque session sur ce dépôt.

## Projet

**TAP·TAP** — borne d'arcade générative psychédélique, jeu web **téléphone uniquement** (portrait, tap au pouce). On tape l'écran CRT pour remplir la jauge **FLUX** ; jauge pleine = seuil franchi, moteur de rendu suivant débloqué. Trois couches : **WAVEFORM** (SVG) → **MANDALA** (Canvas 2D) → **LIQUID** (WebGL, fbm 6 octaves).

Porteur : **Xavier**. Dépôt : `xh75/taptap` (public). Parler et documenter **en français**.

## Stack & commandes

- Vite 5 + React 18 + TypeScript 5.4 strict + Tailwind 3. Composant central **autonome** : `src/TapTap.tsx` (styles inline, seul React en dépendance).
- `npm run dev` (5173) · `npm run build` (tsc strict + vite) · `npm run preview` · `npm run lint` (0 warning).
- Déploiement : build Vite standard (`dist/`), `base` relatif — Vercel connecté au dépôt (push sur `main` = déploiement).

## Où est la vérité (docs → elles font foi sur le code)

- `docs/ux/ux-tap-tap-*/DESIGN.md` — identité visuelle : palette-signal, CRT, typo (HUD CAPS vs oracle bas-de-casse).
- `docs/ux/ux-tap-tap-*/EXPERIENCE.md` — comportement : états, microcopie oracle (tableau « fait foi »), plancher a11y.
- `docs/design/matrice-boss.md` — cadre narratif **« L'Intrus »**, matrice des 3 boss (LA PORTEUSE / LE ROUAGE / LE NOYAU), modèle de combat (INTÉGRITÉ / SIGNAL / SURCHARGE).
- `docs/design/combos-et-interstices.md` — grammaire des combos (CADENCE / RÉSONANCE / INTERFÉRENCE / LE BRUIT) + boucle rituelle inter-sessions (VEILLE → INTRUSION → PORTE DU BOSS → PURGE…).
- `docs/ux/ux-tap-tap-*/review-adversarial-*.md` — findings de revue ; les mineurs non corrigés y sont listés.

**Statut** : v1 en ligne (3 moteurs, revue corrigée). Grammaire des combos, interstices et boss = **design validé, NON implémenté** (écart assumé design ↔ code).

## Règles non négociables

1. **La couleur est un signal, jamais décorative** : magenta = présence · cyan = énergie · ambre = score (et lui seul) · vert = franchissement/gain · **rouge = menace/dégâts** (réservé au combat/détection).
2. **Voix oracle** : la borne parle en bas-de-casse, énigmatique, hostile depuis « L'Intrus » (elle te prend pour une infection). Le HUD reste technique (CAPS). Jamais mélangés sur une même ligne. La microcopie des specs fait foi.
3. **Téléphone d'abord, jamais de scroll**, cibles ≥ 44 px, `prefers-reduced-motion` respecté partout (condition d'accès), la couleur jamais seule porteuse de sens.
4. **Perf** : dPR plafonné à 2, ResizeObserver, uniforms WebGL en refs, pas de re-render React à 60 fps (moteurs `memo`, taps via refs), pas de `shadowBlur` par-op (sprites pré-rendus).
5. Vérifier tout changement gameplay **en conditions réelles** : build tsc strict + rejeu Chromium (Playwright, `/opt/pw-browsers/chromium-*/chrome-linux/chrome`, viewport téléphone) avant de pousser.

## Outillage BMad

`_bmad/` + `.claude/skills` installés localement (gitignorés, régénérables : `npx bmad-method install --directory . --modules bmm,cis --next cis --tools claude-code --yes`). Artefacts configurés vers `docs/` (versionnés). Skills utiles : `bmad-quick-dev` (implémentation), `bmad-party-mode`, `bmad-ux`, `bmad-help`.
