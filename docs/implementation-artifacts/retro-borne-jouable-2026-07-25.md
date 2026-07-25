# Rétrospective — « TAP·TAP : la borne jouable »

**Date** : 2026-07-25 · **Participants** : Xavier (chef de projet) + équipe BMad (party mode)
**Périmètre** : de la grammaire des combos initiale jusqu'aux réglages validés sur téléphone
(commits `bbd2508` → `2aaaa3b`, ~20 commits, `src/TapTap.tsx` ≈ 2200 lignes, déployé Vercel).

## Verdict de clôture

**« Oui, les réglages sont bons ! »** — validé par Xavier au pouce, sur vrai téléphone,
après correction du bug « barre à 100 % sans événement ». Les curseurs figés :
`DIFFICULTY_EXP = 2.4` (42/101/242 taps), perf = cadence × endurance (plafond ~×6),
boss à 2 phases, `BOSS_PHASE2_AT = 50`.

## Ce qui a bien marché

- **Contrainte esthétique forte** (noir & blanc, couleur = combo/événement) : identité
  visuelle nette ET décisions de design simplifiées à chaque étape.
- **Vérification Chromium à chaque manche** : comportement réel validé, pas seulement le
  typecheck. Les captures ont attrapé de vrais bugs visuels (paroi du NOYAU qui débordait).
- **Livraison continue** : chaque itération poussée et déployée ; le retour terrain de
  Xavier arrive vite et pilote la suite.
- **Une seule source de vérité** pour les zones de danger (`bossZones`, lue par la mécanique
  ET le rendu) : la règle « ce que tu vois est ce qui te touche » est structurelle.

## Les leçons (à retenir pour la suite)

1. **La richesse avant la lisibilité était le mauvais ordre.** La grammaire des combos
   (tempo précis, anti-spam, décroissance) était élégante sur le papier et illisible au
   pouce → « le jeu n'est pas compréhensible ». La bonne séquence : boucle minimale qui
   tient → test sur téléphone → puis stratifier. Le modèle actuel en est né, et il est
   meilleur.
2. **L'anti-farm par le silence est toujours un bug UX.** Une barre pleine qui ne
   déclenche rien est indistinguable d'un plantage. La friction va dans la récompense
   (bonus réduit en rejouant), jamais dans l'absence d'événement.
3. **La récompense est un langage** : effets abstraits mais évocateurs (corolles, ondes,
   embrasements), qui escaladent avec la maîtrise et ne sanctionnent jamais la descente.
4. **Découpler célébration et récompense économique** : la corolle rejoue à chaque série,
   le bonus de FLUX ne se paie qu'une fois par montée — sinon hacher le rythme devient
   la stratégie optimale.

## Actions / travail restant

| # | Action | Statut |
|---|---|---|
| 1 | Décor qui se « résout en entité » pendant le combat (MANDALA en engrenage, LIQUID en globe veiné — seul WAVEFORM amplifie son onde) | à faire (le plus spectaculaire de la matrice) |
| 2 | `scripts/verify-combos.mjs` versionné est **périmé** (teste la grammaire supprimée) → régénérer une vérif E2E du modèle actuel (perf, boss 2 phases, jauge unique) | à faire |
| 3 | Clavier : l'esquive spatiale des boss est quasi impossible au clavier (tap positionné aléatoirement) → mode assist à concevoir | à faire (a11y) |
| 4 | Fin ouverte du NOYAU : le choix LIBÉRER / CRASHER (aujourd'hui : DÉLIVRÉ direct) | optionnel, narratif |

## Réglages de référence (validés)

`TAPS_BASE 42` · `DIFFICULTY_EXP 2.4` · `STREAK_WINDOW 700` · `GAP_FAST 110` / `GAP_SLOW 520`
· `CADENCE_BONUS 2` · `ENDURANCE_BONUS 1.2` (cap 40) · `BOSS_PHASE2_AT 50` ·
`PHASE2_EVERY 0.62` / `PHASE2_DUR 0.88` · bonus de palier 4/6/8 taps (1×/montée) ·
SEUIL 500 pts (150 en replay) · SURTENSION 250 pts.
