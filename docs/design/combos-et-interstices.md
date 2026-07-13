# TAP·TAP — Grammaire des combos & interstices de session

> **Statut : design validé** (2026-07-11, décisions Xavier), non implémenté.
> Complète `matrice-boss.md` (cadre « L'Intrus »). Fait foi sur le code à l'implémentation.

## Décisions

| Curseur | Choix |
|---|---|
| Anti-spam | **Détection simple** : 0 point, cadence cassée, jauge figée 1 s (clignote rouge) |
| Compétence dominante | **Rythme d'abord** : la CADENCE est le moteur du FLUX ; résonances = bonus |
| Durée palier 1 → porte du boss | **~30 s nerveux** (bon joueur) — le palier est une montée en température, le boss est le jeu |
| Initiales 3 lettres / top 5 | **Plus tard** (après les boss) |

## Principe

**« Un signal propre se propage ; le bruit se fait purger. »**
La difficulté ne vient pas de la quantité de taps mais de leur **nature et enchaînement**. Taper « bêtement » perd contre la décroissance de la jauge ; seul un signal rythmé, ponctué de résonances, ouvre la porte du boss. L'anti-spam n'est pas une punition arbitraire : c'est **l'immunité de l'hôte** qui détecte le bruit — la mécanique raconte l'Intrus.

La CADENCE **pré-entraîne les boss** : tenir un tempo au palier 1 est la compétence exacte qu'exige la contre-phase de LA PORTEUSE. Chaque couche est le tutoriel secret de son boss.

## Les figures

| Figure | Comment | Points | FLUX | Note |
|---|---|---|---|---|
| **PULSATION** (base) | Un tap, n'importe où | +10 | +1,2 % | Insuffisant seul : la jauge fond à 9 %/s |
| **CADENCE** (cœur) | Taps à **intervalle régulier** — ton propre tempo, entre 250–600 ms, tolérance ±80 ms | ×2 dès 4 taps, ×3 dès 8, ×4 dès 16 | même multiplicateur | Rompre le tempo (hors fenêtre) → retombe à ×1 |
| **RÉSONANCE** | Chaque tap émet un anneau (~1,2 s). Taper **sur l'anneau** d'un tap précédent au passage | +150 | **+3 %** | Ne casse pas la cadence si dans le tempo |
| **INTERFÉRENCE** | Taper à l'**intersection de deux anneaux** qui se croisent | +500, flash | **+6 %** | Rare, se construit ; jamais requis |
| **⛔ LE BRUIT** | Taps < 120 ms d'écart ou > 8 taps/s | **0** , casse la CADENCE | jauge **figée 1 s**, clignote **rouge** | La machine te détecte |

### Tuning cible (palier 1, à playtester)

- Décroissance : 9 %/s (inchangée).
- Cadence ×4 tenue à ~3 taps/s : 1,2 % × 4 × 3 = 14,4 %/s brut → **+5,4 %/s net** → ~19 s de remplissage parfait ; avec montée en cadence et fautes réelles → **~30 s**.
- Sans cadence (pulsations seules ~3/s = 3,6 %/s brut) : **on perd** contre la décroissance. Voulu.
- Paliers 2–3 : décroissance ↑ (11 puis 13 %/s) et tolérance de tempo resserrée (±70 puis ±60 ms).
- Reduced-motion / mode assist : tolérances élargies (±120 ms), spam sans gel (0 point seulement).

### Feedback visuel (règles)

- Cadence : la jauge pulse **au tempo du joueur** ; le multiplicateur s'affiche `x2 x3 x4` (vert).
- Résonance : l'anneau touché s'embrase (magenta → blanc), petit « +3 % » éphémère.
- Bruit : jauge figée + liseré **rouge** clignotant 1 s + micro-texte oracle `bruit.` — le rouge est réservé à la menace/détection (cf. matrice-boss).

## Les interstices — la boucle rituelle (façon Zelda 2D, tempo arcade)

Chaque écran dure **1–3 s ou se saute d'un tap**. Jamais de cinématique.

```
VEILLE → INTRUSION → [COUCHE n : jeu ~30 s] → PORTE DU BOSS → [BOSS]
  ↑                                                   │
  │           ┌── victoire → SEUIL → couche suivante ─┤
  └── RÉSULTATS ←─ PURGE (échec) ─────────────────────┘
```

| Écran | Rôle | Copie (voix de l'hôte — fait foi) |
|---|---|---|
| **VEILLE** (titre / attract) | La borne dort. Glyphes des couches débloquées (onde ⌇ · couronne ✳ · globe ●), high score **blanc** (base mono). | boot actuel + `trois couches. un cœur. il dort encore.` |
| **INTRUSION** (début de run, ~1,5 s) | La borne te remarque. Premier usage du rouge. | `…une impureté dans le signal.` |
| **CARTE DE COUCHE** (~2 s) | Carte de donjon : nom + profondeur. | `COUCHE 1 — LE SIGNAL` · `ici, tout n'est qu'onde.` / `COUCHE 2 — LA LOGIQUE` · `ici, tout est rangé.` / `COUCHE 3 — LE CŒUR` · `ici, ça calcule.` |
| **PORTE DU BOSS** (FLUX 100 %) | Le décor se fige et se **résout** en entité ; carton du nom ; un tap pour engager. | `LA PORTEUSE` — `je vais te couvrir de bruit.` / `LE ROUAGE` — `intrus catalogué. tu seras rangé.` / `LE NOYAU` — `tu n'es qu'une erreur d'arrondi.` |
| **PURGE** (échec au boss) | Game over parlant : score, meilleure chaîne, **INTÉGRITÉ restante du boss en %** (le « presque ! » qui fait remettre une pièce). | `PURGE.` · `signal étranger effacé. l'hôte se rendort.` — sorties : `PERSISTE` (retry boss) · `REDESCENDS` (titre) |
| **SEUIL** (victoire) | Existant (flash + murmure) : recyclé en mise à mort. | inchangé |
| **RÉSULTATS** (fin de run) | Score, rang, temps. *(Initiales 3 lettres + top 5 : différé.)* | `l'hôte se souviendra.` |

## Questions ouvertes

1. La CADENCE doit-elle être **visualisée avant** d'être acquise (métronome fantôme ?) ou découverte au toucher ? (penchant : découverte, avec la jauge qui pulse comme seul indice)
2. INTERFÉRENCE : garder (profondeur) ou couper (bruit cognitif sur 30 s) ? — à trancher au playtest.
3. La PURGE relance-t-elle au boss avec SIGNAL plein, ou entamé ? (économie de la difficulté, cf. matrice-boss Q1)
