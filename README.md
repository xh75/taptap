# TAP·TAP

> Borne d'arcade générative psychédélique — React / TypeScript / Vite / Tailwind

Un générateur d'esthétiques psychédéliques déguisé en borne d'arcade des années 90. On tape l'écran CRT pour charger la jauge **FLOW** ; jauge pleine, on débloque le stage suivant, avec un nouveau moteur de rendu et une nouvelle esthétique.

## Le principe

Le geste central est le **tap**. Chaque tap déclenche une pulsation au point exact touché et remplit la jauge FLOW. Taper vite enchaîne des **combos** qui rechargent plus fort. Au repos, la jauge redescend. FLOW à 100 % → flash « STAGE UP! » et bascule vers le stage supérieur.

## Les 3 stages

| Stage | Moteur | Esthétique | Détail |
|-------|--------|-----------|--------|
| 1 · **WAVEFORM** | SVG | Ondes & interférences | Sinusoïdes déphasées + ripples de tap. Coût GPU quasi nul. |
| 2 · **MANDALA** | Canvas 2D | Fractales radiales | Symétrie en couronnes, composite `lighter`, traînée par fondu. |
| 3 · **LIQUID** | WebGL | Flux marbré | fbm 6 octaves dans un fragment shader. Onde de choc au tap. |

Un stage débloqué reste accessible via le sélecteur 1 / 2 / 3 (verrouillés : 🔒). La progression et le high-score sont **persistés en `localStorage`**.

## Direction artistique

Palette fixe, esthétique CRT/néon : fond `#0a0118`, magenta `#ff2e97`, cyan `#00f0ff`, amber (score) `#ffd600`, green (unlock/FLOW) `#39ff14`. Écran CRT bombé (scanlines + vignette), HUD de score, boot BIOS.

## Attention UX / performance

- `devicePixelRatio` plafonné à **2**.
- `ResizeObserver` plutôt qu'un listener `resize`.
- Uniforms WebGL en **refs** — pas de recompilation du shader par frame.
- Ondes de tap séparées par moteur : `state` React pour le SVG, `ref` pour Canvas/WebGL (pas de re-render à 60 fps).
- `prefers-reduced-motion` respecté (vitesse ×0.3, scanlines coupées).
- Focus clavier visible (vert), zone de jeu activable au clavier (Espace / Entrée).
- `touch-action: manipulation` — pas de délai de tap ni de zoom accidentel.
- **Fallback WebGL** explicite : si le contexte GL est indisponible, repli automatique sur le stage MANDALA + message.

## Installation

```bash
git clone https://github.com/xh75/taptap
cd taptap
npm install
npm run dev        # http://localhost:5173
```

Build de production :

```bash
npm run build      # tsc strict + vite build -> dist/
npm run preview
```

## Structure

```
src/
  main.tsx      # point d'entrée React
  App.tsx       # monte <TapTap />
  TapTap.tsx    # composant autonome : 3 moteurs, jauge, HUD, CRT, boot BIOS
  index.css     # Tailwind + reset plein écran
```

Le composant `TapTap.tsx` est **autonome** (styles inline, aucune dépendance externe hors React).

## Déploiement

Build Vite standard (`dist/`), `base` relatif → déployable tel quel sur **Vercel** ou **GitHub Pages**.

## Idées d'évolution

- Contrôle de palette en live.
- Son / bips d'arcade au tap et à l'unlock.
- Courbe de décroissance de la jauge ajustable par difficulté.
- Descendre le fbm à 4 octaves sur mobile bas de gamme (boucle du shader LIQUID).
