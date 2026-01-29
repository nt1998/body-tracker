import { useState, useEffect } from 'react'
import './App.css'

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

  // Load entries from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('bodytracker_entries')
    if (saved) {
      setEntries(JSON.parse(saved))
    }
  }, [])

  // Load entry for current date
  useEffect(() => {
    if (entries[date]) {
      setEntry(entries[date])
    } else {
      setEntry({
        weight: '',
        bodyFat: '',
        waist: '',
        muscleMass: '',
        creatine: false,
        vitamins: false
      })
    }
  }, [date, entries])

  // Save entry when it changes
  const updateEntry = (field, value) => {
    const newEntry = { ...entry, [field]: value }
    setEntry(newEntry)
    const newEntries = { ...entries, [date]: newEntry }
    setEntries(newEntries)
    localStorage.setItem('bodytracker_entries', JSON.stringify(newEntries))
  }

  const changeDate = (days) => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().split('T')[0])
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
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <button onClick={() => changeDate(1)}>&gt;</button>
            </div>

            <div className="form">
              <div className="field">
                <label>Weight (kg)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={entry.weight}
                  onChange={(e) => updateEntry('weight', e.target.value)}
                />
              </div>
              <div className="field">
                <label>Body Fat (%)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={entry.bodyFat}
                  onChange={(e) => updateEntry('bodyFat', e.target.value)}
                />
              </div>
              <div className="field">
                <label>Waist (cm)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={entry.waist}
                  onChange={(e) => updateEntry('waist', e.target.value)}
                />
              </div>
              <div className="field">
                <label>Muscle Mass (kg)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={entry.muscleMass}
                  onChange={(e) => updateEntry('muscleMass', e.target.value)}
                />
              </div>

              <div className="toggles">
                <button
                  className={entry.creatine ? 'toggle active' : 'toggle'}
                  onClick={() => updateEntry('creatine', !entry.creatine)}
                >
                  Creatine
                </button>
                <button
                  className={entry.vitamins ? 'toggle active' : 'toggle'}
                  onClick={() => updateEntry('vitamins', !entry.vitamins)}
                >
                  Vitamins
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'stats' && <div className="page">Stats coming soon</div>}
        {tab === 'phases' && <div className="page">Phases coming soon</div>}
        {tab === 'settings' && <div className="page">Settings coming soon</div>}
      </main>

      <nav className="navbar">
        <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>Log</button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>Stats</button>
        <button className={tab === 'phases' ? 'active' : ''} onClick={() => setTab('phases')}>Phases</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
      </nav>
    </div>
  )
}

export default App
