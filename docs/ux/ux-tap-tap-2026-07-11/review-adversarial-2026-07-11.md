# Revue UX adversariale — TAP·TAP (2026-07-11)

Trois relecteurs en parallèle, lentilles distinctes : **Accessibilité (A)**, **Fidélité contrat↔code (F)**, **Adversarial/edge-cases (X)**. Findings consolidés, dédupliqués, triés. Un recoupement entre lentilles = confiance accrue.

## 🔴 Critiques

| # | Finding | Source | Correctif |
|---|---------|--------|-----------|
| C1 | **Farm de score / re-franchissement forcé.** Le joueur qui revient repart toujours sur WAVEFORM (`stageIndex` non persisté) ; retaper re-déclenche `SEUIL` + **+500** + bascule, en boucle 1↔2↔3. High-score (le seul méta) ruiné, cérémonie dévaluée, impossible de rester contempler un stage bas. **Chemin par défaut, pas un edge-case.** | X-B1 | Cérémonie seulement si `nextId > maxUnlocked` (sinon plafonner le FLUX, sans flash/+500/bascule). Persister `stageIndex` ou atterrir sur le stage le plus haut débloqué. |
| C2 | **Le flash « SEUIL » ignore `prefers-reduced-motion`.** La media-query ne coupe que les scanlines ; le voile plein écran + le clignotement CTA (`tt-blink`) + `tt-rise` ne sont pas gatés. Le contrat en fait une *condition d'accès*. | A-B1 (+A-M2) | Gater `tt-flash`/`tt-blink`/`tt-rise` sous `@media (prefers-reduced-motion: reduce)`. Garder le mot `SEUIL` (porteur de sens), retirer la pulsation. |
| C3 | **Contemplation contredit le repli WebGL.** Si WebGL tombe → arrivée sur MANDALA avec `maxUnlocked=3` → `contemplation=true` → « plus rien à franchir » s'affiche **en même temps** que « le flux profond ne répond pas ». « Tout accompli » vs « ça a cassé ». | X-M5 | Conditionner le murmure sur `!glFailed` ; ne pas traiter un sommet dégradé-par-panne comme une contemplation. |
| C4 | **Ambre hors score = contradiction des deux contrats.** DESIGN : « amber = SCORE et lui seul ». EXPERIENCE + code : amber sur la ligne de repli WebGL. | F-B1 | Repli en `ink-60` (ou blanc) ; l'ambre reste réservé au score. (Ou élargir DESIGN — déconseillé.) |

## 🟠 Majeurs

| # | Finding | Source | Correctif |
|---|---------|--------|-----------|
| M1 | **Perf 60 fps.** (a) `useRef(loadSave())` relit localStorage + `JSON.parse` à **chaque** render (~60/s en jeu) ; (b) `persistSave` écrit à **chaque tap** en run record ; (c) `setFlow` 60/s re-render **tout l'arbre** (moteurs non-`memo`, HUD/sélecteur churnent) → casse la promesse EXPERIENCE « pas de re-render à 60 fps » ; (d) MANDALA `shadowBlur` sur ~centaines d'ops/frame. | X-M1,M2,M3,M4 | Lazy-init réel de `loadSave` ; throttle persistance ; `React.memo` sur les 3 moteurs + isoler `flow` (gauge en feuille) ; glow mandala pré-rendu (sprite offscreen). |
| M2 | **État de jeu muet pour lecteur d'écran.** Aucun `aria-live`, `role="progressbar"`, `aria-current`. VoiceOver : silence total pendant le jeu (score, FLUX, combo, changement de stage). | A-M1 | `progressbar` + `aria-valuenow` sur FLUX ; région `aria-live` pour seuil + repli ; `aria-current` sur le stage actif. |
| M3 | **Boot : le 1er tap ne pulse pas + focus perdu + écran focusable inerte avant boot.** Le réveil se fait sur le *click* du bouton (pas de pulsation) ; après réveil le focus retombe sur `body` ; avant boot la div écran est focusable/annoncée mais ses handlers sont `undefined`. | A-M3, X-m2 | Réveiller sur `pointerdown` en routant ce tap vers `registerTap` ; focus programmatique post-boot ; div écran non focusable tant que `!booted`. |
| M4 | **Murmure de contemplation en boucle** (spec dit « une fois »). `combo` retombe à 0 après 700 ms → le murmure repop à chaque pause → clignotement, à l'opposé du calme visé. | F-M2, X-m1 | Flag `useRef` « déjà murmuré » (une fois par entrée en contemplation), ou corriger la spec. |
| M5 | **Onde de tap verte vs « magenta ».** Le geste fondateur (Key Flow : « une onde magenta jaillit ») est rendu en `green` (réservé au franchissement). + DESIGN se contredit sur la bordure du stage actif (Colors dit magenta ; Components + code disent couleur du stage). | F-M3, F-M1 | Ripple de tap → `magenta` ; corriger DESIGN.md (retirer « bordure active » de la liste magenta). |

## 🟡 Mineurs (regroupés)

- **Doc / lexique** : README périmé (`FLOW`/`STAGE UP!`/`boot BIOS`) `F-m1` ; lexique interne (`FLOW_MAX`, `FluxGauge`, `BiosBoot`) `F-m2` ; section **Motion** absente de DESIGN `F-m9` ; renvoi contraste sans valeurs dans DESIGN `F-m7` ; frontmatter `components` non déclaré `F-m8`.
- **a11y polish** : `aria-label` muet sur l'état ⚠ indisponible (**2 lentilles**) `A-m4/F-m6` ; labels HUD gris ~4.44:1 (juste sous AA, texte 10px) `A-m1` ; focus vert absent sur les boutons `A-m2` ; « FLUX chaud » couleur-seule `A-m3` ; texte sur moteur sans scrim `A-m5`.
- **Robustesse** : contexte WebGL jamais relâché → faux repli après ~16 visites du stage 3 `X-m3` ; updater `setFlow` impur (`triggerStageUp` dans l'updater → double-invoke StrictMode, tient « par accident » via `flashingRef`) `X-m4` ; shaders non nettoyés sur chemin d'erreur `X-m7` ; affichage combo/score non borné (débordement HUD ~320px) `X-m5` ; safe-area gauche/droite ignorées `X-m6`.
- **Tokens** : tracking oracle `0.06em` vs token `0.02em` `F-m4` ; HIGH sans token/poids + font-stack tronqué `F-m5` ; CTA d'éveil pas « en bas » `F-m3`.

## ✅ Vérifié solide (pour cadrer)

localStorage corrompu géré (99→3, NaN→0, JSON illisible→défaut) · cleanup rAF/ResizeObserver/program GL au unmount · **repli WebGL→MANDALA correct** (le doute du brief était infondé) · **aucun risque photosensible** (voile 14 %, clignotement ~0,9 Hz) · néons tous AA sur `void` · cibles ≥44px réelles · **tous les tokens `{colors.x}` valides** · voix cryptique au caractère près · 8 sections du spine présentes et dans l'ordre.

---

**Priorité** : C1 → C2 → C3 → C4, puis M1 (perf) → M2/M3 (a11y/boot) → M4/M5. Le reste = dérive doc + polish.
