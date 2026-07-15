# Travail différé

- source_spec: `docs/implementation-artifacts/spec-grammaire-combos.md`
  summary: RÉSONANCE/INTERFÉRENCE de facto inaccessibles au clavier (le tap clavier est positionné aléatoirement).
  evidence: Revue adversariale #6 (note) — concevoir une compensation en mode assist (ex. tap clavier ancré au centre, anneaux concentriques prévisibles).

- source_spec: `docs/design/effets-au-tap.md`
  summary: Sur LIQUID, l'onde de choc native du shader domine visuellement l'anneau overlay résonnable ; à tempérer si la lecture de la cible souffre.
  evidence: Capture fx5b-liquid — les grands anneaux cyan du shader (r≈age·0,9, ~2 s) écrasent l'ellipse overlay (0,38, 1,2 s). L'anneau résonnable reste présent et cohérent, mais moins lisible que sur WAVEFORM/MANDALA.

# Résolu

- ✅ Cohérence des anneaux de RÉSONANCE sur les 3 stages → couche FX overlay (ellipse en espace normalisé étiré, identique partout ; l'anneau tracé coïncide avec la détection). Cf. docs/design/effets-au-tap.md.
- ✅ Jauge FLUX qui pulse au tempo du joueur (indice de découverte) → glow `tt-beat` à chaque tap dans la cadence.

- source_spec: `docs/design/matrice-boss.md`
  summary: Équilibrage du combat LA PORTEUSE (trop facile) : INTÉGRITÉ tombe en ~5 s, tells rares et sans conséquence si ignorés ; un tell non contré devrait drainer le SIGNAL.
  evidence: Vérif Chromium — victoire en ~1,5 cycle de tell ; les tells n'infligent rien passivement. Plus : spam (bruit) pendant une charge court-circuite la logique de combat (ni dégât ni punition).

- ✅ Boss LE ROUAGE (palier 2) et LE NOYAU (palier 3) EN PLACE — chaque palier a un boss (BOSS_DEFS),
  difficulté croissante, notice d'accueil dédiée, finale « fin ouverte » (DÉLIVRÉ) après LE NOYAU.
  RESTE : différencier la MÉCANIQUE par moteur (LE ROUAGE = secteur radial temporisé sur MANDALA ;
  LE NOYAU = séquence type Simon + EMP sur LIQUID) et résoudre visuellement le décor en entité
  (aujourd'hui seul WAVEFORM amplifie son onde ; MANDALA/LIQUID gardent la crête overlay commune).
