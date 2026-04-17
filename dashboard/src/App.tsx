import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  XAxis, Tooltip, ResponsiveContainer, AreaChart, Area 
} from 'recharts';
import './index.css';

// VS Code API Bridge
const vscode = (window as any).acquireVsCodeApi ? (window as any).acquireVsCodeApi() : null;

// --- Minimal SVG Icons ---
const IconLeaf = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 3.5 1 8.8C19 14 15.5 20 11 20z" />
    <path d="M7 20c-1.5 0-3-1-3-3 0-3.9 4-6 4-6s.7 3.7 3 6c1.2 1.2 1.5 3 1.5 3" />
  </svg>
);

const IconTrend = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </svg>
);

const IconVampire = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <polyline points="13 2 13 9 20 9" />
    <path d="M8 13h8" /><path d="M8 17h8" /><path d="M10 9H8" />
  </svg>
);

const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconJump = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);

// --- Components ---

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="custom-tooltip">
        <p className="tooltip-commit">COMMIT #{data.timestamp}</p>
        <p className="tooltip-msg">{data.commit}</p>
        <p className="tooltip-score">Sustainability Score: <span>{data.score}%</span></p>
      </div>
    );
  }
  return null;
};

const useCountUp = (target: number, duration: number = 1000) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const initialValue = count;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const currentCount = Math.floor(progress * (target - initialValue) + initialValue);
      setCount(currentCount);
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };

    window.requestAnimationFrame(step);
  }, [target, duration]);

  return count;
};

const PAGE_SIZE = 6;

const App: React.FC = () => {
  const [report, setReport] = useState<any>({
    projectName: 'Loading...',
    lastUpdate: new Date().toISOString(),
    score: 100,
    sustainabilityScore: 100,
    vampiresDetected: 0,
    totalDeltaE_millijoules: 0,
    totalCO2_mg_potential: 0,
    carbonRecoveryPotential: 0,
    carbonAlreadyRecovered: 0,
    totalLinesOfCode: 0,
    languages: [],
    vampireInstances: []
  });

  const [isAuditing, setIsAuditing] = useState(false);

  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRange, setSelectedRange] = useState<string>('5C');
  
  const [rawHistory, setRawHistory] = useState<any[]>([]);
  const [displayHistory, setDisplayHistory] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'updateReport') {
        setReport(message.data);
        setCurrentPage(1);
        setIsAuditing(false); // scan complete — restore button
      } else if (message.type === 'historyPoint') {
        setRawHistory(prev => [...prev, message.data]);
      } else if (message.type === 'historyComplete') {
        setIsGenerating(false);
      }
    });

    if (vscode) {
      vscode.postMessage({ type: 'ready' });
    }
  }, []);

  // Sequential Display Engine (Cinematic Draw)
  useEffect(() => {
    if (!isGenerating && rawHistory.length > 0) {
      // Small delay after generating overlay disappears for maximum impact
      const timer = setTimeout(() => {
        setDisplayHistory(rawHistory);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isGenerating, rawHistory]);

  const prevRangeRef = useRef<string>('');
  useEffect(() => {
    if (vscode && selectedRange !== prevRangeRef.current) {
        prevRangeRef.current = selectedRange;
        setIsGenerating(true);
        setRawHistory([]);
        setDisplayHistory([]);
        let limit = 5;
        if (selectedRange === '1C') limit = 1;
        if (selectedRange === '10C') limit = 10;
        if (selectedRange === 'MAX') limit = -1;
        vscode.postMessage({ type: 'requestHistory', limit });
    }
  }, [selectedRange]);

  const animatedScore = useCountUp(Math.round(report.sustainabilityScore ?? report.score));
  const animatedVampires = useCountUp(report.vampiresDetected);
  // Physics: show totalDeltaE in tenths of mJ (×10 for integer counter, display ÷10)
  const animatedDeltaE_x10 = useCountUp(Math.round((report.totalDeltaE_millijoules ?? 0) * 10));
  const animatedCO2_mg_x100 = useCountUp(Math.round((report.totalCO2_mg_potential ?? 0) * 100));
  const animatedLOC = useCountUp(report.totalLinesOfCode ?? 0);

  // Custom Dot for Staggered Appearance
  const CustomDot = (props: any) => {
    const { cx, cy, index } = props;
    if (cx === undefined || cy === undefined) return null;
    
    return (
      <circle 
        cx={cx} cy={cy} r={3} 
        fill="var(--accent-green)" 
        stroke="#fff" 
        strokeWidth={1}
        className="staggered-dot"
        style={{ animationDelay: `${2.0 + index * 0.12}s` }}
      />
    );
  };

  const formatCodeText = (text: string) => {
    return text
      .replace(/\^3/g, '³')
      .replace(/\^2/g, '²')
      .replace(/O\(n\)/g, '𝒪(n)')
      .replace(/O\(n²/g, '𝒪(n²')
      .replace(/O\(n³/g, '𝒪(n³');
  };

  const getEfficiencyMsg = () => {
    const count = report.vampiresDetected;
    const ss = report.sustainabilityScore ?? report.score;
    const co2mg = ((report.totalCO2_mg_potential) ?? 0).toFixed(3);

    if (ss >= 100) {
      return (
        <div className="efficiency-msg-wrapper">
          <div className="status-header" style={{ color: 'var(--accent-green)' }}>ELITE STATUS ACHIEVED</div>
          <div className="status-sub">Your code is currently <span className="accent-elite">100% GREEN</span>. Zero energy waste detected.</div>
        </div>
      );
    }

    if (ss > 80) {
      return (
        <div className="efficiency-msg-wrapper">
          <div className="status-header" style={{ color: 'var(--accent-green)' }}>HIGHLY EFFICIENT</div>
          <div className="status-sub">
            Fix <span className="accent-num">{count}</span> vampire{count !== 1 ? 's' : ''} to reach <span className="accent-elite">ELITE</span>.
            Potential CO₂ recovery: <span className="accent-num">{co2mg} mg</span>.
          </div>
        </div>
      );
    }

    if (ss > 50) {
      const half = Math.ceil(count / 2);
      return (
        <div className="efficiency-msg-wrapper">
          <div className="status-header" style={{ color: '#ffbb28' }}>MODERATE EFFICIENCY</div>
          <div className="status-sub">
            Fixing <span className="accent-num">{half}</span> vampire{half !== 1 ? 's' : ''} will boost SS to <span className="accent-elite">GREEN</span> tier.
          </div>
        </div>
      );
    }

    return (
      <div className="efficiency-msg-wrapper">
        <div className="status-header" style={{ color: 'var(--vampire-red)' }}>CRITICAL INEFFICIENCY</div>
        <div className="status-sub">
          Fixing all vampires would recover <span className="accent-num">{co2mg} mg</span> CO₂.
        </div>
      </div>
    );
  };

  const filteredInstances = useMemo(() => {
    if (filterCategory === 'All') return report.vampireInstances || [];
    return (report.vampireInstances || []).filter((inst: any) => inst.category === filterCategory);
  }, [report.vampireInstances, filterCategory]);

  const totalPages = Math.ceil(filteredInstances.length / PAGE_SIZE);
  const displayInstances = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredInstances.slice(start, start + PAGE_SIZE);
  }, [filteredInstances, currentPage]);

  const handleJumpToCode = (instance: any) => {
    if (vscode) {
      vscode.postMessage({
        type: 'openFile',
        data: {
          fullPath: instance.fullPath,
          line: instance.line,
          character: instance.character
        }
      });
    }
  };

  const handleAuditNow = () => {
    if (!vscode || isAuditing) return;
    setIsAuditing(true);
    vscode.postMessage({ type: 'auditNow' });
  };

  const categories = ['All', 'CPU', 'Memory', 'I/O', 'Algorithmic'];
  const ranges = ['1C', '5C', '10C', 'MAX'];

  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animatedScore / 100) * circumference;

  const getScoreColor = () => {
    if (report.score > 80) return 'var(--accent-green)';
    if (report.score > 50) return '#ffbb28';
    return 'var(--vampire-red)';
  };

  return (
    <div className="dashboard-container animate">
      <header>
        <div className="brand">
          <div className="brand-icon"><IconLeaf /></div>
          <h1>Code-Green</h1>
        </div>
        <div className="project-info">
          <span className="project-name">{report.projectName}</span>
          <div className="audit-row">
            <span className="last-update">Last Audit: {new Date(report.lastUpdate).toLocaleTimeString()}</span>
            <button
              id="audit-now-btn"
              className={`audit-now-btn${isAuditing ? ' auditing' : ''}`}
              onClick={handleAuditNow}
              disabled={isAuditing}
              title="Recalibrate hardware weights and re-run full workspace audit"
            >
              {isAuditing ? (
                <><span className="audit-spinner" />Auditing...</>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  Audit Now
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="main-grid">
        <div className="span-small">
          <div className="glass-card score-section">
            <div className="card-header-simple">
              <div className="icon-wrap green"><IconLeaf /></div>
              <h3>Sustainability Score</h3>
            </div>
            <div className="score-container">
              <div className="score-gauge-svg">
                <svg width="200" height="200" viewBox="0 0 200 200">
                  <circle cx="100" cy="100" r={radius} fill="transparent" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="12" />
                  <circle cx="100" cy="100" r={radius} fill="transparent" stroke={getScoreColor()} strokeWidth="12" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 100 100)" style={{ transition: 'stroke-dashoffset 1s ease-out, stroke 1s ease' }} />
                </svg>
                <div className="score-value-overlay">
                  <span className="score-number">{animatedScore}</span>
                  <span className="score-percent">%</span>
                </div>
              </div>
              <div className="score-label">SS = 100 − (Σ sev·W) × log₁₀(LOC)</div>
              <div className="efficiency-msg">{getEfficiencyMsg()}</div>
            </div>
          </div>

          <div className="glass-card impact-section">
            <div className="card-header-simple">
              <div className="icon-wrap blue"><IconTrend /></div>
              <h3>Energy Impact</h3>
            </div>
            <div className="stats-box-grid">
              <div className="stat-card">
                <div className="stat-label">Vampires Found</div>
                <div className="stat-value red">{animatedVampires}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total ΔE Wasted</div>
                <div className="stat-value blue">{(animatedDeltaE_x10 / 10).toFixed(1)} mJ</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">CO₂ Recoverable</div>
                <div className="stat-value green">{(animatedCO2_mg_x100 / 100).toFixed(2)} mg</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Lines Audited</div>
                <div className="stat-value" style={{color:'var(--text-secondary)'}}>{animatedLOC.toLocaleString()}</div>
              </div>
            </div>
            <div className="languages-container">
               <div className="small-label">FLEET COVERAGE</div>
               <div className="language-tags">
                 {report.languages && report.languages.length > 0 ? report.languages.map((lang: string) => (
                   <span key={lang} className="lang-tag">{lang}</span>
                 )) : <span className="lang-tag grey">Unknown</span>}
               </div>
            </div>
          </div>
        </div>

        <div className="span-large-modular">
          <div className="glass-card trend-section-card">
            <div className="trend-header-row">
              <div className="trend-header-left">
                <div className="card-title-row">
                  <div className="icon-wrap green"><IconTrend /></div>
                  <h3>Sustainability Evolution</h3>
                </div>
                <p className="subtitle">Audit history derived from Git commits.</p>
              </div>
              <div className="trend-range-selector">
                {ranges.map(range => (
                  <button key={range} className={`range-btn ${selectedRange === range ? 'active' : ''}`} onClick={() => setSelectedRange(range)}> {range} </button>
                ))}
              </div>
            </div>
            <div className="chart-container-relative">
              {isGenerating ? (
                <div className="generating-overlay">
                   <div className="spinner-wrap"><IconLeaf /></div>
                   <span>Trend Generating...</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={150}>
                  <AreaChart 
                    key={`chart-${displayHistory.length}-${selectedRange}`} 
                    data={displayHistory} 
                    margin={{ top: 20, right: 30, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent-green)" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="var(--accent-green)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <Tooltip content={<CustomTooltip />} />
                    <Area 
                      type="monotone" 
                      dataKey="score" 
                      stroke="var(--accent-green)" 
                      fillOpacity={1} 
                      fill="url(#colorScore)" 
                      strokeWidth={3} 
                      dot={<CustomDot />}
                      activeDot={{ r: 5, fill: '#fff', stroke: 'var(--accent-green)', strokeWidth: 2 }} 
                      isAnimationActive={true}
                      animationDuration={2000}
                      animationEasing="ease-in-out"
                    />
                    <XAxis dataKey="timestamp" stroke="var(--text-secondary)" fontSize={10} tickLine={false} axisLine={false} padding={{ left: 20, right: 20 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="glass-card vampires-section-card">
            <div className="card-header">
              <div className="header-left">
                <div className="card-title-row">
                  <div className="icon-wrap red"><IconSearch /></div>
                  <h3>Detected Energy Vampires</h3>
                </div>
                <div className="card-sub">{filteredInstances.length} occurrences matching filter</div>
              </div>
              <div className="header-right">
                <select className="filter-select" value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setCurrentPage(1); }}>
                  {categories.map(cat => ( <option key={cat} value={cat}>{cat} Impact</option> ))}
                </select>
              </div>
            </div>

            <div className="vampire-list-container">
              {displayInstances.length === 0 ? (
                <div className="empty-state">
                  <div className="icon-wrap grey large"><IconLeaf /></div>
                  <p>No energy vampires matching this category!</p>
                </div>
              ) : (
                <>
                  <ul className="vampire-list">
                    {displayInstances.map((instance: any, idx: number) => (
                      <li key={idx} className="vampire-item animate" style={{ animationDelay: `${idx * 0.05}s` }}>
                        <div className="vampire-icon"><IconVampire /></div>
                        <div className="vampire-info">
                          <div className="vampire-title-row">
                            <span className="vampire-title">{formatCodeText(instance.description)}</span>
                            <span className="vampire-file">{instance.fileName}:{instance.line + 1}</span>
                          </div>
                          <div className="vampire-meta-row">
                            <span className="vampire-cat-tag">{instance.category}</span>
                            <span className="vampire-cat-tag" style={{background:'rgba(255,100,0,0.15)',color:'#ff9055'}}>W={instance.energyWeight}</span>
                            {instance.deltaE_millijoules != null && (
                              <span className="vampire-desc">ΔE: {(instance.deltaE_millijoules).toFixed(3)} mJ</span>
                            )}
                            {instance.co2_micrograms != null && (
                              <span className="vampire-desc">CO₂: {(instance.co2_micrograms).toFixed(2)} μg</span>
                            )}
                          </div>
                        </div>
                        <button className="jump-btn" onClick={() => handleJumpToCode(instance)} title="Jump to Line">
                          <IconJump />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {totalPages > 1 && (
                    <div className="pagination">
                      <button className="pag-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>Prev</button>
                      <span className="pag-info">Page {currentPage} of {totalPages}</span>
                      <button className="pag-btn" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next</button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
