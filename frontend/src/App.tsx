import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import Admin from './Admin';

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'POLICY_VIOLATION';
  message: string;
  details?: unknown;
}

interface SystemStatus {
  status: 'HEALTHY' | 'CRITICAL' | 'DEGRADED';
  replicas: number;
  lastAlertTime: string | null;
  autoPilotMode: boolean;
}

const API_BASE = 'http://localhost:3001/api';

function App() {
  const [currentPage, setCurrentPage] = useState<'control' | 'admin'>('control');
  const [serviceName, setServiceName] = useState<string | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [mttrStart, setMttrStart] = useState<number | null>(null);
  const [mttrElapsed, setMttrElapsed] = useState<string>('—');
  const [scaleInput, setScaleInput] = useState<string>('5');
  const [actionInProgress, setActionInProgress] = useState(false);

  // Use ref to avoid recreating the polling interval when mttrStart changes
  const mttrStartRef = useRef(mttrStart);
  mttrStartRef.current = mttrStart;

  // Poll status and logs — stable interval, no dependency on mttrStart
  useEffect(() => {
    let active = true;

    const fetchData = async () => {
      try {
        const [statusRes, logsRes, serviceRes] = await Promise.all([
          fetch(`${API_BASE}/status`),
          fetch(`${API_BASE}/logs`),
          fetch(`${API_BASE}/service`),
        ]);
        if (!active) return;

        const statusData: SystemStatus = await statusRes.json();
        const logsData: LogEntry[] = await logsRes.json();
        const serviceData = await serviceRes.json();

        setStatus(statusData);
        setLogs(logsData);
        setServiceName(serviceData.service?.serviceName || null);

        // Start MTTR timer when alert fires
        if (statusData.lastAlertTime && mttrStartRef.current === null) {
          setMttrStart(new Date(statusData.lastAlertTime).getTime());
        }
        // Reset when healthy
        if (statusData.status === 'HEALTHY' && mttrStartRef.current !== null) {
          setMttrStart(null);
        }
      } catch (err) {
        console.error('Failed to fetch data:', err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 1500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []); // empty deps — runs once, polls forever

  // MTTR stopwatch display
  useEffect(() => {
    if (mttrStart === null) {
      setMttrElapsed('—');
      return;
    }

    const tick = () => {
      const elapsed = (Date.now() - mttrStart) / 1000;
      setMttrElapsed(`${elapsed.toFixed(1)}s`);
    };
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [mttrStart]);

  // --- Actions ---
  const triggerAlert = useCallback(async () => {
    setActionInProgress(true);
    try {
      await fetch(`${API_BASE}/trigger-alert`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to trigger alert:', err);
    } finally {
      setActionInProgress(false);
    }
  }, []);

  const triggerScale = useCallback(async () => {
    const replicas = parseInt(scaleInput, 10);
    if (isNaN(replicas)) return;

    setActionInProgress(true);
    try {
      const res = await fetch(`${API_BASE}/scale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replicas }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Scale failed:', data.error);
      }
    } catch (err) {
      console.error('Failed to scale:', err);
    } finally {
      setActionInProgress(false);
    }
  }, [scaleInput]);

  const triggerRollback = useCallback(async () => {
    setActionInProgress(true);
    try {
      await fetch(`${API_BASE}/rollback`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to rollback:', err);
    } finally {
      setActionInProgress(false);
    }
  }, []);

  const toggleAutoPilot = async () => {
    if (!status) return;
    const newState = !status.autoPilotMode;
    try {
      const res = await fetch(`${API_BASE}/autoscale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newState }),
      });
      if (res.ok) {
        // Optimistically update local state or wait for poll
        setStatus({ ...status, autoPilotMode: newState });
      }
    } catch (err) {
      console.error('Failed to toggle AutoPilot:', err);
    }
  };

  // --- Helpers ---
  const getStatusColor = () => {
    switch (status?.status) {
      case 'HEALTHY':
        return '#00FF41';
      case 'CRITICAL':
        return '#FF2D00';
      case 'DEGRADED':
        return '#FFA500';
      default:
        return '#555';
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'ERROR':
        return '#FF2D00';
      case 'POLICY_VIOLATION':
        return '#FF6B00';
      case 'WARN':
        return '#FFA500';
      case 'INFO':
        return '#00B8D4';
      default:
        return '#666';
    }
  };

  return (
    <div className="app">
      <header>
        <h1>🚀 AutoPilot Control Center</h1>
        <p>MCP-Native Remediation Agent — 2 Fast 2 MCP</p>
        <nav className="page-nav">
          <button
            className={`nav-btn ${currentPage === 'control' ? 'active' : ''}`}
            onClick={() => setCurrentPage('control')}
          >
            Control Center
          </button>
          <button
            className={`nav-btn ${currentPage === 'admin' ? 'active' : ''}`}
            onClick={() => setCurrentPage('admin')}
          >
            Admin
          </button>
        </nav>
      </header>

      {currentPage === 'admin' ? (
        <Admin />
      ) : (
        <div className="control-panel">
          {/* Connection Status Indicator */}
          <div className="connection-status">
            {serviceName ? (
              <span className="status-connected">🟢 Connected: {serviceName}</span>
            ) : (
              <span className="status-simulation">⚪ Simulation Mode</span>
            )}
          </div>

          {/* System Status */}
          <div className="status-section">
            <div
              className="status-indicator"
              style={{ backgroundColor: getStatusColor() }}
            >
              <div className="status-label">SYSTEM STATUS</div>
              <div className="status-value">
                {status?.status ?? 'CONNECTING…'}
              </div>
            </div>

            <div className="metrics">
              <div className="metric">
                <span className="metric-label">Replicas</span>
                <span className="metric-value">{status?.replicas ?? '–'}</span>
              </div>
              <div className="metric">
                <span className="metric-label">MTTR</span>
                <span className="metric-value">{mttrElapsed}</span>
              </div>
            </div>
          </div>

          {/* AutoPilot Toggle */}
          <div className="autopilot-section" style={{
            marginBottom: '1rem',
            background: 'rgba(0, 184, 212, 0.1)',
            padding: '1rem',
            borderRadius: '12px',
            border: `1px solid ${status?.autoPilotMode ? '#00b8d4' : '#2a3f5f'}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.5rem' }}>🤖</span>
              <div>
                <div style={{ fontWeight: 'bold', color: '#e0e0e0' }}>AutoPilot Mode</div>
                <div style={{ fontSize: '0.8rem', color: '#78909c' }}>
                  {status?.autoPilotMode ? 'Automatically scales on alert' : 'Manual control only'}
                </div>
              </div>
            </div>
            <button
              onClick={toggleAutoPilot}
              style={{
                background: status?.autoPilotMode ? '#00b8d4' : 'transparent',
                border: `2px solid ${status?.autoPilotMode ? '#00b8d4' : '#78909c'}`,
                color: status?.autoPilotMode ? '#fff' : '#78909c',
                padding: '0.5rem 1rem',
                borderRadius: '20px',
                cursor: 'pointer',
                fontWeight: 'bold',
                transition: 'all 0.3s ease'
              }}
            >
              {status?.autoPilotMode ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Actions */}
          <div className="actions-section">
            <button
              className="action-btn trigger-btn"
              onClick={triggerAlert}
              disabled={actionInProgress || status?.status === 'CRITICAL'}
            >
              🔥 Trigger Alert
            </button>

            <div className="scale-group">
              <input
                type="number"
                className="scale-input"
                min={1}
                max={10}
                value={scaleInput}
                onChange={(e) => setScaleInput(e.target.value)}
              />
              <button
                className="action-btn scale-btn"
                onClick={triggerScale}
                disabled={actionInProgress}
              >
                ⚡ Scale
              </button>
            </div>

            <button
              className="action-btn rollback-btn"
              onClick={triggerRollback}
              disabled={actionInProgress}
            >
              ⏪ Rollback
            </button>
          </div>

          {/* Event Timeline */}
          <div className="timeline-section">
            <h2>Event Timeline</h2>
            <div className="timeline">
              {logs.length === 0 ? (
                <div className="timeline-empty">No events yet</div>
              ) : (
                [...logs].reverse().map((log) => (
                  <div
                    key={`${log.timestamp}-${log.message}`}
                    className="timeline-item"
                  >
                    <div
                      className="timeline-dot"
                      style={{ backgroundColor: getLevelColor(log.level) }}
                    />
                    <div className="timeline-content">
                      <div className="timeline-header">
                        <span
                          className="timeline-level"
                          style={{ color: getLevelColor(log.level) }}
                        >
                          [{log.level}]
                        </span>
                        <span className="timeline-time">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="timeline-message">{log.message}</div>
                      <pre className="timeline-details">
                        {log.details ? JSON.stringify(log.details, null, 2) : ''}
                      </pre>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <footer>
        <p>Built with MCP SDK · Policy-Gated Execution · Full Observability</p>
      </footer>
    </div>
  );
}

export default App;
