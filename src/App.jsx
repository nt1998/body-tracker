import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'
import annotationPlugin from 'chartjs-plugin-annotation'
import './App.css'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, annotationPlugin)

// ---- Constants ----

const METRICS = [
  { key: 'weight', label: 'Weight', unit: 'kg', color: '#f38ba8', step: 0.1 },
  { key: 'bodyFat', label: 'Body Fat', unit: '%', color: '#fab387', step: 0.1 },
  { key: 'musclePct', label: 'Muscle', unit: '%', color: '#a6e3a1', step: 0.1 },
  { key: 'visceralFat', label: 'Visceral', unit: '', color: '#cba6f7', step: 1 }
]

const ORBIT_HABITS = [
  { key: 'morning', icon: '🧘', name: 'Morning', color: '#f9e2af',
    applies: () => true,
    details: [
      'Ankle Circles (Ankle CARs)',
      'Hip Circles (Hip CARs)',
      'Arch Squeeze (Short Foot, 30s each foot)',
      'Deep Squat Sit (Deep Squat Hold, 60s)'
    ] },
  { key: 'supsAM', icon: '☀️', name: 'Sups AM', color: '#cba6f7',
    applies: () => true,
    details: ['Creatine', '1x Base Powder', '2x Omega 3'] },
  { key: 'd3k2', icon: '💊', name: 'D3+K2', color: '#f5c2e7',
    // Alternates based on yesterday's tracking: if yesterday had no D3+K2, show today
    applies: (_d, dateStr, entries) => {
      if (!entries) return true
      const yKey = addDays(dateStr, -1)
      const yEntry = entries[yKey]
      if (!yEntry) return true
      return !yEntry.habits?.d3k2
    },
    details: ['1x D3+K2'] },
  { key: 'supsPM', icon: '🌙', name: 'Sups PM', color: '#b4befe',
    applies: () => true,
    details: ['1x Magnesium', '2x Omega 3'] },
  { key: 'hiit', icon: '🫀', name: 'HIIT', color: '#89dceb',
    applies: d => [3, 0].includes(d.getDay()) },
]

const DAY_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT']
const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

// ---- Helpers ----

function dateKey(d) {
  if (typeof d === 'string') return d
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(s, n) {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return dateKey(d)
}

function weightAvgDeltaSeries(keys, entries) {
  if (!keys || keys.length === 0) return []
  const firstKey = keys[0]
  const avgEnding = (endKey, days) => {
    if (endKey < firstKey) return null
    const startKey = addDays(endKey, -(days - 1))
    const winStart = startKey < firstKey ? firstKey : startKey
    const vals = []
    for (const k of keys) {
      if (k < winStart) continue
      if (k > endKey) break
      const w = parseFloat(entries[k]?.weight)
      if (!isNaN(w)) vals.push(w)
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  return keys.map(k => {
    let priorEnd = addDays(k, -7)
    if (priorEnd < firstKey) priorEnd = firstKey
    const priorStartNom = addDays(priorEnd, -3)
    let n = 4
    if (priorStartNom < firstKey) {
      const diffDays = Math.round((parseDate(priorEnd) - parseDate(firstKey)) / 86400000)
      n = Math.max(1, diffDays + 1)
    }
    const cur = avgEnding(k, n)
    const prior = avgEnding(priorEnd, n)
    return (cur != null && prior != null) ? +(cur - prior).toFixed(3) : null
  })
}

function formatDateLabel(s) {
  const d = parseDate(s)
  return `${DAY_NAMES[d.getDay()]} ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`
}

function habitApplies(h, dateStr, entries) {
  const d = new Date(dateStr + 'T12:00:00')
  return h.applies(d, dateStr, entries)
}

function getPhaseColor(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('cut')) return '#f38ba8'
  if (n.includes('bulk')) return '#a6e3a1'
  return '#f9e2af'
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}

function makeEmptyHabits() {
  return { morning: false, supsAM: false, d3k2: false, supsPM: false, gymPush: false, gymPull: false, hiit: false, rehab: false }
}

function makeEmptyEntry(prev) {
  return {
    weight: prev?.weight || '',
    bodyFat: prev?.bodyFat || '',
    musclePct: prev?.musclePct || '',
    visceralFat: prev?.visceralFat || '',
    habits: makeEmptyHabits()
  }
}

function ensureHabits(entry) {
  if (!entry) return entry
  const base = makeEmptyHabits()
  if (!entry.habits) {
    if (entry.creatine || entry.vitamins) base.supsAM = !!(entry.creatine && entry.vitamins)
    return { ...entry, habits: base }
  }
  const h = entry.habits
  const migrated = {
    ...base,
    morning: h.morning ?? h.am5 ?? false,
    supsAM: h.supsAM ?? false,
    d3k2: h.d3k2 ?? false,
    supsPM: h.supsPM ?? false,
    gymPush: h.gymPush ?? false,
    gymPull: h.gymPull ?? false,
    hiit: h.hiit ?? h.cardio ?? false,
    rehab: h.rehab ?? h.stretch ?? false,
  }
  return { ...entry, habits: migrated }
}

// Phase band plugin for Chart.js — draws colored vertical bands behind chart data
const phaseBandsPlugin = {
  id: 'phaseBands',
  beforeDraw(chart) {
    const bands = chart.options.plugins?.phaseBands?.bands
    if (!bands || !bands.length) return
    const { ctx, chartArea: { left, right, top, bottom }, scales: { x } } = chart
    const totalLabels = chart.data.labels.length
    if (totalLabels === 0) return
    const pxPerLabel = (right - left) / (totalLabels - 1 || 1)
    bands.forEach(({ startIdx, endIdx, color }) => {
      const x0 = left + (startIdx - 0.5) * pxPerLabel
      const x1 = left + (endIdx + 0.5) * pxPerLabel
      ctx.save()
      ctx.fillStyle = color
      ctx.fillRect(Math.max(x0, left), top, Math.min(x1, right) - Math.max(x0, left), bottom - top)
      ctx.restore()
    })
  }
}
ChartJS.register(phaseBandsPlugin)

// Week-boundary markers — small tick marks at x-axis for Sun→Mon transitions
const weekMarkersPlugin = {
  id: 'weekMarkers',
  afterDatasetsDraw(chart) {
    const dates = chart.options.plugins?.weekMarkers?.dates
    if (!dates || dates.length < 2) return
    const { ctx, chartArea, scales } = chart
    ctx.save()
    ctx.fillStyle = 'rgba(137, 180, 250, 0.55)'
    for (let i = 1; i < dates.length; i++) {
      const cur = parseDate(dates[i])
      if (cur.getDay() !== 1) continue
      const prev = parseDate(dates[i - 1])
      if (prev.getDay() === 1) continue
      const xCur = scales.x.getPixelForValue(i)
      const xPrev = scales.x.getPixelForValue(i - 1)
      const x = (xCur + xPrev) / 2
      // Tick: 2px wide, 5px tall, straddling the axis baseline
      ctx.fillRect(Math.round(x) - 1, chartArea.bottom - 2, 2, 5)
    }
    ctx.restore()
  }
}
ChartJS.register(weekMarkersPlugin)

function buildPhaseBands(sortedDates, phases) {
  const bands = []
  phases.forEach(p => {
    const startIdx = sortedDates.findIndex(d => d >= p.start)
    if (startIdx === -1) return
    let endIdx = p.end ? sortedDates.findIndex(d => d > p.end) : sortedDates.length
    if (endIdx === -1) endIdx = sortedDates.length
    endIdx = Math.max(endIdx - 1, startIdx)
    const color = getPhaseColor(p.name)
    bands.push({ startIdx, endIdx, color: hexToRgba(color, 0.13) })
  })
  return bands
}

// Base chart options: responsive: false, animation: false
function baseChartOpts(extraScales, phaseBands, dates) {
  return {
    responsive: false,
    animation: false,
    plugins: {
      legend: { display: false },
      ...(phaseBands ? { phaseBands: { bands: phaseBands } } : {}),
      ...(dates ? { weekMarkers: { dates } } : {})
    },
    scales: {
      x: { ticks: { color: '#6c7086', font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { display: false } },
      y: { ticks: { color: '#6c7086', font: { size: 9 } }, grid: { color: '#313244' } },
      ...extraScales
    },
    elements: { point: { radius: 0 }, line: { tension: .35, borderWidth: 2 } }
  }
}

// ---- Celebration icons ----
const BlackHoleIcon = () => (
  <svg width="54" height="54" viewBox="0 0 54 54" className="celeb-svg">
    <defs>
      <radialGradient id="bhDisc" cx="50%" cy="50%" r="50%">
        <stop offset="30%" stopColor="#000000" stopOpacity="1" />
        <stop offset="45%" stopColor="#11111b" stopOpacity="1" />
        <stop offset="58%" stopColor="#cba6f7" stopOpacity="0.9" />
        <stop offset="72%" stopColor="#f9e2af" stopOpacity="0.85" />
        <stop offset="90%" stopColor="#fab387" stopOpacity="0.35" />
        <stop offset="100%" stopColor="#fab387" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="bhCore" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#000000" />
        <stop offset="85%" stopColor="#000000" />
        <stop offset="100%" stopColor="#11111b" />
      </radialGradient>
    </defs>
    <circle cx="27" cy="27" r="26" fill="url(#bhDisc)" />
    <circle cx="27" cy="27" r="10" fill="url(#bhCore)" />
  </svg>
)
const StarIcon = () => (
  <svg width="46" height="46" viewBox="0 0 46 46" className="celeb-svg">
    <defs>
      <radialGradient id="starGrad">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="50%" stopColor="#f9e2af" />
        <stop offset="100%" stopColor="#fab387" />
      </radialGradient>
    </defs>
    <polygon
      points="23,2 28,17 44,17 31,27 36,43 23,33 10,43 15,27 2,17 18,17"
      fill="url(#starGrad)"
      stroke="#fff5d5"
      strokeWidth="0.5"
    />
  </svg>
)
const PlanetIcon = () => (
  <svg width="54" height="54" viewBox="0 0 54 54" className="celeb-svg">
    <defs>
      <radialGradient id="planetBody" cx="38%" cy="35%" r="70%">
        <stop offset="0%" stopColor="#fab387" />
        <stop offset="60%" stopColor="#d85e3c" />
        <stop offset="100%" stopColor="#7a2e1e" />
      </radialGradient>
    </defs>
    <ellipse cx="27" cy="28" rx="21" ry="5" fill="none" stroke="#f9e2af" strokeWidth="2.5" opacity="0.5" transform="rotate(-18 27 28)" />
    <circle cx="27" cy="27" r="13" fill="url(#planetBody)" />
    <path d="M 8.3 20 a 21 5 -18 0 0 37.4 14" fill="none" stroke="#f9e2af" strokeWidth="2.5" opacity="0.95" />
  </svg>
)

// ---- SVG Tab Icons ----
const SunIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4"/>
    <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"/>
  </svg>
)
const ChartIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 4-6"/>
  </svg>
)
const GearIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

// ---- Delta badge component ----
function DeltaBadge({ val, unit, invertGood }) {
  const sign = val >= 0 ? '+' : ''
  let cls = 'neutral'
  if (invertGood) cls = val < 0 ? 'up' : val > 0 ? 'down' : 'neutral'
  else cls = val > 0 ? 'up' : val < 0 ? 'down' : 'neutral'
  return <span className={`delta-badge ${cls}`}>{sign}{val.toFixed(1)}{unit}</span>
}


// ====================================================================
// APP
// ====================================================================
const TABS = ['today', 'stats', 'settings']

function App() {
  // ---- State ----
  const [tab, setTab] = useState('today')
  const [swipeDx, setSwipeDx] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const swipeRef = useRef(null)
  const suppressClickUntil = useRef(0)
  const appRef = useRef(null)
  const [statsTab, setStatsTab] = useState('journey')
  const [date, setDate] = useState(dateKey(new Date()))
  const [entries, setEntries] = useState({})
  const [phases, setPhases] = useState([])
  const [github, setGithub] = useState({ token: '', repo: '', owner: '', connected: false })
  const [syncStatus, setSyncStatus] = useState('')
  const [lastSyncTime, setLastSyncTime] = useState(0)
  const [needsSync, setNeedsSync] = useState(false)
  const [commitsToday, setCommitsToday] = useState(null)
  const [phaseModal, setPhaseModal] = useState(null)
  const [statsPhaseIdx, setStatsPhaseIdx] = useState(-1) // -1 = current
  const [ghExpanded, setGhExpanded] = useState(false)
  const [gymWorkouts, setGymWorkouts] = useState({})
  const [habitDetail, setHabitDetail] = useState(null)
  const [celebPhase, setCelebPhase] = useState('orbit')
  const [animT, setAnimT] = useState(0)
  const syncTimeoutRef = useRef(null)
  const dateInputRef = useRef(null)
  const longPressRef = useRef(null)
  const celebRafRef = useRef(null)

  const todayKey = dateKey(new Date())
  const isToday = date === todayKey

  // ---- Orientation lock ----
  useEffect(() => {
    if (screen.orientation?.lock) {
      screen.orientation.lock('portrait').catch(() => {})
    }
    const handle = () => {
      const isLandscape = window.innerWidth > window.innerHeight
      document.body.classList.toggle('landscape-override', isLandscape)
    }
    handle()
    window.addEventListener('resize', handle)
    window.addEventListener('orientationchange', handle)
    return () => {
      window.removeEventListener('resize', handle)
      window.removeEventListener('orientationchange', handle)
    }
  }, [])

  // ---- Global tap-to-dismiss for habit detail panel ----
  useEffect(() => {
    if (!habitDetail) return
    const onDown = (e) => {
      setHabitDetail(null)
      // Swallow this tap so it doesn't toggle a planet or hit any other handler
      e.stopPropagation()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [habitDetail])

  // ---- Load from localStorage ----
  useEffect(() => {
    const savedEntries = localStorage.getItem('bodytracker_entries')
    if (savedEntries) setEntries(JSON.parse(savedEntries))
    const savedPhases = localStorage.getItem('bodytracker_phases')
    if (savedPhases) setPhases(JSON.parse(savedPhases))
    const savedGym = localStorage.getItem('bodytracker_gymworkouts')
    if (savedGym) setGymWorkouts(JSON.parse(savedGym))
    const savedLastSync = localStorage.getItem('bodytracker_lastsync')
    if (savedLastSync) setLastSyncTime(parseInt(savedLastSync))
    const savedGithub = localStorage.getItem('bodytracker_github')
    if (savedGithub) {
      const gh = JSON.parse(savedGithub)
      setGithub(gh)
      if (gh.connected) autoLoadFromGithub(gh)
    }
  }, [])

  // ---- Debounced sync ----
  useEffect(() => {
    if (needsSync && github.connected) {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
      syncTimeoutRef.current = setTimeout(() => { forceSyncToGithub() }, 5000)
    }
    return () => { if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current) }
  }, [needsSync, github.connected, entries, phases])

  // Sync when app goes to background
  useEffect(() => {
    const handleVis = () => {
      if (document.visibilityState === 'hidden' && needsSync && github.connected) {
        forceSyncToGithub()
      }
    }
    document.addEventListener('visibilitychange', handleVis)
    return () => document.removeEventListener('visibilitychange', handleVis)
  }, [needsSync, github.connected])

  // ---- GitHub sync functions (preserved from original) ----
  const autoLoadFromGithub = async (gh) => {
    try {
      const res = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/data.json`, { headers: { Authorization: `token ${gh.token}` } })
      if (res.ok) {
        const file = await res.json()
        const remoteData = JSON.parse(decodeURIComponent(escape(atob(file.content))))
        const localEntries = JSON.parse(localStorage.getItem('bodytracker_entries') || '{}')
        const localPhases = JSON.parse(localStorage.getItem('bodytracker_phases') || '[]')
        const localDates = Object.keys(localEntries)
        const remoteDates = Object.keys(remoteData.entries || {})
        const localHasMore = localDates.some(d => !remoteDates.includes(d) ||
          JSON.stringify(localEntries[d]) !== JSON.stringify(remoteData.entries[d]))
        if (localHasMore) {
          const mergedEntries = { ...remoteData.entries, ...localEntries }
          const mergedPhases = localPhases.length > (remoteData.phases?.length || 0) ? localPhases : remoteData.phases
          setEntries(mergedEntries)
          setPhases(mergedPhases || [])
          localStorage.setItem('bodytracker_entries', JSON.stringify(mergedEntries))
          localStorage.setItem('bodytracker_phases', JSON.stringify(mergedPhases || []))
          await syncToGithub(mergedEntries, mergedPhases || [], true)
        } else {
          setEntries(remoteData.entries || {})
          localStorage.setItem('bodytracker_entries', JSON.stringify(remoteData.entries || {}))
          if (remoteData.phases) {
            setPhases(remoteData.phases)
            localStorage.setItem('bodytracker_phases', JSON.stringify(remoteData.phases))
          }
        }
        setLastSyncTime(Date.now())
        localStorage.setItem('bodytracker_lastsync', Date.now().toString())
      }
      // Also pull gym.json so auto-tracked habits (push/pull/rehab) reflect gym-tracker state
      try {
        const gymRes = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/gym.json`, { headers: { Authorization: `token ${gh.token}` } })
        if (gymRes.ok) {
          const f = await gymRes.json()
          const gymData = JSON.parse(decodeURIComponent(escape(atob(f.content))))
          setGymWorkouts(gymData.workouts || {})
          localStorage.setItem('bodytracker_gymworkouts', JSON.stringify(gymData.workouts || {}))
        }
      } catch { /* gym.json optional */ }
    } catch (e) { console.error('Auto-load failed:', e) }
  }

  const syncToGithub = async (data, phasesData, force = false) => {
    if (!github.token || !github.repo || !github.owner) return
    if (!force) return
    try {
      setSyncStatus('Checking...')
      const apiUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/data.json`
      let sha = ''
      let remoteData = null
      try {
        const getRes = await fetch(apiUrl, { headers: { Authorization: `token ${github.token}` } })
        if (getRes.ok) {
          const file = await getRes.json()
          sha = file.sha
          remoteData = JSON.parse(decodeURIComponent(escape(atob(file.content))))
        }
      } catch { /* ignore */ }
      const localPayload = JSON.stringify({ entries: data, phases: phasesData })
      const remotePayload = remoteData ? JSON.stringify({ entries: remoteData.entries, phases: remoteData.phases }) : null
      if (localPayload === remotePayload) {
        setSyncStatus('No changes')
        setTimeout(() => setSyncStatus(''), 1500)
        setNeedsSync(false)
        return
      }
      setSyncStatus('Syncing...')
      const content = btoa(unescape(encodeURIComponent(JSON.stringify({ entries: data, phases: phasesData }, null, 2))))
      await fetch(apiUrl, {
        method: 'PUT',
        headers: { Authorization: `token ${github.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Update ${new Date().toISOString()}`, content, ...(sha && { sha }) })
      })
      setLastSyncTime(Date.now())
      localStorage.setItem('bodytracker_lastsync', Date.now().toString())
      setNeedsSync(false)
      setSyncStatus('Synced!')
      setTimeout(() => setSyncStatus(''), 2000)
    } catch { setSyncStatus('Sync failed'); setTimeout(() => setSyncStatus(''), 3000) }
  }

  const forceSyncToGithub = async () => {
    if (!github.connected) return
    const currentEntries = JSON.parse(localStorage.getItem('bodytracker_entries') || '{}')
    const currentPhases = JSON.parse(localStorage.getItem('bodytracker_phases') || '[]')
    await syncToGithub(currentEntries, currentPhases, true)
    setNeedsSync(false)
    fetchCommitsToday()
  }

  const fetchCommitsToday = async () => {
    if (!github.connected || !github.token || !github.repo || !github.owner) return
    try {
      const today = new Date().toISOString().split('T')[0]
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
      const res = await fetch(
        `https://api.github.com/repos/${github.owner}/${github.repo}/commits?since=${today}T00:00:00Z&until=${tomorrow}T00:00:00Z&per_page=1`,
        { headers: { Authorization: `token ${github.token}` } }
      )
      if (res.ok) {
        const link = res.headers.get('Link')
        if (link) {
          const match = link.match(/&page=(\d+)>; rel="last"/)
          if (match) { setCommitsToday(parseInt(match[1])); return }
        }
        const commits = await res.json()
        setCommitsToday(commits.length)
      }
    } catch { /* ignore */ }
  }

  const connectGithub = () => {
    const newGithub = { ...github, connected: true }
    setGithub(newGithub)
    localStorage.setItem('bodytracker_github', JSON.stringify(newGithub))
  }

  const disconnectGithub = () => {
    setGithub({ token: '', repo: '', owner: '', connected: false })
    localStorage.setItem('bodytracker_github', JSON.stringify({ token: '', repo: '', owner: '', connected: false }))
  }

  // ---- Data management ----
  const saveAll = useCallback((newEntries, newPhases) => {
    localStorage.setItem('bodytracker_entries', JSON.stringify(newEntries))
    localStorage.setItem('bodytracker_phases', JSON.stringify(newPhases))
    setNeedsSync(true)
  }, [])


  const entryRecorded = !!entries[date]

  const updateEntry = useCallback((field, value) => {
    const existing = entries[date] ? ensureHabits(entries[date]) : makeEmptyEntry(entries[addDays(date, -1)])
    const newEntry = { ...existing, [field]: value }
    const newEntries = { ...entries, [date]: newEntry }
    setEntries(newEntries)
    saveAll(newEntries, phases)
  }, [entries, date, phases, saveAll])

  const updateHabit = useCallback((habitKey, value) => {
    const existing = entries[date] ? ensureHabits(entries[date]) : makeEmptyEntry(entries[addDays(date, -1)])
    const newEntry = { ...existing, habits: { ...existing.habits, [habitKey]: value } }
    const newEntries = { ...entries, [date]: newEntry }
    setEntries(newEntries)
    saveAll(newEntries, phases)
  }, [entries, date, phases, saveAll])

  const adjustValue = useCallback((field, delta) => {
    const metric = METRICS.find(m => m.key === field)
    const step = metric?.step || 0.1
    const existing = entries[date] ? ensureHabits(entries[date]) : makeEmptyEntry(entries[addDays(date, -1)])
    const current = parseFloat(existing[field]) || 0
    const newVal = (current + delta * step).toFixed(step === 1 ? 0 : 1)
    updateEntry(field, newVal)
  }, [entries, date, updateEntry])

  const changeDate = useCallback((days) => {
    const newDate = addDays(date, days)
    if (newDate > todayKey) return
    setDate(newDate)
  }, [date, todayKey])

  // ---- Phase management ----
  const openAddPhase = () => {
    setPhaseModal({ name: '', goals: { weight: '', bodyFat: '', musclePct: '' } })
  }

  const savePhaseModal = () => {
    const newPhase = { id: Date.now(), name: phaseModal.name, start: date, end: '', goals: phaseModal.goals }
    const newPhases = [...phases, newPhase]
    setPhases(newPhases)
    saveAll(entries, newPhases)
    setPhaseModal(null)
  }

  const endPhase = (id) => {
    const newPhases = phases.map(p => p.id === id ? { ...p, end: date } : p)
    setPhases(newPhases)
    saveAll(entries, newPhases)
  }

  const deletePhase = (id) => {
    const newPhases = phases.filter(p => p.id !== id)
    setPhases(newPhases)
    saveAll(entries, newPhases)
  }

  // ---- Auto habits derived from gym workouts ----
  const autoHabitsByDate = useMemo(() => {
    const out = {}
    Object.entries(gymWorkouts).forEach(([d, w]) => {
      if (!w?.committed) return
      const h = {}
      if (w.routineType === 'push') h.gymPush = true
      if (w.routineType === 'pull') h.gymPull = true
      if (w.routineType === 'rest') h.rehab = true
      out[d] = h
    })
    return out
  }, [gymWorkouts])

  const readHabit = useCallback((d, key) => {
    const isAuto = ORBIT_HABITS.find(h => h.key === key)?.auto
    if (isAuto) return !!autoHabitsByDate[d]?.[key]
    const ent = entries[d] ? ensureHabits(entries[d]) : null
    return !!ent?.habits?.[key]
  }, [entries, autoHabitsByDate])

  // ---- Computed: Orbit (manual only — auto habits are stats-only) ----
  const applicable = useMemo(() => ORBIT_HABITS.filter(h => !h.auto && habitApplies(h, date, entries)), [date, entries])

  const orbitFraction = useMemo(() => {
    const done = applicable.filter(h => readHabit(date, h.key)).length
    return { done, total: applicable.length }
  }, [date, applicable, readHabit])

  const allDone = orbitFraction.total > 0 && orbitFraction.done === orbitFraction.total

  // Reset celebration when the day's completion state changes
  useEffect(() => {
    if (!allDone) setCelebPhase('orbit')
  }, [allDone, date])

  // RAF loop for swallow / eject animations
  useEffect(() => {
    if (celebPhase !== 'swallow' && celebPhase !== 'eject') return
    const start = performance.now()
    const duration = celebPhase === 'swallow' ? 1600 : 900
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration)
      setAnimT(t)
      if (t < 1) {
        celebRafRef.current = requestAnimationFrame(step)
      } else {
        setCelebPhase(prev => prev === 'swallow' ? 'hidden' : 'orbit')
        setAnimT(0)
      }
    }
    celebRafRef.current = requestAnimationFrame(step)
    return () => { if (celebRafRef.current) cancelAnimationFrame(celebRafRef.current) }
  }, [celebPhase])

  const handleCenterClick = () => {
    if (!allDone) return
    if (celebPhase === 'orbit') setCelebPhase('swallow')
    else if (celebPhase === 'hidden') setCelebPhase('eject')
  }

  // ---- Computed: sorted dates ----
  const sortedDates = useMemo(() => Object.keys(entries).sort(), [entries])

  // ---- Computed: Trails (21-day) ----
  const trailsData = useMemo(() => {
    return ORBIT_HABITS.map(h => {
      const dots = []
      for (let i = 20; i >= 0; i--) {
        const d = addDays(todayKey, -i)
        const isTodayDot = i === 0
        const appl = habitApplies(h, d, entries)
        let val = null
        if (appl) {
          if (h.auto) val = !!autoHabitsByDate[d]?.[h.key]
          else {
            const ent = entries[d] ? ensureHabits(entries[d]) : null
            val = ent ? !!ent.habits?.[h.key] : null
          }
        }
        let cls = 'dot'
        if (!appl || val === null || val === undefined) cls += ' na'
        else {
          if (val) cls += ' done'
          else cls += ' miss'
          if (isTodayDot) cls += ' today-dot ' + (val ? 'done' : 'pending')
        }
        dots.push({ cls, color: h.color })
      }
      return { ...h, dots }
    })
  }, [entries, todayKey, autoHabitsByDate])

  // ---- Computed: habit compliance (all time) ----
  const habitScores = useMemo(() => {
    return ORBIT_HABITS.map(h => {
      let done = 0, total = 0
      sortedDates.forEach(k => {
        if (!habitApplies(h, k, entries)) return
        const v = h.auto ? !!autoHabitsByDate[k]?.[h.key] : !!ensureHabits(entries[k]).habits?.[h.key]
        total++
        if (v) done++
      })
      const pct = total > 0 ? done / total : 0
      return { ...h, pct, done, total }
    })
  }, [entries, sortedDates, autoHabitsByDate])

  // ---- Display value helper ----
  const getDisplayValue = (field) => {
    if (entries[date]?.[field]) return entries[date][field]
    if (!entryRecorded) {
      const yest = entries[addDays(date, -1)]
      if (yest?.[field]) return yest[field]
    }
    return ''
  }
  const isYesterdayValue = (field) => !entryRecorded && !entries[date]?.[field] && entries[addDays(date, -1)]?.[field]


  // ---- Swipe nav between tabs ----
  const SWIPE_THRESHOLD = 60
  const FLICK_MS = 250
  const FLICK_DX = 40
  const onSwipeTouchStart = (e) => {
    if (e.touches.length !== 1) { swipeRef.current = null; return }
    const t = e.target
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], .no-swipe')) {
      swipeRef.current = null
      return
    }
    const flickOnly = !!(t && t.closest && t.closest('svg, canvas, .flick-only'))
    swipeRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      t0: Date.now(),
      locked: null,
      active: false,
      flickOnly,
    }
  }
  const GRAPH_HOLD_MS = 150
  const onSwipeTouchMove = (e) => {
    const s = swipeRef.current
    if (!s) return
    const dx = e.touches[0].clientX - s.x
    const dy = e.touches[0].clientY - s.y
    if (s.locked == null) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
      s.locked = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v'
      if (s.locked === 'h' && s.flickOnly && Date.now() - s.t0 < GRAPH_HOLD_MS) {
        s.scrubLocked = true
      }
    }
    if (s.locked !== 'h' || s.scrubLocked) return
    const idx = TABS.indexOf(tab)
    let adj = dx
    if ((idx === 0 && dx > 0) || (idx === TABS.length - 1 && dx < 0)) adj = dx * 0.25
    s.active = true
    setSwipeDx(adj)
    setIsSwiping(true)
  }
  const onSwipeTouchEnd = () => {
    const s = swipeRef.current
    swipeRef.current = null
    if (!s) { setSwipeDx(0); setIsSwiping(false); return }
    const dt = Date.now() - s.t0
    const dx = swipeDx
    const idx = TABS.indexOf(tab)
    const flick = dt < FLICK_MS && Math.abs(dx) > FLICK_DX
    const commit = s.scrubLocked ? false : (s.flickOnly ? flick : (Math.abs(dx) >= SWIPE_THRESHOLD || flick))
    if (commit && dx < 0 && idx < TABS.length - 1) {
      suppressClickUntil.current = Date.now() + 400
      setTab(TABS[idx + 1])
    } else if (commit && dx > 0 && idx > 0) {
      suppressClickUntil.current = Date.now() + 400
      setTab(TABS[idx - 1])
    }
    setSwipeDx(0)
    setIsSwiping(false)
  }
  const GLOW_RANGE_PX = 100
  const getTabGlow = (tabId) => {
    const activeIdx = TABS.indexOf(tab)
    const i = TABS.indexOf(tabId)
    if (!isSwiping) return i === activeIdx ? 1 : 0
    const progress = Math.min(1, Math.abs(swipeDx) / GLOW_RANGE_PX)
    const targetIdx = swipeDx < 0 ? activeIdx + 1 : swipeDx > 0 ? activeIdx - 1 : activeIdx
    if (i === activeIdx) return 1 - progress
    if (i === targetIdx && targetIdx >= 0 && targetIdx < TABS.length) return progress
    return 0
  }
  const tabCls = (tabId) => `${tab === tabId ? 'active' : ''}${isSwiping ? ' swiping' : ''}`
  const tabStl = (tabId) => ({ '--glow': getTabGlow(tabId) })
  const onSwipeClickCapture = (e) => {
    if (Date.now() < suppressClickUntil.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  // Non-passive touchmove: block browser scroll while horizontal swipe is active
  useEffect(() => {
    const el = appRef.current
    if (!el) return
    const block = (e) => {
      if (swipeRef.current?.locked === 'h') e.preventDefault()
    }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [])

  // =====================================================
  // RENDER
  // =====================================================
  return (
    <div
      ref={appRef}
      className="app"
      onTouchStart={onSwipeTouchStart}
      onTouchMove={onSwipeTouchMove}
      onTouchEnd={onSwipeTouchEnd}
      onTouchCancel={onSwipeTouchEnd}
      onClickCapture={onSwipeClickCapture}
    >
      <main className="content" key={tab}>

        {/* ==================== TODAY TAB ==================== */}
        {tab === 'today' && (
          <>
            {/* Date picker */}
            <div className="log-header">
              <button onClick={() => changeDate(-1)}>{'\u2039'}</button>
              <span className="log-date" onClick={() => dateInputRef.current?.showPicker()}>
                {formatDateLabel(date)}
              </span>
              <input
                type="date"
                ref={dateInputRef}
                value={date}
                max={todayKey}
                onChange={(e) => { if (e.target.value && e.target.value <= todayKey) setDate(e.target.value) }}
              />
              <button onClick={() => changeDate(1)} disabled={isToday}>{'\u203A'}</button>
            </div>

            {/* Orbit */}
            <div className="orbit-wrap">
              <div className="orbit">
                <div className="orbit-ring"></div>
                <div className="orbit-ring r2"></div>
                <div
                  className={`orbit-center ${allDone ? 'celebrating' : ''} ${celebPhase}`}
                  onClick={handleCenterClick}
                  style={{ cursor: allDone ? 'pointer' : 'default' }}
                >
                  {allDone ? (
                    <div className="celebration-icon"><BlackHoleIcon /></div>
                  ) : (
                    <>
                      <div className="frac">
                        <span>{orbitFraction.done}</span>
                        <span className="denom">/<span>{orbitFraction.total}</span></span>
                      </div>
                      <div className="lbl">in orbit</div>
                    </>
                  )}
                </div>

                {/* Manual planets around the ring */}
                {applicable.map((h, i) => {
                  const N = applicable.length
                  const baseAngle = -Math.PI/2 + (i / N) * Math.PI * 2

                  let angle = baseAngle, rMult = 1, opacity = 1, scale = 1, hidden = false
                  if (celebPhase === 'hidden') hidden = true
                  else if (celebPhase === 'swallow') {
                    const t = animT
                    angle = baseAngle + t * t * Math.PI * 8
                    if (t < 0.45) rMult = 1 + (t / 0.45) * 0.35
                    else { const t2 = (t - 0.45) / 0.55; rMult = Math.max(0, 1.35 * (1 - t2 * t2)) }
                    const fadeT = Math.max(0, (t - 0.55) / 0.45)
                    opacity = 1 - fadeT * fadeT
                    scale = 1 - fadeT * 0.6
                  } else if (celebPhase === 'eject') {
                    const t = animT
                    const eased = 1 - Math.pow(1 - t, 3)
                    rMult = eased
                    opacity = Math.min(1, t * 2)
                    scale = 0.3 + 0.7 * eased
                  }
                  const orbitR = 110 * rMult
                  const x = 140 + Math.cos(angle) * orbitR
                  const y = 140 + Math.sin(angle) * orbitR
                  const isDone = readHabit(date, h.key)
                  const pressStart = () => {
                    if (celebPhase !== 'orbit') return
                    if (longPressRef.current) clearTimeout(longPressRef.current)
                    longPressRef.current = setTimeout(() => {
                      setHabitDetail(h)
                      longPressRef.current = null
                    }, 1000)
                  }
                  const pressEnd = () => {
                    if (celebPhase !== 'orbit') return
                    if (longPressRef.current) {
                      clearTimeout(longPressRef.current)
                      longPressRef.current = null
                      updateHabit(h.key, !isDone)
                    }
                  }
                  const pressCancel = () => {
                    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
                  }
                  if (hidden) return null
                  return (
                    <div
                      key={h.key}
                      className={`planet ${isDone ? 'done' : 'pending'}`}
                      style={{
                        '--c': h.color,
                        left: x + 'px',
                        top: y + 'px',
                        opacity,
                        transform: `translate(-50%, -50%) scale(${scale})`,
                        transition: celebPhase === 'orbit' ? undefined : 'none',
                        pointerEvents: celebPhase === 'orbit' ? 'auto' : 'none'
                      }}
                      onPointerDown={pressStart}
                      onPointerUp={pressEnd}
                      onPointerLeave={pressCancel}
                      onPointerCancel={pressCancel}
                    >
                      <div className="p-icon">{h.icon}</div>
                      <div className="p-name">{h.name}</div>
                    </div>
                  )
                })}

              </div>
            </div>

            {/* Measurements */}
            <div className="log-section-title">Measurements</div>
            <div className="log-metrics">
              {METRICS.map(m => (
                <div key={m.key} className="log-metric">
                  <div className="lm-label">{m.label} {m.unit && `(${m.unit})`}</div>
                  <div className="lm-row">
                    <button className="lm-btn" onClick={() => adjustValue(m.key, -1)}>-</button>
                    <div className={`lm-val ${isYesterdayValue(m.key) ? 'yesterday' : ''}`} style={{ color: m.color }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={getDisplayValue(m.key)}
                        placeholder="--"
                        style={{ color: isYesterdayValue(m.key) ? '#6c7086' : m.color }}
                        onChange={(e) => updateEntry(m.key, e.target.value)}
                      />
                    </div>
                    <button className="lm-btn" onClick={() => adjustValue(m.key, 1)}>+</button>
                  </div>
                </div>
              ))}
            </div>


            {syncStatus && <div className="sync-status">{syncStatus}</div>}
          </>
        )}

        {/* ==================== STATS TAB ==================== */}
        {tab === 'stats' && (
          <>
            <div className="stats-nav">
              {['journey', 'phase', 'habits'].map(t => (
                <button key={t} className={statsTab === t ? 'active' : ''} onClick={() => setStatsTab(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {statsTab === 'journey' && <JourneyPanel entries={entries} phases={phases} sortedDates={sortedDates} />}
            {statsTab === 'phase' && <PhasePanel entries={entries} phases={phases} sortedDates={sortedDates} statsPhaseIdx={statsPhaseIdx} setStatsPhaseIdx={setStatsPhaseIdx} />}
            {statsTab === 'habits' && <HabitsPanel trailsData={trailsData} habitScores={habitScores} entries={entries} phases={phases} sortedDates={sortedDates} />}
          </>
        )}

        {/* ==================== SETTINGS TAB ==================== */}
        {tab === 'settings' && (
          <>
            <div className="settings-h">Settings</div>

            <div className="settings-section">Phases</div>
            {phases.map(p => {
              const isCurrent = !p.end
              return (
                <div key={p.id} className={`phase-card ${isCurrent ? 'current' : ''}`}>
                  <div className="pc-name">{p.name}</div>
                  <div className="pc-dates">{p.start} {'\u2192'} {p.end || 'ongoing'}</div>
                  {p.goals && <div className="pc-goals">Goal: {p.goals.weight && `${p.goals.weight}kg`} {p.goals.bodyFat && `${p.goals.bodyFat}% BF`} {p.goals.musclePct && `${p.goals.musclePct}% Mu`}</div>}
                  {isCurrent && <div className="pc-badge">Current</div>}
                  <div className="pc-actions">
                    {isCurrent && <button onClick={() => endPhase(p.id)}>End</button>}
                    <button className="del" onClick={() => deletePhase(p.id)}>{'\u00D7'}</button>
                  </div>
                </div>
              )
            })}
            {phases.length === 0 && <div style={{ color: '#45475a', fontSize: 12, padding: '8px 0' }}>No phases yet</div>}
            <button className="add-phase-btn" onClick={openAddPhase}>+ Add Phase</button>

            {/* Current phase summary */}
            <SettingsPhaseSummary entries={entries} phases={phases} sortedDates={sortedDates} />

            <div className="settings-section">Data</div>

            {/* GitHub Sync */}
            <div className="settings-row" onClick={() => setGhExpanded(!ghExpanded)}>
              <div className="sr-left">
                <span className="sr-icon">{'\u{E0A0}'}</span>
                <span className="sr-label">GitHub Sync</span>
              </div>
              <span className="sr-arrow">{ghExpanded ? '\u2039' : '\u203A'}</span>
            </div>

            {ghExpanded && (
              <div className="gh-form">
                {!github.connected ? (
                  <>
                    <div className="field">
                      <label>Token</label>
                      <input type="password" value={github.token} onChange={(e) => setGithub({...github, token: e.target.value})} placeholder="ghp_..." />
                    </div>
                    <div className="field">
                      <label>Owner</label>
                      <input value={github.owner} onChange={(e) => setGithub({...github, owner: e.target.value})} placeholder="username" />
                    </div>
                    <div className="field">
                      <label>Repo</label>
                      <input value={github.repo} onChange={(e) => setGithub({...github, repo: e.target.value})} placeholder="repo-name" />
                    </div>
                    <button className="primary-btn" onClick={connectGithub}>Connect</button>
                  </>
                ) : (
                  <>
                    <div className="connected-info">Connected to {github.owner}/{github.repo}</div>
                    <div className="sync-stats">
                      {lastSyncTime > 0 && <p className="sync-note">Last sync: {new Date(lastSyncTime).toLocaleTimeString()}</p>}
                      <p className="sync-note">Commits today: {commitsToday !== null ? commitsToday : '...'}</p>
                    </div>
                    <button className="primary-btn" onClick={forceSyncToGithub} disabled={!needsSync}>
                      {needsSync ? 'Sync Now' : 'Up to date'}
                    </button>
                    <button className="danger-btn" onClick={() => {
                      if (confirm('Disconnect from GitHub? Local data will be preserved.')) disconnectGithub()
                    }}>Disconnect</button>
                  </>
                )}
                {syncStatus && <div className="sync-status" style={{ marginTop: 8 }}>{syncStatus}</div>}
              </div>
            )}

            <button className="primary-btn" style={{ marginTop: 12 }} onClick={async () => {
              if (needsSync && github.connected) {
                setSyncStatus('Syncing before reload...')
                await forceSyncToGithub()
              }
              window.location.reload()
            }}>Reload App</button>
            {needsSync && <p style={{ fontSize: 11, color: '#6c7086', marginTop: 8 }}>Changes pending sync</p>}
            <p className="version-text">v0.3.0</p>
          </>
        )}
      </main>

      {/* ---- Habit detail panel (long-press) ---- */}
      {habitDetail && (
        <div className="habit-detail" style={{ '--c': habitDetail.color }}>
          <div className="hd-title">
            <span className="hd-icon">{habitDetail.icon}</span>
            <span>{habitDetail.name}</span>
          </div>
          {(habitDetail.details || []).map((line, i) => (
            <div key={i} className="hd-line">{line}</div>
          ))}
        </div>
      )}

      {/* ---- Tab bar ---- */}
      <nav className="tabbar">
        <button className={tabCls('today')} style={tabStl('today')} onClick={() => setTab('today')}>
          <span className="glyph"><SunIcon /></span>
        </button>
        <button className={tabCls('stats')} style={tabStl('stats')} onClick={() => setTab('stats')}>
          <span className="glyph"><ChartIcon /></span>
        </button>
        <button className={tabCls('settings')} style={tabStl('settings')} onClick={() => { setTab('settings'); fetchCommitsToday() }}>
          <span className="glyph"><GearIcon /></span>
        </button>
      </nav>

      {/* ---- Phase Modal ---- */}
      {phaseModal && (
        <div className="modal-overlay" onClick={() => setPhaseModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Phase</h3>
            <div className="field">
              <label>Name</label>
              <input value={phaseModal.name} onChange={(e) => setPhaseModal({...phaseModal, name: e.target.value})} placeholder="Cut, Bulk, Maintain..." />
            </div>
            <div className="field">
              <label>Goal Weight (kg)</label>
              <input type="text" inputMode="decimal" value={phaseModal.goals.weight} onChange={(e) => setPhaseModal({...phaseModal, goals: {...phaseModal.goals, weight: e.target.value}})} placeholder="75" />
            </div>
            <div className="field">
              <label>Goal Body Fat %</label>
              <input type="text" inputMode="decimal" value={phaseModal.goals.bodyFat} onChange={(e) => setPhaseModal({...phaseModal, goals: {...phaseModal.goals, bodyFat: e.target.value}})} placeholder="15" />
            </div>
            <div className="field">
              <label>Goal Muscle %</label>
              <input type="text" inputMode="decimal" value={phaseModal.goals.musclePct} onChange={(e) => setPhaseModal({...phaseModal, goals: {...phaseModal.goals, musclePct: e.target.value}})} placeholder="40" />
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setPhaseModal(null)}>Cancel</button>
              <button className="primary-btn" style={{ marginTop: 0 }} onClick={savePhaseModal}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ====================================================================
// SCRUBBABLE LINE — touch/swipe highlights nearest point, shows val + date
// ====================================================================
function ScrubbableLine({ data, options, width, height, style, renderHead }) {
  const chartRef = useRef(null)
  const wrapRef = useRef(null)
  const selRef = useRef(null)
  const [sel, setSel] = useState(null)

  const clearSel = () => {
    if (selRef.current == null) return
    selRef.current = null
    setSel(null)
    chartRef.current?.update('none')
  }

  useEffect(() => {
    const onDocDown = (e) => {
      if (selRef.current == null) return
      if (wrapRef.current && !wrapRef.current.contains(e.target)) clearSel()
    }
    document.addEventListener('pointerdown', onDocDown)
    return () => document.removeEventListener('pointerdown', onDocDown)
  }, [])

  const pickIdx = (clientX) => {
    const chart = chartRef.current
    if (!chart) return null
    const rect = chart.canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const scale = chart.scales.x
    if (!scale) return null
    const n = chart.data.labels.length
    let best = 0, bestDist = Infinity
    for (let i = 0; i < n; i++) {
      const px = scale.getPixelForValue(i)
      const d = Math.abs(px - x)
      if (d < bestDist) { bestDist = d; best = i }
    }
    return best
  }

  const updateSel = (idx) => {
    if (idx == null || idx === selRef.current) return
    selRef.current = idx
    setSel(idx)
    chartRef.current?.update('none')
  }

  const onTouchStart = (e) => {
    const t = e.touches?.[0]
    if (t) updateSel(pickIdx(t.clientX))
  }
  const onTouchMove = (e) => {
    const t = e.touches?.[0]
    if (!t) return
    e.preventDefault()
    updateSel(pickIdx(t.clientX))
  }

  const scrubPlugin = useMemo(() => ({
    id: 'scrub',
    afterDatasetsDraw(chart) {
      const idx = selRef.current
      if (idx == null) return
      const { ctx, chartArea, scales } = chart
      const x = scales.x.getPixelForValue(idx)
      ctx.save()
      ctx.strokeStyle = 'rgba(137, 180, 250, 0.55)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(x, chartArea.top)
      ctx.lineTo(x, chartArea.bottom)
      ctx.stroke()
      ctx.setLineDash([])
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i)
        const pt = meta.data[idx]
        if (!pt) return
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2)
        ctx.fillStyle = ds.borderColor
        ctx.fill()
        ctx.strokeStyle = '#1e1e2e'
        ctx.lineWidth = 2
        ctx.stroke()
      })
      ctx.restore()
    }
  }), [])

  return (
    <>
      {renderHead(sel)}
      <div
        ref={wrapRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        style={{ touchAction: 'pan-y' }}
      >
        <Line
          ref={chartRef}
          data={data}
          options={options}
          width={width}
          height={height}
          style={style}
          plugins={[scrubPlugin]}
        />
      </div>
    </>
  )
}


// ====================================================================
// JOURNEY PANEL
// ====================================================================
function WeightTrendChart({ keys, entries, opts }) {
  const series = weightAvgDeltaSeries(keys, entries)
  const hasData = series.some(v => v != null)
  if (!hasData) return null
  const canvasW = 337
  const labels = keys.map(k => k.slice(5))
  const pickLast = (arr) => { for (let j = arr.length - 1; j >= 0; j--) if (arr[j] != null) return j; return arr.length - 1 }
  const absMax = Math.max(1, ...series.filter(v => v != null).map(v => Math.abs(v)))
  const boundedOpts = { ...opts, scales: { ...(opts.scales || {}), y: { ...((opts.scales && opts.scales.y) || {}), min: -absMax, max: absMax } } }
  return (
    <div className="chart-card">
      <ScrubbableLine
        data={{
          labels,
          datasets: [
            { data: series, borderColor: '#89b4fa', backgroundColor: hexToRgba('#89b4fa', 0.15), fill: true },
            { data: series.map(() => 0), borderColor: '#45475a', borderDash: [4, 4], borderWidth: 1, fill: false, pointRadius: 0 },
          ]
        }}
        options={boundedOpts}
        width={canvasW} height={120}
        style={{ width: canvasW, height: 120 }}
        renderHead={(idx) => {
          const i = idx ?? pickLast(series)
          const v = series[i]
          const sign = v == null ? '' : (v >= 0 ? '+' : '')
          return <div className="card-head">7 Day Weight Delta <span className="v">{v != null ? `${sign}${v.toFixed(2)} kg` : '--'} {idx != null && <span className="d">{keys[i]}</span>}</span></div>
        }}
      />
    </div>
  )
}

function JourneyPanel({ entries, phases, sortedDates: allDates }) {
  const firstPhaseStart = phases.length > 0 ? phases.map(p => p.start).sort()[0] : null
  const sortedDates = firstPhaseStart ? allDates.filter(d => d >= firstPhaseStart) : allDates
  if (sortedDates.length === 0) return <div style={{ color: '#45475a', textAlign: 'center', padding: 40 }}>No data yet</div>

  const firstKey = sortedDates[0]
  const lastKey = sortedDates[sortedDates.length - 1]
  const firstE = ensureHabits(entries[firstKey])
  const lastE = ensureHabits(entries[lastKey])
  const totalDays = sortedDates.length

  const firstW = parseFloat(firstE.weight) || 0
  const lastW = parseFloat(lastE.weight) || 0
  const firstBf = parseFloat(firstE.bodyFat) || 0
  const lastBf = parseFloat(lastE.bodyFat) || 0
  const firstMu = parseFloat(firstE.musclePct) || 0
  const lastMu = parseFloat(lastE.musclePct) || 0

  const phaseBands = buildPhaseBands(sortedDates, phases)
  const labels = sortedDates.map(k => k.slice(5))
  const wts = sortedDates.map(k => parseFloat(entries[k]?.weight) || null)
  const bfs = sortedDates.map(k => parseFloat(entries[k]?.bodyFat) || null)
  const mus = sortedDates.map(k => parseFloat(entries[k]?.musclePct) || null)
  const vis = sortedDates.map(k => parseFloat(entries[k]?.visceralFat) || null)
  const fatMass = sortedDates.map(k => {
    const w = parseFloat(entries[k]?.weight), bf = parseFloat(entries[k]?.bodyFat)
    return (!isNaN(w) && !isNaN(bf)) ? +(w * bf / 100).toFixed(2) : null
  })
  const muMass = sortedDates.map(k => {
    const w = parseFloat(entries[k]?.weight), mu = parseFloat(entries[k]?.musclePct)
    return (!isNaN(w) && !isNaN(mu)) ? +(w * mu / 100).toFixed(2) : null
  })

  const canvasW = 337
  const makeData = (vals, color) => ({
    labels,
    datasets: [{ data: vals, borderColor: color, backgroundColor: hexToRgba(color, 0.12), fill: true }]
  })
  const journeyOpts = (extraScales) => baseChartOpts(extraScales, phaseBands, sortedDates)

  return (
    <>
      <div className="journey-total">
        <div className="jt-days">{totalDays}</div>
        <div className="jt-right">
          <div className="jt-label">Days tracked</div>
          <div className="jt-sub">{firstKey} to {lastKey} / {phases.length} phases</div>
        </div>
      </div>

      <div className="hero-metrics">
        <div className="hero-card" style={{ '--accent': '#f38ba8' }}>
          <div className="hero-val">{lastW.toFixed(1)}</div>
          <div className="hero-label">Weight kg</div>
          <div className="hero-delta"><DeltaBadge val={lastW - firstW} unit="kg" invertGood={true} /></div>
        </div>
        <div className="hero-card" style={{ '--accent': '#fab387' }}>
          <div className="hero-val">{lastBf.toFixed(1)}</div>
          <div className="hero-label">Body Fat %</div>
          <div className="hero-delta"><DeltaBadge val={lastBf - firstBf} unit="%" invertGood={true} /></div>
        </div>
        <div className="hero-card" style={{ '--accent': '#a6e3a1' }}>
          <div className="hero-val">{lastMu.toFixed(1)}</div>
          <div className="hero-label">Muscle %</div>
          <div className="hero-delta"><DeltaBadge val={lastMu - firstMu} unit="%" invertGood={false} /></div>
        </div>
      </div>

      <div className="stat-section-title">Weight trajectory</div>
      <div className="chart-card">
        <ScrubbableLine
          data={makeData(wts, '#f38ba8', 140)}
          options={journeyOpts()}
          width={canvasW} height={140}
          style={{ width: canvasW, height: 140 }}
          renderHead={(idx) => {
            const i = idx ?? wts.map((v,j)=>v!=null?j:-1).filter(j=>j>=0).pop() ?? sortedDates.length - 1
            const v = wts[i]
            return <div className="card-head">Weight <span className="v">{v != null ? v.toFixed(1) : '--'} kg {idx != null && <span className="d">{sortedDates[i]}</span>}</span></div>
          }}
        />
      </div>
      <div className="stat-section-title">7 Day Weight Delta</div>
      <WeightTrendChart keys={sortedDates} entries={entries} opts={journeyOpts()} />

      <div className="stat-section-title">Body composition</div>
      <div className="chart-card">
        <ScrubbableLine
          data={{
            labels,
            datasets: [
              { data: fatMass, borderColor: '#fab387', backgroundColor: hexToRgba('#fab387', 0.1), fill: true, yAxisID: 'y' },
              { data: muMass, borderColor: '#a6e3a1', backgroundColor: hexToRgba('#a6e3a1', 0.1), fill: true, yAxisID: 'y2' },
            ]
          }}
          options={(() => {
            const fv = fatMass.filter(v => v !== null), mv = muMass.filter(v => v !== null)
            const fMin = Math.min(...fv), fMax = Math.max(...fv)
            const mMin = Math.min(...mv), mMax = Math.max(...mv)
            const range = Math.max(fMax - fMin, mMax - mMin, 2)
            const pad = range * 0.15
            const fCenter = (fMin + fMax) / 2, mCenter = (mMin + mMax) / 2
            return journeyOpts({
              y:  { position: 'left',  min: fCenter - range/2 - pad, max: fCenter + range/2 + pad, ticks: { color: '#fab387', font: { size: 9 } }, grid: { color: '#313244' } },
              y2: { position: 'right', min: mCenter - range/2 - pad, max: mCenter + range/2 + pad, ticks: { color: '#a6e3a1', font: { size: 9 } }, grid: { display: false } },
            })
          })()}
          width={canvasW} height={140}
          style={{ width: canvasW, height: 140 }}
          renderHead={(idx) => {
            const pickLast = (arr) => { for (let j = arr.length - 1; j >= 0; j--) if (arr[j] != null) return j; return arr.length - 1 }
            const i = idx ?? pickLast(fatMass)
            const f = fatMass[i], m = muMass[i]
            return <div className="card-head">Fat vs Lean (kg) <span className="v">{f != null ? f.toFixed(1) : '--'} / {m != null ? m.toFixed(1) : '--'} {idx != null && <span className="d">{sortedDates[i]}</span>}</span></div>
          }}
        />
      </div>

      <div className="chart-card">
        <ScrubbableLine
          data={makeData(bfs, '#fab387', 120)}
          options={journeyOpts()}
          width={canvasW} height={120}
          style={{ width: canvasW, height: 120 }}
          renderHead={(idx) => {
            const pickLast = (arr) => { for (let j = arr.length - 1; j >= 0; j--) if (arr[j] != null) return j; return arr.length - 1 }
            const i = idx ?? pickLast(bfs)
            const v = bfs[i]
            return <div className="card-head">Body Fat % <span className="v">{v != null ? v.toFixed(1) : '--'}% {idx != null && <span className="d">{sortedDates[i]}</span>}</span></div>
          }}
        />
      </div>
      <div className="chart-card">
        <ScrubbableLine
          data={makeData(mus, '#a6e3a1', 120)}
          options={journeyOpts()}
          width={canvasW} height={120}
          style={{ width: canvasW, height: 120 }}
          renderHead={(idx) => {
            const pickLast = (arr) => { for (let j = arr.length - 1; j >= 0; j--) if (arr[j] != null) return j; return arr.length - 1 }
            const i = idx ?? pickLast(mus)
            const v = mus[i]
            return <div className="card-head">Muscle % <span className="v">{v != null ? v.toFixed(1) : '--'}% {idx != null && <span className="d">{sortedDates[i]}</span>}</span></div>
          }}
        />
      </div>
      <div className="chart-card">
        <ScrubbableLine
          data={makeData(vis, '#cba6f7', 90)}
          options={{
            ...journeyOpts(),
            scales: { x: { display: false }, y: { ticks: { color: '#6c7086', font: { size: 9 }, stepSize: 1 }, grid: { color: '#313244' }, suggestedMin: 0, suggestedMax: 8 } }
          }}
          width={canvasW} height={90}
          style={{ width: canvasW, height: 90 }}
          renderHead={(idx) => {
            const pickLast = (arr) => { for (let j = arr.length - 1; j >= 0; j--) if (arr[j] != null) return j; return arr.length - 1 }
            const i = idx ?? pickLast(vis)
            const v = vis[i]
            return <div className="card-head">Visceral Fat <span className="v">{v ?? '--'} {idx != null && <span className="d">{sortedDates[i]}</span>}</span></div>
          }}
        />
      </div>
      <MeasurementsTable entries={entries} dates={sortedDates} />
    </>
  )
}


// ====================================================================
// PHASE PANEL
// ====================================================================
function PhasePanel({ entries, phases, sortedDates, statsPhaseIdx, setStatsPhaseIdx }) {
  if (phases.length === 0) return <div style={{ color: '#45475a', textAlign: 'center', padding: 40 }}>No phases yet</div>

  // Default to current phase
  const currentIdx = phases.findIndex(p => !p.end)
  const selectedIdx = statsPhaseIdx >= 0 && statsPhaseIdx < phases.length ? statsPhaseIdx : (currentIdx >= 0 ? currentIdx : phases.length - 1)
  const p = phases[selectedIdx]
  if (!p) return null

  const phaseKeys = sortedDates.filter(k => k >= p.start && (!p.end || k <= p.end))
  if (phaseKeys.length < 2) return (
    <>
      <div className="phase-picker">
        <select value={selectedIdx} onChange={(e) => setStatsPhaseIdx(+e.target.value)}>
          {phases.map((ph, i) => (
            <option key={ph.id} value={i}>{ph.name} ({ph.start} to {ph.end || 'now'}){!ph.end ? ' - current' : ''}</option>
          ))}
        </select>
      </div>
      <div style={{ color: '#45475a', textAlign: 'center', padding: 40 }}>Not enough data for this phase</div>
    </>
  )

  const first = ensureHabits(entries[phaseKeys[0]])
  const last = ensureHabits(entries[phaseKeys[phaseKeys.length - 1]])
  const days = phaseKeys.length
  const isOngoing = !p.end

  const fW = parseFloat(first.weight) || 0
  const lW = parseFloat(last.weight) || 0
  const fBf = parseFloat(first.bodyFat) || 0
  const lBf = parseFloat(last.bodyFat) || 0
  const fMu = parseFloat(first.musclePct) || 0
  const lMu = parseFloat(last.musclePct) || 0
  const fVi = parseFloat(first.visceralFat) || 0
  const lVi = parseFloat(last.visceralFat) || 0

  const wtChange = lW - fW
  const bfChange = lBf - fBf
  const muChange = lMu - fMu

  const fatMassFirst = fW * fBf / 100
  const fatMassLast = lW * lBf / 100
  const lbmFirst = fW - fatMassFirst
  const lbmLast = lW - fatMassLast
  const fatMassChange = fatMassLast - fatMassFirst
  const lbmChange = lbmLast - lbmFirst

  // Grade
  function gradePhase() {
    if (!p.goals) return { grade: '--', cls: '' }
    let score = 0, count = 0
    const pairs = [
      [fW, lW, parseFloat(p.goals.weight)],
      [fBf, lBf, parseFloat(p.goals.bodyFat)],
      [fMu, lMu, parseFloat(p.goals.musclePct)],
    ]
    pairs.forEach(([start, end, goal]) => {
      const target = goal - start
      const actual = end - start
      if (!isNaN(goal) && Math.abs(target) > 0.3) {
        score += Math.min(1, Math.max(0, actual / target))
        count++
      }
    })
    const avg = count > 0 ? score / count : 0
    if (avg >= 0.9) return { grade: 'A', cls: 'A' }
    if (avg >= 0.7) return { grade: 'B', cls: 'B' }
    if (avg >= 0.5) return { grade: 'C', cls: 'C' }
    if (avg >= 0.3) return { grade: 'D', cls: 'D' }
    return { grade: 'F', cls: 'F' }
  }

  const { grade, cls: gradeCls } = gradePhase()
  const phaseColor = getPhaseColor(p.name)

  // Goal progress for ongoing phases
  function goalProgress(startVal, currentVal, goalVal) {
    const target = goalVal - startVal
    if (Math.abs(target) < 0.1) return 100
    return Math.min(100, Math.max(0, Math.round((currentVal - startVal) / target * 100)))
  }

  const labels = phaseKeys.map(k => k.slice(5))
  const canvasW = 337
  const phaseOpts = (extraScales) => baseChartOpts(extraScales, undefined, phaseKeys)
  const phaseWts = phaseKeys.map(k => parseFloat(entries[k]?.weight) || null)
  const pFatMass = phaseKeys.map(k => { const w = parseFloat(entries[k]?.weight), bf = parseFloat(entries[k]?.bodyFat); return (!isNaN(w) && !isNaN(bf)) ? +(w * bf / 100).toFixed(1) : null })
  const pMusMass = phaseKeys.map(k => { const w = parseFloat(entries[k]?.weight), mu = parseFloat(entries[k]?.musclePct); return (!isNaN(w) && !isNaN(mu)) ? +(w * mu / 100).toFixed(1) : null })
  const pBfVals = phaseKeys.map(k => parseFloat(entries[k]?.bodyFat) || null)
  const pMuVals = phaseKeys.map(k => parseFloat(entries[k]?.musclePct) || null)
  const pViVals = phaseKeys.map(k => parseFloat(entries[k]?.visceralFat) || null)
  const pickLast = (arr) => { for (let j = arr.length - 1; j >= 0; j--) if (arr[j] != null) return j; return arr.length - 1 }

  // Streaks
  const streaks = ORBIT_HABITS.map(h => {
    let streak = 0
    for (let i = phaseKeys.length - 1; i >= 0; i--) {
      const e = ensureHabits(entries[phaseKeys[i]])
      const v = e.habits?.[h.key]
      if (v === null || v === undefined) continue
      if (v) streak++; else break
    }
    return { ...h, streak }
  })

  // Work totals
  let liftCount = 0, cardioCount = 0, stretchCount = 0, caliCount = 0
  phaseKeys.forEach(k => {
    const e = ensureHabits(entries[k])
    if (e.habits?.lift) liftCount++
    if (e.habits?.cardio) cardioCount++
    if (e.habits?.stretch) stretchCount++
    if (e.habits?.calisthenics) caliCount++
  })

  return (
    <>
      <div className="phase-picker">
        <select value={selectedIdx} onChange={(e) => setStatsPhaseIdx(+e.target.value)}>
          {phases.map((ph, i) => (
            <option key={ph.id} value={i}>{ph.name} ({ph.start} to {ph.end || 'now'}){!ph.end ? ' - current' : ''}</option>
          ))}
        </select>
      </div>

      {/* Phase detail card */}
      <div className="phase-detail" style={{ '--pc': phaseColor }}>
        <div className="pd-header">
          <div className="pd-name">{p.name}</div>
          {isOngoing
            ? <div className="pd-grade in-progress">In Progress</div>
            : <div className={`pd-grade ${gradeCls}`}>{grade}</div>
          }
        </div>
        <div className="pd-dates">{days} days -- {p.start} to {p.end || 'ongoing'}{p.goals ? ` -- Goal: ${p.goals.weight || '?'}kg / ${p.goals.bodyFat || '?'}% BF / ${p.goals.musclePct || '?'}% Mu` : ''}</div>
        <div className="pd-stats">
          <div className="pd-stat">
            <div className="pd-sv" style={{ color: '#f38ba8' }}>{lW.toFixed(1)}</div>
            <div className="pd-sl">Weight</div>
            <div className="pd-sd" style={{ color: wtChange <= 0 ? '#a6e3a1' : '#f38ba8' }}>{wtChange >= 0 ? '+' : ''}{wtChange.toFixed(1)}</div>
          </div>
          <div className="pd-stat">
            <div className="pd-sv" style={{ color: '#fab387' }}>{lBf.toFixed(1)}%</div>
            <div className="pd-sl">Body Fat</div>
            <div className="pd-sd" style={{ color: bfChange <= 0 ? '#a6e3a1' : '#f38ba8' }}>{bfChange >= 0 ? '+' : ''}{bfChange.toFixed(1)}</div>
          </div>
          <div className="pd-stat">
            <div className="pd-sv" style={{ color: '#a6e3a1' }}>{lMu.toFixed(1)}%</div>
            <div className="pd-sl">Muscle</div>
            <div className="pd-sd" style={{ color: muChange >= 0 ? '#a6e3a1' : '#f38ba8' }}>{muChange >= 0 ? '+' : ''}{muChange.toFixed(1)}</div>
          </div>
        </div>

        {/* Goal progress for ongoing */}
        {isOngoing && p.goals && (
          <div style={{ marginTop: 10 }}>
            {[
              { label: 'Weight', start: fW, current: lW, goal: parseFloat(p.goals.weight), unit: 'kg', color: '#f38ba8' },
              { label: 'Body Fat', start: fBf, current: lBf, goal: parseFloat(p.goals.bodyFat), unit: '%', color: '#fab387' },
              { label: 'Muscle', start: fMu, current: lMu, goal: parseFloat(p.goals.musclePct), unit: '%', color: '#a6e3a1' },
            ].filter(m => !isNaN(m.goal)).map(m => {
              const pct = goalProgress(m.start, m.current, m.goal)
              return (
                <div key={m.label} className="progress-bar-wrap">
                  <div className="progress-bar-header">
                    <span>{m.label}: {m.current.toFixed(1)} / {m.goal} {m.unit}</span>
                    <span style={{ color: m.color, fontWeight: 700 }}>{pct}%</span>
                  </div>
                  <div className="progress-bar-track">
                    <div className="progress-bar-fill" style={{ width: pct + '%', background: m.color }}></div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Rate badges */}
      <div className="rate-row">
        <div className="rate-badge">
          <div className="rb-val" style={{ color: '#f38ba8' }}>{wtChange >= 0 ? '+' : ''}{wtChange.toFixed(1)}</div>
          <div className="rb-lbl">Weight delta kg</div>
          <div className="rb-bar" style={{ background: '#f38ba8', width: Math.min(100, Math.abs(wtChange) / 3 * 100) + '%' }}></div>
        </div>
        <div className="rate-badge">
          <div className="rb-val" style={{ color: '#fab387' }}>{fatMassChange >= 0 ? '+' : ''}{fatMassChange.toFixed(1)}</div>
          <div className="rb-lbl">Fat Mass kg</div>
          <div className="rb-bar" style={{ background: '#fab387', width: Math.min(100, Math.abs(fatMassChange) / 3 * 100) + '%' }}></div>
        </div>
        <div className="rate-badge">
          <div className="rb-val" style={{ color: '#a6e3a1' }}>{lbmChange >= 0 ? '+' : ''}{lbmChange.toFixed(1)}</div>
          <div className="rb-lbl">Lean Mass kg</div>
          <div className="rb-bar" style={{ background: '#a6e3a1', width: Math.min(100, Math.abs(lbmChange) / 3 * 100) + '%' }}></div>
        </div>
      </div>

      {/* Phase charts */}
      <div className="stat-section-title">Phase weight</div>
      <div className="chart-card">
        <ScrubbableLine
          data={{
            labels,
            datasets: [
              { data: phaseWts, borderColor: '#f38ba8', backgroundColor: hexToRgba('#f38ba8', 0.2), fill: true },
              { data: phaseWts.map(() => fW), borderColor: '#45475a', borderDash: [4, 4], borderWidth: 1, fill: false, pointRadius: 0 },
            ]
          }}
          options={phaseOpts()}
          width={canvasW} height={120}
          style={{ width: canvasW, height: 120 }}
          renderHead={(idx) => {
            const i = idx ?? pickLast(phaseWts)
            const v = phaseWts[i]
            return <div className="card-head">Weight <span className="v">{v != null ? v.toFixed(1) : '--'} kg {idx != null && <span className="d">{phaseKeys[i]}</span>}</span></div>
          }}
        />
      </div>
      <div className="stat-section-title">7 Day Weight Delta</div>
      <WeightTrendChart keys={phaseKeys} entries={entries} opts={phaseOpts()} />

      <div className="stat-section-title">Phase body composition</div>
      <div className="chart-card">
        <ScrubbableLine
          data={{
            labels,
            datasets: [
              { data: pFatMass, borderColor: '#fab387', backgroundColor: hexToRgba('#fab387', 0.15), fill: true, yAxisID: 'y' },
              { data: pMusMass, borderColor: '#a6e3a1', backgroundColor: hexToRgba('#a6e3a1', 0.15), fill: true, yAxisID: 'y2' },
            ]
          }}
          options={(() => {
            const fv = pFatMass.filter(v => v !== null), mv = pMusMass.filter(v => v !== null)
            if (!fv.length || !mv.length) return phaseOpts({
              y:  { position: 'left',  ticks: { color: '#fab387', font: { size: 9 } }, grid: { color: '#313244' } },
              y2: { position: 'right', ticks: { color: '#a6e3a1', font: { size: 9 } }, grid: { display: false } },
            })
            const fMin = Math.min(...fv), fMax = Math.max(...fv)
            const mMin = Math.min(...mv), mMax = Math.max(...mv)
            const range = Math.max(fMax - fMin, mMax - mMin, 2)
            const pad = range * 0.15
            const fCenter = (fMin + fMax) / 2, mCenter = (mMin + mMax) / 2
            return phaseOpts({
              y:  { position: 'left',  min: fCenter - range/2 - pad, max: fCenter + range/2 + pad, ticks: { color: '#fab387', font: { size: 9 } }, grid: { color: '#313244' } },
              y2: { position: 'right', min: mCenter - range/2 - pad, max: mCenter + range/2 + pad, ticks: { color: '#a6e3a1', font: { size: 9 } }, grid: { display: false } },
            })
          })()}
          width={canvasW} height={110}
          style={{ width: canvasW, height: 110 }}
          renderHead={(idx) => {
            const i = idx ?? pickLast(pFatMass)
            const f = pFatMass[i], m = pMusMass[i]
            return <div className="card-head">Fat / Muscle Mass (kg) <span className="v">{f != null ? f.toFixed(1) : '--'} / {m != null ? m.toFixed(1) : '--'} {idx != null && <span className="d">{phaseKeys[i]}</span>}</span></div>
          }}
        />
      </div>

      <div className="chart-card">
        <ScrubbableLine
          data={{ labels, datasets: [{ data: pBfVals, borderColor: '#fab387', backgroundColor: hexToRgba('#fab387', 0.2), fill: true }] }}
          options={phaseOpts()}
          width={canvasW} height={120}
          style={{ width: canvasW, height: 120 }}
          renderHead={(idx) => {
            const i = idx ?? pickLast(pBfVals)
            const v = pBfVals[i]
            return <div className="card-head">Body Fat % <span className="v">{v != null ? v.toFixed(1) : '--'}% {idx != null && <span className="d">{phaseKeys[i]}</span>}</span></div>
          }}
        />
      </div>
      <div className="chart-card">
        <ScrubbableLine
          data={{ labels, datasets: [{ data: pMuVals, borderColor: '#a6e3a1', backgroundColor: hexToRgba('#a6e3a1', 0.2), fill: true }] }}
          options={phaseOpts()}
          width={canvasW} height={120}
          style={{ width: canvasW, height: 120 }}
          renderHead={(idx) => {
            const i = idx ?? pickLast(pMuVals)
            const v = pMuVals[i]
            return <div className="card-head">Muscle % <span className="v">{v != null ? v.toFixed(1) : '--'}% {idx != null && <span className="d">{phaseKeys[i]}</span>}</span></div>
          }}
        />
      </div>
      <div className="chart-card">
        <ScrubbableLine
          data={{ labels, datasets: [{ data: pViVals, borderColor: '#cba6f7', backgroundColor: hexToRgba('#cba6f7', 0.2), fill: true }] }}
          options={{ ...phaseOpts(), scales: { x: { ticks: { color: '#6c7086', font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { display: false } }, y: { ticks: { color: '#6c7086', font: { size: 9 }, stepSize: 1 }, grid: { color: '#313244' }, suggestedMin: 0, suggestedMax: 8 } } }}
          width={canvasW} height={90}
          style={{ width: canvasW, height: 90 }}
          renderHead={(idx) => {
            const i = idx ?? pickLast(pViVals)
            const v = pViVals[i]
            return <div className="card-head">Visceral Fat <span className="v">{v ?? '--'} {idx != null && <span className="d">{phaseKeys[i]}</span>}</span></div>
          }}
        />
      </div>

      {/* Deltas */}
      <div className="stat-section-title">Deltas this phase</div>
      {[
        ['Weight', fW, lW, 'kg', '#f38ba8'],
        ['Body Fat', fBf, lBf, '%', '#fab387'],
        ['Muscle', fMu, lMu, '%', '#a6e3a1'],
        ['Visceral', fVi, lVi, '', '#cba6f7'],
      ].map(([lbl, fv, lv, unit, color]) => {
        const d = lv - fv
        return (
          <div key={lbl} className="adv-metric">
            <div className="am-left">
              <div className="am-label">{lbl}</div>
              <div className="am-sub">{fv.toFixed(1)}{unit} {'\u2192'} {lv.toFixed(1)}{unit}</div>
            </div>
            <div className="am-val" style={{ '--c': color }}>{d >= 0 ? '+' : ''}{d.toFixed(1)}{unit}</div>
          </div>
        )
      })}

      {/* Ratio */}
      {Math.abs(fatMassChange) > 0.01 && Math.abs(lbmChange) > 0.01 && (
        <div className="adv-metric">
          <div className="am-left">
            <div className="am-label">{fatMassChange < 0 && lbmChange > 0 ? 'Recomp ratio' : fatMassChange > 0 && lbmChange > 0 ? 'Lean gain ratio' : 'Fat:Muscle ratio'}</div>
            <div className="am-sub">
              {fatMassChange < 0 && lbmChange > 0
                ? 'For every 1kg fat lost'
                : fatMassChange > 0 && lbmChange > 0
                  ? 'Muscle of total gained'
                  : `Fat ${fatMassChange.toFixed(1)}kg / Muscle ${lbmChange.toFixed(1)}kg`}
            </div>
          </div>
          <div className="am-val" style={{ '--c': fatMassChange < 0 && lbmChange > 0 ? '#a6e3a1' : '#89b4fa' }}>
            {fatMassChange < 0 && lbmChange > 0
              ? `+${Math.abs(lbmChange / fatMassChange).toFixed(2)} kg muscle`
              : fatMassChange > 0 && lbmChange > 0
                ? `${(lbmChange / (fatMassChange + lbmChange) * 100).toFixed(0)}%`
                : (fatMassChange / lbmChange).toFixed(2)}
          </div>
        </div>
      )}

      {/* Streaks */}
      <div className="stat-section-title">Current streaks</div>
      <div className="chart-card">
        {streaks.map(h => (
          <div key={h.key} className="streak-row">
            <span className="s-icon">{h.icon}</span>
            <span className="s-name">{h.name}</span>
            <span className="s-val" style={{ color: h.color }}>{h.streak}d</span>
          </div>
        ))}
      </div>

      {/* Work totals */}
      <div className="stat-section-title">Activity totals</div>
      <div className="chart-card">
        {[['Lift sessions', liftCount, '#f38ba8'],
          ['Cardio sessions', cardioCount, '#89dceb'],
          ['Stretch sessions', stretchCount, '#a6e3a1'],
          ['Calisthenics', caliCount, '#fab387']].map(([lbl, v, c]) => (
          <div key={lbl} className="work-stat">
            <span className="ws-label">{lbl}</span>
            <span className="ws-val" style={{ color: c }}>{v}</span>
          </div>
        ))}
      </div>
      <MeasurementsTable entries={entries} dates={phaseKeys} />
    </>
  )
}


// ====================================================================
// MEASUREMENTS TABLE (shared)
// ====================================================================
function MeasurementsTable({ entries, dates }) {
  if (!dates || dates.length === 0) return null
  const rows = [...dates].reverse()
  return (
    <div className="measurements-table">
      <div className="card-head" style={{ marginBottom: 8 }}>Measurements</div>
      <div className="mt-header">
        <span className="mt-date">Date</span>
        <span className="mt-val" style={{ color: '#f38ba8' }}>Wt</span>
        <span className="mt-val" style={{ color: '#fab387' }}>BF%</span>
        <span className="mt-val" style={{ color: '#a6e3a1' }}>Mu%</span>
        <span className="mt-val" style={{ color: '#cba6f7' }}>Vi</span>
      </div>
      <div className="mt-body">
        {rows.map(d => {
          const e = entries[d]
          if (!e) return null
          const [, m, day] = d.split('-')
          return (
            <div key={d} className="mt-row">
              <span className="mt-date">{`${day}/${m}`}</span>
              <span className="mt-val">{e.weight || '—'}</span>
              <span className="mt-val">{e.bodyFat || '—'}</span>
              <span className="mt-val">{e.musclePct || '—'}</span>
              <span className="mt-val">{e.visceralFat || '—'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}


// HABITS PANEL
// ====================================================================
function HabitsPanel({ trailsData, habitScores, entries, phases, sortedDates }) {
  // Streaks (current phase)
  const curPhase = phases.find(p => !p.end)
  const phaseKeys = curPhase ? sortedDates.filter(k => k >= curPhase.start && (!curPhase.end || k <= curPhase.end)) : sortedDates

  const streaks = ORBIT_HABITS.map(h => {
    let streak = 0
    for (let i = phaseKeys.length - 1; i >= 0; i--) {
      const e = ensureHabits(entries[phaseKeys[i]])
      const v = e.habits?.[h.key]
      if (v === null || v === undefined) continue
      if (v) streak++; else break
    }
    return { ...h, streak }
  })

  return (
    <>
      <div className="stat-section-title">21-day trails</div>
      <div className="trails-section" style={{ marginBottom: 12 }}>
        <div className="section-h">
          <span className="t"></span>
          <span className="sub">3 wk {'\u2192'} today</span>
        </div>
        {trailsData.map(h => (
          <div key={h.key} className="trail">
            <span className="t-icon">{h.icon}</span>
            <span className="t-name">{h.name}{h.auto ? <span className="auto">auto</span> : ''}</span>
            <div className="dots">
              {h.dots.map((dot, i) => (
                <div key={i} className={dot.cls} style={{ '--c': dot.color }}></div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="stat-section-title">Habit compliance -- all time</div>
      <div className="compliance-grid">
        {habitScores.map(hs => {
          const pctVal = Math.round(hs.pct * 100)
          return (
            <div key={hs.key} className="comp-cell">
              <div className="name">{hs.icon} {hs.name}</div>
              <div className="pct" style={{ color: hs.color }}>{pctVal}%</div>
              <div className="meta">{hs.done} / {hs.total} days</div>
              <div className="pct-bar">
                <div className="pct-fill" style={{ width: pctVal + '%', background: hs.color }}></div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="stat-section-title">Streaks ({curPhase ? 'current phase' : 'all time'})</div>
      <div className="chart-card">
        {streaks.map(h => (
          <div key={h.key} className="streak-row">
            <span className="s-icon">{h.icon}</span>
            <span className="s-name">{h.name}</span>
            <span className="s-val" style={{ color: h.color }}>{h.streak}d</span>
          </div>
        ))}
      </div>
    </>
  )
}


// ====================================================================
// SETTINGS: Current Phase Summary
// ====================================================================
function SettingsPhaseSummary({ entries, phases, sortedDates }) {
  const curPhase = phases.find(p => !p.end)
  if (!curPhase) return null

  const phaseKeys = sortedDates.filter(k => k >= curPhase.start && (!curPhase.end || k <= curPhase.end))
  if (phaseKeys.length < 2) return (
    <>
      <div className="settings-section">Current Phase Summary</div>
      <div className="phase-delta">
        <div style={{ color: '#45475a', fontSize: 12 }}>Not enough data yet</div>
      </div>
    </>
  )

  const first = entries[phaseKeys[0]]
  const last = entries[phaseKeys[phaseKeys.length - 1]]
  const days = phaseKeys.length

  return (
    <>
      <div className="settings-section">Current Phase Summary</div>
      <div className="phase-delta">
        <div className="pd-title">{curPhase.name} -- {days} days</div>
        {[
          ['Weight', first.weight, last.weight, 'kg'],
          ['Body Fat', first.bodyFat, last.bodyFat, '%'],
          ['Muscle', first.musclePct, last.musclePct, '%'],
          ['Visceral', first.visceralFat, last.visceralFat, ''],
        ].map(([lbl, fv, lv, unit]) => {
          const d = (parseFloat(lv) || 0) - (parseFloat(fv) || 0)
          const sign = d >= 0 ? '+' : ''
          return (
            <div key={lbl} className="delta-row">
              <span className="d-label">{lbl}</span>
              <span className="d-val">{sign}{d.toFixed(1)}{unit}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}


export default App
