---
title: 'Grammaire des combos (CADENCE / RÉSONANCE / INTERFÉRENCE / LE BRUIT)'
type: 'feature'
created: '2026-07-13'
status: 'superseded'
superseded_note: >
  2026-07-13 — Playtest sur vrai téléphone : « le jeu n'est pas compréhensible ».
  Décision Xavier : SIMPLIFIER radicalement le cœur de boucle. La grammaire
  décrite ici (tempo précis, RÉSONANCE/INTERFÉRENCE positionnelles, anti-spam
  LE BRUIT avec gel rouge, décroissance du FLUX) est RETIRÉE du jeu.
  Modèle actuel (cf. src/TapTap.tsx) : chaque tap REMPLIT la barre (FILL_PER_TAP),
  le FLUX ne redescend jamais, taper vite n'est jamais puni. Seule survit une
  SÉRIE indulgente (taps rapprochés → multiplicateur couleur + petit bonus) qui
  retombe sans pénalité après une pause. 100 % → SEUIL (ou boss de palier).
review_loop_iteration: 0
baseline_commit: 'c3fc6163109c0db9ae9615e39ffba3ec4da3d831'
context:
  - '{project-root}/docs/design/combos-et-interstices.md'
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Le jeu en ligne récompense le spam (taper vite = gagner), alors que le design validé exige que la **nature et l'enchaînement** des taps déterminent la progression — palier 1 ≈ 30 s d'effort réel.

**Approach:** Remplacer le combo « fenêtre 700 ms » par la grammaire de `docs/design/combos-et-interstices.md` : CADENCE (tempo propre → multiplicateur), RÉSONANCE et INTERFÉRENCE (anneaux logiques), LE BRUIT (anti-spam qui fige la jauge). Feedback : multiplicateur au HUD, étiquettes éphémères, liseré rouge « détection ».

## Boundaries & Constraints

**Always:** État de jeu chaud en **refs** (jamais de re-render 60 fps ajouté) · rouge réservé à la détection/menace · voix oracle bas-de-casse (`bruit.`) · `prefers-reduced-motion` = tolérance ±120 ms, pas de gel, pas de clignotement · décroissance 9 %/s et flux SEUIL/anti-farm **inchangés** · build tsc strict + lint 0 warning.

**Ask First:** Toute modification du contrat UX (DESIGN/EXPERIENCE.md) au-delà du déjà-validé · tout changement des constantes de tuning hors des valeurs du design doc.

**Never:** Pas d'interstices (VEILLE/PORTE DU BOSS…) ni de boss dans ce lot · pas de son · pas de nouvelle dépendance · ne pas toucher aux shaders/moteurs de rendu (seule la couche jeu change).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pulsation seule | taps espacés > 680 ms | +10 pts, +1,2 % FLUX, ×1 — perd contre la décroissance | N/A |
| Cadence | taps réguliers, T∈[250,600] ms, ±80 ms | chaîne ↑ ; ×2 dès 4, ×3 dès 8, ×4 dès 16 (pts & FLUX) ; T suit une moyenne glissante | hors fenêtre (non-bruit) → chaîne=1, ×1, gains normaux |
| Résonance | tap sur un anneau actif (âge 0,15–1,2 s, bande ±0,045 norm.) | +150 pts, +3 % FLUX, anneau s'embrase, ne casse pas la cadence si dans le tempo | N/A |
| Interférence | tap dans la bande de **2** anneaux à la fois | +500 pts, +6 % FLUX, flash (remplace la résonance, non cumulé) | N/A |
| LE BRUIT | écart < 120 ms **ou** > 8 taps/s (fenêtre glissante 1 s) | 0 pt, 0 %, chaîne=0, jauge **figée 1 s** (ni gain ni décroissance), liseré rouge + `bruit.` | reduced-motion : 0 pt seulement, pas de gel ni clignotement |
| Seuil | FLUX atteint 100 % | comportement actuel intact (cérémonie/anti-farm) | N/A |
| Persistance | rechargement | aucun nouvel état persisté (tempo/chaîne volatils) | N/A |

</frozen-after-approval>

## Code Map

- `src/TapTap.tsx` — unique fichier. Zones : constantes de jeu (l.~50) ; `registerTap` (logique de gain, à réécrire) ; boucle de jeu rAF (décroissance — y brancher le gel) ; `Hud` (affichage `x{mult} CADENCE`) ; `FlowGauge` (liseré rouge bruit) ; couche overlay de l'écran (étiquettes éphémères `+3 %`, `bruit.`).
- `docs/design/combos-et-interstices.md` — source de vérité chiffres/comportements.

## Tasks & Acceptance

**Execution:**
- [x] `src/TapTap.tsx` — Constantes : `TEMPO_MIN=250`, `TEMPO_MAX=600`, `TEMPO_TOL=80` (±120 assist), `NOISE_GAP=120`, `NOISE_RATE=8/s`, `FREEZE_MS=1000`, `RING_LIFE=1200`, `RING_RMAX=0.38`, `RING_TOL=0.045`, gains (1,2 % / +3 % / +6 % ; 10/150/500 pts) — remplace `COMBO_WINDOW`/gains actuels.
- [x] `src/TapTap.tsx` — État chaud en refs : `tempoRef` (T glissant), `chainRef`, `ringsRef[{x,y,born}]` (≤12, purge par âge), `tapTimesRef` (fenêtre 1 s), `freezeUntilRef` ; `mult` en state **seulement au changement**.
- [x] `src/TapTap.tsx` — `registerTap` réécrit : (1) détection BRUIT → 0 gain, chaîne=0, gel, feedback ; (2) cadence (établir/suivre T, chaîne, mult) ; (3) résonance/interférence sur `ringsRef` (distance en espace normalisé, cohérent avec le rendu étiré des moteurs) ; (4) gains = base × mult + bonus ; (5) pousse l'anneau du tap. Gel actif → aucun gain.
- [x] `src/TapTap.tsx` — Boucle rAF : décroissance sautée tant que `now < freezeUntilRef` ; expiration de chaîne si silence > T+TOL (retombe à ×1 sans pénalité).
- [x] `src/TapTap.tsx` — Feedback : HUD `x{2|3|4} CADENCE` (vert) ; étiquettes éphémères à la position du tap (`+3 %`, `+6 %`, `bruit.` en rouge) via petite couche DOM `pointer-events:none` (état léger, cadence humaine, pas 60 fps) ; `FlowGauge` : prop `frozen` → liseré rouge clignotant 1 s (statique si reduced-motion).
- [x] Vérification Playwright : script de taps à intervalles contrôlés (voir Verification).

**Acceptance Criteria:**
- Given des taps réguliers à ~300 ms, when 16 taps s'enchaînent dans la fenêtre, then le HUD affiche ×2 puis ×3 puis ×4 et le FLUX progresse nettement plus vite que la décroissance.
- Given un martèlement < 120 ms, when il se prolonge, then score et FLUX n'augmentent pas, la jauge est figée par vagues de 1 s avec liseré rouge, et la cadence est retombée.
- Given un joueur ne tapant que des pulsations isolées (> 680 ms), when 20 s s'écoulent, then le FLUX reste proche de 0 (la décroissance gagne).
- Given un tap posé sur l'anneau d'un tap précédent (âge ~0,6 s), when il est dans la bande, then +150 pts et +3 % s'appliquent et une étiquette apparaît au point touché.
- Given `prefers-reduced-motion`, when du bruit est détecté, then aucun gel ni clignotement — seulement 0 point.
- Given FLUX = 100 %, when le seuil se déclenche, then la cérémonie et l'anti-farm actuels sont inchangés.

## Design Notes

Espace de détection des anneaux = coordonnées normalisées `[0,1]²` **étirées** (identique au `preserveAspectRatio="none"` du stage 1) : la géométrie logique et le visuel coïncident sans correction d'aspect. R(t) = 0,38·(t/1,2 s) — calqué sur le ripple SVG (380/1000 en 1,2 s). Le tempo est **celui du joueur** (T établi par les 2 premiers taps valides, puis moyenne glissante 0,7·T+0,3·mesure) — pas un métronome imposé (Q1 du design doc : découverte au toucher, la jauge pulse comme seul indice).

## Verification

**Commands:**
- `cd /home/user/taptap && npm run build` — expected: tsc strict + vite OK.
- `cd /home/user/taptap && npm run lint` — expected: 0 warning.
- `node scripts/verify-combos.mjs` (préalables en tête du script) — expected: `TOUT PASSE ✓` : (a) cadence 300 ms → x2/x3/x4 + progression ; (b) martèlement 40 ms → score figé, FLUX stagnant, liseré rouge + `bruit.` ; (c) 800 ms → FLUX ~0 ; (d) résonance → bonus ; console 0 erreur partout.

**Manual checks (if no CLI):**
- Captures des états versionnées dans `verify-combos/` (a-cadence, b-bruit, d-resonance).

## Suggested Review Order

**Le cœur : la grammaire dans `registerTap`**

- Entrée : tout le flux d'un tap — bruit, gel, cadence, anneaux, gains — en une passe.
  [`TapTap.tsx:1066`](../../src/TapTap.tsx#L1066)

- LE BRUIT : fenêtre glissante + gel ré-armé (timeout annulé) + `prevValid=false` (pas d'ancrage).
  [`TapTap.tsx:1076`](../../src/TapTap.tsx#L1076)

- Gel actif = tap inerte : le moteur pulse, aucun pré-armement de chaîne ni d'anneau.
  [`TapTap.tsx:1104`](../../src/TapTap.tsx#L1104)

- CADENCE : EMA **clampée** [250,600] (tue l'exploit de dérive), rupture → chaîne=1.
  [`TapTap.tsx:1111`](../../src/TapTap.tsx#L1111)

- RÉSONANCE/INTERFÉRENCE : bande ±0,045 en espace normalisé étiré, anneaux touchés collectés.
  [`TapTap.tsx:1142`](../../src/TapTap.tsx#L1142)

- Gains : base × mult + bonus, seuil détecté en synchrone via `flowRef` (updater pur).
  [`TapTap.tsx:1158`](../../src/TapTap.tsx#L1158)

**Constantes & boucle de jeu**

- Les chiffres du design doc, nommés et commentés.
  [`TapTap.tsx:58`](../../src/TapTap.tsx#L58)

- Boucle rAF : décroissance sautée pendant le gel, expiration de chaîne sans pénalité.
  [`TapTap.tsx:986`](../../src/TapTap.tsx#L986)

**Robustesse entrées (findings de revue)**

- Multi-touch : seul le pointeur primaire compte (la paume n'est pas du BRUIT).
  [`TapTap.tsx:1205`](../../src/TapTap.tsx#L1205)

- Auto-repeat clavier ignoré (`e.repeat`).
  [`TapTap.tsx:1217`](../../src/TapTap.tsx#L1217)

- Anneaux purgés au SEUIL et au changement de stage (pas de résonance fantôme).
  [`TapTap.tsx:1013`](../../src/TapTap.tsx#L1013) · [`TapTap.tsx:1234`](../../src/TapTap.tsx#L1234)

- reduced-motion à chaud lève le gel ; miroirs de refs assignés hors rendu.
  [`TapTap.tsx:935`](../../src/TapTap.tsx#L935)

**Feedback (HUD, jauge, overlay)**

- `x2/x3/x4 CADENCE` au HUD (vert, seulement au changement).
  [`TapTap.tsx:655`](../../src/TapTap.tsx#L655)

- Liseré rouge de détection : `key={freezeSeq}` fait rejouer l'animation à chaque bruit.
  [`TapTap.tsx:697`](../../src/TapTap.tsx#L697)

- Embrasement des anneaux résonnés / flash blanc d'interférence (overlay, moteurs intouchés).
  [`TapTap.tsx:1323`](../../src/TapTap.tsx#L1323)

- Étiquettes éphémères clampées aux bords, timers traqués (cleanup au démontage).
  [`TapTap.tsx:1345`](../../src/TapTap.tsx#L1345) · [`TapTap.tsx:1029`](../../src/TapTap.tsx#L1029)

**Périphériques**

- Script de vérification versionné (4 scénarios, 12 assertions).
  [`verify-combos.mjs:1`](../../scripts/verify-combos.mjs#L1)
