---
name: TAP·TAP
description: Borne d'arcade générative. Une seule surface — le téléphone, tenu à la verticale. On tape le verre, le FLUX monte, trois moteurs de rendu se dévoilent. Noir & blanc ; la couleur ne surgit que sur les combos et les événements.
status: final
updated: 2026-07-13
colors:
  # Base monochrome
  void: '#0a0a0c'
  cabinet-top: '#141416'
  cabinet-bottom: '#050506'
  ink-100: 'rgba(255,255,255,0.75)'
  ink-60: 'rgba(255,255,255,0.55)'
  ink-30: 'rgba(255,255,255,0.30)'
  # Palette-récompense (combos/événements uniquement)
  magenta: '#ff2e97' # cadence x2
  cyan: '#00f0ff' # cadence x3
  green: '#39ff14' # cadence x4 · SEUIL · gains
  red: '#ff3b30' # détection · boss/danger
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

La règle qui gouverne tout : **noir & blanc par défaut ; la couleur ne surgit que sur les combos et les événements.** Le monde de TAP·TAP est monochrome — un objet de culte sombre, gris sur noir. La couleur est **rare et signifiante** : elle *saigne* dans l'écran quand tu entres en flux (cadence, résonance) ou qu'un événement éclate (seuil, détection, boss). Le gris est le repos ; la couleur est la vie. Rien ne « fait joli » : une teinte qui s'allume répond toujours à *pourquoi ici, maintenant*.

Surface unique et assumée : **le téléphone en portrait**, tenu à une main, tapé au pouce. Tout est calibré pour ça.

## Colors

**Base monochrome.** Aucun mode clair, aucun thème. Tout le persistant est en niveaux de gris sur noir :

- **Void (`#0a0a0c`)** — noir neutre, le fond de tout rendu.
- **Coque** — dégradé gris-noir (`#141416`→`#050506`) autour de l'écran.
- **Blancs & gris** — moteurs (ondes, couronnes, flux marbré), HUD (stage, score, high), jauge FLUX, boot, sélecteur : blanc pur → gris, distincts par la **clarté**, jamais la teinte.

**Palette-récompense** (la couleur, uniquement sur combos/événements — un signal, jamais un décor) :

- **Cadence** — la teinte *encode le palier de flux* : ×2 **magenta `#ff2e97`** → ×3 **cyan `#00f0ff`** → ×4 **green `#39ff14`**. Anneaux, flash d'impact et voile d'ambiance se colorent avec le multiplicateur. Au repos (×1) : blanc.
- **Résonance / interférence** — embrasement coloré de l'anneau touché (événement de combo).
- **Green (`#39ff14`)** — le franchissement : FLUX plein, flash **SEUIL**, gains (`+3 %`), jauge « chaude » (seuil imminent), respiration de la jauge au tempo.
- **Red (`#ff3b30`)** — la menace : **détection du bruit** (anti-spam), dégâts et **boss/danger** (à venir). Le seul rouge, jamais décoratif.

Interdits : toute couleur **persistante** ou décorative (un néon allumé en permanence, un habillage teinté) ; toute couleur pastel ou désaturée. La couleur doit toujours être *déclenchée* par un combo ou un événement.

## Typography

Monospace système partout — la borne pense en caractères de terminal. Deux registres seulement :

- **HUD (technique)** : `hud-label` en capitales espacées, gris ; `hud-value` en gras **blanc** (mono). Chiffres du score zéro-paddés sur 6 (`001603`), façon tableau de scores. Seul le multiplicateur de cadence (`x… CADENCE`) se colore — c'est un combo.
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

- **HUD** — bandeau haut, trois colonnes : STAGE (**blanc**), SCORE (**blanc**, 6 chiffres), HIGH (blanc) + `x… CADENCE` (green quand actif — seul élément coloré du HUD, c'est un combo). Labels `hud-label` gris, valeurs `hud-value` blanches.
- **Jauge FLUX** — barre fine, remplissage dégradé cyan→green, halo green + `%` qui passe au green au-delà de 80 %. Transition largeur ≤ 90ms (réactive au tap).
- **Écran CRT** — surface `void` arrondie 16px, `inset shadow`, calques scanlines (multiply) + vignette radiale par-dessus le moteur. Cible de tap plein cadre.
- **Sélecteur de stage** — trois boutons égaux : numéro (ou 🔒 verrouillé / ⚠ moteur indisponible) + nom. Actif = bordure + fond **blancs** (monochrome, aucune teinte de stage). Désactivé = grisé, `not-allowed`.
- **Seuil (flash)** — plein écran, voile green translucide, mot `threshold` centré + nom du stage (**événement** → couleur). ~0,95s, `pointer-events:none`.
- **Éveil (boot)** — plein écran `void`, lignes `oracle` **blanches/grises** qui apparaissent une à une, CTA blanche clignotante. La borne dort : la couleur n'est pas encore là. Tap n'importe où = entrée.
- **Couche FX** — au-dessus des moteurs, sous les scanlines : anneau résonnable (blanc au repos, coloré par la cadence), flash d'impact, embrasement. C'est là que la couleur *saigne* dans le monochrome.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Noir & blanc par défaut ; la couleur *saigne* sur combo/événement | Couleur persistante, décorative ou pastel |
| Cadence = teinte (×2 magenta → ×3 cyan → ×4 vert) | Colorer un élément qui ne signale ni combo ni événement |
| Moteurs, HUD, jauge, boot, sélecteur en niveaux de gris | Habillage/HUD teinté en permanence |
| Portrait téléphone, une main, pouce | Layouts desktop/paysage, hover, curseurs |
| Monospace : HUD en CAPS / oracle en bas-de-casse | Mélanger les deux registres de voix |
| Rouge = détection/menace/boss uniquement | Rouge décoratif ou d'erreur-formulaire |
