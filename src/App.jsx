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
  Legend
} from 'chart.js'
import './App.css'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

function App() {
  const [tab, setTab] = useState('log')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [entries, setEntries] = useState({})
  const [entry, setEntry] = useState({
    weight: '',
    bodyFat: '',
    waist: '',
    muscleMass: '',
    creatine: false,
    vitamins: false
  })
  const [phases, setPhases] = useState([])
  const [github, setGithub] = useState({ token: '', repo: '', owner: '', connected: false })
  const [syncStatus, setSyncStatus] = useState('')

  // Load from localStorage
  useEffect(() => {
    const savedEntries = localStorage.getItem('bodytracker_entries')
    if (savedEntries) setEntries(JSON.parse(savedEntries))

    const savedPhases = localStorage.getItem('bodytracker_phases')
    if (savedPhases) setPhases(JSON.parse(savedPhases))

    const savedGithub = localStorage.getItem('bodytracker_github')
    if (savedGithub) setGithub(JSON.parse(savedGithub))
  }, [])

  // Load entry for current date
  useEffect(() => {
    if (entries[date]) {
      setEntry(entries[date])
    } else {
      setEntry({ weight: '', bodyFat: '', waist: '', muscleMass: '', creatine: false, vitamins: false })
    }
  }, [date, entries])

  const updateEntry = (field, value) => {
    const newEntry = { ...entry, [field]: value }
    setEntry(newEntry)
    const newEntries = { ...entries, [date]: newEntry }
    setEntries(newEntries)
    localStorage.setItem('bodytracker_entries', JSON.stringify(newEntries))
    if (github.connected) syncToGithub(newEntries)
  }

  const changeDate = (days) => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().split('T')[0])
  }

  // GitHub sync
  const syncToGithub = async (data) => {
    if (!github.token || !github.repo || !github.owner) return
    try {
      setSyncStatus('Syncing...')
      const content = btoa(JSON.stringify(data, null, 2))
      const apiUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/data.json`

      // Get current file SHA if exists
      let sha = ''
      try {
        const getRes = await fetch(apiUrl, {
          headers: { Authorization: `token ${github.token}` }
        })
        if (getRes.ok) {
          const file = await getRes.json()
          sha = file.sha
        }
      } catch {}

      await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          Authorization: `token ${github.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Update ${new Date().toISOString()}`,
          content,
          ...(sha && { sha })
        })
      })
      setSyncStatus('Synced!')
      setTimeout(() => setSyncStatus(''), 2000)
    } catch (err) {
      setSyncStatus('Sync failed')
      setTimeout(() => setSyncStatus(''), 3000)
    }
  }

  const loadFromGithub = async () => {
    if (!github.token || !github.repo || !github.owner) return
    try {
      setSyncStatus('Loading...')
      const res = await fetch(
        `https://api.github.com/repos/${github.owner}/${github.repo}/contents/data.json`,
        { headers: { Authorization: `token ${github.token}` } }
      )
      if (res.ok) {
        const file = await res.json()
        const data = JSON.parse(atob(file.content))
        setEntries(data)
        localStorage.setItem('bodytracker_entries', JSON.stringify(data))
        setSyncStatus('Loaded!')
      }
      setTimeout(() => setSyncStatus(''), 2000)
    } catch {
      setSyncStatus('Load failed')
      setTimeout(() => setSyncStatus(''), 3000)
    }
  }

  const connectGithub = () => {
    const newGithub = { ...github, connected: true }
    setGithub(newGithub)
    localStorage.setItem('bodytracker_github', JSON.stringify(newGithub))
  }

  const disconnectGithub = () => {
    const newGithub = { token: '', repo: '', owner: '', connected: false }
    setGithub(newGithub)
    localStorage.setItem('bodytracker_github', JSON.stringify(newGithub))
  }

  // Phases
  const addPhase = () => {
    const name = prompt('Phase name:')
    if (!name) return
    const newPhases = [...phases, { id: Date.now(), name, start: date, end: '' }]
    setPhases(newPhases)
    localStorage.setItem('bodytracker_phases', JSON.stringify(newPhases))
  }

  const deletePhase = (id) => {
    const newPhases = phases.filter(p => p.id !== id)
    setPhases(newPhases)
    localStorage.setItem('bodytracker_phases', JSON.stringify(newPhases))
  }

  // Chart data
  const sortedDates = Object.keys(entries).sort()
  const chartData = {
    labels: sortedDates.map(d => d.slice(5)),
    datasets: [
      {
        label: 'Weight',
        data: sortedDates.map(d => parseFloat(entries[d].weight) || null),
        borderColor: '#f38ba8',
        tension: 0.3
      },
      {
        label: 'Body Fat %',
        data: sortedDates.map(d => parseFloat(entries[d].bodyFat) || null),
        borderColor: '#fab387',
        tension: 0.3
      }
    ]
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#cdd6f4' } } },
    scales: {
      x: { ticks: { color: '#6c7086' }, grid: { color: '#313244' } },
      y: { ticks: { color: '#6c7086' }, grid: { color: '#313244' } }
    }
  }

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
              <div className="field">
                <label>Weight (kg)</label>
                <input type="number" inputMode="decimal" value={entry.weight} onChange={(e) => updateEntry('weight', e.target.value)} />
              </div>
              <div className="field">
                <label>Body Fat (%)</label>
                <input type="number" inputMode="decimal" value={entry.bodyFat} onChange={(e) => updateEntry('bodyFat', e.target.value)} />
              </div>
              <div className="field">
                <label>Waist (cm)</label>
                <input type="number" inputMode="decimal" value={entry.waist} onChange={(e) => updateEntry('waist', e.target.value)} />
              </div>
              <div className="field">
                <label>Muscle Mass (kg)</label>
                <input type="number" inputMode="decimal" value={entry.muscleMass} onChange={(e) => updateEntry('muscleMass', e.target.value)} />
              </div>

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
            <div className="chart-container">
              <Line data={chartData} options={chartOptions} />
            </div>
            <div className="stats-summary">
              <div className="stat">
                <span className="stat-label">Entries</span>
                <span className="stat-value">{sortedDates.length}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Latest Weight</span>
                <span className="stat-value">{sortedDates.length ? entries[sortedDates[sortedDates.length-1]]?.weight || '-' : '-'} kg</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'phases' && (
          <div className="phases-page">
            <button className="add-btn" onClick={addPhase}>+ Add Phase</button>
            <div className="phases-list">
              {phases.map(p => (
                <div key={p.id} className="phase-item">
                  <span>{p.name}</span>
                  <span className="phase-date">{p.start}</span>
                  <button onClick={() => deletePhase(p.id)}>x</button>
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
          </div>
        )}
      </main>

      <nav className="navbar">
        <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
          <span className="nav-icon">📝</span>
          <span>Log</span>
        </button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
          <span className="nav-icon">📊</span>
          <span>Stats</span>
        </button>
        <button className={tab === 'phases' ? 'active' : ''} onClick={() => setTab('phases')}>
          <span className="nav-icon">🎯</span>
          <span>Phases</span>
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          <span className="nav-icon">⚙️</span>
          <span>Settings</span>
        </button>
      </nav>
    </div>
  )
}

export default App
