/**
 * Chart utilities for OddOdd Dashboard
 * Lightweight, fast, static-host friendly
 */

// Data cache to avoid refetching
const dataCache = new Map();

/**
 * Parse series from raw data format
 * Input: [{value: number, timestamp: string}, ...]
 * Output: [{t: Date, v: number}, ...] sorted by date ascending
 */
function parseSeries(raw) {
    if (!raw || !Array.isArray(raw)) return [];
    
    return raw
        .map(p => ({
            t: new Date(p.timestamp || p.date),
            v: parseFloat(p.value)
        }))
        .filter(p => !isNaN(p.v) && !isNaN(p.t.getTime()))
        .sort((a, b) => a.t - b.t);
}

/**
 * Filter series by date range
 */
function filterByRange(series, start, end) {
    if (!series || series.length === 0) return [];
    
    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end) : null;
    
    return series.filter(p => {
        if (startDate && p.t < startDate) return false;
        if (endDate && p.t > endDate) return false;
        return true;
    });
}

/**
 * Normalize series based on mode
 * Modes: raw, index100, pct, minmax
 */
function normalize(series, mode) {
    if (!series || series.length === 0) return [];
    if (mode === 'raw') return series;
    
    const values = series.map(p => p.v);
    const first = values[0];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    
    return series.map(p => {
        let v = p.v;
        switch (mode) {
            case 'index100':
                v = first !== 0 ? (p.v / first) * 100 : 100;
                break;
            case 'pct':
                v = first !== 0 ? ((p.v / first) - 1) * 100 : 0;
                break;
            case 'minmax':
                v = range !== 0 ? ((p.v - min) / range) * 100 : 50;
                break;
        }
        return { t: p.t, v };
    });
}

/**
 * Get range presets
 */
const RANGE_PRESETS = {
    '7D': 7,
    '30D': 30,
    '90D': 90,
    '6M': 180,
    '1Y': 365,
    'MAX': null
};

function getPresetRange(preset, series) {
    if (preset === 'MAX' || !series || series.length === 0) {
        return { start: null, end: null };
    }
    
    const days = RANGE_PRESETS[preset];
    if (!days) return { start: null, end: null };
    
    const end = series[series.length - 1].t;
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    
    return { start, end };
}

/**
 * Format value for display
 */
function formatValue(val, unit) {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    
    if (unit?.includes('percent') || unit?.includes('rate') || unit?.includes('yield')) {
        return val.toFixed(2) + '%';
    }
    
    if (Math.abs(val) >= 1000000) {
        return (val / 1000000).toFixed(2) + 'M';
    } else if (Math.abs(val) >= 1000) {
        return (val / 1000).toFixed(1) + 'K';
    }
    
    return val.toFixed(2);
}

/**
 * Debounce function
 */
function debounce(fn, ms) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), ms);
    };
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.ChartUtils = {
        parseSeries,
        filterByRange,
        normalize,
        getPresetRange,
        formatValue,
        debounce,
        RANGE_PRESETS
    };
}
