import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

/* ============================================================================
 * TAP·TAP — borne d'arcade generative psychedelique
 * Le geste central est le TAP : chaque tap pulse le visuel au point touche et
 * remplit la jauge FLUX. FLUX plein => SEUIL => nouveau moteur de rendu.
 *   Stage 1 WAVEFORM  -> SVG        (ondes & interferences)
 *   Stage 2 MANDALA   -> Canvas 2D  (fractales radiales, composite lighter)
 *   Stage 3 LIQUID    -> WebGL      (fbm 6 octaves, onde de choc au tap)
 * Composant autonome : styles inline, aucune dependance externe.
 * ==========================================================================*/

const PALETTE = {
  void: '#0a0a0c', // noir neutre (base mono)
  magenta: '#ff2e97',
  cyan: '#00f0ff',
  amber: '#ffd600',
  green: '#39ff14',
  red: '#ff3b30', // menace / detection UNIQUEMENT (cf. CLAUDE.md regle 1)
} as const

type Engine = 'svg' | 'canvas' | 'webgl'

interface StageDef {
  id: number
  name: string
  engine: Engine
  tint: string
  tapsToFill: number // nb de taps pour remplir le FLUX — la difficulte MONTE avec le niveau
}

// ESCALADE EXPONENTIELLE de la difficulte (choix Xavier : « augmente le facteur
// exponentiel de l'escalade du niveau »). Avant, la courbe s'essoufflait — 42 → 84 → 140,
// soit ×2,0 puis ×1,67 (sous-lineaire en fin de course). Desormais chaque palier coute
// DIFFICULTY_EXP fois le precedent, strictement : c'est une vraie progression geometrique.
//   tapsToFill(n) = TAPS_BASE × DIFFICULTY_EXP^(n-1)
// UN SEUL bouton de reglage : DIFFICULTY_EXP. Le monter durcit toute la courbe d'un coup.
const TAPS_BASE = 42 // palier 1 : la couche d'initiation reste accessible
const DIFFICULTY_EXP = 2.4 // facteur d'escalade entre deux paliers
const stageTaps = (id: number) => Math.round(TAPS_BASE * Math.pow(DIFFICULTY_EXP, id - 1))

// WAVEFORM initie, les couches profondes exigent : 42 → 101 → 242 taps.
const STAGES: StageDef[] = [
  { id: 1, name: 'WAVEFORM', engine: 'svg', tint: PALETTE.magenta, tapsToFill: stageTaps(1) },
  { id: 2, name: 'MANDALA', engine: 'canvas', tint: PALETTE.cyan, tapsToFill: stageTaps(2) },
  { id: 3, name: 'LIQUID', engine: 'webgl', tint: PALETTE.green, tapsToFill: stageTaps(3) },
]

// Reglages de jeu -----------------------------------------------------------
const FLUX_MAX = 100
const FLASH_MS = 950 // duree du flash SEUIL
const STORAGE_KEY = 'taptap.save.v1'

// Remplissage SIMPLE et lisible : chaque tap remplit la barre d'une part CONSTANTE
// (= FLUX_MAX / tapsToFill du palier), sans jamais de perte ni de piege. Le nombre de
// taps requis monte avec le niveau (cf. STAGES). Taper vite fait monter la barre plus
// vite (plus de taps/seconde), jamais puni.
const STREAK_WINDOW = 700 // ms : taper avant ce delai continue la serie (indulgent)

// PERFORMANCE — deux variables qui pilotent le SCORE et la couleur (jamais le FLUX) :
//   1. CADENCE   = le temps entre deux tapotis. Plus il est court, plus tu performes.
//   2. ENDURANCE = la duree de tapotement (taps enchaines). Plus la serie dure, plus ca grimpe.
// Les deux se combinent (multiplicateur de perf) ; le score grimpe avec les deux.
const GAP_FAST = 110 // ms : cadence maximale (gap plus court = meme plafond)
const GAP_SLOW = 520 // ms : au-dela, la cadence retombe a son minimum (×1)
const CADENCE_BONUS = 2 // la cadence multiplie la perf de ×1 (lent) a ×3 (rapide)
const ENDURANCE_CAP = 40 // taps enchaines au-dela desquels l'endurance plafonne
const ENDURANCE_BONUS = 1.2 // l'endurance multiplie la perf de ×1 a ×2.2 (serie longue)
const PTS_BASE = 10 // points de base par tap (× performance)
const RING_LIFE = 1200 // ms de vie d'un anneau (retour visuel du tap)
const RING_RMAX = 0.38 // rayon max normalise de l'anneau

// Boss de fin de palier (cf. docs/design/matrice-boss.md, cadre « L'Intrus »).
// CHAQUE palier se termine par un boss ; la difficulte monte d'un boss a l'autre
// (crete plus frequente, plus large, plus dcommageable ; INTEGRITE plus longue a vider).
// Mecanique commune : esquive spatiale de la crete rouge (differenciation par moteur = a venir).
// GEOMETRIE DU DANGER — chaque boss attaque selon l'axe de son propre moteur.
// C'est ce qui les rend vraiment differents a jouer, pas juste plus durs :
//   'band'   → WAVEFORM  : une crete horizontale balaie en Y      (l'axe des ondes)
//   'sector' → MANDALA   : une lame radiale tourne en THETA        (l'axe des couronnes)
//   'ring'   → LE NOYAU  : un anneau de calcul enfle en R          (l'axe de la profondeur)
// Y / THETA / R : les trois axes de l'espace, un par moteur. Le geste d'esquive change
// completement — fuir vers le haut/bas, tourner autour du centre, ou entrer/sortir.
type BossKind = 'band' | 'sector' | 'ring'

interface BossCfg {
  name: string
  kind: BossKind
  tellEvery: number // ms entre deux charges
  tellDur: number // ms de balayage
  band: number // demi-largeur de la zone dangereuse (Y normalise | radians | rayon normalise)
  tellDmg: number // SIGNAL perdu par tap dans la zone
  tapDmg: number // INTEGRITE videe par tap (× perf) — plus bas = boss plus coriace
  iframe: number // ms d'invulnerabilite apres un coup encaisse
  hint: string // consigne d'esquive affichee pendant la charge
  phase2: string // ce que murmure la borne quand le boss se reconfigure
  hint2: string // consigne d'esquive en phase 2 (le motif a change)
}

// Seuil d'INTEGRITE qui fait basculer le boss en 2e phase.
const BOSS_PHASE2_AT = 50
// En phase 2 : charges plus rapprochees et plus breves — la pression monte.
const PHASE2_EVERY = 0.62
const PHASE2_DUR = 0.88
const BOSS_DEFS: Record<number, BossCfg> = {
  1: {
    name: 'LA PORTEUSE', kind: 'band',
    tellEvery: 3200, tellDur: 1600, band: 0.16, tellDmg: 24, tapDmg: 0.22, iframe: 240,
    hint: "l'onde balaie — tape dans les creux",
    phase2: 'elle se dédouble.',
    hint2: 'DEUX ondes en tenaille — vise entre elles',
  },
  2: {
    name: 'LE ROUAGE', kind: 'sector',
    tellEvery: 2600, tellDur: 1520, band: 0.5, tellDmg: 28, tapDmg: 0.17, iframe: 220,
    hint: 'la lame tourne — tape hors du secteur',
    phase2: 'il engrène la seconde dent.',
    hint2: 'DEUX lames opposées — tape dans un quart libre',
  },
  3: {
    name: 'LE NOYAU', kind: 'ring',
    tellEvery: 2100, tellDur: 1440, band: 0.1, tellDmg: 32, tapDmg: 0.14, iframe: 200,
    hint: "l'anneau enfle — écarte-toi de la paroi",
    phase2: "le calcul s'inverse.",
    hint2: "l'anneau IMPLOSE — la paroi revient vers le cœur",
  },
}

// Avancement de la charge en cours (0 → 1).
function bossTellT(b: Boss, now: number): number {
  return Math.min(1, Math.max(0, (now - b.tellStart) / (b.tellUntil - b.tellStart)))
}
// Position courante de la zone dangereuse, selon l'axe du boss.
const bandY = (t: number) => 0.18 + 0.64 * t // WAVEFORM : de haut en bas
const sectorAngle = (b: Boss, t: number) => b.tellSeed + 2.2 * t // MANDALA : rotation
const ringR = (t: number) => 0.1 + 0.52 * t // NOYAU : expansion depuis le centre

// Positions courantes des zones dangereuses. UNE seule source de verite, lue a la fois
// par la mecanique (bossInDanger) et par le rendu (couche FX) — elles ne peuvent pas diverger.
// PHASE 2 : le MOTIF change, pas seulement la vitesse.
//   band   → une 2e crete remonte a contresens : une TENAILLE qui se referme
//   sector → une 2e lame diametralement opposee : un vrai tourniquet
//   ring   → l'anneau IMPLOSE au lieu d'enfler : le calcul s'inverse
function bossZones(b: Boss, t: number): number[] {
  if (b.kind === 'band') return b.phase === 1 ? [bandY(t)] : [bandY(t), bandY(1 - t)]
  if (b.kind === 'sector') {
    const a = sectorAngle(b, t)
    return b.phase === 1 ? [a] : [a, a + Math.PI]
  }
  return [b.phase === 1 ? ringR(t) : ringR(1 - t)]
}

// Le tap touche-t-il une zone dangereuse ? Teste EXACTEMENT ce que la couche FX dessine
// (meme espace normalise etire) — ce que tu vois est ce qui te touche.
function bossInDanger(b: Boss, nx: number, ny: number, now: number): boolean {
  const zones = bossZones(b, bossTellT(b, now))
  if (b.kind === 'band') return zones.some((z) => Math.abs(ny - z) < b.band)
  const dx = nx - 0.5
  const dy = ny - 0.5
  if (b.kind === 'ring') {
    const dist = Math.hypot(dx, dy)
    return zones.some((z) => Math.abs(dist - z) < b.band)
  }
  // 'sector' : ecart angulaire replie sur [-PI, PI]
  const ang = Math.atan2(dy, dx)
  return zones.some((z) => {
    const d = ang - z
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < b.band
  })
}

// ---------------------------------------------------------------------------
// Persistance locale (high-score + stages debloques)
// ---------------------------------------------------------------------------
interface SaveData {
  highScore: number
  maxUnlocked: number
  noyauBeaten: boolean // le boss final (LE NOYAU) a-t-il deja ete vaincu ?
}

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<SaveData>
      return {
        highScore: Math.max(0, Number(p.highScore) || 0),
        maxUnlocked: Math.min(3, Math.max(1, Math.round(Number(p.maxUnlocked) || 1))),
        noyauBeaten: Boolean(p.noyauBeaten),
      }
    }
  } catch {
    /* stockage indisponible : on repart a zero, sans casser. */
  }
  return { highScore: 0, maxUnlocked: 1, noyauBeaten: false }
}

function persistSave(data: SaveData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* quota / mode prive : on ignore silencieusement. */
  }
}

// ---------------------------------------------------------------------------
// prefers-reduced-motion : vitesse reduite + animations non essentielles coupees.
// ---------------------------------------------------------------------------
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}

// devicePixelRatio plafonne a 2 (jamais de rendu 3x/4x sur ecrans denses).
const dpr = () => Math.min(window.devicePixelRatio || 1, 2)

interface StageHandle {
  tap: (nx: number, ny: number) => void
}

// Etiquette flottante de feedback (grammaire des combos).
interface FloatLabel {
  id: number
  x: number
  y: number
  text: string
  kind: 'gain' | 'noise'
}


interface StageProps {
  speed: number // 1 normal, 0.3 si reduced-motion
  boss?: boolean // le moteur se resout en entite (combat de boss)
}

/* ==========================================================================
 * STAGE 1 — WAVEFORM (SVG)
 * Lignes sinusoidales dephasees + ondes de tap. Rendu via state React.
 * ========================================================================*/
const WaveformStage = memo(
  forwardRef<StageHandle, StageProps>(function WaveformStage({ speed, boss }, ref) {
    const [phase, setPhase] = useState(0)
    // Kick : le tap fait gonfler l'onde a l'endroit touche (identite native du stage 1).
    // L'anneau resonnable, lui, est dessine par la couche FX commune aux 3 stages.
    const kicksRef = useRef<{ x: number; born: number }[]>([])

    useImperativeHandle(ref, () => ({
      tap: (nx) => {
        kicksRef.current.push({ x: nx * 1000, born: performance.now() })
        if (kicksRef.current.length > 8) kicksRef.current.shift()
      },
    }))

    useEffect(() => {
      let raf = 0
      let last = performance.now()
      const loop = (now: number) => {
        const dt = (now - last) / 1000
        last = now
        setPhase((p) => p + dt * speed * 1.6)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      return () => cancelAnimationFrame(raf)
    }, [speed])

    // Ondes en niveaux de gris (base mono) ; distinctes par la clarte, pas la teinte.
    const lines = [
      { freq: 0.012, amp: 90, color: '#ffffff', off: 0 },
      { freq: 0.018, amp: 60, color: '#9aa0a6', off: 1.1 },
      { freq: 0.009, amp: 130, color: '#d7dade', off: 2.3 },
      { freq: 0.024, amp: 45, color: '#7d8288', off: 0.6 },
      { freq: 0.015, amp: 100, color: '#c2c6cb', off: 3.0 },
    ]

    const now = performance.now()
    // Gonflement local et decroissant autour de chaque tap recent.
    const kickAt = (x: number) => {
      let b = 0
      for (const k of kicksRef.current) {
        const age = now - k.born
        if (age > 500) continue
        const dx = x - k.x
        b += 150 * (1 - age / 500) * Math.exp(-(dx * dx) / (2 * 70 * 70))
      }
      return b
    }

    // En combat, l'onde enfle et pulse — la porteuse « se resout » en entite menacante.
    const bossAmp = boss ? 1.3 + 0.18 * Math.sin(phase * 2.2) : 1
    const buildPath = (freq: number, amp: number, off: number) => {
      let d = ''
      for (let x = 0; x <= 1000; x += 20) {
        const a = (amp + kickAt(x)) * bossAmp
        const y =
          500 +
          a * Math.sin(x * freq + phase + off) +
          a * 0.35 * Math.sin(x * freq * 2.3 - phase * 1.4 + off)
        d += (x === 0 ? 'M' : 'L') + x.toFixed(0) + ' ' + y.toFixed(1) + ' '
      }
      return d
    }

    return (
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ display: 'block', background: PALETTE.void }}
        aria-hidden="true"
      >
        <g style={{ mixBlendMode: 'screen' }}>
          {lines.map((l, i) => (
            <path
              key={i}
              d={buildPath(l.freq, l.amp, l.off)}
              fill="none"
              stroke={l.color}
              strokeWidth={2}
              strokeLinecap="round"
              opacity={0.85}
            />
          ))}
        </g>
      </svg>
    )
  }),
)

/* ==========================================================================
 * STAGE 2 — MANDALA (Canvas 2D)
 * Symetrie en couronnes, composite 'lighter', trainee par fondu.
 * Glow pre-rendu (sprite offscreen) au lieu de shadowBlur par-op (perf mobile).
 * ========================================================================*/
interface Pulse {
  x: number
  y: number
  born: number
  colorIdx: number
}

// Couronnes en niveaux de gris (base mono). La couleur vient de la couche FX.
const MANDALA_COLORS: [number, number, number][] = [
  [0.92, 0.92, 0.92],
  [0.6, 0.63, 0.66],
  [1, 1, 1],
]

const MandalaStage = memo(
  forwardRef<StageHandle, StageProps>(function MandalaStage({ speed, boss }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const pulsesRef = useRef<Pulse[]>([])
    const colorIdxRef = useRef(0)
    // Le combat lu par la boucle rAF via une ref (pas de re-abonnement de l'effet).
    const bossRef = useRef(!!boss)
    useEffect(() => {
      bossRef.current = !!boss
    }, [boss])

    useImperativeHandle(ref, () => ({
      tap: (nx, ny) => {
        pulsesRef.current.push({
          x: nx,
          y: ny,
          born: performance.now(),
          colorIdx: colorIdxRef.current++ % MANDALA_COLORS.length,
        })
        if (pulsesRef.current.length > 24) pulsesRef.current.shift()
      },
    }))

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const rgba = (c: [number, number, number], a: number) =>
        `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`

      // Sprites de glow pre-rendus (un par couleur) : evite shadowBlur par-op.
      const makeGlow = (c: [number, number, number]) => {
        const s = 64
        const g = document.createElement('canvas')
        g.width = s
        g.height = s
        const gc = g.getContext('2d')!
        const grd = gc.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
        grd.addColorStop(0, rgba(c, 1))
        grd.addColorStop(0.4, rgba(c, 0.5))
        grd.addColorStop(1, rgba(c, 0))
        gc.fillStyle = grd
        gc.fillRect(0, 0, s, s)
        return g
      }
      const glows = MANDALA_COLORS.map(makeGlow)

      let raf = 0
      let w = 0
      let h = 0

      const ro = new ResizeObserver(() => {
        const rect = canvas.getBoundingClientRect()
        const ratio = dpr()
        w = Math.max(1, Math.floor(rect.width * ratio))
        h = Math.max(1, Math.floor(rect.height * ratio))
        canvas.width = w
        canvas.height = h
        ctx.fillStyle = PALETTE.void
        ctx.fillRect(0, 0, w, h)
      })
      ro.observe(canvas)

      const dot = (glow: HTMLCanvasElement, x: number, y: number, r: number, alpha: number) => {
        ctx.globalAlpha = alpha
        ctx.drawImage(glow, x - r, y - r, r * 2, r * 2)
        ctx.globalAlpha = 1
      }

      // Fondu d'entree/sortie du mode entite (0 → 1) : le decor SE RESOUT, il ne clignote pas.
      let bossMix = 0

      const loop = (now: number) => {
        const t = (now / 1000) * speed
        // Trainee : voile sombre semi-transparent par-dessus la frame precedente.
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = 'rgba(10,10,12,0.16)'
        ctx.fillRect(0, 0, w, h)

        ctx.globalCompositeOperation = 'lighter'
        ctx.save()
        ctx.translate(w / 2, h / 2)
        const scale = Math.min(w, h)
        const arms = 12
        bossMix += ((bossRef.current ? 1 : 0) - bossMix) * 0.04

        // Couronne ambiante (le mandala respire meme sans tap). En combat, elle se
        // VERROUILLE en engrenage : rotation a crans (ratchet) au lieu de la derive
        // fluide, dents alternees, et un œil qui s'ouvre au centre — LE ROUAGE.
        const ratchetPeriod = 420 // ms par cran — l'horloge mecanique de l'entite
        const catchUp = Math.min(1, ((now % ratchetPeriod) / ratchetPeriod) * 6) // saut sec
        const ratchet = ((Math.floor(now / ratchetPeriod) + catchUp) * (Math.PI * 2)) / arms / 2
        const drift = t * 0.25
        const gearAng = drift * (1 - bossMix) + ratchet * bossMix
        const ambR = scale * (0.16 + 0.02 * Math.sin(t * 0.8) * (1 - bossMix) + 0.05 * bossMix)
        for (let i = 0; i < arms; i++) {
          const a = (i / arms) * Math.PI * 2 + gearAng
          // Dents : une couronne sur deux sort du rang — silhouette d'engrenage.
          const toothR = ambR * (1 + (i % 2 === 0 ? 0.16 : 0) * bossMix)
          const size = scale * (0.02 + 0.012 * bossMix * (i % 2 === 0 ? 1 : 0.4))
          dot(glows[1], Math.cos(a) * toothR, Math.sin(a) * toothR, size, 0.5 + 0.3 * bossMix)
        }
        if (bossMix > 0.02) {
          // L'œil : une pupille de lumiere qui pulse au rythme des crans.
          const blink = 0.55 + 0.45 * Math.max(0, Math.sin((now / ratchetPeriod) * Math.PI))
          dot(glows[2], 0, 0, scale * 0.045 * bossMix, 0.85 * bossMix * blink)
          dot(glows[1], 0, 0, scale * 0.1 * bossMix, 0.3 * bossMix)
        }

        // Pulses de tap : couronnes qui s'ouvrent en symetrie radiale.
        const pulses = pulsesRef.current
        for (let k = pulses.length - 1; k >= 0; k--) {
          const p = pulses[k]
          const age = (now - p.born) / 1600
          if (age >= 1) {
            pulses.splice(k, 1)
            continue
          }
          const rr = age * scale * 0.5
          const alpha = (1 - age) * 0.9
          const size = scale * 0.03 * (1 - age * 0.5)
          const glow = glows[p.colorIdx]
          const col = MANDALA_COLORS[p.colorIdx]
          for (let i = 0; i < arms; i++) {
            const a = (i / arms) * Math.PI * 2 + t * 0.5 + age * 1.5
            const x = Math.cos(a) * rr
            const y = Math.sin(a) * rr
            dot(glow, x, y, size, alpha)
            // Rayon reliant le centre au point (structure de mandala).
            ctx.strokeStyle = rgba(col, alpha * 0.22)
            ctx.lineWidth = scale * 0.002
            ctx.beginPath()
            ctx.moveTo(0, 0)
            ctx.lineTo(x, y)
            ctx.stroke()
          }
        }

        ctx.restore()
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)

      return () => {
        cancelAnimationFrame(raf)
        ro.disconnect()
      }
    }, [speed])

    return (
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%', background: PALETTE.void }}
        aria-hidden="true"
      />
    )
  }),
)

/* ==========================================================================
 * STAGE 3 — LIQUID (WebGL)
 * Flux marbre : fbm 6 octaves dans un fragment shader. Onde de choc au tap.
 * Uniforms en refs -> le shader ne recompile pas a chaque frame.
 * ========================================================================*/
const VERT_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

const FRAG_SRC = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_taps[6];
uniform float u_ages[6];
uniform vec3 u_colA;
uniform vec3 u_colB;
uniform vec3 u_colC;
uniform float u_boss; // 0 → 1 : le flux se condense en globe (LE NOYAU)

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
             mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 6; i++){ v += a * noise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float aspect = u_res.x / u_res.y;

  float wave = 0.0;
  for (int i = 0; i < 6; i++){
    float age = u_ages[i];
    if (age >= 0.0 && age < 2.0){
      vec2 tp = u_taps[i] - 0.5;
      tp.x *= aspect;
      float d = distance(p, tp);
      float r = age * 0.9;
      wave += smoothstep(0.06, 0.0, abs(d - r)) * (1.0 - age / 2.0);
    }
  }

  float t = u_time * 0.08;
  vec2 q = vec2(fbm(p * 3.0 + t), fbm(p * 3.0 - t + 5.2));
  float f = fbm(p * 3.0 + q * 2.0 + wave * 1.5);
  f = clamp(f + wave * 0.6, 0.0, 1.4);

  vec3 col = mix(u_colA, u_colB, smoothstep(0.2, 0.85, f));
  col = mix(col, u_colC, smoothstep(0.6, 1.0, f) * 0.7);
  col *= 0.55 + 0.7 * f;
  col += wave * vec3(1.0);

  // LE NOYAU : le flux se condense en globe. Le dehors s'eteint (croute nette),
  // et des VEINES pulsent sous la surface — la chaine de processeurs qui alimente
  // le coeur. Reste monochrome : le rouge est reserve a l'attaque (couche FX).
  if (u_boss > 0.001) {
    float d = length(p);
    float globe = smoothstep(0.66, 0.58, d);
    float rim = smoothstep(0.03, 0.0, abs(d - 0.62)) * 0.8;
    float veins = smoothstep(0.045, 0.0, abs(f - 0.62)) * globe;
    float pulse = 0.45 + 0.55 * sin(u_time * 2.6 + f * 9.0);
    vec3 bossCol = col * (0.25 + 0.95 * globe) + vec3(1.0) * (veins * pulse * 0.4 + rim);
    col = mix(col, bossCol, u_boss);
  }
  gl_FragColor = vec4(col, 1.0);
}
`

interface LiquidProps extends StageProps {
  onGlError: () => void
}

const LiquidStage = memo(
  forwardRef<StageHandle, LiquidProps>(function LiquidStage({ speed, boss, onGlError }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    // 6 emplacements d'onde de choc (ring buffer). born tres negatif = inactif.
    const tapsRef = useRef(Array.from({ length: 6 }, () => ({ x: 0, y: 0, born: -1e9 })))
    const ringRef = useRef(0)
    // Le combat lu par la boucle rAF via une ref (pas de recompilation du shader).
    const bossRef = useRef(!!boss)
    useEffect(() => {
      bossRef.current = !!boss
    }, [boss])

    useImperativeHandle(ref, () => ({
      tap: (nx, ny) => {
        const slot = tapsRef.current[ringRef.current % 6]
        slot.x = nx
        slot.y = 1 - ny // WebGL : origine en bas
        slot.born = performance.now()
        ringRef.current++
      },
    }))

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const gl = canvas.getContext('webgl', {
        antialias: false,
        premultipliedAlpha: false,
        powerPreference: 'high-performance',
      })
      if (!gl) {
        onGlError()
        return
      }

      const compile = (type: number, src: string): WebGLShader | null => {
        const sh = gl.createShader(type)
        if (!sh) return null
        gl.shaderSource(sh, src)
        gl.compileShader(sh)
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          gl.deleteShader(sh)
          return null
        }
        return sh
      }

      const vs = compile(gl.VERTEX_SHADER, VERT_SRC)
      const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC)
      const prog = gl.createProgram()
      if (!vs || !fs || !prog) {
        if (vs) gl.deleteShader(vs)
        if (fs) gl.deleteShader(fs)
        if (prog) gl.deleteProgram(prog)
        onGlError()
        return
      }
      gl.attachShader(prog, vs)
      gl.attachShader(prog, fs)
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.deleteShader(vs)
        gl.deleteShader(fs)
        gl.deleteProgram(prog)
        onGlError()
        return
      }
      gl.useProgram(prog)

      const buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const aPos = gl.getAttribLocation(prog, 'a_pos')
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

      const uRes = gl.getUniformLocation(prog, 'u_res')
      const uTime = gl.getUniformLocation(prog, 'u_time')
      const uTaps = gl.getUniformLocation(prog, 'u_taps')
      const uAges = gl.getUniformLocation(prog, 'u_ages')
      const uBoss = gl.getUniformLocation(prog, 'u_boss')
      // Flux marbre en niveaux de gris (base mono) : sombre → clair → blanc.
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_colA'), [0.13, 0.13, 0.15])
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_colB'), [0.55, 0.56, 0.6])
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_colC'), [1, 1, 1])

      let w = 0
      let h = 0
      const ro = new ResizeObserver(() => {
        const rect = canvas.getBoundingClientRect()
        const ratio = dpr()
        w = Math.max(1, Math.floor(rect.width * ratio))
        h = Math.max(1, Math.floor(rect.height * ratio))
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      })
      ro.observe(canvas)

      const start = performance.now()
      const tapsFlat = new Float32Array(12)
      const agesFlat = new Float32Array(6)
      let raf = 0
      let bossMix = 0 // fondu : le flux se condense / se relache sans a-coup

      const loop = (now: number) => {
        gl.uniform2f(uRes, w, h)
        gl.uniform1f(uTime, ((now - start) / 1000) * speed)
        bossMix += ((bossRef.current ? 1 : 0) - bossMix) * 0.04
        gl.uniform1f(uBoss, bossMix)
        for (let i = 0; i < 6; i++) {
          const s = tapsRef.current[i]
          tapsFlat[i * 2] = s.x
          tapsFlat[i * 2 + 1] = s.y
          agesFlat[i] = (now - s.born) / 1000
        }
        gl.uniform2fv(uTaps, tapsFlat)
        gl.uniform1fv(uAges, agesFlat)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)

      return () => {
        cancelAnimationFrame(raf)
        ro.disconnect()
        gl.deleteProgram(prog)
        gl.deleteShader(vs)
        gl.deleteShader(fs)
        gl.deleteBuffer(buf)
        // Libere le contexte : evite l'epuisement apres de nombreux aller-retours.
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
    }, [speed, onGlError])

    return (
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%', background: PALETTE.void }}
        aria-hidden="true"
      />
    )
  }),
)

/* ==========================================================================
 * COUCHE FX — au-dessus des moteurs, sous les scanlines. rAF + refs (0 re-render).
 * « L'intensite = ton flux » : anneaux resonnables (identiques sur les 3 stages),
 * flash d'impact, embrasement resonance/interference. Sobre : bloom/luminosite
 * pilotes par la CADENCE, jamais de shake ni d'aberration.
 * ========================================================================*/
interface Impact {
  x: number
  y: number
  born: number
  mult: number
}
interface Ignite {
  x: number
  y: number
  rad: number
  born: number
  kind: 'res' | 'inter'
}
// Celebration au franchissement d'un palier de performance. La recompense est un
// EFFET GRAPHIQUE ABSTRAIT MAIS EVOCATEUR (choix Xavier, esprit « candy crush ») :
// une corolle de branches qui s'ouvre et tourne. Elle ESCALADE avec le palier —
// 6 branches en ×2, 9 en ×3, 12 en ×4 — donc mieux tu joues, plus la borne fleurit.
interface Celeb {
  x: number
  y: number
  born: number
  tier: number
}
const CELEB_LIFE = 760 // ms

// GRAMMAIRE POSITIF / NEGATIF (demande Xavier : distinguer clairement les deux).
// Le positif S'OUVRE, MONTE, s'illumine, se colore (corolle organique, etiquettes
// qui montent, voiles de lumiere). Le negatif SE REFERME, DESCEND, s'assombrit,
// vire au rouge : au point touche, une FRACTURE — eclats anguleux rouges qui
// IMPLOSENT + une tache sombre qui retire brievement la lumiere du moteur.
interface Hit {
  x: number
  y: number
  born: number
}
const HIT_LIFE = 420 // ms — sec et brutal, la ou la corolle est ample et douce
interface Boss {
  integrite: number
  signal: number
  tellUntil: number
  tellStart: number
  nextTell: number
  lastHit: number
  // Reglages du boss courant (copies depuis BOSS_DEFS a l'entree en combat).
  kind: BossKind
  phase: number // 1 puis 2 sous BOSS_PHASE2_AT d'INTEGRITE : le motif change
  tellSeed: number // orientation de depart de la charge (tiree a chaque tell : imprevisible)
  band: number
  tellDmg: number
  tapDmg: number
  iframe: number
  tellEvery: number
  tellDur: number
}

type Ref<T> = { current: T }

// Noir & blanc au repos ; la couleur ne surgit qu'avec la CADENCE (le palier = la teinte).
// x1 blanc → x2 magenta → x3 cyan → x4 vert. La couleur EST ta maitrise du flux.
const FLOW_STOPS: [number, number, number][] = [
  [235, 235, 235], // x1 : blanc (mono)
  [255, 46, 151], // x2 : magenta
  [0, 240, 255], // x3 : cyan
  [57, 255, 20], // x4 : vert
]
function ringColor(mult: number, a: number): string {
  const t = Math.min(1, Math.max(0, (mult - 1) / 3)) * (FLOW_STOPS.length - 1)
  const i = Math.min(FLOW_STOPS.length - 2, Math.floor(t))
  const f = t - i
  const c0 = FLOW_STOPS[i]
  const c1 = FLOW_STOPS[i + 1]
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * f)
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * f)
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * f)
  return `rgba(${r},${g},${b},${a})`
}

// Repos : au-dela de ce silence, la borne « respire » et emet ses propres ondes
// (elle reve — « quelque chose dort sous le verre ») pour appeler le premier doigt.
const IDLE_MS = 2500
const ATTRACT_INTERVAL = 1450 // ms entre deux ondes d'invitation
const ATTRACT_LIFE = 2200 // ms de vie d'une onde (lente, contemplative)
const ATTRACT_ALPHA = 0.22 // opacite max d'une onde d'invitation

const FxCanvas = memo(function FxCanvas({
  ringsRef,
  impactsRef,
  ignitesRef,
  celebsRef,
  hitsRef,
  multRef,
  lastTapRef,
  bossRef,
  reducedRef,
}: {
  ringsRef: Ref<{ x: number; y: number; born: number }[]>
  impactsRef: Ref<Impact[]>
  ignitesRef: Ref<Ignite[]>
  celebsRef: Ref<Celeb[]>
  hitsRef: Ref<Hit[]>
  multRef: Ref<number>
  lastTapRef: Ref<number>
  bossRef: Ref<Boss | null>
  reducedRef: Ref<boolean>
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let w = 0
    let h = 0
    let ratio = 1
    let raf = 0
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect()
      ratio = dpr()
      w = Math.max(1, Math.floor(rect.width * ratio))
      h = Math.max(1, Math.floor(rect.height * ratio))
      canvas.width = w
      canvas.height = h
    })
    ro.observe(canvas)

    // Ondes d'invitation au repos (attract mode). Blanches : le repos reste monochrome.
    const attracts: { x: number; y: number; born: number }[] = []
    let lastAttract = 0

    const loop = (now: number) => {
      ctx.clearRect(0, 0, w, h)
      const s = Math.min(w, h)
      const reduced = reducedRef.current
      const mult = multRef.current
      const idle = now - lastTapRef.current > IDLE_MS
      ctx.globalCompositeOperation = 'lighter'

      // Respiration au repos : point qui erre lentement + ondes blanches emises seules,
      // et un tres leger souffle de luminosite. La borne reve ; tape pour lui repondre.
      if (idle && !reduced) {
        if (now - lastAttract > ATTRACT_INTERVAL) {
          lastAttract = now
          attracts.push({
            x: 0.5 + 0.26 * Math.sin(now * 0.0006),
            y: 0.5 + 0.19 * Math.sin(now * 0.00043 + 1.3),
            born: now,
          })
          if (attracts.length > 4) attracts.shift()
        }
        // Souffle global (inspire/expire ~0.12 Hz), infime.
        ctx.fillStyle = `rgba(255,255,255,${0.022 * (0.5 + 0.5 * Math.sin(now * 0.0008))})`
        ctx.fillRect(0, 0, w, h)
      }
      for (let i = attracts.length - 1; i >= 0; i--) {
        const at = attracts[i]
        const age = now - at.born
        if (age > ATTRACT_LIFE) {
          attracts.splice(i, 1)
          continue
        }
        if (age < 0) continue
        const p = age / ATTRACT_LIFE
        // Apparait, culmine, s'efface (courbe en cloche).
        const a = Math.sin(p * Math.PI) * ATTRACT_ALPHA
        ctx.strokeStyle = `rgba(255,255,255,${a})`
        ctx.lineWidth = 1.3 * ratio
        ctx.shadowBlur = 7 * ratio
        ctx.shadowColor = `rgba(255,255,255,${a})`
        // Double anneau : l'onde principale + un echo interieur (souffle plus organique).
        for (const k of [0.9, 0.5]) {
          const rad = RING_RMAX * p * k
          ctx.globalAlpha = k === 0.9 ? 1 : 0.55
          ctx.beginPath()
          ctx.ellipse(at.x * w, at.y * h, rad * w, rad * h, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }
      ctx.shadowBlur = 0

      // La couleur bleed-in : voile additif teinte par la cadence (des ×2), tres doux.
      // C'est ainsi que le monde monochrome se colore quand tu entres en flux.
      if (mult >= 2 && !reduced) {
        ctx.fillStyle = ringColor(mult, ((mult - 1) / 3) * 0.06)
        ctx.fillRect(0, 0, w, h)
      }

      // Anneaux resonnables — ellipse en espace etire = ce que la mecanique teste.
      const rings = ringsRef.current
      for (const r of rings) {
        const age = now - r.born
        if (age < 0 || age > RING_LIFE) continue // age<0 : decalage d'horloge rAF
        const p = age / RING_LIFE
        const rad = RING_RMAX * p
        const a = (1 - p) * (0.3 + 0.14 * Math.min(mult, 4))
        ctx.strokeStyle = ringColor(mult, a)
        ctx.lineWidth = (1.1 + 0.5 * Math.min(mult, 4)) * ratio
        ctx.shadowBlur = reduced ? 0 : (7 + 3 * mult) * ratio
        ctx.shadowColor = ringColor(mult, 0.8)
        ctx.beginPath()
        ctx.ellipse(r.x * w, r.y * h, rad * w, rad * h, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.shadowBlur = 0

      // Flash d'impact au point touche.
      const impacts = impactsRef.current
      for (let i = impacts.length - 1; i >= 0; i--) {
        const im = impacts[i]
        const age = now - im.born
        if (age > 260) {
          impacts.splice(i, 1)
          continue
        }
        if (age < 0) continue
        const p = age / 260
        const rad = s * (0.012 + 0.055 * p)
        const a = (1 - p) * 0.9
        const cx = im.x * w
        const cy = im.y * h
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
        grd.addColorStop(0, `rgba(255,255,255,${a})`)
        grd.addColorStop(0.5, ringColor(im.mult, a * 0.6))
        grd.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.arc(cx, cy, rad, 0, Math.PI * 2)
        ctx.fill()
      }

      // Embrasement resonance (magenta→blanc) / interference (blanc).
      const ignites = ignitesRef.current
      for (let i = ignites.length - 1; i >= 0; i--) {
        const ig = ignites[i]
        const age = now - ig.born
        if (age > 450) {
          ignites.splice(i, 1)
          continue
        }
        if (age < 0) continue
        const p = age / 450
        const a = (1 - p) * 0.95
        const col = ig.kind === 'inter' ? `rgba(255,255,255,${a})` : ringColor(3.4, a)
        ctx.strokeStyle = col
        ctx.lineWidth = (2 + 2 * (1 - p)) * ratio
        ctx.shadowBlur = reduced ? 0 : 16 * ratio
        ctx.shadowColor = col
        const rad = ig.rad * (1 + 0.08 * p)
        ctx.beginPath()
        ctx.ellipse(ig.x * w, ig.y * h, rad * w, rad * h, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.shadowBlur = 0
      }

      // CELEBRATION de palier : une corolle abstraite s'ouvre au point touche.
      // C'est la « recompense » du jeu — evocatrice (fleur / etoile / onde de choc)
      // sans jamais etre figurative. Plus le palier est haut, plus elle est riche.
      const celebs = celebsRef.current
      for (let i = celebs.length - 1; i >= 0; i--) {
        const c = celebs[i]
        const age = now - c.born
        if (age > CELEB_LIFE) {
          celebs.splice(i, 1)
          continue
        }
        if (age < 0) continue
        const p = age / CELEB_LIFE
        const ease = 1 - Math.pow(1 - p, 3) // sortie franche puis ralentissement
        const a = (1 - p) * 0.9
        const col = ringColor(c.tier, a)
        const ccx = c.x * w
        const ccy = c.y * h
        const rad = s * (0.05 + 0.34 * ease)
        const branches = 3 * c.tier
        ctx.strokeStyle = col
        ctx.lineWidth = (1.1 + 0.55 * c.tier) * ratio
        ctx.shadowBlur = reduced ? 0 : 14 * ratio
        ctx.shadowColor = col
        for (let b = 0; b < branches; b++) {
          const ang = (b / branches) * Math.PI * 2 + p * 0.7
          const r0 = rad * 0.42
          ctx.beginPath()
          ctx.moveTo(ccx + Math.cos(ang) * r0, ccy + Math.sin(ang) * r0)
          ctx.lineTo(ccx + Math.cos(ang) * rad, ccy + Math.sin(ang) * rad)
          ctx.stroke()
        }
        // Anneau de couronnement : referme la corolle.
        ctx.globalAlpha = 0.65
        ctx.beginPath()
        ctx.arc(ccx, ccy, rad * 0.78, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.shadowBlur = 0
      }

      // FRACTURE de degat : l'anti-corolle. La ou la recompense s'ouvre en branches
      // organiques teintees, le degat se REFERME en eclats anguleux rouges, et une
      // tache sombre retire brievement la lumiere du moteur au point touche.
      const hits = hitsRef.current
      for (let i = hits.length - 1; i >= 0; i--) {
        const ht = hits[i]
        const age = now - ht.born
        if (age > HIT_LIFE) {
          hits.splice(i, 1)
          continue
        }
        if (age < 0) continue
        const p = age / HIT_LIFE
        const hx = ht.x * w
        const hy = ht.y * h
        // Pseudo-aleatoire stable par eclat (seme par l'instant du coup).
        const pr = (k: number) => {
          const v = Math.sin(ht.born * 0.37 + k * 12.9898) * 43758.5453
          return v - Math.floor(v)
        }
        // 1. La lumiere se retire : tache sombre qui guerit en se resorbant.
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = `rgba(5,5,6,${0.55 * (1 - p)})`
        ctx.beginPath()
        ctx.arc(hx, hy, s * 0.13 * (1 - p * 0.35), 0, Math.PI * 2)
        ctx.fill()
        ctx.globalCompositeOperation = 'lighter'
        // 2. Les eclats : anguleux, irreguliers, en IMPLOSION (ils se referment).
        const rOut = s * 0.16 * (1 - p * 0.55)
        const a = 1 - p
        ctx.strokeStyle = `rgba(255,59,48,${a})`
        ctx.lineWidth = 2 * ratio
        ctx.shadowBlur = reduced ? 0 : 6 * ratio
        ctx.shadowColor = `rgba(255,59,48,${a})`
        for (let k = 0; k < 9; k++) {
          const ang = (k / 9) * Math.PI * 2 + pr(k) * 0.7
          const len = rOut * (0.55 + 0.5 * pr(k + 9))
          ctx.beginPath()
          ctx.moveTo(hx + Math.cos(ang) * len, hy + Math.sin(ang) * len)
          ctx.lineTo(hx + Math.cos(ang) * len * 0.3, hy + Math.sin(ang) * len * 0.3)
          ctx.stroke()
        }
        ctx.shadowBlur = 0
      }

      // ZONE DANGEREUSE du boss pendant une charge — la zone a NE PAS taper.
      // Chaque boss a sa geometrie (Y / THETA / R). On dessine EXACTEMENT ce que
      // bossInDanger() teste, dans le meme espace normalise etire.
      // Dessinee meme en reduced-motion : c'est une information de jeu essentielle.
      const bo = bossRef.current
      if (bo && bo.tellUntil > now) {
        const t = bossTellT(bo, now)
        const RED = 'rgba(255,59,48,'
        ctx.strokeStyle = RED + '0.95)'
        ctx.lineWidth = 2 * ratio
        ctx.shadowBlur = 12 * ratio
        ctx.shadowColor = RED + '0.95)'

        // Une zone en phase 1, deux en phase 2 (tenaille / tourniquet).
        const zones = bossZones(bo, t)
        if (bo.kind === 'band') {
          // WAVEFORM — crete(s) horizontale(s). En phase 2 la 2e remonte a contresens.
          const bandH = bo.band * h
          for (const z of zones) {
            const cy = z * h
            const grd = ctx.createLinearGradient(0, cy - bandH, 0, cy + bandH)
            grd.addColorStop(0, RED + '0)')
            grd.addColorStop(0.5, RED + '0.5)')
            grd.addColorStop(1, RED + '0)')
            ctx.fillStyle = grd
            ctx.fillRect(0, cy - bandH, w, bandH * 2)
            ctx.beginPath()
            ctx.moveTo(0, cy)
            ctx.lineTo(w, cy)
            ctx.stroke()
          }
        } else if (bo.kind === 'sector') {
          // MANDALA — lame(s) radiale(s) qui tournent. On les trace en espace normalise
          // puis on etire : le bord visible est exactement le bord teste.
          const R = 1.5 // deborde largement l'ecran : la lame va jusqu'aux bords
          const pt = (a: number, r: number) => [(0.5 + Math.cos(a) * r) * w, (0.5 + Math.sin(a) * r) * h]
          const grd = ctx.createRadialGradient(0.5 * w, 0.5 * h, 0, 0.5 * w, 0.5 * h, Math.max(w, h) * 0.75)
          grd.addColorStop(0, RED + '0.55)')
          grd.addColorStop(1, RED + '0.12)')
          for (const z of zones) {
            const a0 = z - bo.band
            const a1 = z + bo.band
            ctx.beginPath()
            ctx.moveTo(0.5 * w, 0.5 * h)
            for (let i = 0; i <= 24; i++) {
              const [px, py] = pt(a0 + ((a1 - a0) * i) / 24, R)
              ctx.lineTo(px, py)
            }
            ctx.closePath()
            ctx.fillStyle = grd
            ctx.fill()
            // Aretes vives : les deux bords de la lame.
            for (const a of [a0, a1]) {
              const [px, py] = pt(a, R)
              ctx.beginPath()
              ctx.moveTo(0.5 * w, 0.5 * h)
              ctx.lineTo(px, py)
              ctx.stroke()
            }
          }
        } else {
          // LE NOYAU — anneau de calcul qui enfle depuis le centre. Le danger est la
          // PAROI : on est sauf tout pres du coeur, ou loin dehors.
          const r = zones[0] // phase 2 : l'anneau implose au lieu d'enfler
          const rIn = Math.max(0, r - bo.band)
          const rOut = r + bo.band
          // Remplissage EXACT de la couronne : deux ellipses en regle even-odd. Un trait
          // epais de largeur uniforme deborderait horizontalement (l'espace est etire) et
          // teinterait en rouge une zone en realite sure — ce que tu vois DOIT etre ce
          // qui te touche.
          ctx.shadowBlur = 0
          ctx.fillStyle = RED + '0.4)'
          ctx.beginPath()
          ctx.ellipse(0.5 * w, 0.5 * h, rOut * w, rOut * h, 0, 0, Math.PI * 2)
          ctx.ellipse(0.5 * w, 0.5 * h, rIn * w, rIn * h, 0, 0, Math.PI * 2)
          ctx.fill('evenodd')
          // Parois vives : les bords exacts que la mecanique teste.
          ctx.lineWidth = 2 * ratio
          ctx.shadowBlur = 12 * ratio
          ctx.strokeStyle = RED + '0.95)'
          for (const rr of [rIn, rOut]) {
            if (rr <= 0) continue
            ctx.beginPath()
            ctx.ellipse(0.5 * w, 0.5 * h, rr * w, rr * h, 0, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
        ctx.shadowBlur = 0
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [ringsRef, impactsRef, ignitesRef, celebsRef, hitsRef, multRef, lastTapRef, bossRef, reducedRef])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9 }}
    />
  )
})

/* ==========================================================================
 * HUD, jauge, selecteur, eveil, flash
 * ========================================================================*/
const Hud = memo(function Hud({
  stageName,
  score,
  highScore,
  mult,
  bossMode,
}: {
  stageName: string
  score: number
  highScore: number
  mult: number
  bossMode: boolean
}) {
  const cell: React.CSSProperties = { display: 'flex', flexDirection: 'column', lineHeight: 1.1 }
  const label: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: '0.18em',
    color: 'rgba(255,255,255,0.55)', // >= AA sur le fond (labels 10px)
  }
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: '10px 14px',
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <div style={cell}>
        <span style={label}>{bossMode ? 'BOSS' : 'STAGE'}</span>
        <span style={{ color: bossMode ? PALETTE.red : '#ffffff', fontSize: 15, fontWeight: 700 }}>
          {stageName}
        </span>
      </div>
      <div style={{ ...cell, alignItems: 'center' }}>
        <span style={label}>SCORE</span>
        <span style={{ color: '#ffffff', fontSize: 18, fontWeight: 700 }}>
          {Math.min(score, 999999).toString().padStart(6, '0')}
        </span>
      </div>
      <div style={{ ...cell, alignItems: 'flex-end' }}>
        <span style={label}>HIGH</span>
        <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 15, fontWeight: 700 }}>
          {Math.min(highScore, 999999).toString().padStart(6, '0')}
        </span>
        {mult > 1.05 && (
          <span style={{ color: PALETTE.green, fontSize: 12, fontWeight: 700, marginTop: 2 }}>
            PERF ×{mult.toFixed(1)}
          </span>
        )}
      </div>
    </div>
  )
})

// Nombre de plots de SIGNAL (vitalite d'intrus) affiches pendant un combat.
const SIGNAL_PIPS = 4

/* --------------------------------------------------------------------------
 * LA JAUGE — une seule barre, partout, pour toute l'experience.
 *
 * Probleme resolu (retour Xavier) : « la progression ou la regression des jauges
 * n'est pas lisible pendant le jeu ». Avant : FLUX se REMPLISSAIT en jeu normal
 * mais INTEGRITE se VIDAIT en combat, et une 2e barre (SIGNAL) doublait la lecture.
 * Le sens de lecture s'inversait selon le contexte.
 *
 * Maintenant : UNE barre, toujours au meme endroit, qui va TOUJOURS dans le meme
 * sens — gauche → droite = je progresse. En combat elle montre la PURGE du boss
 * (100 - integrite) : elle se remplit a mesure qu'on le vide.
 * Le SIGNAL n'est plus une barre mais des PLOTS discrets (lisibles d'un coup d'oeil).
 * Lisibilite peripherique : un bord lumineux marque le front d'avancee et pulse a
 * chaque tap — on VOIT la barre pousser sans quitter le visuel des yeux.
 * ------------------------------------------------------------------------*/
function Gauge({
  pct,
  label,
  boss,
  tell,
  signal,
  beat,
  tier,
  victory,
  hit,
  reduced,
}: {
  pct: number // 0..100 — TOUJOURS « ma progression vers le but »
  label: string
  boss: boolean
  tell: boolean
  signal: number | null // null hors combat
  beat: number
  tier: number // palier de performance (1..4) — pilote les assets de combo
  victory: number // compteur : s'incremente sur une victoire notable (seuil, boss)
  hit: number // compteur : s'incremente a chaque coup encaisse (flash rouge)
  reduced: boolean
}) {
  const v = Math.min(100, Math.max(0, pct))
  const rounded = Math.round(v)
  const hot = v > 80 // seuil/mise a mort imminente → vert (cf. palette : vert = franchissement)
  // Arrondi au plus proche (pas ceil) : le PREMIER coup encaisse eteint deja un plot.
  // Un degat invisible sur la jauge serait un evenement negatif illisible.
  const pipsLit =
    signal === null ? 0 : signal <= 0 ? 0 : Math.max(1, Math.round((signal / 100) * SIGNAL_PIPS))
  const lowSignal = signal !== null && pipsLit <= 1

  return (
    <div style={{ padding: '0 14px 10px' }}>
      {/* Ligne d'etat : contexte a gauche, plots de SIGNAL + % a droite. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
          letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.55)',
          marginBottom: 4,
        }}
      >
        <span style={{ color: boss ? PALETTE.red : 'rgba(255,255,255,0.55)', fontWeight: boss ? 700 : 400 }}>
          {boss ? `PURGE · ${label}` : label}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* SIGNAL en plots discrets : « combien de coups je peux encore encaisser ». */}
          {signal !== null && (
            <span
              style={{ display: 'flex', alignItems: 'center', gap: 3 }}
              role="img"
              aria-label={`Signal ${pipsLit} sur ${SIGNAL_PIPS}`}
            >
              {Array.from({ length: SIGNAL_PIPS }, (_, i) => {
                const lit = i < pipsLit
                return (
                  <span
                    key={i}
                    aria-hidden="true"
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      background: lit ? (lowSignal ? PALETTE.red : 'rgba(255,255,255,0.9)') : 'rgba(255,255,255,0.12)',
                      boxShadow: lit && lowSignal ? `0 0 8px ${PALETTE.red}` : 'none',
                      transition: 'background 140ms linear',
                    }}
                  />
                )
              })}
            </span>
          )}
          <span style={{ color: hot ? PALETTE.green : 'rgba(255,255,255,0.55)', fontWeight: hot ? 700 : 400 }}>
            {rounded}%{hot ? ' ▲' : ''}
          </span>
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        <div
          role="progressbar"
          aria-label={boss ? `Purge de ${label}` : 'FLUX'}
          aria-valuenow={rounded}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            position: 'relative',
            height: 14,
            borderRadius: 7,
            background: 'rgba(255,255,255,0.08)',
            // Le cadre porte le contexte : rouge en combat, plus vif pendant une charge.
            border: `1px solid ${boss ? (tell ? PALETTE.red : 'rgba(255,59,48,0.5)') : 'rgba(255,255,255,0.12)'}`,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${v}%`,
              // Mono par defaut ; vert quand le but est imminent (evenement).
              background: hot
                ? `linear-gradient(90deg, rgba(57,255,20,0.6), ${PALETTE.green})`
                : 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.92))',
              boxShadow: hot ? `0 0 14px ${PALETTE.green}` : 'none',
              transition: 'width 110ms linear',
            }}
          />
          {/* Front d'avancee : un bord lumineux qui marque OU on en est. C'est lui
              qui rend la progression lisible du coin de l'oeil pendant qu'on tape. */}
          {v > 0 && v < 100 && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `calc(${v}% - 1.5px)`,
                width: 3,
                background: hot ? PALETTE.green : '#ffffff',
                boxShadow: `0 0 10px ${hot ? PALETTE.green : 'rgba(255,255,255,0.9)'}`,
                transition: 'left 110ms linear',
              }}
            />
          )}
          {/* ASSET DE COMBO : au passage d'un palier de performance (×2/×3/×4), une
              onde balaie la jauge dans la teinte du palier. La couleur = ta maitrise. */}
          {tier >= 2 && !reduced && (
            <div
              key={`t${tier}`}
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                background: `linear-gradient(90deg, transparent, ${ringColor(tier, 0.85)}, transparent)`,
                animation: 'tt-sweep 0.55s ease-out',
              }}
            />
          )}
          {/* ASSET DE VICTOIRE NOTABLE (seuil franchi, boss purge) : embrasement vert. */}
          {victory > 0 && !reduced && (
            <div
              key={`v${victory}`}
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                background: PALETTE.green,
                animation: 'tt-burst 0.7s ease-out',
              }}
            />
          )}
          {/* COUP ENCAISSE : la jauge saigne — flash rouge sec (grammaire du negatif). */}
          {hit > 0 && !reduced && (
            <div
              key={`h${hit}`}
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                background: PALETTE.red,
                animation: 'tt-burst 0.4s ease-out',
              }}
            />
          )}
        </div>
        {/* La jauge respire : un glow pulse a chaque tap. */}
        {!reduced && (
          <div
            key={beat}
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 7,
              pointerEvents: 'none',
              animation: 'tt-beat 0.32s ease-out',
            }}
          />
        )}
      </div>
    </div>
  )
}

// Notice d'accueil du boss : qui il est + la marche a suivre pour gagner. La regle
// « le mystere ne masque jamais l'action » (EXPERIENCE.md) : la voix reste oracle,
// les etapes sont explicites. Extensible aux futurs boss via cette table.
const BOSS_BRIEF: Record<string, { role: string; oracle: string; steps: string[] }> = {
  'LA PORTEUSE': {
    role: 'le premier globule blanc de la borne',
    oracle: 'elle veut noyer ton signal sous le bruit.',
    steps: [
      'tape sans relâche : chaque tap vide son INTÉGRITÉ',
      "quand la crête rouge balaie l'écran, tape dans les CREUX — loin d'elle",
      'un tap DANS la crête ronge ton SIGNAL ; à zéro, tu es purgé',
    ],
  },
  'LE ROUAGE': {
    role: 'le verrou logique de la borne',
    oracle: 'il veut te ranger dans son ordre.',
    steps: [
      'tape sans relâche : chaque tap enraye son INTÉGRITÉ',
      'une LAME rouge TOURNE autour du centre — tape hors du secteur',
      'un tap DANS la lame ronge ton SIGNAL ; à zéro, tu es purgé',
    ],
  },
  'LE NOYAU': {
    role: 'le cœur-processeur de la borne',
    oracle: "il calcule ta destruction. c'est la dernière couche.",
    steps: [
      'tape sans relâche : chaque tap fissure son INTÉGRITÉ',
      "un ANNEAU rouge ENFLE depuis le centre — seule sa PAROI blesse : écarte-t'en",
      "un tap SUR l'anneau ronge ton SIGNAL ; à zéro, tu es purgé",
    ],
  },
}

// Ecran d'intro affiche a l'apparition du boss. Le combat demarre au premier tap
// (ce tap la ne compte pas comme une attaque : il ne fait que lancer le duel).
function BossIntro({ name, reduced }: { name: string; reduced: boolean }) {
  const brief = BOSS_BRIEF[name]
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: '0 7vw',
        textAlign: 'center',
        background: 'rgba(10,10,12,0.9)',
        pointerEvents: 'none',
        zIndex: 26,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: '0.28em', color: PALETTE.red, fontWeight: 700 }}>
        INTRUS DÉTECTÉ
      </div>
      <div
        style={{
          fontWeight: 800,
          fontSize: 'clamp(26px, 8vw, 48px)',
          letterSpacing: '0.1em',
          color: PALETTE.red,
          textShadow: `0 0 22px ${PALETTE.red}`,
          animation: reduced ? 'none' : 'tt-tell 1.4s ease-in-out infinite',
        }}
      >
        {name}
      </div>
      {brief && (
        <div style={{ fontSize: 'clamp(11px, 3vw, 14px)', color: 'rgba(255,255,255,0.75)', maxWidth: 360 }}>
          {brief.role} — {brief.oracle}
        </div>
      )}
      {brief && (
        <ol
          style={{
            listStyle: 'none',
            margin: '6px 0 0',
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            maxWidth: 380,
          }}
        >
          {brief.steps.map((s, i) => (
            <li
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'baseline',
                fontSize: 'clamp(11px, 3vw, 13px)',
                lineHeight: 1.35,
                color: 'rgba(255,255,255,0.9)',
                textAlign: 'left',
              }}
            >
              <span style={{ color: PALETTE.red, fontWeight: 700 }}>{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}
      <div
        style={{
          marginTop: 12,
          fontSize: 'clamp(12px, 3.4vw, 16px)',
          letterSpacing: '0.12em',
          fontWeight: 700,
          color: '#ffffff',
          textShadow: '0 0 12px rgba(255,255,255,0.5)',
          animation: reduced ? 'none' : 'tt-blink 1.1s steps(2) infinite',
        }}
      >
        TAPE POUR L'AFFRONTER
      </div>
    </div>
  )
}

const StageSelector = memo(function StageSelector({
  current,
  maxUnlocked,
  glFailed,
  onSelect,
}: {
  current: number
  maxUnlocked: number
  glFailed: boolean
  onSelect: (id: number) => void
}) {
  // Selecteur reduit : de discretes pastilles (numero / cadenas). Le NOM du palier
  // reste lisible dans le HUD (en haut) et dans l'aria-label — inutile de le repeter ici.
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', padding: '0 14px' }}>
      {STAGES.map((s) => {
        const locked = s.id > maxUnlocked
        const glDown = s.engine === 'webgl' && glFailed
        const disabled = locked || glDown
        const active = s.id === current
        const suffix = locked ? ' verrouillé' : glDown ? ' indisponible' : ''
        return (
          <button
            key={s.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(s.id)}
            aria-current={active ? 'true' : undefined}
            aria-label={`Stage ${s.id} ${s.name}${suffix}`}
            className="tt-btn"
            style={{
              width: 46,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: disabled ? 'not-allowed' : 'pointer',
              borderRadius: 8,
              // Selecteur monochrome : actif = blanc (aucune teinte de stage).
              border: `1px solid ${active ? '#ffffff' : 'rgba(255,255,255,0.15)'}`,
              background: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)',
              color: disabled ? 'rgba(255,255,255,0.3)' : active ? '#ffffff' : 'rgba(255,255,255,0.7)',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 13,
              fontWeight: 700,
              opacity: disabled ? 0.55 : 1,
            }}
          >
            <span aria-hidden="true">{glDown ? '⚠' : locked ? '🔒' : s.id}</span>
          </button>
        )
      })}
    </div>
  )
})

// Murmure de l'oracle au franchissement de chaque seuil (cf. EXPERIENCE.md).
const STAGE_CRYPTIC: Record<number, string> = {
  2: 'les couronnes répondent',
  3: "le flux profond s'ouvre",
}

function StageUpFlash({ title = 'SEUIL', sub, reduced }: { title?: string; sub: string; reduced: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        // reduced-motion : voile fixe discret, aucune pulsation.
        background: reduced ? 'rgba(57,255,20,0.10)' : 'rgba(57,255,20,0.14)',
        animation: reduced ? 'none' : 'tt-flash 0.95s ease-out forwards',
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      <div
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontWeight: 800,
          fontSize: 'clamp(28px, 9vw, 64px)',
          letterSpacing: '0.1em',
          color: PALETTE.green,
          textShadow: `0 0 24px ${PALETTE.green}`,
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 'clamp(11px, 3.4vw, 15px)',
          letterSpacing: '0.02em',
          color: 'rgba(255,255,255,0.85)',
        }}
      >
        {sub}
      </div>
    </div>
  )
}

// Voix cryptique de l'oracle (cf. EXPERIENCE.md > Voice and Tone). La derniere
// ligne est la CTA de depart : poetique mais explicite dans sa forme.
const ORACLE_BOOT = [
  'tap·tap',
  'quelque chose dort sous le verre.',
  'chaque pression est une onde.',
  "l'onde en appelle d'autres.",
  "POSE UN DOIGT POUR L'ÉVEILLER",
]

// Ecran d'eveil : purement visuel (l'ecran lui-meme capte le premier tap).
function BootOverlay({ reduced }: { reduced: boolean }) {
  const [shown, setShown] = useState(1)
  useEffect(() => {
    const id = window.setInterval(() => {
      setShown((n) => (n < ORACLE_BOOT.length ? n + 1 : n))
    }, 260)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 9vw',
        gap: 10,
        // Voile semi-transparent : la borne endormie « respire » derriere le texte.
        background: 'rgba(10,10,12,0.55)',
        pointerEvents: 'none',
        zIndex: 30,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      {ORACLE_BOOT.slice(0, shown).map((line, i) => {
        const isCta = i === ORACLE_BOOT.length - 1
        return (
          <div
            key={i}
            style={{
              fontSize: isCta ? 'clamp(12px, 3.4vw, 17px)' : 'clamp(11px, 3vw, 15px)',
              letterSpacing: isCta ? '0.12em' : '0.02em',
              // Eveil monochrome : la borne dort, la couleur n'est pas encore la.
              color: isCta ? '#ffffff' : 'rgba(255,255,255,0.72)',
              opacity: isCta ? 1 : 0.72,
              // Ombre sombre : lisible par-dessus la borne qui respire.
              textShadow: isCta
                ? '0 0 12px rgba(255,255,255,0.55), 0 1px 8px rgba(5,5,6,0.95)'
                : '0 1px 8px rgba(5,5,6,0.95)',
              animation: reduced ? 'none' : isCta ? 'tt-blink 1.1s steps(2) infinite' : 'tt-rise 0.5s ease-out',
              marginTop: isCta ? 12 : 0,
            }}
          >
            {line}
          </div>
        )
      })}
    </div>
  )
}

/* ==========================================================================
 * COMPOSANT PRINCIPAL
 * ========================================================================*/
export default function TapTap() {
  const reduced = useReducedMotion()
  const speed = reduced ? 0.3 : 1

  const [saved] = useState(loadSave) // lazy-init : lu une seule fois
  const [booted, setBooted] = useState(false)
  // Le joueur qui revient atterrit sur son stage le plus haut (evite de re-franchir).
  const [stageIndex, setStageIndex] = useState(saved.maxUnlocked - 1)
  const [maxUnlocked, setMaxUnlocked] = useState(saved.maxUnlocked)
  const [flow, setFlow] = useState(0)
  const [mult, setMult] = useState(1)
  const [beat, setBeat] = useState(0) // pulsation de la jauge a chaque tap (la jauge respire)
  const [labels, setLabels] = useState<FloatLabel[]>([])
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(saved.highScore)
  const [flashSub, setFlashSub] = useState<string | null>(null)
  const [flashTitle, setFlashTitle] = useState('SEUIL') // titre du flash plein ecran (SEUIL / finale)
  const [victory, setVictory] = useState(0) // s'incremente a chaque victoire notable (asset de jauge)
  const [glFailed, setGlFailed] = useState(false)
  const [whispered, setWhispered] = useState(false)
  const [srMsg, setSrMsg] = useState('')
  // Combat de boss
  const [bossName, setBossName] = useState<string | null>(null) // non-null = combat actif
  const [bossIntegrite, setBossIntegrite] = useState(100)
  const [bossSignal, setBossSignal] = useState(100)
  const [bossTell, setBossTell] = useState(false)
  const [bossIntro, setBossIntro] = useState(false) // notice d'accueil : le combat attend le 1er tap
  const [bossPhase, setBossPhase] = useState(1) // 2 = le boss s'est reconfigure (motif different)
  const [phaseMsg, setPhaseMsg] = useState<string | null>(null) // murmure a la reconfiguration
  const [dmgSeq, setDmgSeq] = useState(0) // s'incremente a chaque coup ENCAISSE (voile rouge + jauge)
  const [purge, setPurge] = useState<number | null>(null) // % d'INTEGRITE restant a la purge
  const [noyauBeaten, setNoyauBeaten] = useState(saved.noyauBeaten) // boss final vaincu (persiste)
  const bossRef = useRef<Boss | null>(null)
  const bossIntroRef = useRef(false) // miroir de bossIntro (lu dans le handler de tap)

  const engineRef = useRef<StageHandle>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const lastTapRef = useRef(0)
  const flashingRef = useRef(false)
  const flowRef = useRef(0) // miroir synchrone du FLUX (detection de seuil pure)
  const fillPerTapRef = useRef(FLUX_MAX / STAGES[stageIndex].tapsToFill) // difficulte du palier courant
  // Etat chaud en refs (jamais de re-render 60 fps).
  const streakRef = useRef(0) // ENDURANCE : taps enchaines dans la fenetre
  const cadenceRef = useRef(0) // CADENCE : moyenne glissante (EMA) du temps entre 2 tapotis
  const multRef = useRef(1) // miroir du multiplicateur de perf affiche (aussi lu par la couche FX)
  const ringsRef = useRef<{ x: number; y: number; born: number }[]>([])
  const impactsRef = useRef<Impact[]>([]) // flashs d'impact (couche FX)
  const ignitesRef = useRef<Ignite[]>([]) // embrasements (couche FX, reserve au combat)
  const celebsRef = useRef<Celeb[]>([]) // corolles de recompense (franchissement de palier)
  const hitsRef = useRef<Hit[]>([]) // fractures de degat (couche FX, grammaire du negatif)
  const tierRef = useRef(1) // palier courant de la serie — declenche la CELEBRATION (visuel)
  // Palier le plus haut ayant deja paye son bonus de FLUX sur CETTE montee. Distinct de
  // tierRef : sinon hacher son rythme (pause + 3 taps rapides) re-armerait le bonus en
  // boucle et paierait mieux que jouer en continu — l'inverse du flow recherche.
  const bonusTierRef = useRef(1)
  const labelIdRef = useRef(0)
  const timeoutsRef = useRef<Set<number>>(new Set()) // timers traques (nettoyes au demontage)
  const reducedRef = useRef(reduced)

  // Miroir de reduced-motion, mis a jour hors rendu (purete du rendu).
  useEffect(() => {
    reducedRef.current = reduced
  }, [reduced])

  const stage = STAGES[stageIndex]
  // La part de FLUX gagnee par tap depend du palier : plus le niveau est haut, plus il en faut.
  useEffect(() => {
    fillPerTapRef.current = FLUX_MAX / stage.tapsToFill
  }, [stage])
  const topStageId = glFailed ? 2 : 3
  // Contemplation : les trois couches ouvertes, au sommet accessible, hors panne.
  const contemplation = maxUnlocked >= topStageId && stage.id === topStageId && !glFailed

  // Murmure de contemplation : une fois par entree (ne clignote pas au fil des taps).
  useEffect(() => {
    setWhispered(contemplation)
  }, [contemplation])

  // Persistance : maxUnlocked / noyauBeaten (rares) immediats ; highScore (chaud) debounce.
  useEffect(() => {
    persistSave({ highScore, maxUnlocked, noyauBeaten })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxUnlocked, noyauBeaten])
  useEffect(() => {
    const id = window.setTimeout(() => persistSave({ highScore, maxUnlocked, noyauBeaten }), 1000)
    return () => window.clearTimeout(id)
  }, [highScore, maxUnlocked, noyauBeaten])

  // Boucle de jeu : la SEULE mecanique de repos est la retombee de la SERIE.
  // Le FLUX ne redescend JAMAIS tout seul : la barre ne fait que se remplir, tap
  // apres tap, jusqu'au SEUIL. Rien ne punit une pause (choix de lisibilite Xavier).
  useEffect(() => {
    if (!booted) return
    let raf = 0
    const loop = (now: number) => {
      // Silence plus long que la fenetre : endurance + cadence retombent, donc la perf
      // revient a ×1 — sans jamais toucher au FLUX deja gagne ni au score.
      if (streakRef.current > 0 && now - lastTapRef.current > STREAK_WINDOW) {
        streakRef.current = 0
        cadenceRef.current = 0
        tierRef.current = 1 // la prochaine serie pourra de nouveau celebrer ses paliers
        if (multRef.current !== 1) {
          multRef.current = 1
          setMult(1)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [booted])

  // Ceremonie de deblocage (SEUIL → stage suivant). Reutilisee en direct OU apres un boss.
  const doUnlock = useCallback((nextId: number, bonus = 500) => {
    flashingRef.current = true
    ringsRef.current.length = 0 // le moteur change : les anneaux logiques meurent avec lui
    setMaxUnlocked((m) => Math.max(m, nextId))
    setStageIndex(nextId - 1)
    const sub = STAGE_CRYPTIC[nextId] ?? STAGES[nextId - 1].name
    setFlashTitle('SEUIL')
    setFlashSub(sub)
    setVictory((n) => n + 1) // embrasement de la jauge : victoire notable
    setSrMsg(`Seuil franchi. Stage ${STAGES[nextId - 1].name}. ${sub}.`)
    setScore((s) => s + bonus) // bonus de passage (reduit si le palier etait deja ouvert)
    window.setTimeout(() => {
      flashingRef.current = false
      setFlashSub(null)
      flowRef.current = 14
      setFlow(14) // residu de FLUX sur la nouvelle couche
      bonusTierRef.current = 1 // nouvelle montee : les bonus de maitrise se rearment
    }, FLASH_MS)
  }, [])

  const enterBoss = useCallback((cfg: BossCfg) => {
    bossRef.current = {
      integrite: 100,
      signal: 100,
      tellUntil: 0,
      tellStart: 0,
      nextTell: 0,
      lastHit: 0,
      kind: cfg.kind,
      phase: 1,
      tellSeed: 0,
      band: cfg.band,
      tellDmg: cfg.tellDmg,
      tapDmg: cfg.tapDmg,
      iframe: cfg.iframe,
      tellEvery: cfg.tellEvery,
      tellDur: cfg.tellDur,
    }
    setBossIntegrite(100)
    setBossSignal(100)
    setBossTell(false)
    setBossPhase(1)
    // Notice d'accueil : le combat est en pause tant que le joueur n'a pas lu la marche a suivre.
    bossIntroRef.current = true
    setBossIntro(true)
    flowRef.current = FLUX_MAX
    setFlow(FLUX_MAX)
    setSrMsg(
      `${cfg.name} apparait. Pour gagner : tape sans relache pour vider son integrite ; quand la crete rouge balaie l'ecran, tape dans les creux, loin d'elle ; un tap dans la crete ronge ton signal. Tape pour commencer le combat.`,
    )
    setBossName(cfg.name)
  }, [])

  const winBoss = useCallback(() => {
    const sid = stage.id
    bossRef.current = null
    setBossTell(false)
    setBossName(null)
    setBossIntro(false)
    bossIntroRef.current = false
    if (sid < topStageId) {
      doUnlock(sid + 1) // le boss battu ouvre le palier suivant (ceremonie SEUIL)
    } else {
      // Boss final (LE NOYAU) vaincu : fin ouverte -> contemplation. Pas de palier au-dela.
      setNoyauBeaten(true)
      flashingRef.current = true
      setScore((s) => s + 1000)
      setFlashTitle('DÉLIVRÉ')
      setFlashSub('le cœur cède — tu as traversé')
      setVictory((n) => n + 1)
      setSrMsg('Le noyau est vaincu. Le coeur cede. Fin ouverte.')
      window.setTimeout(() => {
        flashingRef.current = false
        setFlashSub(null)
        flowRef.current = 40
        setFlow(40)
        bonusTierRef.current = 1
      }, FLASH_MS)
    }
  }, [doUnlock, stage.id, topStageId])

  const purgeBoss = useCallback(() => {
    const rem = Math.round(bossRef.current?.integrite ?? 0)
    bossRef.current = null
    setBossTell(false)
    setBossName(null)
    setPurge(rem)
    setSrMsg('Purge. Signal etranger efface.')
  }, [])

  const retryBoss = useCallback(() => {
    const cfg = BOSS_DEFS[stage.id]
    setPurge(null)
    if (cfg) enterBoss(cfg)
  }, [enterBoss, stage.id])

  // 100 % TERMINE TOUJOURS le niveau (retour Xavier : « la jauge arrive a 100 % mais le
  // niveau ne se termine pas — incomprehensible »). Une barre pleine declenche un
  // evenement, quel que soit l'etat de la partie :
  //   · boss non battu  → il surgit (porte du palier)
  //   · palier suivant  → SEUIL et bascule (meme s'il etait deja ouvert — rejouer paie
  //     juste moins, l'anti-farm passe par le bonus, plus jamais par un non-evenement)
  //   · sommet conquis  → SURTENSION : bonus de score, la barre se recycle a zero
  const triggerStageUp = useCallback(() => {
    if (flashingRef.current || bossRef.current) return
    const cfg = BOSS_DEFS[stage.id]
    const beaten = stage.id === 3 ? noyauBeaten : maxUnlocked > stage.id
    if (cfg && !beaten) {
      enterBoss(cfg)
      return
    }
    const nextId = stage.id + 1
    if (nextId <= topStageId) {
      doUnlock(nextId, nextId > maxUnlocked ? 500 : 150)
      return
    }
    // Sommet deja conquis : la boucle se referme sur elle-meme, avec recompense.
    setVictory((n) => n + 1) // embrasement de la jauge
    setScore((s) => {
      const ns = s + 250
      setHighScore((h) => (ns > h ? ns : h))
      return ns
    })
    flowRef.current = 0
    setFlow(0)
    bonusTierRef.current = 1 // les bonus de maitrise se rearment avec la nouvelle montee
    setSrMsg('Surtension. Le flux se recycle : +250.')
  }, [stage.id, topStageId, maxUnlocked, noyauBeaten, enterBoss, doUnlock])

  // Boucle du boss : cadence des « tells » (charges). Ne tourne qu'une fois la notice
  // fermee (le combat demarre au 1er tap) et pendant le combat.
  useEffect(() => {
    if (!bossName || bossIntro) return
    const b = bossRef.current
    if (!b) return
    // En 2e phase les charges se rapprochent et raccourcissent.
    const every = () => (b.phase === 2 ? b.tellEvery * PHASE2_EVERY : b.tellEvery)
    const dur = () => (b.phase === 2 ? b.tellDur * PHASE2_DUR : b.tellDur)
    b.nextTell = performance.now() + every()
    let raf = 0
    const loop = (now: number) => {
      if (b.tellUntil > 0) {
        // La crete balaie jusqu'a la fin de la charge (elle ne s'arrete plus au tap).
        if (now > b.tellUntil) {
          b.tellUntil = 0
          setBossTell(false)
          b.nextTell = now + every()
        }
      } else if (now > b.nextTell) {
        b.tellStart = now
        b.tellUntil = now + dur()
        // Orientation tiree a chaque charge : la lame du ROUAGE n'arrive jamais deux
        // fois du meme cote, on ne peut pas camper un coin de l'ecran.
        b.tellSeed = Math.random() * Math.PI * 2
        setBossTell(true)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [bossName, bossIntro])

  // Bascule en 2e phase : la borne l'annonce, brievement, en voix oracle.
  useEffect(() => {
    if (bossPhase !== 2 || !bossName) return
    const line = BOSS_DEFS[stage.id]?.phase2 ?? ''
    setPhaseMsg(line)
    setSrMsg(`${bossName} se reconfigure. ${line} Le motif d'attaque a change.`)
    const id = window.setTimeout(() => setPhaseMsg(null), 1800)
    return () => window.clearTimeout(id)
  }, [bossPhase, bossName, stage.id])

  // Timer traque : nettoye au demontage (pas de setState post-unmount).
  const trackedTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timeoutsRef.current.delete(id)
      fn()
    }, ms)
    timeoutsRef.current.add(id)
  }, [])

  useEffect(() => {
    const timeouts = timeoutsRef.current
    return () => {
      timeouts.forEach((id) => window.clearTimeout(id))
      timeouts.clear()
    }
  }, [])

  // Etiquette ephemere au point touche (+3 %, +6 %, bruit.) — cadence humaine, pas 60 fps.
  const pushLabel = useCallback(
    (x: number, y: number, text: string, kind: 'gain' | 'noise') => {
      const id = labelIdRef.current++
      setLabels((ls) => [...ls.slice(-5), { id, x, y, text, kind }])
      trackedTimeout(() => setLabels((ls) => ls.filter((l) => l.id !== id)), 800)
    },
    [trackedTimeout],
  )


  const registerTap = useCallback(
    (nx: number, ny: number) => {
      if (flashingRef.current) return
      engineRef.current?.tap(nx, ny) // le moteur pulse toujours (retour immediat du tap)

      const now = performance.now()
      const gap = now - lastTapRef.current
      const hadPrev = lastTapRef.current > 0
      lastTapRef.current = now

      // === PERFORMANCE : deux variables, uniquement des recompenses (jamais de punition) ===
      // 1. ENDURANCE — la duree de tapotement : taps enchaines dans la fenetre.
      const chained = hadPrev && gap < STREAK_WINDOW
      streakRef.current = chained ? streakRef.current + 1 : 1
      const streak = streakRef.current
      // 2. CADENCE — le temps entre deux tapotis, lisse (EMA) tant qu'on enchaine.
      cadenceRef.current = chained
        ? cadenceRef.current > 0
          ? cadenceRef.current * 0.6 + gap * 0.4
          : gap
        : 0
      const gapEma = cadenceRef.current

      // Cadence : ×1 (lent / 1er tap) → ×(1+CADENCE_BONUS) (rapide). Court = performant.
      const cadT = gapEma > 0 ? Math.min(1, Math.max(0, (GAP_SLOW - gapEma) / (GAP_SLOW - GAP_FAST))) : 0
      const cadence = 1 + CADENCE_BONUS * cadT
      // Endurance : ×1 → ×(1+ENDURANCE_BONUS) selon la longueur de la serie.
      const endurance = 1 + ENDURANCE_BONUS * (Math.min(streak, ENDURANCE_CAP) / ENDURANCE_CAP)
      // Performance = les deux combinees. Le score grimpe avec la vitesse ET la duree.
      const perf = cadence * endurance
      const disp = Math.round(perf * 10) / 10
      if (disp !== multRef.current) {
        multRef.current = disp // lu par la couche FX (couleur) + affiche dans le HUD
        setMult(disp)
      }
      setBeat((bb) => bb + 1) // la jauge respire a chaque tap

      // RECOMPENSE : franchir un palier de perf fait fleurir une corolle au doigt.
      // Elle ne se declenche qu'a la MONTEE (jamais en redescendant) : le jeu
      // celebre, il ne sanctionne pas.
      const tierNow = Math.min(4, Math.max(1, Math.round(perf)))
      const tierUp = tierNow > tierRef.current
      if (tierUp) {
        celebsRef.current.push({ x: nx, y: ny, born: now, tier: tierNow })
        if (celebsRef.current.length > 6) celebsRef.current.shift()
      }
      tierRef.current = tierNow

      // Retour visuel : flash d'impact + anneau (la perf colore l'ensemble : blanc→vert).
      impactsRef.current.push({ x: nx, y: ny, born: now, mult: disp })
      if (impactsRef.current.length > 24) impactsRef.current.shift()
      const rings = ringsRef.current
      for (let i = rings.length - 1; i >= 0; i--) {
        if (now - rings[i].born > RING_LIFE) rings.splice(i, 1)
      }
      rings.push({ x: nx, y: ny, born: now })
      if (rings.length > 12) rings.shift()

      const pts = Math.round(PTS_BASE * perf)

      // --- Combat de boss : la crete rouge balaie ; tape dans les creux.
      const b = bossRef.current
      if (b) {
        const inTell = b.tellUntil > now
        const inCrest = inTell && bossInDanger(b, nx, ny, now)
        if (inCrest) {
          if (now > b.lastHit + b.iframe) {
            b.signal = Math.max(0, b.signal - b.tellDmg)
            b.lastHit = now
            setBossSignal(b.signal)
            // Grammaire du NEGATIF : fracture au doigt + voile rouge + flash de jauge.
            hitsRef.current.push({ x: nx, y: ny, born: now })
            if (hitsRef.current.length > 5) hitsRef.current.shift()
            setDmgSeq((n) => n + 1)
            pushLabel(nx, ny, '−signal', 'noise')
            if (b.signal <= 0) purgeBoss()
          }
        } else {
          // Coup PENDANT la charge, place dans une zone sure : le courage crepite —
          // un eclair blanc recompense la prise de risque (et le +1 d'INTEGRITE).
          if (inTell) {
            ignitesRef.current.push({ x: nx, y: ny, rad: 0.055, born: now, kind: 'inter' })
            if (ignitesRef.current.length > 8) ignitesRef.current.shift()
          }
          const dmg = b.tapDmg * Math.min(perf, 4) + (inTell ? 1 : 0)
          b.integrite = Math.max(0, b.integrite - dmg)
          setBossIntegrite(b.integrite)
          // SECONDE PHASE : sous le seuil, le boss se reconfigure — charges plus
          // rapprochees ET motif d'attaque different (cf. bossZones).
          if (b.phase === 1 && b.integrite <= BOSS_PHASE2_AT && b.integrite > 0) {
            b.phase = 2
            b.tellUntil = 0 // la charge en cours s'interrompt : la bascule est nette
            b.nextTell = now + 900 // court repit pour lire le nouveau motif
            setBossTell(false)
            setBossPhase(2)
          }
          if (b.integrite <= 0) winBoss()
        }
        setScore((sc) => {
          const ns = sc + pts
          setHighScore((h) => (ns > h ? ns : h))
          return ns
        })
        return
      }

      // --- Jeu normal : chaque tap REMPLIT la barre d'une part constante propre au palier
      // (progressif, previsible, jamais de perte). Plus le niveau est haut, plus il faut de taps.
      //
      // COUP DE POUCE DE MAITRISE : franchir un palier de perf offre un bonus de FLUX
      // (4 / 6 / 8 taps d'avance en ×2 / ×3 / ×4). Il tombe pile au moment ou la corolle
      // s'ouvre : on VOIT pourquoi la barre saute. C'est ce qui empeche l'escalade
      // exponentielle de devenir une corvee — bien jouer raccourcit la montee.
      // Non farmable : atteindre ×4 coute bien plus de taps que le bonus n'en rend.
      // Le bonus ne se paie qu'une fois par palier ET par montee (jamais re-armable).
      const newBest = tierNow > bonusTierRef.current
      if (newBest) bonusTierRef.current = tierNow
      const bonus = newBest ? fillPerTapRef.current * tierNow * 2 : 0
      const raw = flowRef.current + fillPerTapRef.current + bonus
      const nf = Math.min(FLUX_MAX, raw)
      flowRef.current = nf
      setFlow(nf)
      if (raw >= FLUX_MAX) triggerStageUp()
      setScore((sc) => {
        const ns = sc + pts
        setHighScore((h) => (ns > h ? ns : h))
        return ns
      })
    },
    [triggerStageUp, pushLabel, purgeBoss, winBoss],
  )

  // Le premier contact reveille la borne ET pulse au point touche.
  const tapAt = useCallback(
    (nx: number, ny: number) => {
      if (purge !== null) {
        retryBoss() // l'ecran de PURGE : un tap relance le combat
        return
      }
      // Notice du boss : le 1er tap la ferme et lance le combat (il ne frappe pas encore).
      if (bossIntroRef.current) {
        bossIntroRef.current = false
        setBossIntro(false)
        lastTapRef.current = performance.now() // pas de « serie » heritee de l'intro
        setSrMsg('Combat engage.')
        return
      }
      if (!booted) setBooted(true)
      registerTap(Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny)))
    },
    [booted, registerTap, purge, retryBoss],
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Un geste = un tap : le 2e doigt / la paume ne sont pas du BRUIT.
      if (!e.isPrimary) return
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      tapAt((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
    },
    [tapAt],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (e.repeat) return // l'auto-repeat OS n'est pas du spam volontaire
        tapAt(0.5 + (Math.random() - 0.5) * 0.3, 0.5 + (Math.random() - 0.5) * 0.3)
      }
    },
    [tapAt],
  )

  const handleGlError = useCallback(() => {
    setGlFailed(true)
    setStageIndex((idx) => (STAGES[idx].engine === 'webgl' ? 1 : idx)) // repli sur MANDALA
    setSrMsg('Le flux profond ne répond pas. Retour aux couronnes.')
  }, [])

  const selectStage = useCallback(
    (id: number) => {
      if (id > maxUnlocked) return
      if (STAGES[id - 1].engine === 'webgl' && glFailed) return
      ringsRef.current.length = 0 // pas de resonance sur un anneau de l'ancien moteur
      setStageIndex(id - 1)
    },
    [maxUnlocked, glFailed],
  )

  // Focus initial sur la surface de jeu (clavier immediat, sans piege).
  useEffect(() => {
    screenRef.current?.focus()
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: PALETTE.void, overflow: 'hidden' }}>
      <style>{KEYFRAMES}</style>

      {/* Region live (visuellement masquee) pour lecteur d'ecran */}
      <div
        aria-live="assertive"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        {srMsg}
      </div>

      {/* Surface de jeu PLEIN ÉCRAN — le visuel generatif occupe tout l'ecran, bord a bord. */}
      <div
        ref={screenRef}
        role="button"
        tabIndex={0}
        aria-label={
          booted
            ? 'Ecran de jeu — tape pour pulser et remplir le FLUX'
            : "Ecran — touche pour eveiller la borne"
        }
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        className="tt-screen"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          overflow: 'hidden',
          background: PALETTE.void,
          touchAction: 'manipulation',
          cursor: 'pointer',
        }}
      >
        {stage.engine === 'svg' && <WaveformStage ref={engineRef} speed={speed} boss={!!bossName} />}
        {stage.engine === 'canvas' && (
          <MandalaStage ref={engineRef} speed={speed} boss={!!bossName} />
        )}
        {stage.engine === 'webgl' && (
          <LiquidStage ref={engineRef} speed={speed} boss={!!bossName} onGlError={handleGlError} />
        )}

        {/* Couche FX : anneaux + impacts + embrasements + crete de boss (rAF, refs) */}
        <FxCanvas
          ringsRef={ringsRef}
          impactsRef={impactsRef}
          ignitesRef={ignitesRef}
          celebsRef={celebsRef}
          hitsRef={hitsRef}
          multRef={multRef}
          lastTapRef={lastTapRef}
          bossRef={bossRef}
          reducedRef={reducedRef}
        />

        {/* Scanlines + vignette CRT (plein ecran) */}
        <div className="tt-scanlines" aria-hidden="true" />
        <div className="tt-vignette" aria-hidden="true" />

        {/* Etiquettes ephemeres (combat : −signal) */}
        {labels.map((l) => (
          <div
            key={l.id}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${Math.min(0.9, Math.max(0.1, l.x)) * 100}%`,
              top: `${Math.min(0.92, Math.max(0.12, l.y)) * 100}%`,
              transform: 'translate(-50%, -120%)',
              color: l.kind === 'noise' ? PALETTE.red : PALETTE.green,
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.02em',
              textShadow: '0 1px 6px rgba(5,1,13,0.9)',
              // Grammaire directionnelle : les gains MONTENT, les pertes TOMBENT.
              animation: reduced
                ? 'none'
                : `${l.kind === 'noise' ? 'tt-fall' : 'tt-float'} 0.8s ease-out forwards`,
              pointerEvents: 'none',
              zIndex: 13,
              whiteSpace: 'nowrap',
            }}
          >
            {l.text}
          </div>
        ))}

        {/* VOILE DE DEGAT : un coup encaisse assombrit et rougit l'ecran, une fois,
            sec — a distinguer du lisere continu de la charge, qui n'est qu'un
            AVERTISSEMENT. Ici, la lumiere se retire : tu as ete touche. */}
        {dmgSeq > 0 && !reduced && (
          <div
            key={`dmg${dmgSeq}`}
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 15,
              background: 'rgba(5,5,6,0.22)',
              boxShadow: `inset 0 0 90px 24px rgba(255,59,48,0.65)`,
              animation: 'tt-dmg 0.45s ease-out forwards',
            }}
          />
        )}

        {/* Charge du boss : bord rouge pulsant — le danger. NE PAS taper. */}
        {bossTell && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 14,
              boxShadow: `inset 0 0 60px 8px ${PALETTE.red}`,
              animation: reduced ? 'none' : 'tt-tell 0.6s ease-in-out infinite',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 'calc(84px + env(safe-area-inset-bottom))',
                textAlign: 'center',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 'clamp(11px, 3vw, 14px)',
                letterSpacing: '0.06em',
                color: PALETTE.red,
                textShadow: '0 1px 8px rgba(5,1,13,0.9)',
              }}
            >
              {(bossName &&
                (bossPhase === 2 ? BOSS_DEFS[stage.id]?.hint2 : BOSS_DEFS[stage.id]?.hint)) ||
                "l'onde balaie — tape dans les creux"}
            </div>
          </div>
        )}

        {/* Notice d'accueil du boss : qui il est + comment gagner (combat en pause). */}
        {bossName && bossIntro && <BossIntro name={bossName} reduced={reduced} />}

        {/* RECONFIGURATION : le boss passe en 2e phase. Bref, mais il faut le LIRE —
            le motif d'attaque vient de changer. */}
        {phaseMsg && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              pointerEvents: 'none',
              zIndex: 24,
              fontFamily: 'ui-monospace, monospace',
              textAlign: 'center',
              padding: '0 8vw',
              animation: reduced ? 'none' : 'tt-burst 1.8s ease-out',
              background: 'rgba(255,59,48,0.10)',
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.28em',
                color: PALETTE.red,
                fontWeight: 700,
              }}
            >
              RECONFIGURATION
            </div>
            <div
              style={{
                fontSize: 'clamp(15px, 5vw, 24px)',
                fontWeight: 800,
                letterSpacing: '0.04em',
                color: '#ffffff',
                textShadow: `0 0 18px ${PALETTE.red}`,
              }}
            >
              {phaseMsg}
            </div>
          </div>
        )}

        {/* PURGE : echec du combat. Un tap relance (gere par tapAt). */}
        {purge !== null && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '0 7vw',
              textAlign: 'center',
              background: 'rgba(10,10,12,0.82)',
              pointerEvents: 'none',
              zIndex: 25,
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            <div
              style={{
                fontWeight: 800,
                fontSize: 'clamp(28px, 9vw, 60px)',
                letterSpacing: '0.14em',
                color: PALETTE.red,
                textShadow: `0 0 24px ${PALETTE.red}`,
              }}
            >
              PURGE.
            </div>
            <div style={{ fontSize: 'clamp(11px, 3vw, 14px)', color: 'rgba(255,255,255,0.7)' }}>
              signal étranger effacé. l'hôte se rendort.
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 6 }}>
              il lui restait {purge}% — pose un doigt pour persister
            </div>
          </div>
        )}

        {flashSub && <StageUpFlash title={flashTitle} sub={flashSub} reduced={reduced} />}

        {/* Contemplation : murmure une fois, stable (ne clignote pas). */}
        {booted && whispered && !flashSub && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 'calc(84px + env(safe-area-inset-bottom))',
              textAlign: 'center',
              padding: '6px 8vw',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 'clamp(11px, 3vw, 14px)',
              letterSpacing: '0.02em',
              color: 'rgba(255,255,255,0.6)',
              textShadow: '0 1px 8px rgba(5,1,13,0.9)',
              animation: reduced ? 'none' : 'tt-rise 1.2s ease-out',
              zIndex: 12,
              pointerEvents: 'none',
            }}
          >
            plus rien à franchir. reste, ou recommence.
          </div>
        )}

        {!booted && <BootOverlay reduced={reduced} />}
      </div>

      {/* HUD compact en surimpression (haut). Non tactile : les taps traversent vers le jeu.
          N'apparait qu'une fois la borne eveillee (le repos reste plein ecran et nu). */}
      {booted && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 40,
            pointerEvents: 'none',
            paddingTop: 'env(safe-area-inset-top)',
            background:
              'linear-gradient(180deg, rgba(5,5,6,0.78) 0%, rgba(5,5,6,0.5) 55%, rgba(5,5,6,0) 100%)',
          }}
        >
          <Hud
            stageName={bossName ?? stage.name}
            score={score}
            highScore={highScore}
            mult={mult}
            bossMode={!!bossName}
          />
          {/* UNE seule jauge, quel que soit le contexte. Elle va toujours dans le meme
              sens : gauche → droite = je progresse (en combat = purge du boss). */}
          <Gauge
            pct={bossName ? 100 - bossIntegrite : (flow / FLUX_MAX) * 100}
            label={bossName ?? 'FLUX'}
            boss={!!bossName}
            tell={bossTell}
            signal={bossName ? bossSignal : null}
            beat={beat}
            tier={Math.min(4, Math.max(1, Math.round(mult)))}
            victory={victory}
            hit={dmgSeq}
            reduced={reduced}
          />
        </div>
      )}

      {/* Selecteur de couche + statut de repli, compacts en bas. Le conteneur laisse
          passer les taps ; seuls les boutons sont tactiles. */}
      {booted && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 40,
            pointerEvents: 'none',
            paddingBottom: 'calc(8px + env(safe-area-inset-bottom))',
            paddingTop: 6,
            background:
              'linear-gradient(0deg, rgba(5,5,6,0.78) 0%, rgba(5,5,6,0.5) 55%, rgba(5,5,6,0) 100%)',
          }}
        >
          {glFailed && (
            <div
              role="status"
              style={{
                padding: '0 14px 6px',
                color: 'rgba(255,255,255,0.6)',
                fontSize: 11,
                fontFamily: 'ui-monospace, monospace',
                letterSpacing: '0.02em',
                textAlign: 'center',
              }}
            >
              le flux profond ne répond pas — retour aux couronnes
            </div>
          )}
          <div style={{ pointerEvents: 'auto' }}>
            <StageSelector
              current={stage.id}
              maxUnlocked={maxUnlocked}
              glFailed={glFailed}
              onSelect={selectStage}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Keyframes + effets CRT injectes une fois. Les animations non essentielles
// sont coupees sous prefers-reduced-motion (au cas ou, en plus des gardes JS).
const KEYFRAMES = `
@keyframes tt-flash {
  0% { opacity: 0; }
  15% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes tt-blink {
  0%, 50% { opacity: 1; }
  50.01%, 100% { opacity: 0.25; }
}
@keyframes tt-rise {
  0% { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes tt-float {
  0% { opacity: 0; transform: translate(-50%, -80%); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -240%); }
}
/* Grammaire du negatif : les pertes TOMBENT (les gains montent via tt-float). */
@keyframes tt-fall {
  0% { opacity: 0; transform: translate(-50%, -80%); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, 90%); }
}
/* Voile de degat : la lumiere se retire, une fois, sec. */
@keyframes tt-dmg {
  0% { opacity: 1; }
  100% { opacity: 0; }
}
/* Asset de COMBO : une onde teintee balaie la jauge au passage d'un palier de perf. */
@keyframes tt-sweep {
  0% { opacity: 0; transform: translateX(-100%); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: translateX(100%); }
}
/* Asset de VICTOIRE NOTABLE : la jauge s'embrase brievement. */
@keyframes tt-burst {
  0% { opacity: 0; }
  12% { opacity: 0.95; }
  100% { opacity: 0; }
}
@keyframes tt-beat {
  0% { box-shadow: 0 0 0 rgba(255,255,255,0); }
  30% { box-shadow: 0 0 9px rgba(255,255,255,0.45); }
  100% { box-shadow: 0 0 0 rgba(255,255,255,0); }
}
@keyframes tt-tell {
  0%, 100% { box-shadow: inset 0 0 40px 4px rgba(255,59,48,0.55); }
  50% { box-shadow: inset 0 0 75px 14px rgba(255,59,48,0.95); }
}
.tt-screen:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}
.tt-btn:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}
.tt-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    rgba(0,0,0,0) 0px,
    rgba(0,0,0,0) 2px,
    rgba(0,0,0,0.18) 3px,
    rgba(0,0,0,0.18) 3px
  );
  mix-blend-mode: multiply;
  z-index: 10;
}
.tt-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(120% 120% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%);
  z-index: 11;
}
@media (prefers-reduced-motion: reduce) {
  .tt-scanlines { background: none; }
}
`
