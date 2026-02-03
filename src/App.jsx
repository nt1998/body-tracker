import { useState, useEffect, useMemo, useRef } from 'react'
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

const metrics = [
  { key: 'weight', label: 'Weight', unit: 'kg', color: '#f38ba8', step: 0.1 },
  { key: 'bodyFat', label: 'Body Fat', unit: '%', color: '#fab387', step: 0.1 },
  { key: 'musclePct', label: 'Muscle', unit: '%', color: '#a6e3a1', step: 0.1 },
  { key: 'visceralFat', label: 'Visceral', unit: '', color: '#89b4fa', step: 1 }
]

function App() {
  const [tab, setTab] = useState('log')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [entries, setEntries] = useState({})
  const [entry, setEntry] = useState({ weight: '', bodyFat: '', musclePct: '', visceralFat: '', creatine: false, vitamins: false, cycle: false })
  const [hasChanges, setHasChanges] = useState(false)
  const [phases, setPhases] = useState([])
  const [github, setGithub] = useState({ token: '', repo: '', owner: '', connected: false })
  const [syncStatus, setSyncStatus] = useState('')
  const [statsPhase, setStatsPhase] = useState('current')
  const [phaseModal, setPhaseModal] = useState(null)
  const [lastSyncTime, setLastSyncTime] = useState(0)
  const [needsSync, setNeedsSync] = useState(false)
  const [commitsToday, setCommitsToday] = useState(null)
  const syncTimeoutRef = useRef(null)

  // Get yesterday's date (handles month boundaries correctly)
  const getYesterday = (d) => {
    const [year, month, day] = d.split('-').map(Number)
    const dt = new Date(year, month - 1, day) // month is 0-indexed in JS
    dt.setDate(dt.getDate() - 1)
    const y = dt.getFullYear()
    const m = String(dt.getMonth() + 1).padStart(2, '0')
    const dd = String(dt.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }

  const yesterday = getYesterday(date)
  const yesterdayEntry = entries[yesterday] || {}
  const todayRecorded = !!entries[date]

  // Lock screen orientation to portrait (or counter-rotate on iOS)
  useEffect(() => {
    // Try the API first (works on Android PWA)
    if (screen.orientation?.lock) {
      screen.orientation.lock('portrait').catch(() => {})
    }

    // For iOS: counter-rotate content when in landscape
    const handleOrientationChange = () => {
      const isLandscape = window.innerWidth > window.innerHeight
      document.body.classList.toggle('landscape-override', isLandscape)
    }

    handleOrientationChange()
    window.addEventListener('resize', handleOrientationChange)
    window.addEventListener('orientationchange', handleOrientationChange)

    return () => {
      window.removeEventListener('resize', handleOrientationChange)
      window.removeEventListener('orientationchange', handleOrientationChange)
    }
  }, [])

  // Load from localStorage first
  useEffect(() => {
    const savedEntries = localStorage.getItem('bodytracker_entries')
    if (savedEntries) setEntries(JSON.parse(savedEntries))
    const savedPhases = localStorage.getItem('bodytracker_phases')
    if (savedPhases) setPhases(JSON.parse(savedPhases))
    const savedLastSync = localStorage.getItem('bodytracker_lastsync')
    if (savedLastSync) setLastSyncTime(parseInt(savedLastSync))
    const savedGithub = localStorage.getItem('bodytracker_github')
    if (savedGithub) {
      const gh = JSON.parse(savedGithub)
      setGithub(gh)
      if (gh.connected) autoLoadFromGithub(gh)
    }
  }, [])

  // Debounced sync - sync 5 seconds after last change
  useEffect(() => {
    if (needsSync && github.connected) {
      // Clear any existing timeout
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
      // Set new timeout to sync after 5 seconds of no changes
      syncTimeoutRef.current = setTimeout(() => {
        forceSyncToGithub()
      }, 5000)
    }
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    }
  }, [needsSync, github.connected, entries, phases])

  // Sync when app goes to background (more reliable than beforeunload)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && needsSync && github.connected) {
        // Use sendBeacon or sync immediately
        forceSyncToGithub()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [needsSync, github.connected])

  const autoLoadFromGithub = async (gh) => {
    try {
      const res = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/data.json`, { headers: { Authorization: `token ${gh.token}` } })
      if (res.ok) {
        const file = await res.json()
        const remoteData = JSON.parse(decodeURIComponent(escape(atob(file.content))))
        const localEntries = JSON.parse(localStorage.getItem('bodytracker_entries') || '{}')
        const localPhases = JSON.parse(localStorage.getItem('bodytracker_phases') || '[]')

        // Check if local has entries that remote doesn't (need to sync up)
        const localDates = Object.keys(localEntries)
        const remoteDates = Object.keys(remoteData.entries || {})
        const localHasMore = localDates.some(d => !remoteDates.includes(d) ||
          JSON.stringify(localEntries[d]) !== JSON.stringify(remoteData.entries[d]))

        if (localHasMore) {
          // Local has data remote doesn't - merge and sync
          const mergedEntries = { ...remoteData.entries, ...localEntries }
          const mergedPhases = localPhases.length > (remoteData.phases?.length || 0) ? localPhases : remoteData.phases
          setEntries(mergedEntries)
          setPhases(mergedPhases || [])
          localStorage.setItem('bodytracker_entries', JSON.stringify(mergedEntries))
          localStorage.setItem('bodytracker_phases', JSON.stringify(mergedPhases || []))
          // Sync merged data to remote
          await syncToGithub(mergedEntries, mergedPhases || [], true)
        } else {
          // Remote is up to date or has more - use remote
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
    } catch (e) {
      console.error('Auto-load failed:', e)
    }
  }

  // Force immediate sync to GitHub
  const forceSyncToGithub = async () => {
    if (!github.connected) return
    const currentEntries = JSON.parse(localStorage.getItem('bodytracker_entries') || '{}')
    const currentPhases = JSON.parse(localStorage.getItem('bodytracker_phases') || '[]')
    await syncToGithub(currentEntries, currentPhases, true)
    setNeedsSync(false)
    // Refresh commit count after sync
    fetchCommitsToday()
  }

  // Fetch today's commit count from GitHub (count from Link header)
  const fetchCommitsToday = async () => {
    if (!github.connected || !github.token || !github.repo || !github.owner) return
    try {
      const today = new Date().toISOString().split('T')[0]
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
      // Use per_page=1 and check Link header for total count
      const res = await fetch(
        `https://api.github.com/repos/${github.owner}/${github.repo}/commits?since=${today}T00:00:00Z&until=${tomorrow}T00:00:00Z&per_page=1`,
        { headers: { Authorization: `token ${github.token}` } }
      )
      if (res.ok) {
        const link = res.headers.get('Link')
        if (link) {
          // Parse last page number from Link header
          const match = link.match(/&page=(\d+)>; rel="last"/)
          if (match) {
            setCommitsToday(parseInt(match[1]))
            return
          }
        }
        // If no Link header, count directly (less than 1 page)
        const commits = await res.json()
        setCommitsToday(commits.length)
      }
    } catch {}
  }

  // Load entry for date - use yesterday's values if no entry
  useEffect(() => {
    if (entries[date]) {
      setEntry(entries[date])
      setHasChanges(false)
    } else {
      const yest = entries[getYesterday(date)] || {}
      setEntry({
        weight: yest.weight || '',
        bodyFat: yest.bodyFat || '',
        musclePct: yest.musclePct || '',
        visceralFat: yest.visceralFat || '',
        creatine: false,
        vitamins: false,
        cycle: false
      })
      setHasChanges(false)
    }
  }, [date, entries])

  const saveAll = (newEntries, newPhases, forceSync = false) => {
    localStorage.setItem('bodytracker_entries', JSON.stringify(newEntries))
    localStorage.setItem('bodytracker_phases', JSON.stringify(newPhases))
    setNeedsSync(true)
    if (forceSync && github.connected) {
      syncToGithub(newEntries, newPhases, true)
    }
  }

  const updateEntry = (field, value) => {
    const newEntry = { ...entry, [field]: value }
    setEntry(newEntry)
    setHasChanges(true)
    // Save immediately
    const newEntries = { ...entries, [date]: newEntry }
    setEntries(newEntries)
    saveAll(newEntries, phases)
  }

  const adjustValue = (field, delta) => {
    const metric = metrics.find(m => m.key === field)
    const step = metric?.step || 0.1
    const current = parseFloat(entry[field]) || parseFloat(yesterdayEntry[field]) || 0
    const newVal = (current + delta * step).toFixed(step === 1 ? 0 : 1)
    updateEntry(field, newVal)
  }

  const today = new Date().toISOString().split('T')[0]
  const isToday = date === today

  const changeDate = (days) => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    const newDate = d.toISOString().split('T')[0]
    // Don't allow future dates
    if (newDate > today) return
    setDate(newDate)
  }


  const syncToGithub = async (data, phasesData, force = false) => {
    if (!github.token || !github.repo || !github.owner) return
    if (!force) return // Only sync when forced

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
      } catch {}

      // Compare local vs remote - only sync if different
      const localPayload = JSON.stringify({ entries: data, phases: phasesData })
      const remotePayload = remoteData ? JSON.stringify({ entries: remoteData.entries, phases: remoteData.phases }) : null

      if (localPayload === remotePayload) {
        // No changes, skip commit
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

  const connectGithub = () => {
    const newGithub = { ...github, connected: true }
    setGithub(newGithub)
    localStorage.setItem('bodytracker_github', JSON.stringify(newGithub))
  }

  const disconnectGithub = () => {
    setGithub({ token: '', repo: '', owner: '', connected: false })
    localStorage.setItem('bodytracker_github', JSON.stringify({ token: '', repo: '', owner: '', connected: false }))
  }

  // Calculate streaks for creatine and vitamins
  const calcStreak = (field) => {
    const sortedDates = Object.keys(entries).sort().reverse()
    let streak = 0
    let weekStart = null
    let missedInWeek = 0

    for (let i = 0; i < sortedDates.length; i++) {
      const d = sortedDates[i]
      const dt = new Date(d)
      const weekNum = Math.floor(dt.getTime() / (7 * 24 * 60 * 60 * 1000))

      if (weekStart === null) weekStart = weekNum
      if (weekNum !== weekStart) {
        // New week - check if missed more than 2 days
        if (missedInWeek > 2) break
        weekStart = weekNum
        missedInWeek = 0
      }

      if (entries[d]?.[field]) {
        streak++
      } else {
        missedInWeek++
        if (missedInWeek > 2) break
      }
    }
    return streak
  }

  const creatineStreak = useMemo(() => calcStreak('creatine'), [entries])
  const vitaminsStreak = useMemo(() => calcStreak('vitamins'), [entries])
  const cycleStreak = useMemo(() => calcStreak('cycle'), [entries])

  // Phases
  const getCurrentPhase = () => phases.find(p => !p.end)

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

  // Stats
  const getPhaseForStats = () => {
    if (statsPhase === 'all') return null
    if (statsPhase === 'current') return getCurrentPhase()
    return phases.find(p => p.id === parseInt(statsPhase))
  }

  const getFilteredDates = (phase) => {
    let dates = Object.keys(entries).sort()
    if (phase) dates = dates.filter(d => d >= phase.start && (!phase.end || d <= phase.end))
    return dates
  }

  const calc5DayAvg = (dates, field) => {
    return dates.map((d, i) => {
      const window = dates.slice(Math.max(0, i - 4), i + 1)
      const values = window.map(dt => parseFloat(entries[dt]?.[field])).filter(v => !isNaN(v))
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null
    })
  }

  const getPhaseStats = (phase) => {
    if (!phase) return null
    const dates = getFilteredDates(phase)
    if (dates.length === 0) return null
    const startDate = new Date(phase.start)
    const today = new Date()
    const days = Math.floor((today - startDate) / (1000 * 60 * 60 * 24))
    const weeks = days / 7
    const stats = {}
    metrics.forEach(m => {
      const values = dates.map(d => parseFloat(entries[d]?.[m.key])).filter(v => !isNaN(v))
      if (values.length < 1) { stats[m.key] = { start: '-', current: '-', change: '-', weeklyAvg: '-', weekChange: '-' }; return }
      const start = values[0], current = values[values.length - 1], change = current - start
      const weeklyAvg = weeks > 0 ? change / weeks : 0
      const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7)
      const recentDates = dates.filter(d => d >= weekAgo.toISOString().split('T')[0])
      const recentValues = recentDates.map(d => parseFloat(entries[d]?.[m.key])).filter(v => !isNaN(v))
      const weekChange = recentValues.length >= 2 ? recentValues[recentValues.length - 1] - recentValues[0] : 0
      stats[m.key] = { start: start.toFixed(1), current: current.toFixed(1), change: (change >= 0 ? '+' : '') + change.toFixed(1), weeklyAvg: (weeklyAvg >= 0 ? '+' : '') + weeklyAvg.toFixed(2), weekChange: (weekChange >= 0 ? '+' : '') + weekChange.toFixed(1) }
    })
    return { days, weeks: weeks.toFixed(1), stats }
  }

  const phase = getPhaseForStats()
  const filteredDates = getFilteredDates(phase)

  const createChartData = (metric) => ({
    labels: filteredDates.map(d => d.slice(5)),
    datasets: [
      { label: metric.label, data: filteredDates.map(d => parseFloat(entries[d]?.[metric.key]) || null), borderColor: metric.color, backgroundColor: metric.color + '33', tension: 0.3, spanGaps: true },
      { label: '5-Day Avg', data: calc5DayAvg(filteredDates, metric.key), borderColor: '#6c7086', borderDash: [5, 5], tension: 0.3, pointRadius: 0, spanGaps: true }
    ]
  })

  const createChartOptions = (metric) => {
    const opts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, annotation: { annotations: {} } }, scales: { x: { ticks: { color: '#6c7086', maxTicksLimit: 6 }, grid: { color: '#313244' } }, y: { ticks: { color: '#6c7086' }, grid: { color: '#313244' } } } }
    if (phase?.goals?.[metric.key]) {
      const goalVal = parseFloat(phase.goals[metric.key])
      if (!isNaN(goalVal)) opts.plugins.annotation.annotations.goalLine = { type: 'line', yMin: goalVal, yMax: goalVal, borderColor: '#a6e3a1', borderWidth: 2, borderDash: [10, 5] }
    }
    if (phase && filteredDates.length > 0) {
      const startVal = parseFloat(entries[filteredDates[0]]?.[metric.key])
      if (!isNaN(startVal)) opts.plugins.annotation.annotations.startLine = { type: 'line', yMin: startVal, yMax: startVal, borderColor: '#f38ba8', borderWidth: 1, borderDash: [5, 5] }
    }
    return opts
  }

  const currentPhase = getCurrentPhase()
  const phaseStats = getPhaseStats(currentPhase)

  const getDisplayValue = (field) => {
    if (entry[field]) return entry[field]
    if (!todayRecorded && yesterdayEntry[field]) return yesterdayEntry[field]
    return ''
  }

  const isYesterdayValue = (field) => !todayRecorded && !entry[field] && yesterdayEntry[field]

  return (
    <div className="app">
      <header className="header"><h1>Body Tracker</h1></header>

      <main className="content">
        {tab === 'log' && (
          <div className="log-page">
            <div className="date-row">
              <button onClick={() => changeDate(-1)}>&lt;</button>
              <input type="date" value={date} max={today} onChange={(e) => e.target.value <= today && setDate(e.target.value)} />
              <button onClick={() => changeDate(1)} disabled={isToday} className={isToday ? 'disabled' : ''}>&gt;</button>
            </div>

            {metrics.map(m => (
              <div key={m.key} className="metric-row">
                <span className="metric-label">{m.label}</span>
                <div className="metric-input">
                  <button className="adj-btn" onClick={() => adjustValue(m.key, -1)}>-</button>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={`metric-value ${isYesterdayValue(m.key) ? 'yesterday' : ''}`}
                    value={getDisplayValue(m.key)}
                    placeholder="-"
                    onChange={(e) => updateEntry(m.key, e.target.value)}
                  />
                  <span className="metric-unit">{m.unit}</span>
                  <button className="adj-btn" onClick={() => adjustValue(m.key, 1)}>+</button>
                </div>
              </div>
            ))}

            <div className="toggles">
              <button className={entry.creatine ? 'toggle active' : 'toggle'} onClick={() => updateEntry('creatine', !entry.creatine)}>
                Creatine {creatineStreak > 0 && <span className="streak">{creatineStreak}d</span>}
              </button>
              <button className={entry.vitamins ? 'toggle active' : 'toggle'} onClick={() => updateEntry('vitamins', !entry.vitamins)}>
                Vitamins {vitaminsStreak > 0 && <span className="streak">{vitaminsStreak}d</span>}
              </button>
              <button className={entry.cycle ? 'toggle active' : 'toggle'} onClick={() => updateEntry('cycle', !entry.cycle)}>
                Cycle {cycleStreak > 0 && <span className="streak">{cycleStreak}d</span>}
              </button>
            </div>

            {syncStatus && <div className="sync-status">{syncStatus}</div>}
          </div>
        )}

        {tab === 'stats' && (
          <div className="stats-page">
            <div className="filters">
              <select value={statsPhase} onChange={(e) => setStatsPhase(e.target.value)}>
                {getCurrentPhase() && <option value="current">{getCurrentPhase().name} (current)</option>}
                {phases.filter(p => p.end).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value="all">All Time</option>
              </select>
            </div>
            {metrics.map(m => (
              <div key={m.key} className="chart-section">
                <div className="chart-header">
                  <span className="chart-title" style={{ color: m.color }}>{m.label}</span>
                  <span className="chart-current">{entries[Object.keys(entries).sort().pop()]?.[m.key] || '-'} {m.unit}</span>
                </div>
                <div className="chart-container">
                  <Line data={createChartData(m)} options={createChartOptions(m)} />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'phases' && (
          <div className="phases-page">
            {currentPhase && phaseStats && (
              <div className="current-phase-stats">
                <h3>{currentPhase.name}</h3>
                <div className="phase-duration">{phaseStats.days} days ({phaseStats.weeks} weeks)</div>
                <div className="phase-metrics">
                  {metrics.map(m => (
                    <div key={m.key} className="phase-metric">
                      <span className="pm-label">{m.label}</span>
                      <span className="pm-current">{phaseStats.stats[m.key].current}</span>
                      <span className="pm-change">{phaseStats.stats[m.key].change}</span>
                      <span className="pm-weekly">~{phaseStats.stats[m.key].weeklyAvg}/wk</span>
                      <span className="pm-thisweek">This wk: {phaseStats.stats[m.key].weekChange}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button className="add-btn" onClick={openAddPhase}>+ Add Phase</button>
            <div className="phases-list">
              {phases.map(p => (
                <div key={p.id} className="phase-item">
                  <div className="phase-info">
                    <span className="phase-name">{p.name}</span>
                    <span className="phase-date">{p.start} → {p.end || 'ongoing'}</span>
                    {p.goals && <span className="phase-goals">Goals: {p.goals.weight && `W:${p.goals.weight}`} {p.goals.bodyFat && `BF:${p.goals.bodyFat}`} {p.goals.musclePct && `M:${p.goals.musclePct}`}</span>}
                  </div>
                  <div className="phase-actions">
                    {!p.end && <button onClick={() => endPhase(p.id)}>End</button>}
                    <button className="del" onClick={() => deletePhase(p.id)}>×</button>
                  </div>
                </div>
              ))}
              {phases.length === 0 && <p className="empty">No phases yet</p>}
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="settings-page">
            <h2>GitHub Sync</h2>
            {!github.connected ? (
              <div className="form">
                <div className="field"><label>Token</label><input type="password" value={github.token} onChange={(e) => setGithub({...github, token: e.target.value})} placeholder="ghp_..." /></div>
                <div className="field"><label>Owner</label><input value={github.owner} onChange={(e) => setGithub({...github, owner: e.target.value})} placeholder="username" /></div>
                <div className="field"><label>Repo</label><input value={github.repo} onChange={(e) => setGithub({...github, repo: e.target.value})} placeholder="repo-name" /></div>
                <button className="primary-btn" onClick={connectGithub}>Connect</button>
              </div>
            ) : (
              <div className="connected-info">
                <p>Connected to {github.owner}/{github.repo}</p>
                <div className="sync-stats">
                  {lastSyncTime > 0 && (
                    <p className="sync-note">Last sync: {new Date(lastSyncTime).toLocaleTimeString()}</p>
                  )}
                  <p className="sync-note">Commits today: {commitsToday !== null ? commitsToday : '...'}</p>
                </div>
                <button className="primary-btn" style={{marginTop: '12px'}} onClick={forceSyncToGithub} disabled={!needsSync}>
                  {needsSync ? 'Sync Now' : 'Up to date'}
                </button>
                <button className="danger-btn" style={{marginTop: '8px'}} onClick={() => {
                  if (confirm('Disconnect from GitHub? Local data will be preserved.')) {
                    disconnectGithub()
                  }
                }}>Disconnect</button>
              </div>
            )}
            {syncStatus && <div className="sync-status">{syncStatus}</div>}
            <h2>App</h2>
            <button className="primary-btn" onClick={async () => {
              if (needsSync && github.connected) {
                setSyncStatus('Syncing before reload...')
                await forceSyncToGithub()
              }
              window.location.reload()
            }}>Reload App</button>
            {needsSync && <p className="sync-note" style={{marginTop: '8px'}}>Changes pending sync</p>}
            <p className="version-text">v0.0.0</p>
          </div>
        )}
      </main>

      <nav className="navbar">
        <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}><span className="nav-icon">📝</span><span>Log</span></button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}><span className="nav-icon">📊</span><span>Stats</span></button>
        <button className={tab === 'phases' ? 'active' : ''} onClick={() => setTab('phases')}><span className="nav-icon">🎯</span><span>Phases</span></button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => { setTab('settings'); fetchCommitsToday() }}><span className="nav-icon">⚙️</span><span>Settings</span></button>
      </nav>

      {phaseModal && (
        <div className="modal-overlay" onClick={() => setPhaseModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Phase</h3>
            <div className="form">
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
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setPhaseModal(null)}>Cancel</button>
              <button className="primary-btn" onClick={savePhaseModal}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
