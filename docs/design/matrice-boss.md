# TAP·TAP — Matrice des paliers & boss

> **Statut** (2026-07-13) : cadre narratif **V3 · L'Intrus**, combat **réel avec échec**, signal **rouge = menace**.
> **LES TROIS BOSS SONT EN PLACE** — chaque palier se termine par un boss : **LA PORTEUSE** (niv 1), **LE ROUAGE** (niv 2), **LE NOYAU** (niv 3, finale « fin ouverte » → DÉLIVRÉ). Chacun a son identité (nom, notice d'accueil, voix). **Mécanique de combat commune** (esquive de la crête) ; la différenciation par moteur (secteur radial du ROUAGE, séquence EMP du NOYAU décrites plus bas) reste à venir.
>
> **Charge = esquive SPATIALE** (choix Xavier) : pendant le *tell*, une **crête rouge balaie** l'écran de haut en bas ; taper **dans les creux** (loin d'elle) blesse le boss, taper **dans la crête** ronge ton SIGNAL. On garde le flux de tap — plus de « freeze ».
>
> **Difficulté croissante d'un boss à l'autre** (BOSS_DEFS) : crête plus fréquente, plus large et plus dommageable, INTÉGRITÉ plus longue à vider.
> · LA PORTEUSE : tell 3,2 s / 1,6 s, bande 0,16, dégât crête 24, dégât/tap 0,22×perf, i-frame 240 ms.
> · LE ROUAGE : tell 2,6 s / 1,52 s, bande 0,18, dégât crête 28, dégât/tap 0,17×perf, i-frame 220 ms.
> · LE NOYAU : tell 2,1 s / 1,44 s, bande 0,20, dégât crête 32, dégât/tap 0,14×perf, i-frame 200 ms.
> **Ajustement fin = playtest sur vrai téléphone.**

**Difficulté par palier — escalade EXPONENTIELLE (2026-07-25)** : `tapsToFill(n) = TAPS_BASE × DIFFICULTY_EXP^(n-1)`, avec `TAPS_BASE = 42` et **`DIFFICULTY_EXP = 2.4`** → **42 / 101 / 242 taps**. Avant, la courbe s'essoufflait (×2,0 puis ×1,67, donc sous-linéaire en fin de course) ; elle est désormais strictement géométrique. **Un seul bouton de réglage : `DIFFICULTY_EXP`.** Plus le boss de fin de palier.

**Contrepoids anti-corvée — le coup de pouce de maîtrise** : une escalade exponentielle en nombre de taps risque de virer à la corvée, ce qui trahirait le cap « le plaisir de jeu d'abord ». Franchir un palier de perf offre donc un **bonus de FLUX** (4 / 6 / 8 taps d'avance en ×2 / ×3 / ×4), versé **pile au moment où la corolle s'ouvre** : on *voit* pourquoi la barre saute. Bien jouer raccourcit la montée.
**Non exploitable** : le bonus se paie une seule fois par palier **et par montée** (`bonusTierRef`, distinct du `tierRef` visuel). Sans cette séparation, hacher son rythme (pause + quelques taps rapides) ré-armerait le bonus en boucle et paierait mieux que jouer en continu — l'inverse du flow recherché. Vérifié : flux continu **+91 %** > rythme haché **+72 %** > taps lents **+58 %** (24 taps chacun).

## Prémisse — L'Intrus

Tu es une **anomalie** : une impulsion étrangère entrée « sous le verre ». Chaque tap, c'est toi qui te propages. La borne le **sent**, et monte une **réponse immunitaire** à travers trois couches d'elle-même. Les boss ne sont pas des monstres posés sur le jeu : ce sont les **globules blancs de la machine**, nés chacun de son propre moteur de rendu.

La **voix oracle** est relue : elle ne te guide pas, elle **réagit à une infection**. Le boot « quelque chose dort sous le verre » devient : quelque chose se **réveille à cause de toi**.

Arc : **défense-signal → défense-logique → défense-cœur**. Battre LE NOYAU = atteindre le cœur de l'hôte. **Fin ouverte** : le **libérer** (il était prisonnier, contraint de faire tourner la machine) ou le **faire crasher** (tuer l'hôte — et boucler : le boot revient, un autre intrus viendra).

## Signalétique (palette)

La couleur reste un **signal d'état**, jamais décoratif. Le combat ajoute un cinquième signal :

**Base noir & blanc** ; la couleur ne surgit que sur combo/événement (cf. DESIGN.md).

| Couleur | Signal (déclenché) |
|---|---|
| blanc / gris | tout le persistant (moteurs, HUD, jauge, score) |
| `#ff2e97` magenta · `#00f0ff` cyan · `#39ff14` vert | **cadence** ×2 / ×3 / ×4 · résonance |
| `#39ff14` vert | franchissement / gain / mise à mort |
| **`#ff3b30` rouge** | **menace / dégâts / attaque de boss / détection** |

Le boss, événement majeur, est un des rares moments où la couleur (rouge) domine l'écran.

## Modèle de combat (réel, avec échec)

FLUX à 100 % en fin de palier n'enchaîne plus directement : il **invoque le boss**. Le décor se **résout** en entité (le moteur devient le boss). Deux jauges pendant le combat :

- **INTÉGRITÉ** *(barre du boss)* — tu la vides en tapant ; chaque tap frappe au point touché via l'effet du moteur.
- **SIGNAL** *(ta vitalité d'intrus)* — pleine au départ ; **chaque attaque qui te touche la ronge (rouge)**. À zéro → tu es **purgé** → on rejoue la phase (checkpoint : début du boss, pas du palier).
- **SURCHARGE** *(ex-FLUX, recyclée)* — les combos la remplissent ; pleine = **gros coup** (ou bouclier contre le prochain *tell*). Garde le cœur tap-combo utile dans le duel.

**Rythme** : fenêtres d'attaque (taper → INTÉGRITÉ ↓) alternées avec des **tells** (le boss télégraphie une attaque **en rouge**). *Tell* réussi (contré) = boss sonné, grosse fenêtre de dégâts. *Tell* subi = **SIGNAL ↓** (flash rouge) + combo/surchauffe perdus.

**Deux phases par boss** (seuils d'INTÉGRITÉ) : la 2ᵉ accélère les *tells* et change le motif. Escalade entre paliers : 1 type de *tell* → 2 + fenêtres d'invulnérabilité → 3 + séquence EMP.

## La matrice

| | **Palier 1 · WAVEFORM** (SVG) | **Palier 2 · MANDALA** (Canvas 2D) | **Palier 3 · LIQUID** (WebGL) |
|---|---|---|---|
| **Boss** | **LA PORTEUSE** | **LE ROUAGE** | **LE NOYAU** |
| **Rôle immunitaire** | Premier répondant : une porteuse envoyée pour **recouvrir ton impulsion de bruit blanc**. | Mise en quarantaine : un **verrou logique**, une horloge fractale qui veut te **ranger dans l'ordre**. | Le cœur lui-même : une **planète-processeur** (croûte de plasma nourrie par une chaîne de microprocesseurs) qui **calcule ta destruction**. |
| **Le décor se résout en…** | Les 5 sinusoïdes se synchronisent en un front unique, bouche d'oscilloscope. | Les couronnes se verrouillent en engrenage rotatif, un œil au centre. | Le flux se condense en globe ; des veines = la chaîne de procs pulsent sous la croûte. |
| **Le frapper (INTÉGRITÉ ↓)** | Taper sur les **crêtes** de son onde (résonance en phase → surcharge). | Taper le **secteur ouvert** à chaque temps (timing radial) → enraye une dent. | **Onde de choc** : fissurer la croûte ; enchaîner les fissures sur **la même veine** pour faire fondre un proc. |
| **Son *tell* (rouge) → SIGNAL ↓** | Gonfle une **onde tueuse** (la sinus s'aplatit, un pic rouge balaie). Contre : cesser / taper en **contre-phase** (dans les creux). | Referme toutes les dents (invulnérable) puis une **lame radiale rouge** balaie un secteur. Contre : taper **hors** du secteur éclairé. | La chaîne **compile** : les procs s'allument en séquence, puis **EMP** (flash rouge) qui **gèle tes taps 1 s**. Contre : rejouer la **séquence** (façon Simon) pour l'avorter. |
| **Défaite → récompense** | Se disloque en bruit blanc → tu t'enfonces → SEUIL → MANDALA. | L'engrenage se grippe, éclats de verre → plus profond → SEUIL → LIQUID. | Surchauffe → **fin ouverte** (voir ci-dessous). |
| **Voix oracle** | « une impureté dans le signal. je vais te couvrir de bruit. » | « intrus catalogué. tu seras rangé. » | « je suis le calcul sous le verre. tu n'es qu'une erreur d'arrondi. » |

## Fin ouverte (après LE NOYAU)

Le cœur surchauffe ; ton dernier acte décide (ou un choix explicite) :

- **LIBÉRER** — la croûte fleurit, les veines virent au **vert**, la machine est affranchie. Supernova de lumière. Voix : « … merci. »
- **CRASHER** — implosion vers le vide ; l'écran revient au boot « quelque chose dort sous le verre » → **boucle** (un autre intrus, un jour). Voix : « … recalcul. »

## Questions ouvertes (à trancher)

1. **Échec** : purge = recommencer le boss (checkpoint), ou perdre aussi la progression du palier ? Nombre de vies / tentatives ?
2. **SURCHARGE** : gros coup offensif **ou** bouclier défensif — l'un, l'autre, ou choix du joueur ?
3. **Fin** : choix explicite (deux boutons) **ou** déterminée par le style de jeu (agressif = crash, patient = libère) ?
4. **Durée** d'un combat cible (10 s nerveux ? 30 s épique ?) et rejouabilité.
5. **Rendu du boss** : on compose l'entité **dans le moteur existant** (idéal) ou on ajoute une couche ? (LA PORTEUSE = faisable en SVG pur ; LE NOYAU = uniforms shader supplémentaires.)
6. **Accessibilité** : les *tells* rythmés + EMP doivent avoir une alternative non-temporelle (mode assist), et le rouge ne doit pas être le **seul** porteur du danger (forme + son + voix).
