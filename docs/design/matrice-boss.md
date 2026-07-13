# TAP·TAP — Matrice des paliers & boss

> **Statut** (2026-07-13) : cadre narratif **V3 · L'Intrus**, combat **réel avec échec**, signal **rouge = menace**.
> **LA PORTEUSE (palier 1) — IMPLÉMENTÉE** (premier jet jouable, à équilibrer). LE ROUAGE / LE NOYAU : à venir.
>
> **Réglages à faire (playtest) :** le combat est actuellement **trop facile** — l'INTÉGRITÉ tombe en ~5 s (taps hors charge à 3,4×mult), les *tells* sont rares (3,5 s) et sans conséquence si on les ignore. Pistes : ↑ INTÉGRITÉ, ↓ dégâts par tap, *tells* plus fréquents, et un *tell* non contré devrait coûter quelque chose (drain passif de SIGNAL) plutôt que rien. Détail : spammer (bruit) pendant une charge n'inflige rien et ne punit pas (l'anti-spam court-circuite avant la logique de combat).

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
