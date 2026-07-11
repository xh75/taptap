---
name: TAP·TAP
description: Borne d'arcade générative psychédélique. Une seule surface — le téléphone, tenu à la verticale. On tape le verre, le FLUX monte, trois moteurs de rendu se dévoilent. Noir profond, néon, aucune couleur décorative.
status: final
updated: 2026-07-11
colors:
  void: '#0a0118'
  cabinet: '#05010d'
  panel: '#120826'
  magenta: '#ff2e97'
  cyan: '#00f0ff'
  amber: '#ffd600'
  green: '#39ff14'
  ink-100: 'rgba(255,255,255,0.75)'
  ink-60: 'rgba(255,255,255,0.45)'
  ink-30: 'rgba(255,255,255,0.30)'
typography:
  family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  hud-label: { size: 10px, tracking: 0.18em, case: UPPER, color: ink-60 }
  hud-value: { size: 15-18px, weight: 700 }
  oracle: { size: 'clamp(11px,3vw,15px)', tracking: 0.02em, case: lower }
  threshold: { size: 'clamp(28px,9vw,64px)', weight: 800, tracking: 0.1em, case: UPPER }
rounded:
  screen: 16px
  cabinet: 20px
  control: 8px
  gauge: 6px
spacing:
  '1': 4px
  '2': 8px
  '3': 10px
  '4': 14px
  '6': 20px
---

## Brand & Style

TAP·TAP se déguise en borne d'arcade des années 90 pour livrer, en réalité, un générateur d'esthétiques psychédéliques. Le ton n'est pas nostalgique-kitsch : c'est un objet de culte sombre. Le verre bombé, les scanlines et le boot ne sont pas des gadgets rétro — ils cadrent le visuel comme une **relique qui s'éveille sous le doigt**.

La règle qui gouverne tout : **la couleur est un signal, jamais une décoration.** Le fond est un noir violacé quasi absolu (`void`) ; les néons ne servent qu'à dire quelque chose — magenta = présence/stage courant, cyan = mouvement/énergie, amber = trace chiffrée (score), green = franchissement/FLUX. Rien ne « fait joli » sans porter un sens. Le psychédélisme vit dans les **moteurs de rendu** (ondes, couronnes, flux), pas dans l'habillage.

Surface unique et assumée : **le téléphone en portrait**, tenu à une main, tapé au pouce. Tout est calibré pour ça.

## Colors

Palette FIXE (aucun mode clair, aucun thème alternatif — le noir profond est l'identité).

- **Void (`#0a0118`)** — l'écran, le vide d'où naît le visuel. Le fond de tout rendu.
- **Cabinet (`#05010d`) / Panel (`#120826`)** — la coque de la borne autour de l'écran ; dégradé sombre qui isole l'écran du reste du monde.
- **Magenta (`#ff2e97`)** — la présence : nom du stage courant, ondes SVG, bordure du stage actif. La couleur « toi, ici, maintenant ».
- **Cyan (`#00f0ff`)** — le mouvement : jauge en charge, boot, couronnes ambiantes du mandala.
- **Amber (`#ffd600`)** — la trace : le SCORE et lui seul. Chiffres qui s'accumulent.
- **Green (`#39ff14`)** — le franchissement : FLUX plein, flash de seuil, combos, focus clavier, déblocage. La couleur de la bascule.

Interdits : tout rouge (TAP·TAP ne connaît pas l'erreur-formulaire — un échec se dit dans la voix, pas dans une pastille rouge) ; toute couleur pastel ou désaturée ; tout néon employé « pour habiller ». Un néon allumé doit toujours répondre à *pourquoi ici*.

## Typography

Monospace système partout — la borne pense en caractères de terminal. Deux registres seulement :

- **HUD (technique)** : `hud-label` en capitales espacées, gris ; `hud-value` en gras coloré (magenta/amber). Chiffres du score zéro-paddés sur 6 (`001603`), façon tableau de scores.
- **Oracle (narratif)** : `oracle` en **bas-de-casse**, interligne aéré — la borne murmure. À l'opposé du HUD : minuscule, calme, sans capitales. Le contraste casse/tracking distingue *la machine qui compte* de *la borne qui parle*.
- **Threshold** : `threshold`, capitales massives + `text-shadow` vert au moment du franchissement de seuil. Le seul moment typographiquement « fort ».

Aucune police web chargée (perf + hors-réseau). Tailles fluides en `clamp()` pour tenir du petit au grand téléphone.

## Layout & Spacing

Échelle : 4 / 8 / 10 / 14 / 20 px. Une seule colonne, plein écran, jamais de scroll.

Structure verticale fixe, du haut vers le bas : **HUD** (stage · score · high · combo) → **jauge FLUX** → **écran CRT** (prend tout l'espace flexible) → **sélecteur de stage 1/2/3**. L'écran est le héros ; HUD et contrôles sont des lisières fines qui l'encadrent sans jamais le concurrencer.

Respect strict des `safe-area-inset` (encoche, barre home). Zones tactiles ≥ 44px. Tout est atteignable au pouce : le sélecteur de stage vit en bas, la cible de tap est l'écran entier.

## Elevation & Depth

La profondeur ne vient pas d'ombres Material mais de la **métaphore CRT** : l'écran est enfoncé dans la coque (`box-shadow: inset`), bombé par une vignette radiale, strié de scanlines. Une seule lueur externe : un halo magenta très diffus autour de la cabine, signe qu'elle est « sous tension ». Pas d'ombres portées d'UI, pas de cartes flottantes.

## Shapes

- `rounded/screen` (16px) — l'écran CRT.
- `rounded/cabinet` (20px) — la coque extérieure.
- `rounded/control` (8px) — boutons du sélecteur de stage.
- `rounded/gauge` (6px) — la jauge FLUX.

Coins doux partout, jamais de cercle parfait pour une surface, jamais de pilule. Les seuls cercles vrais sont *générés* (ondes, points de mandala, ondes de choc) — jamais des éléments d'UI.

## Components

- **HUD** — bandeau haut, trois colonnes : STAGE (magenta), SCORE (amber, 6 chiffres), HIGH + COMBO (green quand actif). Labels `hud-label`, valeurs `hud-value`.
- **Jauge FLUX** — barre fine, remplissage dégradé cyan→green, halo green + `%` qui passe au green au-delà de 80 %. Transition largeur ≤ 90ms (réactive au tap).
- **Écran CRT** — surface `void` arrondie 16px, `inset shadow`, calques scanlines (multiply) + vignette radiale par-dessus le moteur. Cible de tap plein cadre.
- **Sélecteur de stage** — trois boutons égaux : numéro (ou 🔒 verrouillé / ⚠ moteur indisponible) + nom. Actif = bordure + fond teinté de la couleur du stage. Désactivé = grisé, `not-allowed`.
- **Seuil (flash)** — plein écran, voile green translucide, mot `threshold` centré + nom du stage. ~0,95s, `pointer-events:none`.
- **Éveil (boot)** — plein écran `void`, lignes `oracle` cyan qui apparaissent une à une, CTA green clignotante en bas. Tap n'importe où = entrée.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Couleur = signal (état/énergie/franchissement) | Couleur « décorative » ou pastel |
| Psychédélisme dans les moteurs de rendu | Psychédélisme dans l'habillage/HUD |
| Portrait téléphone, une main, pouce | Layouts desktop/paysage, hover, curseurs |
| Monospace : HUD en CAPS / oracle en bas-de-casse | Mélanger les deux registres de voix |
| Noir profond fixe, unique identité | Mode clair, thèmes alternatifs |
| Échec dit dans la voix de la borne | Pastille/fond rouge d'erreur |
