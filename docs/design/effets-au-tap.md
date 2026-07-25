# TAP·TAP — Esthétique & effets au tap

> **Statut : implémenté** (premier jet, 2026-07-13). La raison d'être de l'app : le tap doit se *sentir*.
> Décisions Xavier : **intensité = ton flux** · **anneau overlay unifié** · **sobre & élégant**.
>
> **⚠ Mise à jour 2026-07-13 (simplification du cœur de boucle)** — après playtest
> (« pas compréhensible »), la mécanique a été simplifiée : plus de RÉSONANCE /
> INTERFÉRENCE positionnelles, plus de décroissance du FLUX, plus d'anti-spam. La
> **couche FX reste** (anneau au tap, flash d'impact, bloom de cadence, respiration
> au repos, crête de boss) : c'est l'esthétique qui persiste. Ce qui disparaît, c'est
> l'*embrasement résonance/interférence* et l'anneau « résonnable » (l'anneau est
> désormais un simple retour visuel du tap). La teinte suit la **PERFORMANCE**, elle-même
> pilotée par **deux variables réunies** : la **CADENCE** (le temps entre deux tapotis —
> plus il est court, plus tu performes) et l'**ENDURANCE** (la durée de tapotement — plus
> la série dure, plus ça grimpe). La performance pilote le **score** et la couleur, jamais
> le FLUX (la barre se remplit d'une part constante par tap).

## Principe

**« L'intensité visuelle EST ton flux. »** Un tap isolé rend une onde discrète et propre ; une CADENCE ×4 ponctuée de résonances fait *respirer* la borne (bloom, luminosité, anneaux plus vifs qui virent du magenta au vert). L'esthétique récompense la maîtrise du rythme et raconte la grammaire des combos. **Sobre** : jamais de shake ni d'aberration chromatique — l'escalade passe par la lumière, pas le chaos.

## La couche FX (`FxCanvas`)

Un `<canvas>` au-dessus des moteurs, **sous** les scanlines (intégration CRT), piloté par sa propre boucle rAF lisant des **refs** (0 re-render React). Elle dessine, identiquement sur les 3 stages :

- **Anneau résonnable** — ellipse en espace normalisé étiré : le tracé **coïncide exactement** avec ce que teste la mécanique de RÉSONANCE. *Ce que tu vois est ce que tu peux toucher* (corrige la dette de cohérence MANDALA/LIQUID). Couleur `ringColor(mult)` : **blanc au repos (×1) → magenta (×2) → cyan (×3) → vert (×4)** — la teinte encode ton palier de flux ; opacité, épaisseur et glow montent avec le multiplicateur.
- **Flash d'impact** — noyau lumineux blanc→teinte au point touché, à chaque tap valide ; intensité = cadence.
- **Embrasement** — RÉSONANCE : l'anneau touché s'embrase (magenta→blanc) ; INTERFÉRENCE : flash blanc sur les deux anneaux.
- **Bloom d'ambiance** — au-delà de ×3, un voile additif très doux (l'« embrasement » élégant).

Garde-fou : les âges négatifs (décalage d'horloge rAF vs `performance.now()`) sont ignorés — sinon un rayon négatif casserait `ellipse` et tuerait la boucle.

## Par moteur (identité native, sous l'anneau commun)

- **WAVEFORM** — le tap fait *gonfler l'onde* au point touché (kick gaussien décroissant sur les sinusoïdes). L'ancien ripple SVG est retiré : l'anneau appartient à la couche FX.
- **MANDALA** — la couronne radiale native (existante) + l'anneau overlay.
- **LIQUID** — l'onde de choc du shader (existante) + l'anneau overlay.

## Le repos qui respire (attract mode)

« quelque chose dort sous le verre » — rendu visible. Au-delà de **2,5 s sans tap** (et pendant tout l'éveil), la borne *rêve* :

- **Ondes d'invitation** — elle émet ses propres anneaux **blancs** (le repos reste monochrome) depuis un point qui erre lentement (Lissajous), un toutes les ~1,7 s, apparition-culmination-effacement en cloche. Comme des taps qu'on ne t'a pas demandés : elle te montre où poser le doigt.
- **Souffle global** — un voile de luminosité infime inspire/expire (~0,12 Hz).
- **Boot transparent** — l'écran d'éveil laisse voir la borne qui respire *derrière* le texte oracle (voile 55 % + ombre de lisibilité). La machine endormie, ses ondes qui dérivent, sous l'appel.

Dès le premier tap, la couleur remplace le rêve : tu réponds, elle s'éveille. `prefers-reduced-motion` coupe l'attract.

## Une seule jauge, et la récompense comme langage

> **Décision Xavier (2026-07-25)** — « la progression ou la régression des jauges n'est pas
> lisible pendant le jeu ; une seule barre suffirait, agrémentée d'assets spécifiques lors de
> combos et/ou victoire notable. » Et le cap : **« l'accent doit être mis sur le plaisir de jeu »**,
> « un peu comme candy crush, sauf qu'ici les récompenses sont exprimées par des effets
> graphiques abstraits mais néanmoins évocateurs ».

**Le problème** : FLUX se *remplissait* en jeu normal, mais INTÉGRITÉ se *vidait* en combat —
le sens de lecture s'inversait selon le contexte — et une 2ᵉ barre (SIGNAL) doublait la charge.

**La règle désormais : UNE seule barre, toujours au même endroit, toujours dans le même sens.**
Gauche → droite = *je progresse*. En combat elle affiche la **PURGE** du boss (100 − intégrité) :
elle se remplit à mesure qu'on le vide. Le **SIGNAL** n'est plus une barre mais **4 plots discrets**
(lisibles d'un coup d'œil, « combien de coups je peux encore encaisser »).

**Lisibilité périphérique** : un **front d'avancée** lumineux marque où on en est et pulse à
chaque tap — on *voit* la barre pousser sans quitter le visuel des yeux.

**La récompense (le plaisir) est graphique, jamais littérale :**

| Événement | Asset |
|---|---|
| Tap | flash d'impact + anneau (teinte = palier de perf) |
| **Franchissement d'un palier de perf** (×2/×3/×4) | **corolle** qui s'ouvre et tourne au doigt — **elle escalade** : 6 branches en ×2, 9 en ×3, 12 en ×4. Plus tu joues bien, plus la borne fleurit. + onde teintée qui balaie la jauge |
| **Victoire notable** (SEUIL, boss purgé) | embrasement vert de la jauge + flash plein écran |

La célébration ne se déclenche **qu'à la montée**, jamais en redescendant : le jeu célèbre,
il ne sanctionne pas.

## Grammaire positif / négatif (2026-07-25)

> Demande Xavier : « que l'utilisateur distingue clairement un événement négatif d'un positif. »

Deux pôles stricts, opposés terme à terme — la forme, la direction, la lumière et la couleur
disent la même chose en même temps :

| | **POSITIF** | **NÉGATIF** |
|---|---|---|
| Forme | **corolle organique** qui S'OUVRE (branches rayonnantes) | **fracture anguleuse** qui SE REFERME (éclats en implosion) |
| Direction | les étiquettes **montent** (`tt-float`) | les étiquettes **tombent** (`tt-fall`) |
| Lumière | voile/bloom qui **s'ajoute** | tache sombre au point touché + voile qui **assombrit** l'écran |
| Couleur | blanc → teinte du palier → vert | **rouge**, toujours |
| Jauge | onde teintée qui balaie · embrasement vert | **flash rouge sec** + un plot de SIGNAL s'éteint **dès le premier coup** (arrondi au plus proche — un dégât invisible serait illisible) |

Distinction fine côté rouge : le **liseré pulsant continu** = *avertissement* (une charge est
en cours) ; le **voile sec one-shot + fracture** = *dégât* (tu as été touché). Deux rythmes,
deux sens.

Récompense de courage : toucher le boss **pendant** sa charge, depuis une zone sûre, fait
crépiter un **éclair blanc** au doigt (et paie +1 d'INTÉGRITÉ) — le risque bien pris se voit.

## La jauge respire au tempo

À chaque tap **dans la cadence**, un glow cyan pulse sur la jauge FLUX (`tt-beat`). C'est l'unique indice de découverte de la CADENCE : quand tu trouves ton rythme, la jauge respire avec toi (pas de métronome imposé).

## Palette

**Base noir & blanc ; la couleur ne surgit que sur combo/événement.** Cadence : ×2 `magenta` → ×3 `cyan` → ×4 `vert` (la teinte = ton palier de flux). `vert` aussi = SEUIL/gains. `rouge` = détection/menace/boss. Tout le reste (moteurs, HUD, jauge, score, boot) est monochrome. Aucune couleur décorative ni persistante.

## À surveiller (playtest / itération)

1. Sur LIQUID, l'onde de choc native du shader est visuellement plus forte que l'anneau overlay — à tempérer si elle brouille la lecture de la cible résonnable.
2. Le bloom d'ambiance ×3-×4 : vérifier qu'il ne fatigue pas sur de longues sessions mobiles.
3. RÉSONANCE/INTERFÉRENCE au clavier restent inaccessibles (tap positionné aléatoirement) — compensation en mode assist à concevoir.
