import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

function formatChartDateTime(val) {
  if (!val) return '—';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}-${month}-${year} at ${hours}:${minutes}`;
  } catch {
    return String(val);
  }
}

function formatCurrentDateTime(d = new Date()) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${day}-${month}-${year} AT ${hours}:${minutes}:${seconds}`;
}

export default function OccupancyChartModal({ isOpen, onClose }) {
  const { showToast } = useApp();
  const [chartData, setChartData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [viewFilter, setViewFilter] = useState('all'); // 'all' | 'occupied'
  const [searchQuery, setSearchQuery] = useState('');
  const [generatedAt, setGeneratedAt] = useState('');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const res = await api.getOccupancyChart();
      if (res && res.success) {
        setChartData(res.chart || []);
        setSummary(res.summary || null);
        setGeneratedAt(res.generatedAt || new Date().toISOString());
      } else {
        showToast(res?.error || 'Failed to load occupancy chart', 'error', 3000);
      }
    } catch (err) {
      console.error('Error fetching occupancy chart:', err);
      showToast('Could not load occupancy chart: ' + err.message, 'error', 3000);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filtered rows for on-screen viewing
  const displayedRows = useMemo(() => {
    let rows = chartData;
    if (viewFilter === 'occupied') {
      rows = rows.filter((r) => r.is_occupied);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          String(r.room_number).toLowerCase().includes(q) ||
          String(r.guest_name).toLowerCase().includes(q) ||
          String(r.city).toLowerCase().includes(q) ||
          String(r.company).toLowerCase().includes(q) ||
          String(r.reg_no).toLowerCase().includes(q)
      );
    }
    return rows;
  }, [chartData, viewFilter, searchQuery]);

  // Breakfast counts
  const breakfastStats = useMemo(() => {
    const occupied = chartData.filter((r) => r.is_occupied);
    const withBreakfast = occupied.filter((r) => r.breakfast === 'Yes').length;
    const withoutBreakfast = occupied.filter((r) => r.breakfast === 'No').length;
    return { withBreakfast, withoutBreakfast };
  }, [chartData]);

  // Occupied and Empty room lists
  const occupiedRooms = useMemo(() => chartData.filter((r) => r.is_occupied).map((r) => r.room_number), [chartData]);
  const emptyRooms = useMemo(() => chartData.filter((r) => !r.is_occupied).map((r) => r.room_number), [chartData]);

  // Print function matching the exact format from Image 2
  const handlePrint = (filterMode = viewFilter) => {
    let rowsToPrint = chartData;
    if (filterMode === 'occupied') {
      rowsToPrint = chartData.filter((r) => r.is_occupied);
    }

    const printTimeStr = formatCurrentDateTime(new Date(generatedAt || Date.now()));
    const occupiedTotal = summary?.occupiedCount || chartData.filter((r) => r.is_occupied).length;
    const allTotal = summary?.totalRooms || chartData.length;
    const occupancyPercentage = summary?.occupancyPct || (allTotal > 0 ? Math.round((occupiedTotal / allTotal) * 100) : 0);
    const totalGuestsPax = summary?.totalPax || rowsToPrint.filter((r) => r.is_occupied).reduce((sum, r) => sum + (Number(r.pax) || 0), 0);
    const occupiedRoomNumbers = chartData.filter((r) => r.is_occupied).map((r) => r.room_number);
    const emptyRoomNumbers = chartData.filter((r) => !r.is_occupied).map((r) => r.room_number);

    const rowsHtml = rowsToPrint
      .map((r) => {
        if (r.is_occupied) {
          const arrFormatted = formatChartDateTime(r.checkin_time);
          const depFormatted = formatChartDateTime(r.approx_checkout_time);
          return `
            <tr>
              <td class="col-room">${r.room_number}</td>
              <td class="col-reg">${r.reg_no || '—'}</td>
              <td class="col-guest">${r.guest_name || 'GUEST'}</td>
              <td class="col-company">${r.company || ''}</td>
              <td class="col-dis">${r.discount_pct || ''}</td>
              <td class="col-city">${r.city || ''}</td>
              <td class="col-breakfast">${r.breakfast || 'No'}</td>
              <td class="col-pax">${r.pax || '1'}</td>
              <td class="col-dates">
                <div class="date-arr">${arrFormatted}</div>
                <div class="dotted-sep"></div>
                <div class="date-dep">${depFormatted}</div>
              </td>
            </tr>
          `;
        } else {
          return `
            <tr class="row-vacant">
              <td class="col-room">${r.room_number}</td>
              <td class="col-reg"></td>
              <td class="col-guest"></td>
              <td class="col-company"></td>
              <td class="col-dis"></td>
              <td class="col-city"></td>
              <td class="col-breakfast"></td>
              <td class="col-pax"></td>
              <td class="col-dates"></td>
            </tr>
          `;
        }
      })
      .join('');

    const printHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Room Occupancy Chart - Hotel City Park</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 8mm 6mm;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body {
            font-family: Arial, Helvetica, sans-serif;
            color: #000;
            background: #fff;
            margin: 0;
            padding: 4px;
            font-size: 11px;
            line-height: 1.25;
          }
          .chart-header {
            text-align: center;
            margin-bottom: 6px;
          }
          .chart-title {
            font-size: 18px;
            font-weight: 900;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin: 0 0 4px 0;
          }
          .chart-subrow {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            font-size: 11.5px;
            font-weight: 700;
            border-bottom: 1.5px solid #000;
            padding-bottom: 4px;
            margin-bottom: 6px;
          }
          .chart-room-status-list {
            flex: 1;
            margin: 0 14px;
            font-size: 9.5px;
            line-height: 1.35;
            text-align: left;
            font-weight: 500;
          }
          .chart-room-status-list b {
            font-weight: 800;
          }
          .chart-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10.5px;
            border: 1.5px solid #000;
          }
          .chart-table th {
            border: 1px solid #000;
            padding: 5px 3px;
            background: #f8fafc;
            font-weight: 800;
            text-transform: capitalize;
            font-size: 10.5px;
          }
          .chart-table td {
            border: 1px solid #000;
            padding: 4px 4px;
            vertical-align: middle;
          }
          .col-room { width: 5.5%; text-align: center; font-weight: 800; font-size: 11px; }
          .col-reg { width: 7.5%; text-align: center; }
          .col-guest { width: 23%; text-align: left; font-weight: 700; }
          .col-company { width: 17%; text-align: left; font-size: 10px; }
          .col-dis { width: 6.5%; text-align: center; }
          .col-city { width: 10.5%; text-align: left; }
          .col-breakfast { width: 7.5%; text-align: center; font-weight: 700; }
          .col-pax { width: 4.5%; text-align: center; font-weight: 700; }
          .col-dates { width: 18%; text-align: center; font-size: 9.5px; line-height: 1.2; padding: 2px 3px; }
          
          /* Dotted line between Arrival and Departure */
          .dotted-sep {
            border-top: 1.2px dotted #000;
            margin: 2.5px 0;
            width: 100%;
          }
          .date-arr { font-weight: 600; }
          .date-dep { font-weight: 600; }

          .row-vacant td {
            height: 20px;
          }

          /* Bottom Summary Row */
          .chart-summary-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border: 1.5px solid #000;
            border-top: none;
            padding: 6px 12px;
            font-weight: 900;
            font-size: 12px;
            background: #fafafa;
          }
        </style>
      </head>
      <body>
        <div class="chart-header">
          <div class="chart-title">HOTEL CITY PARK</div>
          <div class="chart-subrow">
            <div style="font-weight: 800; white-space: nowrap;">ROOM OCCUPANCY CHART</div>
            <div class="chart-room-status-list">
              <div><b>Occupied (${occupiedRoomNumbers.length}):</b> ${occupiedRoomNumbers.join(', ') || 'None'}</div>
              <div><b>Empty (${emptyRoomNumbers.length}):</b> ${emptyRoomNumbers.join(', ') || 'None'}</div>
            </div>
            <div style="font-weight: 800; white-space: nowrap;">AS ON ${printTimeStr}</div>
          </div>
        </div>

        <table class="chart-table">
          <thead>
            <tr>
              <th class="col-room">Room #</th>
              <th class="col-reg">Reg. No.</th>
              <th class="col-guest">Guest Name</th>
              <th class="col-company">Company</th>
              <th class="col-dis">Dis. %</th>
              <th class="col-city">City</th>
              <th class="col-breakfast">Breakfast</th>
              <th class="col-pax">Pax</th>
              <th class="col-dates">
                <div>Arr. Date & Time</div>
                <div style="border-top: 1px dotted #000; margin: 1px 0;"></div>
                <div>Dep. Date & Time</div>
              </th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <div class="chart-summary-row">
          <div>ROOM OCCUPANCY : ${occupiedTotal} / ${allTotal} (${occupancyPercentage}%)</div>
          <div>TOTAL PAX : ${totalGuestsPax}</div>
        </div>

        <script>
          window.onload = function() {
            window.focus();
            window.print();
            setTimeout(function() { window.close(); }, 800);
          };
        </script>
      </body>
      </html>
    `;

    const printWin = window.open('', '_blank', 'width=1000,height=800');
    if (printWin) {
      printWin.document.open();
      printWin.document.write(printHtml);
      printWin.document.close();
    } else {
      showToast('Pop-up blocked. Please allow pop-ups to print the occupancy chart.', 'warning', 4000);
    }
  };

  if (!isOpen) return null;

  const occupiedCount = summary?.occupiedCount || chartData.filter((r) => r.is_occupied).length;
  const totalRoomsCount = summary?.totalRooms || chartData.length;
  const occupancyPercentage = summary?.occupancyPct || (totalRoomsCount > 0 ? Math.round((occupiedCount / totalRoomsCount) * 100) : 0);
  const totalInHousePax = summary?.totalPax || chartData.filter((r) => r.is_occupied).reduce((sum, r) => sum + (Number(r.pax) || 0), 0);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.2s ease-out'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '1280px',
          maxHeight: '92vh',
          background: 'var(--bg-app, #ffffff)',
          color: 'var(--text-primary, #0f172a)',
          borderRadius: '16px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1.5px solid var(--border-medium, #cbd5e1)'
        }}
      >
        {/* Modern Modal Header */}
        <div
          style={{
            padding: '16px 22px',
            borderBottom: '1px solid var(--border-medium, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-surface, #f8fafc)',
            flexWrap: 'wrap',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.25rem',
                boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)'
              }}
            >
              📋
            </div>
            <div>
              <h2
                style={{
                  fontSize: '1.22rem',
                  fontWeight: 850,
                  margin: 0,
                  color: 'var(--text-primary, #0f172a)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                Room Occupancy Chart
              </h2>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)', fontWeight: 600 }}>
                Hotel City Park · In-house guests, meal plans, pax allotment & departure schedule
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* View Mode Toggle */}
            <div
              style={{
                display: 'flex',
                background: 'var(--bg-surface-secondary, #e2e8f0)',
                padding: '2.5px',
                borderRadius: '10px',
                border: '1px solid var(--border-subtle, #cbd5e1)'
              }}
            >
              <button
                type="button"
                onClick={() => setViewFilter('all')}
                style={{
                  padding: '4px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: 750,
                  cursor: 'pointer',
                  background: viewFilter === 'all' ? 'var(--bg-surface, #ffffff)' : 'transparent',
                  color: viewFilter === 'all' ? '#0284c7' : 'var(--text-secondary, #64748b)',
                  boxShadow: viewFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                All Rooms ({totalRoomsCount})
              </button>
              <button
                type="button"
                onClick={() => setViewFilter('occupied')}
                style={{
                  padding: '4px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: 750,
                  cursor: 'pointer',
                  background: viewFilter === 'occupied' ? 'var(--bg-surface, #ffffff)' : 'transparent',
                  color: viewFilter === 'occupied' ? '#0284c7' : 'var(--text-secondary, #64748b)',
                  boxShadow: viewFilter === 'occupied' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                Occupied Only ({occupiedCount})
              </button>
            </div>

            {/* Refresh */}
            <button
              type="button"
              onClick={loadData}
              disabled={isLoading}
              title="Refresh live room occupancy data"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                borderRadius: '10px',
                border: '1px solid var(--border-medium, #cbd5e1)',
                background: 'var(--bg-surface, #ffffff)',
                color: 'var(--text-primary, #334155)',
                fontWeight: 700,
                fontSize: '0.78rem',
                cursor: 'pointer'
              }}
            >
              <span style={{ display: 'inline-block', transform: isLoading ? 'rotate(180deg)' : 'none', transition: 'transform 0.4s ease' }}>
                🔄
              </span>
              <span>Refresh</span>
            </button>

            {/* Print Button (Exact Formate) */}
            <button
              type="button"
              id="btn-print-occupancy-chart"
              onClick={() => handlePrint(viewFilter)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 16px',
                borderRadius: '10px',
                border: 'none',
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.82rem',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(2, 132, 199, 0.35)',
                transition: 'all 0.15s ease'
              }}
            >
              <span>🖨️</span>
              <span>Print Chart</span>
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.2rem',
                cursor: 'pointer',
                color: 'var(--text-secondary, #64748b)',
                padding: '4px 8px',
                borderRadius: '8px'
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modern KPI Summary Strip */}
        <div
          style={{
            padding: '10px 22px',
            background: 'var(--bg-surface-secondary, rgba(241, 245, 249, 0.8))',
            borderBottom: '1px solid var(--border-subtle, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap'
          }}
        >
          {/* Quick Metrics */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.82rem' }}>
              <span style={{ color: 'var(--text-secondary, #64748b)', fontWeight: 600 }}>Occupancy: </span>
              <strong style={{ color: '#0284c7', fontWeight: 800 }}>
                {occupiedCount} / {totalRoomsCount} ({occupancyPercentage}%)
              </strong>
            </div>

            <div style={{ fontSize: '0.82rem' }}>
              <span style={{ color: 'var(--text-secondary, #64748b)', fontWeight: 600 }}>Total In-House Pax: </span>
              <strong style={{ color: '#0f172a', fontWeight: 800 }}>{totalInHousePax} Guests</strong>
            </div>

            <div style={{ fontSize: '0.82rem' }}>
              <span style={{ color: 'var(--text-secondary, #64748b)', fontWeight: 600 }}>Breakfast: </span>
              <span style={{ background: '#dcfce7', color: '#15803d', padding: '1px 7px', borderRadius: '10px', fontWeight: 800, fontSize: '0.74rem' }}>
                Yes: {breakfastStats.withBreakfast}
              </span>{' '}
              <span style={{ background: '#f1f5f9', color: '#475569', padding: '1px 7px', borderRadius: '10px', fontWeight: 800, fontSize: '0.74rem' }}>
                No: {breakfastStats.withoutBreakfast}
              </span>
            </div>
          </div>

          {/* Quick Search */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search room, guest, city..."
              style={{
                padding: '4px 10px 4px 28px',
                fontSize: '0.78rem',
                borderRadius: '8px',
                border: '1px solid var(--border-medium, #cbd5e1)',
                background: 'var(--bg-surface, #ffffff)',
                color: 'var(--text-primary, #0f172a)',
                outline: 'none',
                width: '210px'
              }}
            />
            <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.72rem', opacity: 0.6 }}>
              🔍
            </span>
          </div>
        </div>

        {/* Scrollable Table Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          {isLoading ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-secondary, #64748b)' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '8px', animation: 'spin 1s linear infinite' }}>⏳</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Loading live room occupancy chart...</div>
            </div>
          ) : (
            <div
              style={{
                border: '1.5px solid var(--border-medium, #cbd5e1)',
                borderRadius: '12px',
                overflow: 'hidden',
                background: 'var(--bg-surface, #ffffff)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
              }}
            >
              {/* Official Table Header Banner */}
              <div
                style={{
                  padding: '12px 16px 8px 16px',
                  borderBottom: '2px solid var(--border-medium, #0f172a)',
                  background: 'var(--bg-surface-secondary, #f8fafc)'
                }}
              >
                <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.1rem', letterSpacing: '0.5px' }}>
                  HOTEL CITY PARK
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-end',
                    marginTop: '4px',
                    fontSize: '0.8rem',
                    fontWeight: 750,
                    color: 'var(--text-secondary, #475569)'
                  }}
                >
                  <div style={{ color: 'var(--text-primary, #0f172a)', fontWeight: 800, whiteSpace: 'nowrap' }}>ROOM OCCUPANCY CHART</div>
                  <div style={{ flex: 1, margin: '0 14px', fontSize: '0.75rem', lineHeight: 1.35, textAlign: 'left' }}>
                    <div>
                      <span style={{ fontWeight: 800, color: '#166534' }}>Occupied ({occupiedRooms.length}): </span>
                      <span style={{ color: 'var(--text-primary, #0f172a)' }}>{occupiedRooms.join(', ') || 'None'}</span>
                    </div>
                    <div>
                      <span style={{ fontWeight: 800, color: '#475569' }}>Empty ({emptyRooms.length}): </span>
                      <span style={{ color: 'var(--text-primary, #0f172a)' }}>{emptyRooms.join(', ') || 'None'}</span>
                    </div>
                  </div>
                  <div style={{ whiteSpace: 'nowrap' }}>AS ON {formatCurrentDateTime(new Date(generatedAt || Date.now()))}</div>
                </div>
              </div>

              {/* Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface-secondary, #f1f5f9)', borderBottom: '1.5px solid var(--border-medium, #cbd5e1)' }}>
                    <th style={{ padding: '8px 6px', textAlign: 'center', width: '6%', fontWeight: 800, borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>Room #</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', width: '8%', fontWeight: 800, borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>Reg. No.</th>
                    <th style={{ padding: '8px 8px', textAlign: 'left', width: '22%', fontWeight: 800, borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>Guest Name</th>
                    <th style={{ padding: '8px 8px', textAlign: 'left', width: '17%', fontWeight: 800, borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>Company</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', width: '7%', fontWeight: 800, borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>Dis. %</th>
                    <th style={{ padding: '8px 8px', textAlign: 'left', width: '11%', fontWeight: 800, borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>City</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', width: '8%', fontWeight: 800, borderRight: '1px solid var(--border-subtle, #e2e8f0)', background: '#eff6ff' }}>
                      Breakfast
                    </th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', width: '5%', fontWeight: 800, borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>Pax</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', width: '16%', fontWeight: 800 }}>
                      <div>Arr. Date & Time</div>
                      <div style={{ borderTop: '1px dotted #94a3b8', margin: '2px 0' }} />
                      <div>Dep. Date & Time</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.length === 0 ? (
                    <tr>
                      <td colSpan="9" style={{ padding: '30px', textAlign: 'center', color: 'var(--text-secondary, #64748b)', fontStyle: 'italic' }}>
                        No room records found matching the filter.
                      </td>
                    </tr>
                  ) : (
                    displayedRows.map((r, idx) => {
                      const isEven = idx % 2 === 0;
                      if (r.is_occupied) {
                        return (
                          <tr
                            key={r.room_number}
                            style={{
                              background: isEven ? 'var(--bg-surface, #ffffff)' : 'var(--bg-surface-secondary, rgba(248, 250, 252, 0.7))',
                              borderBottom: '1px solid var(--border-subtle, #e2e8f0)',
                              transition: 'background 0.1s ease'
                            }}
                          >
                            <td style={{ padding: '7px 6px', textAlign: 'center', fontWeight: 850, borderRight: '1px solid var(--border-subtle, #e2e8f0)', color: '#0284c7' }}>
                              #{r.room_number}
                            </td>
                            <td style={{ padding: '7px 6px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 600, borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>
                              {r.reg_no || '—'}
                            </td>
                            <td style={{ padding: '7px 8px', fontWeight: 750, color: 'var(--text-primary, #0f172a)', borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>
                              {r.guest_name || 'GUEST'}
                            </td>
                            <td style={{ padding: '7px 8px', fontSize: '0.78rem', color: 'var(--text-secondary, #475569)', borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>
                              {r.company || '—'}
                            </td>
                            <td style={{ padding: '7px 6px', textAlign: 'center', borderRight: '1px solid var(--border-subtle, #e2e8f0)', fontWeight: 650 }}>
                              {r.discount_pct ? `${r.discount_pct}%` : '—'}
                            </td>
                            <td style={{ padding: '7px 8px', fontWeight: 650, borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>
                              {r.city || '—'}
                            </td>
                            {/* Breakfast Column */}
                            <td style={{ padding: '7px 6px', textAlign: 'center', borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 9px',
                                  borderRadius: '12px',
                                  fontSize: '0.74rem',
                                  fontWeight: 800,
                                  background: r.breakfast === 'Yes' ? '#dcfce7' : '#f1f5f9',
                                  color: r.breakfast === 'Yes' ? '#15803d' : '#64748b',
                                  border: r.breakfast === 'Yes' ? '1px solid #bbf7d0' : '1px solid #e2e8f0'
                                }}
                              >
                                {r.breakfast || 'No'}
                              </span>
                            </td>
                            <td style={{ padding: '7px 6px', textAlign: 'center', fontWeight: 800, borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}>
                              {r.pax || 1}
                            </td>
                            {/* Arrive & Depart with Dotted Line */}
                            <td style={{ padding: '4px 6px', textAlign: 'center', fontSize: '0.76rem', lineHeight: 1.25 }}>
                              <div style={{ color: '#0369a1', fontWeight: 700 }}>
                                {formatChartDateTime(r.checkin_time)}
                              </div>
                              <div style={{ borderTop: '1px dotted var(--border-medium, #94a3b8)', margin: '3px 0' }} />
                              <div style={{ color: '#475569', fontWeight: 600 }}>
                                {formatChartDateTime(r.approx_checkout_time)}
                              </div>
                            </td>
                          </tr>
                        );
                      } else {
                        // Vacant / Ready room row
                        return (
                          <tr
                            key={r.room_number}
                            style={{
                              background: isEven ? 'var(--bg-surface, #ffffff)' : 'var(--bg-surface-secondary, rgba(248, 250, 252, 0.4))',
                              borderBottom: '1px solid var(--border-subtle, #e2e8f0)',
                              opacity: 0.65
                            }}
                          >
                            <td style={{ padding: '6px', textAlign: 'center', fontWeight: 700, borderRight: '1px solid var(--border-subtle, #e2e8f0)', color: '#64748b' }}>
                              #{r.room_number}
                            </td>
                            <td style={{ padding: '6px', borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}></td>
                            <td style={{ padding: '6px', borderRight: '1px solid var(--border-subtle, #e2e8f0)', color: '#94a3b8', fontStyle: 'italic', fontSize: '0.74rem' }}>
                              Ready / Available
                            </td>
                            <td style={{ padding: '6px', borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}></td>
                            <td style={{ padding: '6px', borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}></td>
                            <td style={{ padding: '6px', borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}></td>
                            <td style={{ padding: '6px', borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}></td>
                            <td style={{ padding: '6px', borderRight: '1px solid var(--border-subtle, #e2e8f0)' }}></td>
                            <td style={{ padding: '6px' }}></td>
                          </tr>
                        );
                      }
                    })
                  )}
                </tbody>
              </table>

              {/* Bottom Summary Bar */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 16px',
                  background: 'var(--bg-surface-secondary, #f8fafc)',
                  borderTop: '2px solid var(--border-medium, #0f172a)',
                  fontWeight: 850,
                  fontSize: '0.86rem'
                }}
              >
                <div>
                  ROOM OCCUPANCY : {occupiedCount} / {totalRoomsCount} ({occupancyPercentage}%)
                </div>
                <div>TOTAL PAX : {totalInHousePax}</div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '12px 22px',
            borderTop: '1px solid var(--border-subtle, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-surface, #f8fafc)'
          }}
        >
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary, #64748b)' }}>
            💡 <strong>Print Tip:</strong> Click &quot;Print Chart&quot; to print directly to A4 paper in the exact hotel format.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 16px',
                borderRadius: '8px',
                border: '1px solid var(--border-medium, #cbd5e1)',
                background: 'var(--bg-surface, #ffffff)',
                color: 'var(--text-primary, #334155)',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer'
              }}
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => handlePrint(viewFilter)}
              style={{
                padding: '6px 18px',
                borderRadius: '8px',
                border: 'none',
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.8rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)'
              }}
            >
              <span>🖨️</span>
              <span>Print Occupancy Chart</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
