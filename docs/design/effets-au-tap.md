# TAP·TAP — Esthétique & effets au tap

> **Statut : implémenté** (premier jet, 2026-07-13). La raison d'être de l'app : le tap doit se *sentir*.
> Décisions Xavier : **intensité = ton flux** · **anneau overlay unifié** · **sobre & élégant**.

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

## La jauge respire au tempo

À chaque tap **dans la cadence**, un glow cyan pulse sur la jauge FLUX (`tt-beat`). C'est l'unique indice de découverte de la CADENCE : quand tu trouves ton rythme, la jauge respire avec toi (pas de métronome imposé).

## Palette

**Base noir & blanc ; la couleur ne surgit que sur combo/événement.** Cadence : ×2 `magenta` → ×3 `cyan` → ×4 `vert` (la teinte = ton palier de flux). `vert` aussi = SEUIL/gains. `rouge` = détection/menace/boss. Tout le reste (moteurs, HUD, jauge, score, boot) est monochrome. Aucune couleur décorative ni persistante.

## À surveiller (playtest / itération)

1. Sur LIQUID, l'onde de choc native du shader est visuellement plus forte que l'anneau overlay — à tempérer si elle brouille la lecture de la cible résonnable.
2. Le bloom d'ambiance ×3-×4 : vérifier qu'il ne fatigue pas sur de longues sessions mobiles.
3. RÉSONANCE/INTERFÉRENCE au clavier restent inaccessibles (tap positionné aléatoirement) — compensation en mode assist à concevoir.
