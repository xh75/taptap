import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

/* ============================================================================
 * TAP·TAP — borne d'arcade generative psychedelique
 * Le geste central est le TAP : chaque tap pulse le visuel au point touche et
 * remplit la jauge FLOW. FLOW plein => STAGE UP => nouveau moteur de rendu.
 *   Stage 1 WAVEFORM  -> SVG        (ondes & interferences)
 *   Stage 2 MANDALA   -> Canvas 2D  (fractales radiales, composite lighter)
 *   Stage 3 LIQUID    -> WebGL      (fbm 6 octaves, onde de choc au tap)
 * Composant autonome : styles inline, aucune dependance externe.
 * ==========================================================================*/

// ---------------------------------------------------------------------------
// Palette psyche fixe (contraste calibre, esthetique CRT/neon)
// ---------------------------------------------------------------------------
const PALETTE = {
  void: '#0a0118',
  magenta: '#ff2e97',
  cyan: '#00f0ff',
  amber: '#ffd600',
  green: '#39ff14',
} as const

// Meme palette en composantes 0..1 pour le shader WebGL.
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
const FLOW_MAX = 100
const TAP_GAIN_BASE = 7 // points de FLOW par tap (avant bonus combo)
const COMBO_WINDOW = 700 // ms max entre deux taps pour enchainer le combo
const DECAY_PER_SEC = 9 // vitesse de descente de la jauge au repos
const FLASH_MS = 950 // duree du flash STAGE UP!
const STORAGE_KEY = 'taptap.save.v1'

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
        maxUnlocked: Math.min(3, Math.max(1, Number(p.maxUnlocked) || 1)),
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
// prefers-reduced-motion : vitesse d'animation reduite a x0.3 si demande.
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

interface StageProps {
  speed: number // 1 normal, 0.3 si reduced-motion
}

/* ==========================================================================
 * STAGE 1 — WAVEFORM (SVG)
 * Lignes sinusoidales dephasees + ripples de tap. Rendu via state React
 * (leger : quelques lignes, cout GPU quasi nul).
 * ========================================================================*/
interface Ripple {
  id: number
  x: number
  y: number
  born: number
}

const WaveformStage = forwardRef<StageHandle, StageProps>(function WaveformStage(
  { speed },
  ref,
) {
  const [phase, setPhase] = useState(0)
  const [ripples, setRipples] = useState<Ripple[]>([])
  const idRef = useRef(0)

  useImperativeHandle(ref, () => ({
    tap: (nx, ny) => {
      const r: Ripple = { id: idRef.current++, x: nx * 1000, y: ny * 1000, born: performance.now() }
      setRipples((rs) => [...rs.slice(-11), r])
    },
  }))

  // Horloge d'animation (rAF) : avance la phase + purge les ripples expires.
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
          return (
            <circle
              key={r.id}
              cx={r.x}
              cy={r.y}
              r={rad}
              fill="none"
              stroke={PALETTE.green}
              strokeWidth={3 * (1 - age)}
              opacity={1 - age}
            />
          )
        })}
      </g>
    </svg>
  )
})

/* ==========================================================================
 * STAGE 2 — MANDALA (Canvas 2D)
 * Symetrie en couronnes, composite 'lighter', trainee par fondu.
 * Les taps (pulses) sont pousses dans un ref -> pas de re-render a 60fps.
 * ========================================================================*/
interface Pulse {
  x: number
  y: number
  born: number
  color: [number, number, number]
}

const MANDALA_COLORS: [number, number, number][] = [RGB.magenta, RGB.cyan, RGB.green]

const MandalaStage = forwardRef<StageHandle, StageProps>(function MandalaStage(
  { speed },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pulsesRef = useRef<Pulse[]>([])
  const colorIdxRef = useRef(0)

  useImperativeHandle(ref, () => ({
    tap: (nx, ny) => {
      pulsesRef.current.push({
        x: nx,
        y: ny,
        born: performance.now(),
        color: MANDALA_COLORS[colorIdxRef.current++ % MANDALA_COLORS.length],
      })
      if (pulsesRef.current.length > 24) pulsesRef.current.shift()
    },
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

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

    const rgba = (c: [number, number, number], a: number) =>
      `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`

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
        const x = Math.cos(a) * ambR
        const y = Math.sin(a) * ambR
        ctx.shadowBlur = 16
        ctx.shadowColor = PALETTE.cyan
        ctx.fillStyle = rgba(RGB.cyan, 0.5)
        ctx.beginPath()
        ctx.arc(x, y, scale * 0.006, 0, Math.PI * 2)
        ctx.fill()
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
        const dot = scale * 0.012 * (1 - age * 0.6)
        ctx.shadowBlur = 22
        ctx.shadowColor = rgba(p.color, 1)
        ctx.fillStyle = rgba(p.color, alpha)
        for (let i = 0; i < arms; i++) {
          const a = (i / arms) * Math.PI * 2 + t * 0.5 + age * 1.5
          const x = Math.cos(a) * rr
          const y = Math.sin(a) * rr
          ctx.beginPath()
          ctx.arc(x, y, dot, 0, Math.PI * 2)
          ctx.fill()
          // Rayon reliant le centre au point (structure de mandala).
          ctx.strokeStyle = rgba(p.color, alpha * 0.25)
          ctx.lineWidth = scale * 0.002
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.lineTo(x, y)
          ctx.stroke()
        }
      }

      ctx.restore()
      ctx.shadowBlur = 0
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
})

/* ==========================================================================
 * STAGE 3 — LIQUID (WebGL)
 * Flux marbre : bruit fbm 6 octaves dans un fragment shader. Onde de choc
 * au tap. Uniforms en refs -> le shader ne recompile pas a chaque frame.
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

  // Ondes de choc issues des taps.
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

const LiquidStage = forwardRef<StageHandle, LiquidProps>(function LiquidStage(
  { speed, onGlError },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // 6 emplacements d'onde de choc (ring buffer). born tres negatif = inactif.
  const tapsRef = useRef(
    Array.from({ length: 6 }, () => ({ x: 0, y: 0, born: -1e9 })),
  )
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
      onGlError()
      return
    }
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      onGlError()
      return
    }
    gl.useProgram(prog)

    // Triangle plein-ecran.
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
    }
  }, [speed, onGlError])

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%', background: PALETTE.void }}
      aria-hidden="true"
    />
  )
})

/* ==========================================================================
 * HUD, jauge, selecteur, boot BIOS, flash STAGE UP
 * ========================================================================*/
function Hud({
  stageName,
  score,
  highScore,
  combo,
}: {
  stageName: string
  score: number
  highScore: number
  combo: number
}) {
  const cell: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.1,
  }
  const label: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: '0.18em',
    color: 'rgba(255,255,255,0.45)',
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
          {score.toString().padStart(6, '0')}
        </span>
      </div>
      <div style={{ ...cell, alignItems: 'flex-end' }}>
        <span style={label}>HIGH</span>
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15 }}>
          {highScore.toString().padStart(6, '0')}
        </span>
        {combo > 1 && (
          <span style={{ color: PALETTE.green, fontSize: 12, fontWeight: 700, marginTop: 2 }}>
            x{combo} COMBO
          </span>
        )}
      </div>
    </div>
  )
}

function FlowGauge({ flow }: { flow: number }) {
  const pct = Math.min(100, (flow / FLOW_MAX) * 100)
  const hot = pct > 80
  return (
    <div style={{ padding: '0 14px 12px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.45)',
          marginBottom: 4,
        }}
      >
        <span>FLOW</span>
        <span style={{ color: hot ? PALETTE.green : 'rgba(255,255,255,0.45)' }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div
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
            background: `linear-gradient(90deg, ${PALETTE.cyan}, ${PALETTE.green})`,
            boxShadow: hot ? `0 0 14px ${PALETTE.green}` : 'none',
            transition: 'width 90ms linear',
          }}
        />
      </div>
    </div>
  )
}

function StageSelector({
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
        return (
          <button
            key={s.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(s.id)}
            aria-label={`Stage ${s.id} ${s.name}${locked ? ' verrouille' : ''}`}
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
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {glDown ? '⚠' : locked ? '🔒' : s.id}
            </div>
            <div>{s.name}</div>
          </button>
        )
      })}
    </div>
  )
}

function StageUpFlash({ name }: { name: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(57,255,20,0.14)',
        animation: 'tt-flash 0.95s ease-out forwards',
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
        STAGE UP!
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 'clamp(12px, 3.5vw, 20px)',
          letterSpacing: '0.3em',
          color: '#fff',
        }}
      >
        {name}
      </div>
    </div>
  )
}

const BIOS_LINES = [
  'TAP·TAP ARCADE SYSTEM',
  'BIOS v0.1 ...... OK',
  'PSYCHE-GEN CORE ...... OK',
  'ENGINE/SVG ...... READY',
  'ENGINE/CANVAS2D ...... LOCKED',
  'ENGINE/WEBGL ...... LOCKED',
  '',
  'INSERT COIN — TAP TO START',
]

function BiosBoot({ onStart }: { onStart: () => void }) {
  const [shown, setShown] = useState(1)
  useEffect(() => {
    const id = window.setInterval(() => {
      setShown((n) => (n < BIOS_LINES.length ? n + 1 : n))
    }, 220)
    return () => window.clearInterval(id)
  }, [])
  return (
    <button
      type="button"
      onClick={onStart}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 8vw',
        gap: 6,
        background: PALETTE.void,
        border: 'none',
        textAlign: 'left',
        cursor: 'pointer',
        zIndex: 30,
        fontFamily: 'ui-monospace, monospace',
      }}
      aria-label="Demarrer TAP-TAP"
    >
      {BIOS_LINES.slice(0, shown).map((line, i) => {
        const isCta = line.startsWith('INSERT COIN')
        return (
          <div
            key={i}
            style={{
              fontSize: isCta ? 'clamp(13px, 3.6vw, 18px)' : 'clamp(11px, 3vw, 15px)',
              color: isCta ? PALETTE.green : PALETTE.cyan,
              textShadow: isCta ? `0 0 12px ${PALETTE.green}` : 'none',
              animation: isCta ? 'tt-blink 1s steps(2) infinite' : 'none',
            }}
          >
            {line || ' '}
          </div>
        )
      })}
    </button>
  )
}

/* ==========================================================================
 * COMPOSANT PRINCIPAL
 * ========================================================================*/
export default function TapTap() {
  const reduced = useReducedMotion()
  const speed = reduced ? 0.3 : 1

  const saved = useRef<SaveData>(loadSave()).current
  const [booted, setBooted] = useState(false)
  const [stageIndex, setStageIndex] = useState(0)
  const [maxUnlocked, setMaxUnlocked] = useState(saved.maxUnlocked)
  const [flow, setFlow] = useState(0)
  const [combo, setCombo] = useState(0)
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(saved.highScore)
  const [flashName, setFlashName] = useState<string | null>(null)
  const [glFailed, setGlFailed] = useState(false)

  const engineRef = useRef<StageHandle>(null)
  const lastTapRef = useRef(0)
  const comboRef = useRef(0)
  const flashingRef = useRef(false)

  const stage = STAGES[stageIndex]

  // --- Persistance high-score + progression ---
  useEffect(() => {
    persistSave({ highScore, maxUnlocked })
  }, [highScore, maxUnlocked])

  // --- Boucle de jeu : descente de la jauge + expiration du combo ---
  useEffect(() => {
    if (!booted) return
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setFlow((f) => Math.max(0, f - DECAY_PER_SEC * dt))
      if (comboRef.current > 0 && now - lastTapRef.current > COMBO_WINDOW) {
        comboRef.current = 0
        setCombo(0)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [booted])

  const topStageId = glFailed ? 2 : 3

  const triggerStageUp = useCallback(() => {
    if (flashingRef.current) return
    const nextId = Math.min(stage.id + 1, topStageId)
    if (nextId <= stage.id) {
      // Deja au dernier moteur : on plafonne le FLOW, pas de bascule.
      setFlow(FLOW_MAX)
      return
    }
    flashingRef.current = true
    setMaxUnlocked((m) => Math.max(m, nextId))
    setStageIndex(nextId - 1)
    setFlashName(STAGES[nextId - 1].name)
    setScore((s) => s + 500) // bonus de passage
    window.setTimeout(() => {
      flashingRef.current = false
      setFlashName(null)
      setFlow(14) // residu de FLOW sur le nouveau stage
    }, FLASH_MS)
  }, [stage.id, topStageId])

  const registerTap = useCallback(
    (nx: number, ny: number) => {
      if (!booted || flashingRef.current) return
      engineRef.current?.tap(nx, ny)

      const now = performance.now()
      const chained = now - lastTapRef.current < COMBO_WINDOW
      lastTapRef.current = now
      comboRef.current = chained ? comboRef.current + 1 : 1
      const c = comboRef.current
      setCombo(c)

      const gain = TAP_GAIN_BASE * (1 + Math.min(c, 20) * 0.12)
      setFlow((f) => {
        const nf = f + gain
        if (nf >= FLOW_MAX) triggerStageUp()
        return Math.min(FLOW_MAX, nf)
      })

      const pts = Math.round(10 * (1 + Math.min(c, 30) * 0.1))
      setScore((s) => {
        const ns = s + pts
        setHighScore((h) => (ns > h ? ns : h))
        return ns
      })
    },
    [booted, triggerStageUp],
  )

  // Coordonnees normalisees [0,1] a partir d'un evenement pointeur.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      const nx = (e.clientX - rect.left) / rect.width
      const ny = (e.clientY - rect.top) / rect.height
      registerTap(Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny)))
    },
    [registerTap],
  )

  // Accessibilite clavier : Espace / Entree = tap au centre (leger jitter).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        registerTap(0.5 + (Math.random() - 0.5) * 0.3, 0.5 + (Math.random() - 0.5) * 0.3)
      }
    },
    [registerTap],
  )

  const handleGlError = useCallback(() => {
    setGlFailed(true)
    setStageIndex((idx) => (STAGES[idx].engine === 'webgl' ? 1 : idx))
  }, [])

  const selectStage = useCallback(
    (id: number) => {
      if (id > maxUnlocked) return
      if (STAGES[id - 1].engine === 'webgl' && glFailed) return
      setStageIndex(id - 1)
    },
    [maxUnlocked, glFailed],
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#05010d',
        padding: 'max(8px, env(safe-area-inset-top)) 8px max(8px, env(safe-area-inset-bottom))',
        boxSizing: 'border-box',
      }}
    >
      <style>{KEYFRAMES}</style>

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
        <Hud stageName={stage.name} score={score} highScore={highScore} combo={combo} />
        <FlowGauge flow={flow} />

        {/* Ecran CRT bombe */}
        <div style={{ position: 'relative', flex: 1, margin: '0 14px', minHeight: 0 }}>
          <div
            role="button"
            tabIndex={0}
            aria-label="Ecran de jeu — tape pour pulser et remplir le FLOW"
            onPointerDown={booted ? handlePointerDown : undefined}
            onKeyDown={booted ? handleKeyDown : undefined}
            className="tt-screen"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 16,
              overflow: 'hidden',
              background: PALETTE.void,
              touchAction: 'manipulation',
              cursor: booted ? 'pointer' : 'default',
              // Bombe CRT.
              boxShadow: 'inset 0 0 80px rgba(0,0,0,0.9)',
            }}
          >
            {/* Moteur du stage courant */}
            {stage.engine === 'svg' && <WaveformStage ref={engineRef} speed={speed} />}
            {stage.engine === 'canvas' && <MandalaStage ref={engineRef} speed={speed} />}
            {stage.engine === 'webgl' && (
              <LiquidStage ref={engineRef} speed={speed} onGlError={handleGlError} />
            )}

            {/* Scanlines + vignette CRT */}
            <div className="tt-scanlines" aria-hidden="true" />
            <div className="tt-vignette" aria-hidden="true" />

            {flashName && <StageUpFlash name={flashName} />}
            {!booted && <BiosBoot onStart={() => setBooted(true)} />}
          </div>
        </div>

        {glFailed && (
          <div
            style={{
              padding: '8px 14px 0',
              color: PALETTE.amber,
              fontSize: 11,
              fontFamily: 'ui-monospace, monospace',
              letterSpacing: '0.06em',
              textAlign: 'center',
            }}
          >
            ⚠ SIGNAL WEBGL ABSENT — REPLI SUR LE STAGE MANDALA
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

// Keyframes + effets CRT injectes une fois.
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
.tt-screen:focus-visible {
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
