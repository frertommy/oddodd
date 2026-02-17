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
 * Calculate percentile for YES% band
 */
function calculatePercentile(sortedValues, p) {
    if (!sortedValues || sortedValues.length === 0) return 0;
    const index = (p / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    if (upper >= sortedValues.length) return sortedValues[lower];
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Compute YES% band bounds using p5/p95 with 50% padding
 * bandType: '6M', '1Y', '2Y', 'MAX'
 * Returns: { band, p5, p95, lo, hi, windowStart, windowEnd, windowPoints }
 */
function computeYesBand(series, bandType, toDate) {
    if (!series || series.length === 0) return null;
    
    const end = toDate ? new Date(toDate) : series[series.length - 1].t;
    let start;
    
    switch(bandType) {
        case '1Y':
            start = new Date(end);
            start.setFullYear(start.getFullYear() - 1);
            break;
        case '2Y':
            start = new Date(end);
            start.setFullYear(start.getFullYear() - 2);
            break;
        case 'MAX':
            start = series[0].t;
            break;
        case '6M':
        default:
            start = new Date(end);
            start.setMonth(start.getMonth() - 6);
            break;
    }
    
    // Get window data
    const windowData = series.filter(p => p.t >= start && p.t <= end);
    
    // Fallback if not enough data
    const minPoints = { '6M': 30, '1Y': 60, '2Y': 100, 'MAX': 10 };
    let actualBand = bandType;
    
    if (windowData.length < (minPoints[bandType] || 10)) {
        // Try shorter bands
        if (bandType === '2Y' && series.length >= minPoints['1Y']) {
            actualBand = '1Y';
            start = new Date(end);
            start.setFullYear(start.getFullYear() - 1);
        } else if ((bandType === '2Y' || bandType === '1Y') && series.length >= minPoints['6M']) {
            actualBand = '6M';
            start = new Date(end);
            start.setMonth(start.getMonth() - 6);
        } else {
            // Use all available data
            actualBand = 'all';
            start = series[0].t;
        }
    }
    
    const finalWindow = series.filter(p => p.t >= start && p.t <= end);
    if (finalWindow.length < 5) return null;
    
    const values = finalWindow.map(p => p.v).sort((a, b) => a - b);
    const a = calculatePercentile(values, 5);  // p5
    const b = calculatePercentile(values, 95); // p95
    const r = b - a;
    const lo = a - 0.5 * r;
    const hi = b + 0.5 * r;
    
    return {
        band: actualBand,
        requestedBand: bandType,
        p5: a,
        p95: b,
        lo: lo,
        hi: hi,
        windowStart: start,
        windowEnd: end,
        windowPoints: finalWindow.length
    };
}

/**
 * Convert value to YES% using band bounds
 * s = clamp((x - lo) / (hi - lo), 0, 1)
 * p = clamp(s, 0.02, 0.98)
 * YES% = 100 * p
 */
function valueToYesPercent(value, band) {
    if (!band || band.hi === band.lo) return 50;
    const s = (value - band.lo) / (band.hi - band.lo);
    const clamped = Math.max(0, Math.min(1, s));
    // Clamp to 2-98%
    const p = Math.max(0.02, Math.min(0.98, clamped));
    return 100 * p;
}

/**
 * Compute 6-month trailing band bounds (L, U) based on "to" date
 * Returns: { L, U, min6, max6, r, source: '6m'|'full' }
 */
function computeBandBounds(series, toDate) {
    if (!series || series.length === 0) {
        return { L: 0, U: 100, min6: 0, max6: 100, r: 100, source: 'full' };
    }
    
    const end = toDate ? new Date(toDate) : series[series.length - 1].t;
    const start6M = new Date(end);
    start6M.setMonth(start6M.getMonth() - 6);
    
    // Get 6-month trailing window
    const window6M = series.filter(p => p.t >= start6M && p.t <= end);
    
    let min6, max6, source;
    
    if (window6M.length >= 10) {
        // Use 6-month window
        const values6M = window6M.map(p => p.v);
        min6 = Math.min(...values6M);
        max6 = Math.max(...values6M);
        source = '6m';
    } else {
        // Fallback to full series
        const allValues = series.map(p => p.v);
        min6 = Math.min(...allValues);
        max6 = Math.max(...allValues);
        source = 'full';
    }
    
    const r = max6 - min6;
    
    // Add 50% padding on each side
    const L = min6 - 0.5 * r;
    const U = max6 + 0.5 * r;
    
    return { L, U, min6, max6, r, source };
}

/**
 * Clamp value between min and max
 */
function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

/**
 * Normalize series based on mode
 * Modes: raw, index100, pct, minmax, band6m_price, band6m_pct
 * 
 * For band modes: fullSeries is the complete unfiltered series (needed for 6M calculation)
 * toDate is the end date of the visible range
 */
function normalize(series, mode, fullSeries = null, toDate = null) {
    if (!series || series.length === 0) return { series: [], bandInfo: null };
    if (mode === 'raw') return { series, bandInfo: null };
    
    const values = series.map(p => p.v);
    const first = values[0];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    
    // Standard normalization modes
    if (mode !== 'band6m_price' && mode !== 'band6m_pct') {
        const normalized = series.map(p => {
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
        return { series: normalized, bandInfo: null };
    }
    
    // Band 6M modes
    const useFullSeries = fullSeries || series;
    const band = computeBandBounds(useFullSeries, toDate);
    
    // Normalize to P (100-900 range)
    const P_series = series.map(p => {
        const z = band.r > 0 ? (p.v - band.L) / (band.U - band.L) : 0.5;
        const z_clamped = clamp(z, 0, 1);
        const P = 100 + 800 * z_clamped;
        return { t: p.t, v: P, raw: p.v };
    });
    
    if (mode === 'band6m_price') {
        return { 
            series: P_series, 
            bandInfo: { ...band, mode: 'price' }
        };
    }
    
    // Band 6M (% Move)
    const P0 = P_series[0].v;
    const pct_series = P_series.map(p => ({
        t: p.t,
        v: P0 !== 0 ? ((p.v / P0) - 1) * 100 : 0,
        raw: p.raw
    }));
    
    return { 
        series: pct_series, 
        bandInfo: { ...band, mode: 'pct', P0 }
    };
}

/**
 * Format band info for display
 */
function formatBandInfo(bandInfo) {
    if (!bandInfo) return '';
    const sourceLabel = bandInfo.source === '6m' ? 'last 6M' : 'full series';
    return `Band: ${sourceLabel} + 50% padding (L=${bandInfo.L.toFixed(2)}, U=${bandInfo.U.toFixed(2)})`;
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
        computeBandBounds,
        computeYesBand,
        valueToYesPercent,
        formatBandInfo,
        clamp,
        getPresetRange,
        formatValue,
        debounce,
        RANGE_PRESETS
    };
}
