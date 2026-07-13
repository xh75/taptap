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

// La difficulte grimpe par palier : atteindre MANDALA (niv 2) puis LIQUID (niv 3)
// demande de plus en plus de taps. WAVEFORM initie, les couches profondes exigent.
const STAGES: StageDef[] = [
  { id: 1, name: 'WAVEFORM', engine: 'svg', tint: PALETTE.magenta, tapsToFill: 34 },
  { id: 2, name: 'MANDALA', engine: 'canvas', tint: PALETTE.cyan, tapsToFill: 64 },
  { id: 3, name: 'LIQUID', engine: 'webgl', tint: PALETTE.green, tapsToFill: 104 },
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
// Seuls les stages listes ont un boss auteur ; les autres gardent le SEUIL direct.
const BOSS_STAGES: Record<number, string> = { 1: 'LA PORTEUSE' }
const BOSS_TELL_EVERY = 3200 // ms entre deux charges (le « tell ») — plus frequent = plus exigeant
const BOSS_TELL_DUR = 1600 // ms — la crete rouge balaie l'ecran de haut en bas
const BOSS_BAND = 0.16 // demi-hauteur (normalisee) de la crete dangereuse
const BOSS_TELL_DMG = 24 // SIGNAL perdu par tap DANS la crete rouge — ignorer la charge coute cher
const BOSS_HIT_IFRAME = 240 // ms d'invulnerabilite apres un coup encaisse (marteler la crete punit)
const BOSS_TAP_DMG = 0.22 // INTEGRITE par tap (× multiplicateur) — combat ~20-25 s

// Position (y normalise) de la crete pendant une charge : elle balaie de haut en bas.
function bossDangerY(tellStart: number, tellUntil: number, now: number): number {
  const t = Math.min(1, Math.max(0, (now - tellStart) / (tellUntil - tellStart)))
  return 0.18 + 0.64 * t
}

// ---------------------------------------------------------------------------
// Persistance locale (high-score + stages debloques)
// ---------------------------------------------------------------------------
interface SaveData {
  highScore: number
  maxUnlocked: number
}

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<SaveData>
      return {
        highScore: Math.max(0, Number(p.highScore) || 0),
        maxUnlocked: Math.min(3, Math.max(1, Math.round(Number(p.maxUnlocked) || 1))),
      }
    }
  } catch {
    /* stockage indisponible : on repart a zero, sans casser. */
  }
  return { highScore: 0, maxUnlocked: 1 }
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
  forwardRef<StageHandle, StageProps>(function MandalaStage({ speed }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const pulsesRef = useRef<Pulse[]>([])
    const colorIdxRef = useRef(0)

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

        // Couronne ambiante (le mandala respire meme sans tap).
        const ambR = scale * (0.16 + 0.02 * Math.sin(t * 0.8))
        for (let i = 0; i < arms; i++) {
          const a = (i / arms) * Math.PI * 2 + t * 0.25
          dot(glows[1], Math.cos(a) * ambR, Math.sin(a) * ambR, scale * 0.02, 0.5)
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
  gl_FragColor = vec4(col, 1.0);
}
`

interface LiquidProps extends StageProps {
  onGlError: () => void
}

const LiquidStage = memo(
  forwardRef<StageHandle, LiquidProps>(function LiquidStage({ speed, onGlError }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    // 6 emplacements d'onde de choc (ring buffer). born tres negatif = inactif.
    const tapsRef = useRef(Array.from({ length: 6 }, () => ({ x: 0, y: 0, born: -1e9 })))
    const ringRef = useRef(0)

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

      const loop = (now: number) => {
        gl.uniform2f(uRes, w, h)
        gl.uniform1f(uTime, ((now - start) / 1000) * speed)
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
interface Boss {
  integrite: number
  signal: number
  tellUntil: number
  tellStart: number
  nextTell: number
  lastHit: number
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
  multRef,
  lastTapRef,
  bossRef,
  reducedRef,
}: {
  ringsRef: Ref<{ x: number; y: number; born: number }[]>
  impactsRef: Ref<Impact[]>
  ignitesRef: Ref<Ignite[]>
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

      // Crete rouge du boss pendant une charge : la zone a NE PAS taper (elle balaie).
      // Dessinee meme en reduced-motion : c'est une information de jeu essentielle.
      const bo = bossRef.current
      if (bo && bo.tellUntil > now) {
        const cy = bossDangerY(bo.tellStart, bo.tellUntil, now) * h
        const bandH = BOSS_BAND * h
        const grd = ctx.createLinearGradient(0, cy - bandH, 0, cy + bandH)
        grd.addColorStop(0, 'rgba(255,59,48,0)')
        grd.addColorStop(0.5, 'rgba(255,59,48,0.5)')
        grd.addColorStop(1, 'rgba(255,59,48,0)')
        ctx.fillStyle = grd
        ctx.fillRect(0, cy - bandH, w, bandH * 2)
        ctx.strokeStyle = 'rgba(255,59,48,0.95)'
        ctx.lineWidth = 2 * ratio
        ctx.shadowBlur = 12 * ratio
        ctx.shadowColor = 'rgba(255,59,48,0.95)'
        ctx.beginPath()
        ctx.moveTo(0, cy)
        ctx.lineTo(w, cy)
        ctx.stroke()
        ctx.shadowBlur = 0
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [ringsRef, impactsRef, ignitesRef, multRef, lastTapRef, bossRef, reducedRef])

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

function FlowGauge({
  flow,
  beat,
  reduced,
}: {
  flow: number
  beat: number
  reduced: boolean
}) {
  const pct = Math.min(100, (flow / FLUX_MAX) * 100)
  const rounded = Math.round(pct)
  const hot = pct > 80
  return (
    <div style={{ padding: '0 14px 12px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.55)',
          marginBottom: 4,
        }}
      >
        <span>FLUX</span>
        <span style={{ color: hot ? PALETTE.green : 'rgba(255,255,255,0.55)', fontWeight: hot ? 700 : 400 }}>
          {rounded}%{hot ? ' ▲' : ''}
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        <div
          role="progressbar"
          aria-label="FLUX"
          aria-valuenow={rounded}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            height: 12,
            borderRadius: 6,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              // Mono par defaut ; vert seulement quand le SEUIL est imminent (evenement).
              background: hot
                ? `linear-gradient(90deg, rgba(57,255,20,0.65), ${PALETTE.green})`
                : 'linear-gradient(90deg, rgba(255,255,255,0.35), rgba(255,255,255,0.9))',
              boxShadow: hot ? `0 0 14px ${PALETTE.green}` : 'none',
              transition: 'width 90ms linear',
            }}
          />
        </div>
        {/* La jauge respire : un glow pulse a chaque tap. */}
        {!reduced && (
          <div
            key={beat}
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 6,
              pointerEvents: 'none',
              animation: 'tt-beat 0.32s ease-out',
            }}
          />
        )}
      </div>
    </div>
  )
}

// Barres de combat : INTEGRITE (le boss, rouge = menace) + SIGNAL (ta vitalite).
function BossBar({ integrite, signal, tell }: { integrite: number; signal: number; tell: boolean }) {
  const sigLow = signal <= 35
  const labelRow: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 10,
    letterSpacing: '0.18em',
    color: 'rgba(255,255,255,0.55)',
  }
  return (
    <div style={{ padding: '0 14px 12px' }}>
      <div style={{ ...labelRow, marginBottom: 4 }}>
        <span style={{ color: PALETTE.red, fontWeight: 700 }}>INTÉGRITÉ</span>
        <span>{Math.round(integrite)}%</span>
      </div>
      <div
        style={{
          height: 12,
          borderRadius: 6,
          background: 'rgba(255,255,255,0.08)',
          border: `1px solid ${tell ? PALETTE.red : 'rgba(255,255,255,0.12)'}`,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${integrite}%`,
            background: 'linear-gradient(90deg, rgba(255,255,255,0.5), #ffffff)',
            transition: 'width 120ms linear',
          }}
        />
      </div>
      <div style={{ ...labelRow, margin: '6px 0 3px' }}>
        <span>SIGNAL</span>
        <span style={{ color: sigLow ? PALETTE.red : 'rgba(255,255,255,0.55)' }}>{Math.round(signal)}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${signal}%`,
            background: sigLow ? PALETTE.red : 'rgba(255,255,255,0.85)',
            transition: 'width 120ms linear',
          }}
        />
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
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '0 14px 12px' }}>
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
              flex: 1,
              maxWidth: 120,
              padding: '8px 6px',
              minHeight: 44,
              cursor: disabled ? 'not-allowed' : 'pointer',
              borderRadius: 8,
              // Selecteur monochrome : actif = blanc (aucune teinte de stage).
              border: `1px solid ${active ? '#ffffff' : 'rgba(255,255,255,0.15)'}`,
              background: active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
              color: disabled ? 'rgba(255,255,255,0.3)' : active ? '#ffffff' : 'rgba(255,255,255,0.75)',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11,
              letterSpacing: '0.08em',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }} aria-hidden="true">
              {glDown ? '⚠' : locked ? '🔒' : s.id}
            </div>
            <div>{s.name}</div>
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

function StageUpFlash({ sub, reduced }: { sub: string; reduced: boolean }) {
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
        SEUIL
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
  const [glFailed, setGlFailed] = useState(false)
  const [whispered, setWhispered] = useState(false)
  const [srMsg, setSrMsg] = useState('')
  // Combat de boss
  const [bossName, setBossName] = useState<string | null>(null) // non-null = combat actif
  const [bossIntegrite, setBossIntegrite] = useState(100)
  const [bossSignal, setBossSignal] = useState(100)
  const [bossTell, setBossTell] = useState(false)
  const [purge, setPurge] = useState<number | null>(null) // % d'INTEGRITE restant a la purge
  const bossRef = useRef<Boss | null>(null)

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

  // Persistance : maxUnlocked (rare) immediat ; highScore (chaud) debounce.
  useEffect(() => {
    persistSave({ highScore, maxUnlocked })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxUnlocked])
  useEffect(() => {
    const id = window.setTimeout(() => persistSave({ highScore, maxUnlocked }), 1000)
    return () => window.clearTimeout(id)
  }, [highScore, maxUnlocked])

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
  const doUnlock = useCallback((nextId: number) => {
    flashingRef.current = true
    ringsRef.current.length = 0 // le moteur change : les anneaux logiques meurent avec lui
    setMaxUnlocked((m) => Math.max(m, nextId))
    setStageIndex(nextId - 1)
    const sub = STAGE_CRYPTIC[nextId] ?? STAGES[nextId - 1].name
    setFlashSub(sub)
    setSrMsg(`Seuil franchi. Stage ${STAGES[nextId - 1].name}. ${sub}.`)
    setScore((s) => s + 500) // bonus de passage
    window.setTimeout(() => {
      flashingRef.current = false
      setFlashSub(null)
      flowRef.current = 14
      setFlow(14) // residu de FLUX sur la nouvelle couche
    }, FLASH_MS)
  }, [])

  const enterBoss = useCallback((name: string) => {
    bossRef.current = { integrite: 100, signal: 100, tellUntil: 0, tellStart: 0, nextTell: 0, lastHit: 0 }
    setBossIntegrite(100)
    setBossSignal(100)
    setBossTell(false)
    flowRef.current = FLUX_MAX
    setFlow(FLUX_MAX)
    setSrMsg(`${name} apparait. Vide son integrite ; pendant la charge, tape dans les creux.`)
    setBossName(name)
  }, [])

  const winBoss = useCallback(() => {
    bossRef.current = null
    setBossTell(false)
    setBossName(null)
    doUnlock(Math.min(stage.id + 1, topStageId))
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
    const bn = BOSS_STAGES[stage.id]
    setPurge(null)
    if (bn) enterBoss(bn)
  }, [enterBoss, stage.id])

  const triggerStageUp = useCallback(() => {
    if (flashingRef.current || bossRef.current) return
    const nextId = Math.min(stage.id + 1, topStageId)
    // Ceremonie SEULEMENT pour un deblocage reellement nouveau (anti-farm).
    if (nextId <= stage.id || nextId <= maxUnlocked) {
      flowRef.current = FLUX_MAX
      setFlow(FLUX_MAX)
      return
    }
    // Porte du boss : si ce stage a un boss auteur non encore battu, on l'invoque.
    const bn = BOSS_STAGES[stage.id]
    if (bn) {
      enterBoss(bn)
      return
    }
    doUnlock(nextId)
  }, [stage.id, topStageId, maxUnlocked, enterBoss, doUnlock])

  // Boucle du boss : cadence des « tells » (charges). Ne tourne que pendant le combat.
  useEffect(() => {
    if (!bossName) return
    const b = bossRef.current
    if (!b) return
    b.nextTell = performance.now() + BOSS_TELL_EVERY
    let raf = 0
    const loop = (now: number) => {
      if (b.tellUntil > 0) {
        // La crete balaie jusqu'a la fin de la charge (elle ne s'arrete plus au tap).
        if (now > b.tellUntil) {
          b.tellUntil = 0
          setBossTell(false)
          b.nextTell = now + BOSS_TELL_EVERY
        }
      } else if (now > b.nextTell) {
        b.tellStart = now
        b.tellUntil = now + BOSS_TELL_DUR
        setBossTell(true)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [bossName])

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
        const inCrest = inTell && Math.abs(ny - bossDangerY(b.tellStart, b.tellUntil, now)) < BOSS_BAND
        if (inCrest) {
          if (now > b.lastHit + BOSS_HIT_IFRAME) {
            b.signal = Math.max(0, b.signal - BOSS_TELL_DMG)
            b.lastHit = now
            setBossSignal(b.signal)
            pushLabel(nx, ny, '−signal', 'noise')
            if (b.signal <= 0) purgeBoss()
          }
        } else {
          const dmg = BOSS_TAP_DMG * Math.min(perf, 4) + (inTell ? 1 : 0)
          b.integrite = Math.max(0, b.integrite - dmg)
          setBossIntegrite(b.integrite)
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
      // (progressif, previsible, jamais de perte). Plus le niveau est haut, plus il faut de
      // taps. La performance ne touche pas au FLUX, seulement au score.
      const raw = flowRef.current + fillPerTapRef.current
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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#050506',
        padding:
          'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))',
        boxSizing: 'border-box',
      }}
    >
      <style>{KEYFRAMES}</style>

      {/* Region live (visuellement masquee) pour lecteur d'ecran */}
      <div
        aria-live="assertive"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        {srMsg}
      </div>

      {/* Coque de la borne */}
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          height: '100%',
          maxHeight: 900,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'linear-gradient(180deg, #141416, #050506)',
          boxShadow: '0 0 60px rgba(255,255,255,0.05)',
          overflow: 'hidden',
        }}
      >
        <Hud
          stageName={bossName ?? stage.name}
          score={score}
          highScore={highScore}
          mult={mult}
          bossMode={!!bossName}
        />
        {bossName ? (
          <BossBar integrite={bossIntegrite} signal={bossSignal} tell={bossTell} />
        ) : (
          <FlowGauge flow={flow} beat={beat} reduced={reduced} />
        )}

        {/* Ecran CRT bombe — surface de jeu unique (eveil + jeu) */}
        <div style={{ position: 'relative', flex: 1, margin: '0 14px', minHeight: 0 }}>
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
              borderRadius: 16,
              overflow: 'hidden',
              background: PALETTE.void,
              touchAction: 'manipulation',
              cursor: 'pointer',
              boxShadow: 'inset 0 0 80px rgba(0,0,0,0.9)',
            }}
          >
            {stage.engine === 'svg' && (
              <WaveformStage ref={engineRef} speed={speed} boss={!!bossName} />
            )}
            {stage.engine === 'canvas' && <MandalaStage ref={engineRef} speed={speed} />}
            {stage.engine === 'webgl' && (
              <LiquidStage ref={engineRef} speed={speed} onGlError={handleGlError} />
            )}

            {/* Couche FX : anneaux resonnables + impacts + embrasements (rAF, refs) */}
            <FxCanvas
              ringsRef={ringsRef}
              impactsRef={impactsRef}
              ignitesRef={ignitesRef}
              multRef={multRef}
              lastTapRef={lastTapRef}
              bossRef={bossRef}
              reducedRef={reducedRef}
            />

            {/* Scanlines + vignette CRT */}
            <div className="tt-scanlines" aria-hidden="true" />
            <div className="tt-vignette" aria-hidden="true" />

            {/* Etiquettes ephemeres de la grammaire (+3 %, +6 %, bruit.) */}
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
                  animation: reduced ? 'none' : 'tt-float 0.8s ease-out forwards',
                  pointerEvents: 'none',
                  zIndex: 13,
                  whiteSpace: 'nowrap',
                }}
              >
                {l.text}
              </div>
            ))}

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
                    bottom: 18,
                    textAlign: 'center',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 'clamp(11px, 3vw, 14px)',
                    letterSpacing: '0.06em',
                    color: PALETTE.red,
                    textShadow: '0 1px 8px rgba(5,1,13,0.9)',
                  }}
                >
                  l'onde balaie — tape dans les creux
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

            {flashSub && <StageUpFlash sub={flashSub} reduced={reduced} />}

            {/* Contemplation : murmure une fois, stable (ne clignote pas). */}
            {booted && whispered && !flashSub && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 16,
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
        </div>

        {glFailed && (
          <div
            role="status"
            style={{
              padding: '8px 14px 0',
              color: 'rgba(255,255,255,0.6)', // voix oracle (ambre reserve au score)
              fontSize: 11,
              fontFamily: 'ui-monospace, monospace',
              letterSpacing: '0.02em',
              textAlign: 'center',
            }}
          >
            le flux profond ne répond pas — retour aux couronnes
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          <StageSelector
            current={stage.id}
            maxUnlocked={maxUnlocked}
            glFailed={glFailed}
            onSelect={selectStage}
          />
        </div>
      </div>
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
