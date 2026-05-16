/**
 * erlang.js — Erlang X (M/M/s/K+M + Redials) Core Algorithms
 *
 * JavaScript port of Phone_Erlang.xlsm VBA modules:
 *   QueueCore, ErlangX, ErlangX_MultiQueue
 *
 * Queue model: M/M/s/K+M (Erlang A with finite waiting room + redials)
 *   λ_eff = λ₀ + r · AbandonFrac · λ_eff  (fixed-point redial)
 *   SL1 = (1 - blockProb) − delayProb · exp(−γ·t)
 *   SL2 = SL1 + abandonFrac · (1 − exp(−θ·t))
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────
const ERLANG_MAX_QUEUE = 500;   // effective max queue length (500 is enough for call centres)
const ERLANG_MAX_AGENTS = 2000; // safety cap for agent search

// ─── Utility ─────────────────────────────────────────────────────────────────
function clip01(x) { return Math.max(0, Math.min(1, x)); }

// ─── M/M/s/K+M Steady-State (Exact) ─────────────────────────────────────────
/**
 * Compute steady-state probabilities for M/M/s/K+M queue.
 * @param {number} lambda - Effective arrival rate (per sec)
 * @param {number} mu     - Service rate per agent (per sec)
 * @param {number} theta  - Patience rate = 1/avgPatience (per sec)
 * @param {number} s      - Number of agents
 * @param {number} maxQ   - Max queue length (K = s + maxQ)
 * @returns {{ delayProb, blockProb, busyFrac, qLen }}
 */
function steadyState(lambda, mu, theta, s, maxQ) {
    const k = s + maxQ;
    // Build unnormalised probabilities
    const p = new Float64Array(k + 1);
    p[0] = 1.0;
    for (let n = 1; n <= k; n++) {
        const denom = n <= s ? n * mu : s * mu + (n - s) * theta;
        p[n] = p[n - 1] * (lambda / Math.max(denom, 1e-15));
    }
    // Normalise
    let Z = 0.0;
    for (let n = 0; n <= k; n++) Z += p[n];
    if (Z < 1e-300) Z = 1e-300;
    for (let n = 0; n <= k; n++) p[n] /= Z;

    // delayProb = Σ p[n] for n = s … k-1
    let delayProb = 0.0;
    for (let n = s; n < k; n++) delayProb += p[n];

    // busyFrac = (Σ n·p[n] for n=1..s  +  Σ s·p[n] for n=s+1..k) / s
    let busy = 0.0;
    for (let n = 1; n <= s; n++) busy += n * p[n];
    for (let n = s + 1; n <= k; n++) busy += s * p[n];
    const busyFrac = busy / Math.max(1, s);

    // qLen = Σ (n-s)·p[n] for n = s+1 … k
    let qLen = 0.0;
    for (let n = s + 1; n <= k; n++) qLen += (n - s) * p[n];

    return {
        delayProb: clip01(delayProb),
        blockProb: clip01(p[k]),
        busyFrac:  clip01(busyFrac),
        qLen
    };
}

// ─── Fixed-Point Lambda (Redial Loop) ────────────────────────────────────────
/**
 * Solve λ_eff = λ₀ + r · AbandonFrac(λ_eff) · λ_eff  by damped iteration.
 * @returns {{ lambdaEff, abandonFrac, blockProb, delayProb, busyFrac }}
 */
function fixedPointLambda(lambda0, mu, theta, s, maxQ, r) {
    let lambdaEff = lambda0;
    let abandonFrac = 0, blockProb = 0, delayProb = 0, busyFrac = 0, qLen = 0;

    for (let i = 0; i < 50; i++) {
        const ss = steadyState(lambdaEff, mu, theta, s, maxQ);
        blockProb = ss.blockProb;
        delayProb = ss.delayProb;
        busyFrac  = ss.busyFrac;
        qLen      = ss.qLen;

        abandonFrac = lambdaEff > 1e-12
            ? clip01((theta * qLen) / lambdaEff)
            : 0;

        const lambdaNext = lambda0 + r * abandonFrac * lambdaEff;
        if (Math.abs(lambdaNext - lambdaEff) < 1e-10) {
            lambdaEff = lambdaNext;
            break;
        }
        lambdaEff = 0.5 * lambdaEff + 0.5 * lambdaNext; // damping
    }
    return { lambdaEff, abandonFrac, blockProb, delayProb, busyFrac };
}

// ─── Service Level (net agents — no shrinkage) ───────────────────────────────
/**
 * Erlang-X SL for a given net agent count.
 * SL1 = (1−B) − C·exp(−γt)
 * SL2 = SL1 + AbandonFrac·(1−exp(−θt))
 */
function serviceLevelNet(calls, periodMin, ahtSec, slTimeSec, agents, patienceSec, redial, slDef) {
    if (agents <= 0 || calls < 0 || ahtSec <= 0 || patienceSec <= 0) return 0;

    const mu      = 1.0 / ahtSec;
    const theta   = 1.0 / patienceSec;
    const lambda0 = calls / (periodMin * 60);

    const fp = fixedPointLambda(lambda0, mu, theta, agents, ERLANG_MAX_QUEUE, redial);
    const { lambdaEff, abandonFrac, blockProb, delayProb } = fp;

    const lambdaAcc = lambdaEff * (1 - blockProb);
    let gamma = agents * mu + theta - lambdaAcc;
    if (gamma < 1e-12) gamma = 1e-12;

    let sl = (1 - blockProb) - delayProb * Math.exp(-gamma * slTimeSec);
    if (slDef === 'SL2') {
        sl += abandonFrac * (1 - Math.exp(-theta * slTimeSec));
    }
    return clip01(sl);
}

// ─── Occupancy (simple traffic intensity formula — matches VBA multi-queue) ──
function occupancySimple(calls, periodMin, ahtSec, agents) {
    if (agents <= 0) return 1;
    return (calls / (periodMin * 60)) * ahtSec / agents;
}

// ─── Public: ServiceLevel_X (SL prediction, shrinkage only) ──────────────────
/**
 * Predict FRT SL given headcount (scheduled, including shrinkage).
 * effectiveAgents = floor(headcount × (1 − shrinkage)).
 * maxOccupancy is passed through but used only as a display reference;
 * it no longer caps the agent count here.
 */
function serviceLevelX(params) {
    const { calls, periodMin, ahtSec, slTimeSec, headcount,
            shrinkage, maxOccupancy, patienceSec, redial, slDef = 'SL1' } = params;

    if (calls < 0 || periodMin <= 0 || ahtSec <= 0 || slTimeSec <= 0 ||
        headcount <= 0 || shrinkage < 0 || shrinkage >= 1 ||
        patienceSec <= 1 || redial < 0 || redial >= 1) return 0;

    // Effective agents = shrinkage-adjusted headcount only
    const agents = Math.floor(headcount * (1 - shrinkage));
    if (agents <= 0) return 0;

    return serviceLevelNet(calls, periodMin, ahtSec, slTimeSec, agents,
                           patienceSec, redial, slDef);
}

// ─── Minimum Agents (Binary Search, single queue) ────────────────────────────
/**
 * Find minimum net agents satisfying both SL target and occupancy cap.
 * Returns 0 if infeasible within ERLANG_MAX_AGENTS.
 */
function minAgentsSingleQueue(calls, periodMin, ahtSec, slTarget, slTimeSec,
                               maxOccupancy, patienceSec, redial, slDef) {
    if (calls <= 0) return 0; // 0 calls → 0 agents needed
    if (calls < 0 || ahtSec <= 0 || slTarget <= 0 || slTarget >= 1 ||
        slTimeSec <= 0 || maxOccupancy <= 0 || maxOccupancy >= 1 ||
        patienceSec <= 1 || redial < 0 || redial >= 1) return -1; // invalid

    // Lower bound: floor(traffic intensity)
    const mu = 1.0 / ahtSec;
    const intensityBase = (calls / (periodMin * 60)) * ahtSec;
    let sLo = Math.max(1, Math.floor(intensityBase));
    let sHi = ERLANG_MAX_AGENTS;

    // Feasibility at cap
    const slHi  = serviceLevelNet(calls, periodMin, ahtSec, slTimeSec, sHi, patienceSec, redial, slDef);
    const occHi = occupancySimple(calls, periodMin, ahtSec, sHi);
    if (!(slHi >= slTarget && occHi <= maxOccupancy)) return -1; // infeasible

    // Binary search (both SL and occ are monotone w.r.t. agents)
    while (sLo < sHi) {
        const sMid = (sLo + sHi) >> 1;
        const sl  = serviceLevelNet(calls, periodMin, ahtSec, slTimeSec, sMid, patienceSec, redial, slDef);
        const occ = occupancySimple(calls, periodMin, ahtSec, sMid);
        if (sl >= slTarget && occ <= maxOccupancy) {
            sHi = sMid;
        } else {
            sLo = sMid + 1;
        }
    }
    return sLo;
}

// ─── Public: AgentsRequired_X (single queue, returns scheduled seats) ─────────
/**
 * Compute minimum scheduled seats (incl. shrinkage) for one time slot.
 * Returns { netAgents, scheduledSeats, sl, occ } or null on error.
 */
function agentsRequiredX(params) {
    const { calls, periodMin, ahtSec, slTarget, slTimeSec,
            maxOccupancy, shrinkage, patienceSec, redial, slDef = 'SL1' } = params;

    if (calls <= 0) {
        return { netAgents: 0, scheduledSeats: 0, sl: 1, occ: 0, note: 'zero calls' };
    }

    const netAgents = minAgentsSingleQueue(
        calls, periodMin, ahtSec, slTarget, slTimeSec,
        maxOccupancy, patienceSec, redial, slDef
    );
    if (netAgents <= 0) {
        return { netAgents: 0, scheduledSeats: 0, sl: 0, occ: 1, note: '実現不可' };
    }

    const scheduledSeats = Math.ceil(netAgents / (1 - shrinkage));
    const sl  = serviceLevelNet(calls, periodMin, ahtSec, slTimeSec, netAgents, patienceSec, redial, slDef);
    const occ = occupancySimple(calls, periodMin, ahtSec, netAgents);
    return { netAgents, scheduledSeats, sl, occ, note: 'OK' };
}

// ─── Public: Multi-Queue Optimizer ───────────────────────────────────────────
/**
 * Compute required seats for multiple independent queues (time slots).
 * Each queue uses the same SL target, threshold, AHT, patience, redial.
 * Returns array of per-queue results + total.
 *
 * @param {Array} slots - Array of { calls } per time slot
 * @param {object} common - Shared settings
 * @returns {{ rows: Array, totalScheduled, totalNet }}
 */
function multiQueueOptimize(slots, common) {
    const { periodMin, ahtSec, slTarget, slTimeSec,
            maxOccupancy, shrinkage, patienceSec, redial, slDef = 'SL1' } = common;

    const rows = slots.map(slot => {
        const calls = slot.calls;
        if (isNaN(calls) || calls < 0) {
            return { calls, netAgents: 0, scheduledSeats: 0, sl: null, occ: null, note: '入力エラー' };
        }
        const result = agentsRequiredX({
            calls, periodMin, ahtSec, slTarget, slTimeSec,
            maxOccupancy, shrinkage, patienceSec, redial, slDef
        });
        return { calls, ...result };
    });

    const totalNet       = rows.reduce((s, r) => s + (r.netAgents  || 0), 0);
    const totalScheduled = rows.reduce((s, r) => s + (r.scheduledSeats || 0), 0);

    return { rows, totalNet, totalScheduled };
}

// ─── Public: SL Prediction (per row with individual utilization) ─────────────
/**
 * Predict SL for multiple time slots (Phone_SL sheet equivalent).
 * Each slot has its own headcount and utilization (稼働率).
 * maxOccupancy is shared via common settings (used only for display color-coding).
 *
 * utilization (0–100) = proportion of scheduled time agents are actually available
 *   = 100 − shrinkage%.  Accounts for breaks, training, meetings, etc.
 * occupancy  (output)  = traffic intensity / effectiveAgents  (how busy they are)
 */
function multiSlotSLPrediction(slots, common) {
    const { periodMin, ahtSec, slTimeSec, maxOccupancy,
            patienceSec, redial, slDef = 'SL1' } = common;
    // shrinkage is now per-slot (derived from slot.utilization)

    return slots.map(slot => {
        const { calls, headcount, utilization } = slot;

        // 0 calls → no calculation; show "—" for all result columns
        if (calls <= 0 || isNaN(calls)) {
            return { calls, headcount, utilization, sl: null, occ: null, effectiveAgents: 0, note: 'zero calls' };
        }
        if (isNaN(headcount) || headcount <= 0) {
            return { calls, headcount, utilization, sl: null, occ: null, effectiveAgents: 0, note: '入力エラー' };
        }

        // Per-slot utilization → shrinkage for this time slot
        const util = (utilization != null && !isNaN(utilization))
            ? Math.max(0, Math.min(100, utilization)) : 80;
        const slotShrinkage = 1 - util / 100;

        const sl = serviceLevelX({
            calls, periodMin, ahtSec, slTimeSec, headcount,
            shrinkage: slotShrinkage, maxOccupancy,
            patienceSec, redial, slDef
        });

        // effectiveAgents = headcount × utilization/100  (available agents on phones)
        const effectiveAgents = Math.floor(headcount * util / 100);
        const occ = effectiveAgents > 0
            ? occupancySimple(calls, periodMin, ahtSec, effectiveAgents)
            : null;
        return { calls, headcount, utilization: util, sl, occ, effectiveAgents, note: 'OK' };
    });
}

// ─── Chat: Concurrency Factor (CCH table, linear interpolation) ──────────────
/**
 * Convert concurrency level (1–5+) to effective throughput factor.
 * Matches VBA ConcurrencyFactorFromLevel_Chat_local:
 *   1→1.0, 2→1.7, 3→2.5, 4→2.9, 5→3.5  (linear interpolation)
 */
function concurrencyFactor(level) {
    const x = [1, 2, 3, 4, 5];
    const y = [1.0, 1.7, 2.5, 2.9, 3.5];
    if (level <= 1) return 1.0;
    if (level >= 5) return 3.5;
    for (let i = 0; i < 4; i++) {
        if (level >= x[i] && level <= x[i + 1]) {
            const t = (level - x[i]) / (x[i + 1] - x[i]);
            return y[i] + t * (y[i + 1] - y[i]);
        }
    }
    return 3.5;
}

// ─── Chat: Service Level (net agents) ────────────────────────────────────────
/**
 * Predict FRT SL for chat given net agent count and concurrency level.
 * Key difference from phone: mu = cf / ahtSec  (cf = concurrencyFactor(level))
 * Matches VBA ServiceLevel_ChatX_local.
 */
function chatServiceLevelNet(chats, periodMin, ahtSec, slTimeSec,
                              agents, patienceSec, redial, concLevel, slDef) {
    if (agents <= 0 || chats < 0 || ahtSec <= 0 || patienceSec <= 0) return 0;

    const cf      = concurrencyFactor(Math.max(1, concLevel || 1));
    const mu      = cf / ahtSec;    // effective service rate per agent
    const theta   = 1.0 / patienceSec;
    const lambda0 = chats / (periodMin * 60);

    const fp = fixedPointLambda(lambda0, mu, theta, agents, ERLANG_MAX_QUEUE, redial);
    const { lambdaEff, abandonFrac, blockProb, delayProb } = fp;

    const lambdaAcc = lambdaEff * (1 - blockProb);
    let gamma = agents * mu + theta - lambdaAcc;
    if (gamma < 1e-12) gamma = 1e-12;

    let sl = (1 - blockProb) - delayProb * Math.exp(-gamma * slTimeSec);
    if (slDef === 'SL2') {
        sl += abandonFrac * (1 - Math.exp(-theta * slTimeSec));
    }
    return clip01(sl);
}

// ─── Chat: Multi-slot SL Prediction ──────────────────────────────────────────
/**
 * Predict FRT SL for multiple chat time slots.
 * Each slot: { chats, headcount, utilization (%), concurrency (1–5+) }
 * Matches VBA PredictFRTSL_FromSeats_Single called per slot.
 */
function chatMultiSlotSLPrediction(slots, common) {
    const { periodMin, ahtSec, slTimeSec, patienceSec, redial,
            concurrency: globalConc, maxOccupancy, slDef = 'SL1' } = common;

    return slots.map(slot => {
        const { chats, headcount, utilization } = slot;

        if (chats <= 0 || isNaN(chats)) {
            return { chats, headcount, utilization,
                     sl: null, occ: null, effectiveAgents: 0, note: 'zero chats' };
        }
        if (isNaN(headcount) || headcount <= 0) {
            return { chats, headcount, utilization,
                     sl: null, occ: null, effectiveAgents: 0, note: '入力エラー' };
        }

        const util = (utilization != null && !isNaN(utilization))
            ? Math.max(0, Math.min(100, utilization)) : 80;
        // Global concurrency from common takes priority over per-slot value
        const conc = Math.max(1, globalConc || slot.concurrency || 1);

        const cf             = concurrencyFactor(conc);
        const effectiveAgents = Math.floor(headcount * util / 100);

        // Chat occupancy: λ × (AHT / cf) / effectiveAgents
        // cf accounts for concurrency throughput gain; result is comparable to phone occ
        const occ = effectiveAgents > 0
            ? clip01((chats / (periodMin * 60)) * (ahtSec / cf) / effectiveAgents)
            : null;

        const sl = effectiveAgents > 0
            ? chatServiceLevelNet(chats, periodMin, ahtSec, slTimeSec,
                                  effectiveAgents, patienceSec, redial, conc, slDef)
            : null;

        return { chats, headcount, utilization: util, concurrency: conc,
                 sl, occ, effectiveAgents, note: 'OK' };
    });
}

// ─── Export ──────────────────────────────────────────────────────────────────
const _exports = {
    serviceLevelX,
    agentsRequiredX,
    multiQueueOptimize,
    multiSlotSLPrediction,
    serviceLevelNet,
    occupancySimple,
    chatServiceLevelNet,
    chatMultiSlotSLPrediction,
    concurrencyFactor,
};

// Node.js (サーバー) とブラウザの両方で動作する
if (typeof module !== 'undefined' && module.exports) {
    module.exports = _exports;   // Node.js: require('./erlang') で読み込み可能
} else {
    window.Erlang = _exports;    // ブラウザ: window.Erlang として従来通り使用可能
}
