"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const http = __importStar(require("http"));
const balances = new Map();
const idempotencyStore = new Map();
const deductions = [];
const failureRules = [];
const requestLog = [];
let globalDelay = 0;
function generateId() {
    return `hcm-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            }
            catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}
function respond(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function checkFailure(operation, employeeId) {
    for (let i = failureRules.length - 1; i >= 0; i--) {
        const rule = failureRules[i];
        if (rule.operation && rule.operation !== operation)
            continue;
        if (rule.employeeId && rule.employeeId !== employeeId)
            continue;
        if (rule.countdown > 0) {
            rule.countdown--;
            continue;
        }
        rule.failureCount--;
        const mode = rule.mode;
        if (rule.failureCount <= 0) {
            failureRules.splice(i, 1);
        }
        return { shouldFail: true, mode };
    }
    return { shouldFail: false };
}
function getFailureResponse(mode) {
    switch (mode) {
        case 'transient':
        case 'timeout':
        case 'server_error':
            return { statusCode: 500, body: { error: 'INTERNAL_ERROR', message: `Mock failure: ${mode}` } };
        case 'rate_limited':
            return { statusCode: 429, body: { error: 'RATE_LIMITED', message: 'Too many requests' } };
        case 'insufficient_balance':
            return { statusCode: 422, body: { error: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' } };
        case 'invalid_leave_type':
            return { statusCode: 422, body: { error: 'INVALID_LEAVE_TYPE', message: 'Invalid leave type' } };
        case 'not_found':
            return { statusCode: 404, body: { error: 'NOT_FOUND', message: 'Resource not found' } };
        case 'permanent':
            return { statusCode: 400, body: { error: 'BAD_REQUEST', message: 'Mock permanent failure' } };
        default:
            return { statusCode: 500, body: { error: 'UNKNOWN', message: `Unknown failure mode: ${mode}` } };
    }
}
async function handleGetBalance(req, res, params) {
    const employeeId = params.get('employee_id');
    const leaveType = params.get('leave_type');
    if (!employeeId || !leaveType) {
        return respond(res, 400, { error: 'Missing employee_id or leave_type' });
    }
    const failure = checkFailure('getBalance', employeeId);
    if (failure.shouldFail) {
        const { statusCode, body } = getFailureResponse(failure.mode);
        return respond(res, statusCode, body);
    }
    const balance = balances.get(`${employeeId}:${leaveType}`);
    if (!balance) {
        return respond(res, 404, { error: 'NOT_FOUND', message: `No balance for ${employeeId}/${leaveType}` });
    }
    respond(res, 200, {
        employee_id: employeeId,
        leave_type: leaveType,
        total_balance: balance.total_balance,
        used_balance: balance.used_balance,
        hcm_version: balance.hcm_version,
    });
}
async function handlePostTimeOff(req, res) {
    const body = await parseBody(req);
    const idempotencyKey = req.headers['x-idempotency-key'] || body.idempotency_key;
    if (idempotencyKey) {
        const existing = idempotencyStore.get(idempotencyKey);
        if (existing) {
            return respond(res, existing.statusCode, existing.response);
        }
    }
    const failure = checkFailure('postTimeOff', body.employee_id);
    if (failure.shouldFail) {
        const { statusCode, body: errBody } = getFailureResponse(failure.mode);
        return respond(res, statusCode, errBody);
    }
    const balanceKey = `${body.employee_id}:${body.leave_type}`;
    const balance = balances.get(balanceKey);
    if (!balance) {
        return respond(res, 404, { error: 'NOT_FOUND', message: `No balance for ${balanceKey}` });
    }
    const available = balance.total_balance - balance.used_balance;
    if (available < body.hours) {
        const errResponse = {
            error: 'INSUFFICIENT_BALANCE',
            message: `Available: ${available}h, Requested: ${body.hours}h`,
        };
        return respond(res, 422, errResponse);
    }
    balance.used_balance += body.hours;
    balance.hcm_version = new Date().toISOString();
    const referenceId = generateId();
    const response = {
        reference_id: referenceId,
        status: 'ACCEPTED',
        version: balance.hcm_version,
    };
    if (idempotencyKey) {
        idempotencyStore.set(idempotencyKey, { response, statusCode: 200 });
    }
    deductions.push({
        reference_id: referenceId,
        idempotency_key: idempotencyKey || '',
        employee_id: body.employee_id,
        leave_type: body.leave_type,
        hours: body.hours,
        start_date: body.start_date,
        end_date: body.end_date,
        created_at: new Date().toISOString(),
    });
    respond(res, 200, response);
}
async function handleCancelTimeOff(req, res) {
    const body = await parseBody(req);
    const idempotencyKey = req.headers['x-idempotency-key'] || body.idempotency_key;
    if (idempotencyKey) {
        const existing = idempotencyStore.get(idempotencyKey);
        if (existing) {
            return respond(res, existing.statusCode, existing.response);
        }
    }
    const failure = checkFailure('cancelTimeOff', body.employee_id);
    if (failure.shouldFail) {
        const { statusCode, body: errBody } = getFailureResponse(failure.mode);
        return respond(res, statusCode, errBody);
    }
    const idx = deductions.findIndex((d) => d.reference_id === body.hcm_reference_id);
    if (idx === -1) {
        return respond(res, 404, { error: 'NOT_FOUND', message: `No deduction ${body.hcm_reference_id}` });
    }
    const deduction = deductions[idx];
    const balanceKey = `${deduction.employee_id}:${deduction.leave_type}`;
    const balance = balances.get(balanceKey);
    if (balance) {
        balance.used_balance -= deduction.hours;
        balance.hcm_version = new Date().toISOString();
    }
    deductions.splice(idx, 1);
    const response = { status: 'CANCELLED', version: balance?.hcm_version || new Date().toISOString() };
    if (idempotencyKey) {
        idempotencyStore.set(idempotencyKey, { response, statusCode: 200 });
    }
    respond(res, 200, response);
}
async function handleBatchBalances(req, res, params) {
    const sinceCheckpoint = params.get('since') || '1970-01-01T00:00:00Z';
    const failure = checkFailure('getBatchBalances', 'system');
    if (failure.shouldFail) {
        const { statusCode, body } = getFailureResponse(failure.mode);
        return respond(res, statusCode, body);
    }
    const items = Array.from(balances.entries())
        .filter(([_, b]) => b.hcm_version > sinceCheckpoint)
        .map(([key, b]) => {
        const [employee_id, leave_type] = key.split(':');
        return { employee_id, leave_type, total_balance: b.total_balance, used_balance: b.used_balance, hcm_version: b.hcm_version };
    });
    respond(res, 200, { checkpoint: new Date().toISOString(), items });
}
async function handleAdmin(req, res, path) {
    const body = await parseBody(req);
    switch (path) {
        case '/admin/balances':
            if (req.method === 'POST') {
                balances.set(`${body.employee_id}:${body.leave_type}`, {
                    total_balance: body.total_balance,
                    used_balance: body.used_balance || 0,
                    hcm_version: body.hcm_version || new Date().toISOString(),
                });
                return respond(res, 200, { status: 'OK', message: 'Balance set' });
            }
            if (req.method === 'GET') {
                const all = Array.from(balances.entries()).map(([key, b]) => {
                    const [eid, lt] = key.split(':');
                    return { employee_id: eid, leave_type: lt, ...b };
                });
                return respond(res, 200, { balances: all });
            }
            break;
        case '/admin/failures':
            if (req.method === 'POST') {
                failureRules.push({
                    mode: body.mode || 'transient',
                    countdown: body.countdown || 0,
                    failureCount: body.failure_count || 1,
                    operation: body.operation || null,
                    employeeId: body.employee_id || null,
                });
                return respond(res, 200, { status: 'OK', message: 'Failure rule added', rules: failureRules.length });
            }
            if (req.method === 'DELETE') {
                failureRules.length = 0;
                return respond(res, 200, { status: 'OK', message: 'All failure rules cleared' });
            }
            break;
        case '/admin/delay':
            if (req.method === 'POST') {
                globalDelay = body.delay_ms || 0;
                return respond(res, 200, { status: 'OK', delay_ms: globalDelay });
            }
            break;
        case '/admin/deductions':
            if (req.method === 'GET') {
                return respond(res, 200, { deductions });
            }
            break;
        case '/admin/log':
            if (req.method === 'GET') {
                return respond(res, 200, { requests: requestLog.slice(-50) });
            }
            break;
        case '/admin/reset':
            if (req.method === 'POST') {
                balances.clear();
                idempotencyStore.clear();
                deductions.length = 0;
                failureRules.length = 0;
                requestLog.length = 0;
                globalDelay = 0;
                return respond(res, 200, { status: 'OK', message: 'Full reset' });
            }
            break;
        case '/admin/stats':
            if (req.method === 'GET') {
                return respond(res, 200, {
                    balances_count: balances.size,
                    deductions_count: deductions.length,
                    idempotency_keys: idempotencyStore.size,
                    failure_rules: failureRules.length,
                    request_log_size: requestLog.length,
                    global_delay_ms: globalDelay,
                });
            }
            break;
    }
    respond(res, 404, { error: 'Unknown admin endpoint' });
}
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    const params = url.searchParams;
    if (globalDelay > 0)
        await delay(globalDelay);
    const startTime = Date.now();
    let statusCode = 200;
    try {
        if (path.startsWith('/admin')) {
            await handleAdmin(req, res, path);
            statusCode = res.statusCode;
            return;
        }
        if (path === '/api/balance' && req.method === 'GET') {
            await handleGetBalance(req, res, params);
        }
        else if (path === '/api/time-off' && req.method === 'POST') {
            await handlePostTimeOff(req, res);
        }
        else if (path === '/api/time-off/cancel' && req.method === 'POST') {
            await handleCancelTimeOff(req, res);
        }
        else if (path === '/api/batch-balances' && req.method === 'GET') {
            await handleBatchBalances(req, res, params);
        }
        else if (path === '/health' && req.method === 'GET') {
            respond(res, 200, { status: 'healthy', type: 'mock-hcm-server' });
        }
        else {
            respond(res, 404, { error: 'Not Found', path });
            statusCode = 404;
        }
    }
    catch (error) {
        respond(res, 500, { error: 'Internal Error', message: error.message });
        statusCode = 500;
    }
    finally {
        requestLog.push({
            method: req.method || 'UNKNOWN',
            path,
            timestamp: new Date().toISOString(),
            status: statusCode,
        });
    }
});
const PORT = parseInt(process.env.MOCK_HCM_PORT || '3001', 10);
server.listen(PORT, () => {
    console.log(`\n🏢 Mock HCM Server running on http://localhost:${PORT}`);
    console.log(`\n  HCM API Endpoints:`);
    console.log(`    GET  /api/balance?employee_id=X&leave_type=Y`);
    console.log(`    POST /api/time-off`);
    console.log(`    POST /api/time-off/cancel`);
    console.log(`    GET  /api/batch-balances?since=TIMESTAMP`);
    console.log(`    GET  /health`);
    console.log(`\n  Admin Endpoints:`);
    console.log(`    POST   /admin/balances    — Set employee balance`);
    console.log(`    GET    /admin/balances    — List all balances`);
    console.log(`    POST   /admin/failures   — Add failure injection rule`);
    console.log(`    DELETE /admin/failures   — Clear all failure rules`);
    console.log(`    POST   /admin/delay      — Set global response delay`);
    console.log(`    GET    /admin/deductions — List all deductions`);
    console.log(`    GET    /admin/log        — Request log (last 50)`);
    console.log(`    GET    /admin/stats      — Server statistics`);
    console.log(`    POST   /admin/reset      — Full reset\n`);
});
//# sourceMappingURL=server.js.map