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
  void: '#0a0118',
  magenta: '#ff2e97',
  cyan: '#00f0ff',
  amber: '#ffd600',
  green: '#39ff14',
  red: '#ff3b30', // menace / detection UNIQUEMENT (cf. CLAUDE.md regle 1)
} as const

// Meme palette en composantes 0..1 pour le shader WebGL et les sprites Canvas.
const RGB = {
  magenta: [1.0, 0.18, 0.592] as [number, number, number],
  cyan: [0.0, 0.941, 1.0] as [number, number, number],
  green: [0.224, 1.0, 0.078] as [number, number, number],
}

type Engine = 'svg' | 'canvas' | 'webgl'

interface StageDef {
  id: number
  name: string
  engine: Engine
  tint: string
}

const STAGES: StageDef[] = [
  { id: 1, name: 'WAVEFORM', engine: 'svg', tint: PALETTE.magenta },
  { id: 2, name: 'MANDALA', engine: 'canvas', tint: PALETTE.cyan },
  { id: 3, name: 'LIQUID', engine: 'webgl', tint: PALETTE.green },
]

// Reglages de jeu -----------------------------------------------------------
const FLUX_MAX = 100
const DECAY_PER_SEC = 9 // vitesse de descente de la jauge au repos
const FLASH_MS = 950 // duree du flash SEUIL
const STORAGE_KEY = 'taptap.save.v1'

// Grammaire des combos (source de verite : docs/design/combos-et-interstices.md)
// « Un signal propre se propage ; le bruit se fait purger. »
const TEMPO_MIN = 250 // ms — un tempo se joue entre 250 et 600 ms
const TEMPO_MAX = 600
const TEMPO_TOL = 80 // ms de tolerance autour du tempo etabli
const TEMPO_TOL_ASSIST = 120 // tolerance elargie en prefers-reduced-motion
const NOISE_GAP = 120 // ms — en-dessous, le tap est du BRUIT
const NOISE_RATE = 8 // taps max par fenetre glissante de 1 s
const FREEZE_MS = 1000 // gel de la jauge apres detection du bruit
const RING_LIFE = 1200 // ms de vie d'un anneau logique
const RING_RMAX = 0.38 // rayon max en espace normalise (calque sur le ripple SVG)
const RING_TOL = 0.045 // demi-bande de detection RESONANCE
const RING_MIN_AGE = 150 // ms avant qu'un anneau devienne resonnable
const GAIN_BASE = 1.2 // % de FLUX par PULSATION (avant multiplicateur)
const GAIN_RESONANCE = 3 // % bonus RESONANCE
const GAIN_INTERFERENCE = 6 // % bonus INTERFERENCE (remplace la resonance)
const PTS_BASE = 10
const PTS_RESONANCE = 150
const PTS_INTERFERENCE = 500

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

// Embrasement d'un anneau resonne / flash d'interference (couche overlay,
// les moteurs de rendu ne sont pas touches — cf. spec « Never »).
interface Burst {
  id: number
  x: number
  y: number
  rad: number // rayon normalise de l'anneau au moment du hit
  kind: 'res' | 'inter'
}

interface StageProps {
  speed: number // 1 normal, 0.3 si reduced-motion
}

/* ==========================================================================
 * STAGE 1 — WAVEFORM (SVG)
 * Lignes sinusoidales dephasees + ondes de tap. Rendu via state React.
 * ========================================================================*/
interface Ripple {
  id: number
  x: number
  y: number
  born: number
}

const WaveformStage = memo(
  forwardRef<StageHandle, StageProps>(function WaveformStage({ speed }, ref) {
    const [phase, setPhase] = useState(0)
    const [ripples, setRipples] = useState<Ripple[]>([])
    const idRef = useRef(0)

    useImperativeHandle(ref, () => ({
      tap: (nx, ny) => {
        const r: Ripple = { id: idRef.current++, x: nx * 1000, y: ny * 1000, born: performance.now() }
        setRipples((rs) => [...rs.slice(-11), r])
      },
    }))

    useEffect(() => {
      let raf = 0
      let last = performance.now()
      const loop = (now: number) => {
        const dt = (now - last) / 1000
        last = now
        setPhase((p) => p + dt * speed * 1.6)
        setRipples((rs) => rs.filter((r) => now - r.born < 1200))
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      return () => cancelAnimationFrame(raf)
    }, [speed])

    const lines = [
      { freq: 0.012, amp: 90, color: PALETTE.magenta, off: 0 },
      { freq: 0.018, amp: 60, color: PALETTE.cyan, off: 1.1 },
      { freq: 0.009, amp: 130, color: PALETTE.magenta, off: 2.3 },
      { freq: 0.024, amp: 45, color: PALETTE.cyan, off: 0.6 },
      { freq: 0.015, amp: 100, color: PALETTE.green, off: 3.0 },
    ]

    const buildPath = (freq: number, amp: number, off: number) => {
      let d = ''
      for (let x = 0; x <= 1000; x += 20) {
        const y =
          500 +
          amp * Math.sin(x * freq + phase + off) +
          amp * 0.35 * Math.sin(x * freq * 2.3 - phase * 1.4 + off)
        d += (x === 0 ? 'M' : 'L') + x.toFixed(0) + ' ' + y.toFixed(1) + ' '
      }
      return d
    }

    const now = performance.now()

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
          {ripples.map((r) => {
            const age = (now - r.born) / 1200
            const rad = age * 380
            // Onde de tap = magenta (la presence, cf. DESIGN/EXPERIENCE Key Flow).
            return (
              <circle
                key={r.id}
                cx={r.x}
                cy={r.y}
                r={rad}
                fill="none"
                stroke={PALETTE.magenta}
                strokeWidth={3 * (1 - age)}
                opacity={1 - age}
              />
            )
          })}
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

const MANDALA_COLORS: [number, number, number][] = [RGB.magenta, RGB.cyan, RGB.green]

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
        ctx.fillStyle = 'rgba(10,1,24,0.16)'
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
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_colA'), RGB.magenta)
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_colB'), RGB.cyan)
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_colC'), RGB.green)

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
 * HUD, jauge, selecteur, eveil, flash
 * ========================================================================*/
const Hud = memo(function Hud({
  stageName,
  score,
  highScore,
  mult,
}: {
  stageName: string
  score: number
  highScore: number
  mult: number
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
        <span style={label}>STAGE</span>
        <span style={{ color: PALETTE.magenta, fontSize: 15, fontWeight: 700 }}>{stageName}</span>
      </div>
      <div style={{ ...cell, alignItems: 'center' }}>
        <span style={label}>SCORE</span>
        <span style={{ color: PALETTE.amber, fontSize: 18, fontWeight: 700 }}>
          {Math.min(score, 999999).toString().padStart(6, '0')}
        </span>
      </div>
      <div style={{ ...cell, alignItems: 'flex-end' }}>
        <span style={label}>HIGH</span>
        <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 15, fontWeight: 700 }}>
          {Math.min(highScore, 999999).toString().padStart(6, '0')}
        </span>
        {mult > 1 && (
          <span style={{ color: PALETTE.green, fontSize: 12, fontWeight: 700, marginTop: 2 }}>
            x{mult} CADENCE
          </span>
        )}
      </div>
    </div>
  )
})

function FlowGauge({
  flow,
  frozen,
  freezeSeq,
  reduced,
}: {
  flow: number
  frozen: boolean
  freezeSeq: number
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
      <div
        key={freezeSeq} // remonte a chaque detection : l'animation tt-noise rejoue
        role="progressbar"
        aria-label="FLUX"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: 12,
          borderRadius: 6,
          background: 'rgba(255,255,255,0.08)',
          // Detection du bruit : liseré rouge (menace), clignotant sauf reduced-motion.
          border: frozen ? `1px solid ${PALETTE.red}` : '1px solid rgba(255,255,255,0.12)',
          animation: frozen && !reduced ? 'tt-noise 0.5s linear 2' : 'none',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${PALETTE.cyan}, ${PALETTE.green})`,
            boxShadow: hot ? `0 0 14px ${PALETTE.green}` : 'none',
            transition: 'width 90ms linear',
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
              border: `1px solid ${active ? s.tint : 'rgba(255,255,255,0.15)'}`,
              background: active ? `${s.tint}22` : 'rgba(255,255,255,0.03)',
              color: disabled ? 'rgba(255,255,255,0.3)' : active ? s.tint : 'rgba(255,255,255,0.75)',
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
        background: PALETTE.void,
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
              color: isCta ? PALETTE.green : PALETTE.cyan,
              opacity: isCta ? 1 : 0.72,
              textShadow: isCta ? `0 0 12px ${PALETTE.green}` : 'none',
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
  const [frozenUi, setFrozenUi] = useState(false)
  const [freezeSeq, setFreezeSeq] = useState(0) // re-declenche l'animation de detection
  const [labels, setLabels] = useState<FloatLabel[]>([])
  const [bursts, setBursts] = useState<Burst[]>([])
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(saved.highScore)
  const [flashSub, setFlashSub] = useState<string | null>(null)
  const [glFailed, setGlFailed] = useState(false)
  const [whispered, setWhispered] = useState(false)
  const [srMsg, setSrMsg] = useState('')

  const engineRef = useRef<StageHandle>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const lastTapRef = useRef(0)
  const flashingRef = useRef(false)
  const flowRef = useRef(0) // miroir synchrone du FLUX (detection de seuil pure)
  // Grammaire des combos — etat chaud en refs (jamais de re-render 60 fps).
  const tempoRef = useRef<number | null>(null) // T du joueur (moyenne glissante)
  const chainRef = useRef(0) // taps enchaines dans le tempo
  const multRef = useRef(1) // miroir du multiplicateur affiche
  const ringsRef = useRef<{ x: number; y: number; born: number }[]>([])
  const tapTimesRef = useRef<number[]>([]) // fenetre glissante 1 s (detection du taux)
  const freezeUntilRef = useRef(0) // gel de la jauge apres BRUIT
  const freezeTimeoutRef = useRef(0) // timeout du degel UI (annule/rearme a chaque detection)
  const prevValidRef = useRef(false) // le tap precedent peut-il ancrer un tempo ?
  const noiseLabelUntilRef = useRef(0) // throttle de l'etiquette 'bruit.'
  const labelIdRef = useRef(0)
  const timeoutsRef = useRef<Set<number>>(new Set()) // timers traques (nettoyes au demontage)
  const reducedRef = useRef(reduced)

  // Miroirs mis a jour hors rendu (purete du rendu) + reduced-motion leve le gel.
  useEffect(() => {
    reducedRef.current = reduced
    if (reduced) {
      freezeUntilRef.current = 0
      window.clearTimeout(freezeTimeoutRef.current)
      setFrozenUi(false)
    }
  }, [reduced])

  const stage = STAGES[stageIndex]
  const topStageId = glFailed ? 2 : 3
  // Contemplation : les trois couches ouvertes, au sommet accessible, hors panne.
  const contemplation = maxUnlocked >= topStageId && stage.id === topStageId && !glFailed
  const contemplationRef = useRef(contemplation)
  useEffect(() => {
    contemplationRef.current = contemplation
  }, [contemplation])

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

  // Boucle de jeu : descente de la jauge + expiration du combo.
  useEffect(() => {
    if (!booted) return
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      // Gel apres BRUIT : ni gain ni decroissance (la jauge est figee).
      if (now >= freezeUntilRef.current) {
        const decay = contemplationRef.current ? DECAY_PER_SEC * 0.4 : DECAY_PER_SEC
        setFlow((f) => {
          const v = Math.max(0, f - decay * dt)
          flowRef.current = v
          return v
        })
      }
      // Silence plus long que le tempo + tolerance : la cadence retombe (sans penalite).
      const tol = reducedRef.current ? TEMPO_TOL_ASSIST : TEMPO_TOL
      if (chainRef.current > 0 && now - lastTapRef.current > (tempoRef.current ?? TEMPO_MAX) + tol) {
        chainRef.current = 0
        tempoRef.current = null
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

  const triggerStageUp = useCallback(() => {
    if (flashingRef.current) return
    const nextId = Math.min(stage.id + 1, topStageId)
    // Ceremonie SEULEMENT pour un deblocage reellement nouveau. Re-remplir un
    // stage deja ouvert plafonne le FLUX, sans flash / +500 / bascule (anti-farm).
    if (nextId <= stage.id || nextId <= maxUnlocked) {
      flowRef.current = FLUX_MAX
      setFlow(FLUX_MAX)
      return
    }
    flashingRef.current = true
    ringsRef.current.length = 0 // le moteur change : les anneaux logiques meurent avec lui
    setMaxUnlocked(nextId)
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
  }, [stage.id, topStageId, maxUnlocked])

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
      window.clearTimeout(freezeTimeoutRef.current)
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

  // Embrasement de l'anneau resonne (RESONANCE) / flash blanc (INTERFERENCE).
  const pushBurst = useCallback(
    (x: number, y: number, rad: number, kind: 'res' | 'inter') => {
      const id = labelIdRef.current++
      setBursts((bs) => [...bs.slice(-3), { id, x, y, rad, kind }])
      trackedTimeout(() => setBursts((bs) => bs.filter((b) => b.id !== id)), 500)
    },
    [trackedTimeout],
  )

  const registerTap = useCallback(
    (nx: number, ny: number) => {
      if (flashingRef.current) return
      engineRef.current?.tap(nx, ny) // le moteur pulse TOUJOURS (le jouet repond), recompense ou pas

      const now = performance.now()
      const gap = now - lastTapRef.current
      const hadPrev = lastTapRef.current > 0
      lastTapRef.current = now

      // --- LE BRUIT : ecart trop court ou taux trop haut → la machine te detecte.
      const times = tapTimesRef.current
      times.push(now)
      while (times.length && now - times[0] > 1000) times.shift()
      if (hadPrev && (gap < NOISE_GAP || times.length > NOISE_RATE)) {
        chainRef.current = 0
        tempoRef.current = null
        prevValidRef.current = false // un tap puni n'ancre jamais le tempo suivant
        if (multRef.current !== 1) {
          multRef.current = 1
          setMult(1)
        }
        if (now >= noiseLabelUntilRef.current) {
          noiseLabelUntilRef.current = now + 800
          pushLabel(nx, ny, 'bruit.', 'noise')
        }
        if (!reducedRef.current) {
          // Detection simple : jauge figee 1 s (ni gain ni decroissance) + liseré rouge.
          // Re-detection : le timeout precedent est annule, l'animation rejoue (freezeSeq).
          freezeUntilRef.current = now + FREEZE_MS
          setFrozenUi(true)
          setFreezeSeq((s) => s + 1)
          window.clearTimeout(freezeTimeoutRef.current)
          freezeTimeoutRef.current = window.setTimeout(() => setFrozenUi(false), FREEZE_MS)
        }
        return // 0 point, 0 FLUX
      }

      // --- Gel actif : le tap est inerte (le moteur a pulse, rien d'autre).
      // Pas de pre-armement de chaine ni d'anneau pendant la detection.
      if (!reducedRef.current && now < freezeUntilRef.current) {
        prevValidRef.current = false
        return
      }

      // --- CADENCE : tenir SON tempo (etabli par 2 taps valides, suivi en moyenne
      // glissante CLAMPEE a [TEMPO_MIN, TEMPO_MAX] — la derive ne re-ouvre pas le spam).
      const tol = reducedRef.current ? TEMPO_TOL_ASSIST : TEMPO_TOL
      if (tempoRef.current !== null && Math.abs(gap - tempoRef.current) <= tol) {
        chainRef.current += 1
        tempoRef.current = Math.min(
          TEMPO_MAX,
          Math.max(TEMPO_MIN, 0.7 * tempoRef.current + 0.3 * gap),
        )
      } else if (
        tempoRef.current === null &&
        hadPrev &&
        prevValidRef.current &&
        gap >= TEMPO_MIN &&
        gap <= TEMPO_MAX
      ) {
        tempoRef.current = gap // ce tap + le precedent (valide) etablissent le tempo
        chainRef.current = 2
      } else {
        // Rompre le tempo = repartir a 1 (spec) ; ce tap pourra ancrer le suivant.
        tempoRef.current = null
        chainRef.current = 1
      }
      prevValidRef.current = true
      const chain = chainRef.current
      const m = chain >= 16 ? 4 : chain >= 8 ? 3 : chain >= 4 ? 2 : 1
      if (m !== multRef.current) {
        multRef.current = m
        setMult(m)
      }

      // --- RESONANCE / INTERFERENCE : taper sur ses propres anneaux.
      // Espace normalise [0,1]² etire — coherent avec le rendu (preserveAspectRatio=none).
      const rings = ringsRef.current
      for (let i = rings.length - 1; i >= 0; i--) {
        if (now - rings[i].born > RING_LIFE) rings.splice(i, 1)
      }
      const hitRings: { x: number; y: number; rad: number }[] = []
      for (const r of rings) {
        const age = now - r.born
        if (age < RING_MIN_AGE) continue
        const rad = RING_RMAX * (age / RING_LIFE)
        const d = Math.hypot(nx - r.x, ny - r.y)
        if (Math.abs(d - rad) <= RING_TOL) hitRings.push({ x: r.x, y: r.y, rad })
      }
      const hits = hitRings.length

      // --- Gains (le gel est deja sorti plus haut).
      let fluxGain = GAIN_BASE * m
      let pts = PTS_BASE * m
      if (hits >= 2) {
        fluxGain += GAIN_INTERFERENCE
        pts += PTS_INTERFERENCE
        pushLabel(nx, ny, '+6 %', 'gain')
        // Flash d'interference : les deux anneaux s'embrasent en blanc.
        pushBurst(hitRings[0].x, hitRings[0].y, hitRings[0].rad, 'inter')
        pushBurst(hitRings[1].x, hitRings[1].y, hitRings[1].rad, 'inter')
      } else if (hits === 1) {
        fluxGain += GAIN_RESONANCE
        pts += PTS_RESONANCE
        pushLabel(nx, ny, '+3 %', 'gain')
        // L'anneau resonne s'embrase (magenta → blanc via le glow).
        pushBurst(hitRings[0].x, hitRings[0].y, hitRings[0].rad, 'res')
      }
      const raw = flowRef.current + fluxGain
      const nf = Math.min(FLUX_MAX, raw)
      flowRef.current = nf
      setFlow(nf)
      if (raw >= FLUX_MAX) triggerStageUp() // detection synchrone via flowRef (pur)
      setScore((s) => {
        const ns = s + pts
        setHighScore((h) => (ns > h ? ns : h))
        return ns
      })

      // L'anneau logique du tap (le bruit n'en cree pas : return plus haut).
      rings.push({ x: nx, y: ny, born: now })
      if (rings.length > 12) rings.shift()
    },
    [triggerStageUp, pushLabel, pushBurst],
  )

  // Le premier contact reveille la borne ET pulse au point touche.
  const tapAt = useCallback(
    (nx: number, ny: number) => {
      if (!booted) setBooted(true)
      registerTap(Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny)))
    },
    [booted, registerTap],
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
        background: '#05010d',
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
          background: 'linear-gradient(180deg, #120826, #05010d)',
          boxShadow: '0 0 60px rgba(255,46,151,0.12)',
          overflow: 'hidden',
        }}
      >
        <Hud stageName={stage.name} score={score} highScore={highScore} mult={mult} />
        <FlowGauge flow={flow} frozen={frozenUi} freezeSeq={freezeSeq} reduced={reduced} />

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
            {stage.engine === 'svg' && <WaveformStage ref={engineRef} speed={speed} />}
            {stage.engine === 'canvas' && <MandalaStage ref={engineRef} speed={speed} />}
            {stage.engine === 'webgl' && (
              <LiquidStage ref={engineRef} speed={speed} onGlError={handleGlError} />
            )}

            {/* Scanlines + vignette CRT */}
            <div className="tt-scanlines" aria-hidden="true" />
            <div className="tt-vignette" aria-hidden="true" />

            {/* Embrasement des anneaux resonnes / flash d'interference (overlay) */}
            {bursts.map((b) => (
              <div
                key={b.id}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: `${(b.x - b.rad) * 100}%`,
                  top: `${(b.y - b.rad) * 100}%`,
                  width: `${b.rad * 2 * 100}%`,
                  height: `${b.rad * 2 * 100}%`,
                  borderRadius: '50%',
                  border: `2px solid ${b.kind === 'inter' ? '#ffffff' : PALETTE.magenta}`,
                  boxShadow: `0 0 18px ${b.kind === 'inter' ? '#ffffff' : PALETTE.magenta}`,
                  opacity: 0.9,
                  animation: reduced ? 'none' : 'tt-ignite 0.45s ease-out forwards',
                  pointerEvents: 'none',
                  zIndex: 12,
                }}
              />
            ))}

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
@keyframes tt-noise {
  0%, 100% { box-shadow: 0 0 10px rgba(255,59,48,0.55); }
  50% { box-shadow: 0 0 0 rgba(255,59,48,0); }
}
@keyframes tt-ignite {
  0% { opacity: 0.95; filter: brightness(2); }
  100% { opacity: 0; filter: brightness(1); transform: scale(1.06); }
}
.tt-screen:focus-visible {
  outline: 2px solid ${PALETTE.green};
  outline-offset: 2px;
}
.tt-btn:focus-visible {
  outline: 2px solid ${PALETTE.green};
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
