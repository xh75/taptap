---
name: TAP·TAP — Experience
description: Comment TAP·TAP se comporte. Une seule surface (téléphone portrait), un seul geste (le tap), une tension entre progresser et contempler. La borne parle comme un oracle.
status: final
updated: 2026-07-11
design_ref: ./DESIGN.md
---

## Foundation

**Form-factor : téléphone, portrait, une main, tapé au pouce. Point.** Pas de desktop, pas de paysage, pas de hover, pas de curseur-comme-outil. Toute décision d'interaction suppose un doigt sur du verre.

Pas de framework d'UI (ni shadcn ni natif) : un composant React autonome, styles inline, moteurs de rendu SVG / Canvas 2D / WebGL. L'identité visuelle vit dans `DESIGN.md` ; ce document ne spécifie que le comportement. **Le contenu, c'est le visuel génératif** — l'UI (HUD, jauge, sélecteur) n'est qu'un cadre fin autour de lui.

## Information Architecture

**Un seul écran, zéro navigation.** Il n'y a pas de pages : il y a des **états** d'une même borne, et **trois moteurs** entre lesquels on bascule sur place.

- Le HUD (haut) et le sélecteur de stage (bas) sont toujours présents une fois la borne éveillée.
- Les trois stages — `les ondes` (WAVEFORM), `les couronnes` (MANDALA), `le flux profond` (LIQUID) — ne sont pas des destinations mais des **couches débloquées** d'un même lieu. Un stage verrouillé existe (🔒) mais ne se visite pas.
- Fermeture des surfaces : chaque besoin déclaré a sa place à l'écran, et rien de plus. On n'ajoute pas de menu, de réglages, de tutoriel-écran : l'épure est une décision.

## Voice and Tone

La borne est un **oracle**, pas un manuel. Elle ne dit jamais « appuyez sur le bouton » ; elle murmure ce qui se passe. Registre : bas-de-casse, présent, images d'onde / de sommeil / de seuil / de flux. Court. Jamais deux phrases là où une suffit.

**Règle de sécurité :** le mystère ne doit jamais masquer l'action. Le tout premier appel à l'action (éveiller la borne) reste explicite dans sa forme même s'il est poétique dans ses mots.

Microcopie canonique (le code suit ce tableau — il fait foi) :

| Moment | Voix (fait foi) | Registre / couleur |
|---|---|---|
| Éveil — lignes de boot | `tap·tap` / `quelque chose dort sous le verre.` / `chaque pression est une onde.` / `l'onde en appelle d'autres.` | `oracle`, {colors.cyan} |
| Éveil — CTA départ | `POSE UN DOIGT POUR L'ÉVEILLER` | CTA, {colors.green}, clignotante |
| Franchissement de seuil | `SEUIL` | `threshold`, {colors.green} |
| Seuil → MANDALA | sous-titre : `les couronnes répondent` | `oracle`, blanc |
| Seuil → LIQUID | sous-titre : `le flux profond s'ouvre` | `oracle`, blanc |
| Repli WebGL | `le flux profond ne répond pas — retour aux couronnes` | `oracle`, {colors.ink-60} (gris — la couleur est réservée aux combos/événements) |
| Contemplation (tout ouvert) | `plus rien à franchir. reste, ou recommence.` | `oracle`, {colors.ink-60} |
| Labels HUD | `STAGE` · `SCORE` · `HIGH` · `FLUX` · `x… COMBO` | `hud-label`, technique |

Note de registre : le **HUD reste technique** (capitales, chiffres zéro-paddés) — c'est la machine qui compte. La **voix oracle** (bas-de-casse) — c'est la borne qui parle. Les deux ne se mélangent jamais dans une même ligne. `FLOW` est renommé **`FLUX`** (langue de l'oracle).

## Component Patterns (comportement)

- **Cible de tap (l'écran)** — capte `pointerdown` sur toute sa surface. Chaque tap : (1) pulse le moteur au point exact touché, (2) incrémente le combo si < 700 ms depuis le précédent, (3) recharge le FLUX (gain × bonus de combo), (4) ajoute au score. Aucun délai (`touch-action: manipulation`).
- **Jauge FLUX** — miroir temps réel de l'énergie. Monte par à-coups au tap, redescend seule au repos. Passe visuellement « chaude » (halo green) au-delà de 80 % : signal que le seuil approche.
- **Sélecteur de stage** — bascule immédiate entre stages **débloqués**. Verrouillé = inerte (🔒). Moteur indisponible (WebGL absent) = inerte (⚠). Le FLUX ne se réinitialise pas en changeant de couche.
- **Flash de seuil** — interruption plein écran ~0,95 s, non tactile, qui *acte* le franchissement puis rend la main sur la nouvelle couche.
- **Éveil** — tant que la borne dort, l'écran ne joue pas : il attend le premier doigt.

## State Patterns

1. **Dormante (éveil)** — au chargement. Le moteur ne répond pas encore ; lignes oracle + CTA. Sortie : premier tap.
2. **Vive (progression)** — état nominal. Taps → FLUX ↑, combos, score. Repos → FLUX ↓ (~9 %/s). Pression douce mais réelle : rester actif ou la jauge fond.
3. **Seuil** — FLUX atteint 100 % et une couche supérieure existe : flash `SEUIL`, déblocage, bascule automatique, résidu de FLUX (~14 %) sur la nouvelle couche.
4. **Contemplation (liberté)** — quand les **trois** stages sont ouverts. La tension se relâche : au dernier stage, la décroissance du FLUX **s'adoucit** (on peut s'arrêter et regarder sans tout perdre) et la borne murmure une fois `plus rien à franchir. reste, ou recommence.` Le score reste possible (chasse au high-score) mais n'est plus imposé. C'est le versant « bac à sable » de la tension.
5. **Repli (WebGL absent)** — si le contexte GL manque : bascule douce sur `les couronnes`, ligne oracle grise, stage `le flux profond` marqué ⚠ dans le sélecteur. Jamais d'écran d'erreur brut.
6. **Motion réduite** — si `prefers-reduced-motion` : vitesse des moteurs × 0,3, scanlines coupées. La borne reste jouable et lisible, jamais figée.

## Interaction Primitives

- **Tap** = unité atomique. Coordonnées normalisées [0,1] transmises au moteur (le point de pulsation est *exactement* là où le doigt tombe).
- **Combo** : fenêtre 700 ms. Chaîne de taps rapprochés → multiplicateur croissant (plafonné) sur le gain de FLUX et le score. Silence > 700 ms → combo retombe à zéro.
- **Décroissance** : le FLUX baisse en continu au repos ; adoucie en état Contemplation. Jamais brutale.
- **Séparation par moteur (perf)** : les ondes de tap passent par le **state React** pour le SVG, par des **refs** pour Canvas/WebGL — pas de re-render à 60 fps. Uniforms WebGL en refs (pas de recompilation du shader).
- **Clavier** : la zone de jeu est focusable ; `Espace`/`Entrée` = tap (léger jitter autour du centre) pour jouer sans toucher l'écran.

## Accessibility Floor

- **Zones tactiles ≥ 44px** ; la cible principale est l'écran entier.
- **Clavier** : borne jouable au clavier, focus visible en {colors.green} (`:focus-visible`, jamais supprimé).
- **`prefers-reduced-motion`** respecté (voir État 6) — condition d'accès, pas une option cachée.
- **La couleur n'est jamais le seul porteur de sens** : un stage verrouillé montre 🔒 (pas seulement un grisé) ; le combo affiche `x… COMBO` en toutes lettres ; le seuil dit `SEUIL`, il ne se contente pas de virer au vert.
- **`aria-label`** explicites sur l'écran (« tape pour pulser et remplir le FLUX ») et sur chaque bouton de stage (nom + état verrouillé).
- **Contrastes** : néons vifs sur `void` — voir `DESIGN.md` pour les valeurs.

## Key Flow — le premier éveil de Nadia

Nadia, 24 ans, dans le métro, une main sur la barre, l'autre sur son téléphone. Un ami lui a juste envoyé un lien : « tape, tu vas voir ».

1. **L'écran est noir.** Des mots montent, un à un, en cyan pâle : *quelque chose dort sous le verre.* En bas, ça clignote : `POSE UN DOIGT POUR L'ÉVEILLER`. Elle comprend sans qu'on lui explique.
2. **Elle tape.** Sous son pouce, une onde magenta jaillit *exactement là*. La borne s'éveille : des sinusoïdes ondulent. En haut, `FLUX` bouge d'un cran.
3. **Elle retape, plus vite.** `x3 CADENCE` s'allume, et — surprise — la couleur *saigne* dans l'écran gris : les anneaux virent au cyan à mesure qu'elle tient le rythme. Le score défile en blanc, le FLUX grimpe. Ça devient un rythme — le pouce trouve sa cadence, et le monde se colore avec elle.
4. **Le FLUX touche le rebord.** *(climax)* Plein écran, un mot énorme, vert, vibrant : **SEUIL**. Dessous, un murmure : *les couronnes répondent.* L'écran bascule : les ondes cèdent la place à un **mandala** radial qui s'ouvre à chaque tap. Nadia n'a rien lu, rien appris — elle a **franchi** quelque chose.
5. **Elle continue jusqu'au flux profond.** Deux seuils plus loin, les trois couches sont ouvertes. La pression retombe : la borne souffle *plus rien à franchir. reste, ou recommence.* Nadia arrête de marteler. Elle regarde le flux marbré onduler sous son pouce, pose un tap de temps en temps pour l'onde de choc. Sa station arrive. Elle enverra le lien à quelqu'un.

## Responsive & Platform

- **Cible unique : téléphones**, du petit (~320px) au grand (~430px+), portrait. La cabine occupe la largeur (max 520px, donc pleine largeur sur téléphone) et toute la hauteur utile.
- **`safe-area-inset`** honorées (encoche haute, barre home basse) — le HUD et le sélecteur ne passent jamais sous le matériel.
- **Pas de scroll, jamais** : tout tient dans une hauteur d'écran ; la zone flexible, c'est l'écran CRT.
- **Paysage / desktop** : non ciblés. La borne reste centrée et jouable si l'écran est large, mais aucune mise en page spécifique n'est due — c'est un objet de téléphone.
- **Perf mobile** : `devicePixelRatio` plafonné à 2 ; sur mobile bas de gamme, le fbm du flux profond peut être descendu de 6 à 4 octaves (levier documenté, hors périmètre v1).
