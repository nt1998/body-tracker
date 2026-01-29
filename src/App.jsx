import { useState, useEffect } from 'react'
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
  { key: 'weight', label: 'Weight', unit: 'kg', color: '#f38ba8' },
  { key: 'bodyFat', label: 'Body Fat', unit: '%', color: '#fab387' },
  { key: 'musclePct', label: 'Muscle', unit: '%', color: '#a6e3a1' },
  { key: 'visceralFat', label: 'Visceral Fat', unit: '', color: '#89b4fa' }
]

function App() {
  const [tab, setTab] = useState('log')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [entries, setEntries] = useState({})
  const [entry, setEntry] = useState({ weight: '', bodyFat: '', musclePct: '', visceralFat: '', creatine: false, vitamins: false })
  const [phases, setPhases] = useState([])
  const [github, setGithub] = useState({ token: '', repo: '', owner: '', connected: false })
  const [syncStatus, setSyncStatus] = useState('')
  const [statsPhase, setStatsPhase] = useState('current')

  useEffect(() => {
    const savedEntries = localStorage.getItem('bodytracker_entries')
    if (savedEntries) setEntries(JSON.parse(savedEntries))
    const savedPhases = localStorage.getItem('bodytracker_phases')
    if (savedPhases) setPhases(JSON.parse(savedPhases))
    const savedGithub = localStorage.getItem('bodytracker_github')
    if (savedGithub) setGithub(JSON.parse(savedGithub))
  }, [])

  useEffect(() => {
    if (entries[date]) setEntry(entries[date])
    else setEntry({ weight: '', bodyFat: '', musclePct: '', visceralFat: '', creatine: false, vitamins: false })
  }, [date, entries])

  const saveAll = (newEntries, newPhases) => {
    localStorage.setItem('bodytracker_entries', JSON.stringify(newEntries))
    localStorage.setItem('bodytracker_phases', JSON.stringify(newPhases))
    if (github.connected) syncToGithub(newEntries, newPhases)
  }

  const updateEntry = (field, value) => {
    const newEntry = { ...entry, [field]: value }
    setEntry(newEntry)
    const newEntries = { ...entries, [date]: newEntry }
    setEntries(newEntries)
    saveAll(newEntries, phases)
  }

  const changeDate = (days) => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().split('T')[0])
  }

  const syncToGithub = async (data, phasesData) => {
    if (!github.token || !github.repo || !github.owner) return
    try {
      setSyncStatus('Syncing...')
      const payload = { entries: data, phases: phasesData }
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))))
      const apiUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/data.json`
      let sha = ''
      try {
        const getRes = await fetch(apiUrl, { headers: { Authorization: `token ${github.token}` } })
        if (getRes.ok) { const file = await getRes.json(); sha = file.sha }
      } catch {}
      await fetch(apiUrl, {
        method: 'PUT',
        headers: { Authorization: `token ${github.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Update ${new Date().toISOString()}`, content, ...(sha && { sha }) })
      })
      setSyncStatus('Synced!')
      setTimeout(() => setSyncStatus(''), 2000)
    } catch { setSyncStatus('Sync failed'); setTimeout(() => setSyncStatus(''), 3000) }
  }

  const loadFromGithub = async () => {
    if (!github.token || !github.repo || !github.owner) return
    try {
      setSyncStatus('Loading...')
      const res = await fetch(`https://api.github.com/repos/${github.owner}/${github.repo}/contents/data.json`, { headers: { Authorization: `token ${github.token}` } })
      if (res.ok) {
        const file = await res.json()
        const data = JSON.parse(decodeURIComponent(escape(atob(file.content))))
        if (data.entries) {
          setEntries(data.entries)
          localStorage.setItem('bodytracker_entries', JSON.stringify(data.entries))
        }
        if (data.phases) {
          setPhases(data.phases)
          localStorage.setItem('bodytracker_phases', JSON.stringify(data.phases))
        }
        setSyncStatus('Loaded!')
      }
      setTimeout(() => setSyncStatus(''), 2000)
    } catch { setSyncStatus('Load failed'); setTimeout(() => setSyncStatus(''), 3000) }
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

  // Phases
  const getCurrentPhase = () => phases.find(p => !p.end)

  const addPhase = () => {
    const name = prompt('Phase name (e.g., Cut, Bulk):')
    if (!name) return
    const goalWeight = prompt('Goal weight (kg):', '')
    const goalBodyFat = prompt('Goal body fat %:', '')
    const goalMuscle = prompt('Goal muscle %:', '')
    const newPhase = {
      id: Date.now(),
      name,
      start: date,
      end: '',
      goals: { weight: goalWeight, bodyFat: goalBodyFat, musclePct: goalMuscle }
    }
    const newPhases = [...phases, newPhase]
    setPhases(newPhases)
    saveAll(entries, newPhases)
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

  // Stats calculations
  const getPhaseForStats = () => {
    if (statsPhase === 'all') return null
    if (statsPhase === 'current') return getCurrentPhase()
    return phases.find(p => p.id === parseInt(statsPhase))
  }

  const getFilteredDates = (phase) => {
    let dates = Object.keys(entries).sort()
    if (phase) {
      dates = dates.filter(d => d >= phase.start && (!phase.end || d <= phase.end))
    }
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
      if (values.length < 1) {
        stats[m.key] = { start: '-', current: '-', change: '-', weeklyAvg: '-', weekChange: '-' }
        return
      }
      const start = values[0]
      const current = values[values.length - 1]
      const change = current - start
      const weeklyAvg = weeks > 0 ? change / weeks : 0

      // Current week change
      const weekAgo = new Date(today)
      weekAgo.setDate(weekAgo.getDate() - 7)
      const weekAgoStr = weekAgo.toISOString().split('T')[0]
      const recentDates = dates.filter(d => d >= weekAgoStr)
      const recentValues = recentDates.map(d => parseFloat(entries[d]?.[m.key])).filter(v => !isNaN(v))
      const weekChange = recentValues.length >= 2 ? recentValues[recentValues.length - 1] - recentValues[0] : 0

      stats[m.key] = {
        start: start.toFixed(1),
        current: current.toFixed(1),
        change: (change >= 0 ? '+' : '') + change.toFixed(1),
        weeklyAvg: (weeklyAvg >= 0 ? '+' : '') + weeklyAvg.toFixed(2),
        weekChange: (weekChange >= 0 ? '+' : '') + weekChange.toFixed(1)
      }
    })

    return { days, weeks: weeks.toFixed(1), stats }
  }

  const phase = getPhaseForStats()
  const filteredDates = getFilteredDates(phase)

  const createChartData = (metric) => {
    const data = filteredDates.map(d => parseFloat(entries[d]?.[metric.key]) || null)
    const avg = calc5DayAvg(filteredDates, metric.key)

    return {
      labels: filteredDates.map(d => d.slice(5)),
      datasets: [
        {
          label: metric.label,
          data,
          borderColor: metric.color,
          backgroundColor: metric.color + '33',
          tension: 0.3,
          spanGaps: true
        },
        {
          label: '5-Day Avg',
          data: avg,
          borderColor: '#6c7086',
          borderDash: [5, 5],
          tension: 0.3,
          pointRadius: 0,
          spanGaps: true
        }
      ]
    }
  }

  const createChartOptions = (metric) => {
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        annotation: { annotations: {} }
      },
      scales: {
        x: { ticks: { color: '#6c7086', maxTicksLimit: 6 }, grid: { color: '#313244' } },
        y: { ticks: { color: '#6c7086' }, grid: { color: '#313244' } }
      }
    }

    // Add goal line if phase has goals
    if (phase?.goals?.[metric.key]) {
      const goalVal = parseFloat(phase.goals[metric.key])
      if (!isNaN(goalVal)) {
        opts.plugins.annotation.annotations.goalLine = {
          type: 'line',
          yMin: goalVal,
          yMax: goalVal,
          borderColor: '#a6e3a1',
          borderWidth: 2,
          borderDash: [10, 5],
          label: { display: true, content: `Goal: ${goalVal}`, position: 'end', backgroundColor: '#a6e3a1', color: '#1e1e2e' }
        }
      }
    }

    // Add start line
    if (phase && filteredDates.length > 0) {
      const startVal = parseFloat(entries[filteredDates[0]]?.[metric.key])
      if (!isNaN(startVal)) {
        opts.plugins.annotation.annotations.startLine = {
          type: 'line',
          yMin: startVal,
          yMax: startVal,
          borderColor: '#f38ba8',
          borderWidth: 1,
          borderDash: [5, 5]
        }
      }
    }

    return opts
  }

  const currentPhase = getCurrentPhase()
  const phaseStats = getPhaseStats(currentPhase)

  return (
    <div className="app">
      <header className="header">
        <h1>Body Tracker</h1>
      </header>

      <main className="content">
        {tab === 'log' && (
          <div className="log-page">
            <div className="date-row">
              <button onClick={() => changeDate(-1)}>&lt;</button>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <button onClick={() => changeDate(1)}>&gt;</button>
            </div>
            <div className="form">
              <div className="field"><label>Weight (kg)</label><input type="number" inputMode="decimal" step="0.1" value={entry.weight} onChange={(e) => updateEntry('weight', e.target.value)} /></div>
              <div className="field"><label>Body Fat %</label><input type="number" inputMode="decimal" step="0.1" value={entry.bodyFat} onChange={(e) => updateEntry('bodyFat', e.target.value)} /></div>
              <div className="field"><label>Muscle %</label><input type="number" inputMode="decimal" step="0.1" value={entry.musclePct} onChange={(e) => updateEntry('musclePct', e.target.value)} /></div>
              <div className="field"><label>Visceral Fat</label><input type="number" inputMode="decimal" step="0.1" value={entry.visceralFat} onChange={(e) => updateEntry('visceralFat', e.target.value)} /></div>
              <div className="toggles">
                <button className={entry.creatine ? 'toggle active' : 'toggle'} onClick={() => updateEntry('creatine', !entry.creatine)}>Creatine</button>
                <button className={entry.vitamins ? 'toggle active' : 'toggle'} onClick={() => updateEntry('vitamins', !entry.vitamins)}>Vitamins</button>
              </div>
            </div>
            {syncStatus && <div className="sync-status">{syncStatus}</div>}
          </div>
        )}

        {tab === 'stats' && (
          <div className="stats-page">
            <div className="filters">
              <select value={statsPhase} onChange={(e) => setStatsPhase(e.target.value)}>
                <option value="current">Current Phase</option>
                <option value="all">All Time</option>
                {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
            <button className="add-btn" onClick={addPhase}>+ Add Phase</button>
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
                <div className="btn-row">
                  <button className="primary-btn" onClick={loadFromGithub}>Pull Data</button>
                  <button className="danger-btn" onClick={disconnectGithub}>Disconnect</button>
                </div>
              </div>
            )}
            {syncStatus && <div className="sync-status">{syncStatus}</div>}

            <h2>App</h2>
            <button className="primary-btn" onClick={() => window.location.reload()}>Reload App</button>
          </div>
        )}
      </main>

      <nav className="navbar">
        <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}><span className="nav-icon">📝</span><span>Log</span></button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}><span className="nav-icon">📊</span><span>Stats</span></button>
        <button className={tab === 'phases' ? 'active' : ''} onClick={() => setTab('phases')}><span className="nav-icon">🎯</span><span>Phases</span></button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><span className="nav-icon">⚙️</span><span>Settings</span></button>
      </nav>
    </div>
  )
}

export default App
