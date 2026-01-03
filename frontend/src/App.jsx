import { useState, useEffect } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

const OPERATION_TYPES = [
  { id: 1, name: 'Purchase', desc: 'paid / refunded / chargedback' },
  { id: 2, name: 'Refund', desc: 'success' },
  { id: 3, name: 'Chargeback', desc: 'success' },
  { id: 4, name: 'Payout', desc: 'success' },
]

const VIEW_TYPES = [
  { id: 1, name: 'By Acquirer', desc: 'Acquirer → Legal Name → Currency' },
  { id: 2, name: 'By Merchant', desc: 'Legal Name → Acquirer → Currency' },
]

function formatNumber(num) {
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function App() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [error, setError] = useState(null)
  const [summary, setSummary] = useState(null)
  const [currencies, setCurrencies] = useState([])

  // Filters
  const [operationType, setOperationType] = useState(1)
  const [viewType, setViewType] = useState(1)
  const [currency, setCurrency] = useState('')

  // Pivot data
  const [pivotData, setPivotData] = useState(null)
  const [pivotLoading, setPivotLoading] = useState(false)

  // Expanded state for accordion
  const [expanded, setExpanded] = useState({})

  useEffect(() => {
    checkStatus()
  }, [])

  async function checkStatus() {
    try {
      const res = await fetch(`${API_URL}/api/status`)
      const data = await res.json()
      setStatus(data)
      if (data.loaded) {
        loadCurrencies()
        loadSummary()
      }
    } catch (e) {
      setError('Cannot connect to API server')
    }
  }

  async function uploadFile(file) {
    setLoading(true)
    setError(null)
    setUploadProgress('Uploading file...')
    try {
      const formData = new FormData()
      formData.append('file', file)
      setUploadProgress(`Uploading ${(file.size / 1024 / 1024).toFixed(1)}MB...`)

      const res = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData
      })

      setUploadProgress('Processing data...')
      const data = await res.json()

      if (data.success) {
        setStatus({ loaded: true, filename: data.filename, row_count: data.total_rows })
        setUploadProgress('')
        loadCurrencies()
        loadSummary()
      } else {
        setError(data.detail || 'Failed to upload file')
        setUploadProgress('')
      }
    } catch (e) {
      setError('Failed to upload file. The file may be too large or the server timed out.')
      setUploadProgress('')
    }
    setLoading(false)
  }

  function handleFileSelect(e) {
    const file = e.target.files[0]
    if (file) {
      uploadFile(file)
    }
  }

  async function loadCurrencies() {
    try {
      const res = await fetch(`${API_URL}/api/currencies`)
      const data = await res.json()
      setCurrencies(data.currencies)
    } catch (e) {
      console.error('Failed to load currencies')
    }
  }

  async function loadSummary() {
    try {
      const res = await fetch(`${API_URL}/api/summary`)
      const data = await res.json()
      setSummary(data.summaries)
    } catch (e) {
      console.error('Failed to load summary')
    }
  }

  async function loadPivot() {
    setPivotLoading(true)
    setExpanded({})
    try {
      let url = `${API_URL}/api/pivot?operation_type=${operationType}&view_type=${viewType}`
      if (currency) url += `&currency=${currency}`
      const res = await fetch(url)
      const data = await res.json()
      setPivotData(data)
    } catch (e) {
      setError('Failed to load pivot data')
    }
    setPivotLoading(false)
  }

  function toggleExpand(key) {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function renderPivotByAcquirer(data) {
    if (!data.groups || data.groups.length === 0) {
      return <div className="empty">No data found</div>
    }

    return (
      <div className="pivot-table">
        <table>
          <thead>
            <tr>
              <th style={{width: '300px'}}>Group</th>
              <th>Amount</th>
              <th>Fee</th>
              <th>PSP Buy Fee</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {data.groups.map((acq, ai) => (
              <>
                <tr key={`acq-${ai}`} className="group-row acquirer-row" onClick={() => toggleExpand(`acq-${ai}`)}>
                  <td>
                    <span className="expand-icon">{expanded[`acq-${ai}`] ? '▼' : '▶'}</span>
                    <strong>{acq.acquirer}</strong>
                  </td>
                  <td className="num">{formatNumber(acq.subtotals.amount)}</td>
                  <td className="num">{formatNumber(acq.subtotals.fee)}</td>
                  <td className="num">{formatNumber(acq.subtotals.psp_buy_fee)}</td>
                  <td className="num">{acq.subtotals.count}</td>
                </tr>
                {expanded[`acq-${ai}`] && acq.merchants.map((merch, mi) => (
                  <>
                    <tr key={`merch-${ai}-${mi}`} className="group-row merchant-row" onClick={() => toggleExpand(`merch-${ai}-${mi}`)}>
                      <td style={{paddingLeft: '30px'}}>
                        <span className="expand-icon">{expanded[`merch-${ai}-${mi}`] ? '▼' : '▶'}</span>
                        {merch.legal_name}
                      </td>
                      <td className="num">{formatNumber(merch.subtotals.amount)}</td>
                      <td className="num">{formatNumber(merch.subtotals.fee)}</td>
                      <td className="num">{formatNumber(merch.subtotals.psp_buy_fee)}</td>
                      <td className="num">{merch.subtotals.count}</td>
                    </tr>
                    {expanded[`merch-${ai}-${mi}`] && merch.currencies.map((cur, ci) => (
                      <tr key={`cur-${ai}-${mi}-${ci}`} className="detail-row">
                        <td style={{paddingLeft: '60px'}}>{cur.currency}</td>
                        <td className="num">{formatNumber(cur.amount)}</td>
                        <td className="num">{formatNumber(cur.fee)}</td>
                        <td className="num">{formatNumber(cur.psp_buy_fee)}</td>
                        <td className="num">{cur.count}</td>
                      </tr>
                    ))}
                  </>
                ))}
              </>
            ))}
            <tr className="total-row">
              <td><strong>TOTAL</strong></td>
              <td className="num"><strong>{formatNumber(data.totals.amount)}</strong></td>
              <td className="num"><strong>{formatNumber(data.totals.fee)}</strong></td>
              <td className="num"><strong>{formatNumber(data.totals.psp_buy_fee)}</strong></td>
              <td className="num"><strong>{data.totals.count}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  function renderPivotByMerchant(data) {
    if (!data.groups || data.groups.length === 0) {
      return <div className="empty">No data found</div>
    }

    return (
      <div className="pivot-table">
        <table>
          <thead>
            <tr>
              <th style={{width: '300px'}}>Group</th>
              <th>Amount</th>
              <th>Fee</th>
              <th>PSP Buy Fee</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {data.groups.map((merch, mi) => (
              <>
                <tr key={`merch-${mi}`} className="group-row merchant-row" onClick={() => toggleExpand(`merch-${mi}`)}>
                  <td>
                    <span className="expand-icon">{expanded[`merch-${mi}`] ? '▼' : '▶'}</span>
                    <strong>{merch.legal_name}</strong>
                  </td>
                  <td className="num">{formatNumber(merch.subtotals.amount)}</td>
                  <td className="num">{formatNumber(merch.subtotals.fee)}</td>
                  <td className="num">{formatNumber(merch.subtotals.psp_buy_fee)}</td>
                  <td className="num">{merch.subtotals.count}</td>
                </tr>
                {expanded[`merch-${mi}`] && merch.acquirers.map((acq, ai) => (
                  <>
                    <tr key={`acq-${mi}-${ai}`} className="group-row acquirer-row" onClick={() => toggleExpand(`acq-${mi}-${ai}`)}>
                      <td style={{paddingLeft: '30px'}}>
                        <span className="expand-icon">{expanded[`acq-${mi}-${ai}`] ? '▼' : '▶'}</span>
                        {acq.acquirer}
                      </td>
                      <td className="num">{formatNumber(acq.subtotals.amount)}</td>
                      <td className="num">{formatNumber(acq.subtotals.fee)}</td>
                      <td className="num">{formatNumber(acq.subtotals.psp_buy_fee)}</td>
                      <td className="num">{acq.subtotals.count}</td>
                    </tr>
                    {expanded[`acq-${mi}-${ai}`] && acq.currencies.map((cur, ci) => (
                      <tr key={`cur-${mi}-${ai}-${ci}`} className="detail-row">
                        <td style={{paddingLeft: '60px'}}>{cur.currency}</td>
                        <td className="num">{formatNumber(cur.amount)}</td>
                        <td className="num">{formatNumber(cur.fee)}</td>
                        <td className="num">{formatNumber(cur.psp_buy_fee)}</td>
                        <td className="num">{cur.count}</td>
                      </tr>
                    ))}
                  </>
                ))}
              </>
            ))}
            <tr className="total-row">
              <td><strong>TOTAL</strong></td>
              <td className="num"><strong>{formatNumber(data.totals.amount)}</strong></td>
              <td className="num"><strong>{formatNumber(data.totals.fee)}</strong></td>
              <td className="num"><strong>{formatNumber(data.totals.psp_buy_fee)}</strong></td>
              <td className="num"><strong>{data.totals.count}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="app">
      <header>
        <h1>Transfer Guru</h1>
        <p>XLSX Transaction Analysis Tool</p>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="status-section">
        <h2>Data Status</h2>
        {status?.loaded ? (
          <div className="status-info">
            <span className="status-badge loaded">Loaded</span>
            <span>{status.filename} — {status.row_count.toLocaleString()} rows</span>
            <label className="file-upload-btn">
              Load another file
              <input type="file" accept=".xlsx" onChange={handleFileSelect} disabled={loading} />
            </label>
          </div>
        ) : (
          <div className="status-info">
            <span className="status-badge">No data</span>
            <label className="file-upload-btn primary">
              {loading ? (uploadProgress || 'Loading...') : 'Upload XLSX file'}
              <input type="file" accept=".xlsx" onChange={handleFileSelect} disabled={loading} />
            </label>
            {loading && <div className="loading-spinner"></div>}
          </div>
        )}
      </section>

      {summary && (
        <section className="summary-section">
          <h2>Summary by Operation Type</h2>
          <div className="summary-cards">
            {summary.map(s => (
              <div key={s.operation_type} className={`summary-card type-${s.operation_type}`}>
                <h3>{s.name}</h3>
                <div className="summary-stats">
                  <div><label>Count:</label> {s.count.toLocaleString()}</div>
                  <div><label>Amount:</label> {formatNumber(s.total_amount)}</div>
                  <div><label>Fee:</label> {formatNumber(s.total_fee)}</div>
                  <div><label>PSP Fee:</label> {formatNumber(s.total_psp_buy_fee)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {status?.loaded && (
        <section className="filter-section">
          <h2>Pivot Table</h2>

          <div className="filters">
            <div className="filter-group">
              <label>Operation Type:</label>
              <select value={operationType} onChange={e => setOperationType(Number(e.target.value))}>
                {OPERATION_TYPES.map(op => (
                  <option key={op.id} value={op.id}>{op.name} ({op.desc})</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label>View Type:</label>
              <select value={viewType} onChange={e => setViewType(Number(e.target.value))}>
                {VIEW_TYPES.map(vt => (
                  <option key={vt.id} value={vt.id}>{vt.name}</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label>Currency:</label>
              <select value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="">All currencies</option>
                {currencies.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <button onClick={loadPivot} disabled={pivotLoading} className="primary">
              {pivotLoading ? 'Loading...' : 'Generate Pivot'}
            </button>
          </div>

          {pivotData && (
            <div className="pivot-container">
              <h3>
                {OPERATION_TYPES.find(o => o.id === pivotData.operation_type)?.name} —
                {VIEW_TYPES.find(v => v.id === pivotData.view_type)?.desc}
                {pivotData.currency_filter && ` — ${pivotData.currency_filter}`}
              </h3>
              {viewType === 1
                ? renderPivotByAcquirer(pivotData.data)
                : renderPivotByMerchant(pivotData.data)
              }
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export default App
