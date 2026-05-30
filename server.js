const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { URL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'system.db');

fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  real_name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT DEFAULT '',
  status INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT NOT NULL,
  enterprise_name TEXT NOT NULL,
  project_leader TEXT NOT NULL,
  setup_year INTEGER NOT NULL,
  current_stage TEXT NOT NULL DEFAULT 'project_info',
  current_progress TEXT NOT NULL DEFAULT '',
  remark TEXT DEFAULT '',
  overall_status TEXT NOT NULL DEFAULT 'draft',
  total_budget_amount REAL NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS stage_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  stage_code TEXT NOT NULL,
  responsible_user_id INTEGER,
  submitted_by INTEGER,
  submitted_at TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, stage_code)
);
CREATE TABLE IF NOT EXISTS contract_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  responsible_user_id INTEGER,
  responsible_name TEXT DEFAULT '',
  confirm_time TEXT DEFAULT '',
  final_contract_file_id INTEGER,
  final_contract_file_name TEXT DEFAULT '',
  status TEXT DEFAULT '待确定',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contract_seals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  responsible_user_id INTEGER,
  responsible_name TEXT DEFAULT '',
  seal_time TEXT DEFAULT '',
  contract_copies INTEGER DEFAULT 0,
  is_scanned INTEGER DEFAULT 0,
  is_uploaded INTEGER DEFAULT 0,
  scanned_file_id INTEGER,
  scanned_file_name TEXT DEFAULT '',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contract_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  responsible_user_id INTEGER,
  responsible_name TEXT DEFAULT '',
  sent_time TEXT DEFAULT '',
  tracking_no TEXT DEFAULT '',
  receipt_screenshot_file_id INTEGER,
  receipt_screenshot_name TEXT DEFAULT '',
  customer_confirm_file_id INTEGER,
  customer_confirm_name TEXT DEFAULT '',
  customer_confirm_status TEXT DEFAULT '待确认',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS fund_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  responsible_user_id INTEGER,
  responsible_name TEXT DEFAULT '',
  bank_flow_screenshot_file_id INTEGER,
  bank_flow_screenshot_name TEXT DEFAULT '',
  bank_flow_no TEXT DEFAULT '',
  apply_time TEXT DEFAULT '',
  finance_confirm_time TEXT DEFAULT '',
  claim_result TEXT DEFAULT '',
  arrival_status TEXT DEFAULT '待到账',
  recognized_amount REAL NOT NULL DEFAULT 0,
  remark TEXT DEFAULT '',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invoice_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  responsible_user_id INTEGER,
  responsible_name TEXT DEFAULT '',
  apply_time TEXT DEFAULT '',
  invoice_type TEXT DEFAULT '普票',
  invoice_preview_file_id INTEGER,
  invoice_preview_name TEXT DEFAULT '',
  customer_confirm_status TEXT DEFAULT '待确认',
  electronic_invoice_file_id INTEGER,
  electronic_invoice_name TEXT DEFAULT '',
  send_status TEXT DEFAULT '未发送',
  invoice_time TEXT DEFAULT '',
  invoice_amount REAL NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reimbursements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  responsible_user_id INTEGER,
  responsible_name TEXT DEFAULT '',
  reimbursement_time TEXT DEFAULT '',
  reimbursement_amount REAL NOT NULL DEFAULT 0,
  ticket_type TEXT DEFAULT '有票',
  payee_name TEXT DEFAULT '',
  voucher_file_id INTEGER,
  voucher_file_name TEXT DEFAULT '',
  teacher_confirm_status TEXT DEFAULT '待确认',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS project_closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  responsible_user_id INTEGER,
  responsible_name TEXT DEFAULT '',
  closure_report_file_id INTEGER,
  closure_report_name TEXT DEFAULT '',
  apply_time TEXT DEFAULT '',
  closure_status TEXT DEFAULT '待结题',
  completed_time TEXT DEFAULT '',
  overdue_reminder INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS file_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  module_code TEXT NOT NULL,
  business_id INTEGER,
  file_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  content_type TEXT DEFAULT 'application/octet-stream',
  uploaded_by INTEGER,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS edit_authorizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  stage_code TEXT NOT NULL,
  granted_to_user_id INTEGER NOT NULL,
  granted_by_user_id INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  valid_until TEXT NOT NULL,
  used_status TEXT NOT NULL DEFAULT 'unused',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  module_code TEXT NOT NULL,
  action_type TEXT NOT NULL,
  operator_id INTEGER,
  operator_name TEXT DEFAULT '',
  action_content TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const STAGES = ['project_info', 'contract_management', 'fund_claim', 'invoice_management', 'reimbursement', 'project_closure'];
const STAGE_LABELS = {
  project_info: '项目基础信息',
  contract_management: '合同管理',
  fund_claim: '经费认领',
  invoice_management: '开票管理',
  reimbursement: '经费报销',
  project_closure: '项目结题'
};

function cleanupLegacyDemoData() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const projectCount = db.prepare('SELECT COUNT(*) AS count FROM projects').get().count;
  if (userCount !== 5 || projectCount !== 1) {
    return;
  }

  const usernames = db.prepare('SELECT username FROM users ORDER BY username').all().map(item => item.username);
  const demoUsers = ['admin1', 'assistant1', 'assistant2', 'student1', 'viewer1'];
  if (JSON.stringify(usernames) !== JSON.stringify(demoUsers)) {
    return;
  }

  const project = db.prepare('SELECT id, project_name FROM projects LIMIT 1').get();
  if (!project || project.project_name !== '智能视觉检测联合研发') {
    return;
  }

  const projectId = project.id;
  const fileRows = db.prepare('SELECT file_path FROM file_assets WHERE project_id = ?').all(projectId);
  for (const file of fileRows) {
    if (file.file_path && fs.existsSync(file.file_path)) {
      fs.rmSync(file.file_path, { force: true });
    }
  }

  removeDirectorySafe(path.join(UPLOAD_DIR, String(projectId)));
  db.prepare('DELETE FROM contract_confirmations WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM contract_seals WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM contract_deliveries WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM fund_claims WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM invoice_records WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM reimbursements WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM project_closures WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM stage_states WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM file_assets WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM operation_logs WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM edit_authorizations WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  db.prepare('DELETE FROM users').run();
}

cleanupLegacyDemoData();

function now() {
  return new Date().toISOString();
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  json(res, 404, { message: 'Not Found' });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 20 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function getActor(req) {
  const role = req.headers['x-role'] || 'viewer';
  const userId = Number(req.headers['x-user-id'] || 0);
  const realName = req.headers['x-user-name'] || 'Guest';
  return { role, userId, realName };
}

function requireRole(res, actor, roles) {
  if (!roles.includes(actor.role)) {
    json(res, 403, { message: '权限不足' });
    return false;
  }
  return true;
}

function logAction(projectId, moduleCode, actionType, actor, content) {
  db.prepare('INSERT INTO operation_logs (project_id, module_code, action_type, operator_id, operator_name, action_content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(projectId, moduleCode, actionType, actor.userId, actor.realName, content, now());
}

function getProject(projectId) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
}

function getStageState(projectId, stageCode) {
  return db.prepare('SELECT * FROM stage_states WHERE project_id = ? AND stage_code = ?').get(projectId, stageCode);
}

function previousStage(stageCode) {
  const index = STAGES.indexOf(stageCode);
  return index > 0 ? STAGES[index - 1] : null;
}

function isStageOpen(projectId, stageCode) {
  if (stageCode === 'project_info') return true;
  const previous = previousStage(stageCode);
  const state = getStageState(projectId, previous);
  return !!state && state.is_completed === 1;
}

function hasAuthorization(projectId, stageCode, actor) {
  const row = db.prepare(`
    SELECT * FROM edit_authorizations
    WHERE project_id = ? AND stage_code = ? AND granted_to_user_id = ?
      AND used_status = 'unused' AND valid_until >= ?
    ORDER BY id DESC LIMIT 1
  `).get(projectId, stageCode, actor.userId, now());
  return row || null;
}

function canEditStage(projectId, stageCode, actor, responsibleUserId) {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'executor') return false;
  if (!isStageOpen(projectId, stageCode)) return false;
  if (Number(responsibleUserId) !== actor.userId) return false;
  const state = getStageState(projectId, stageCode);
  if (!state || state.is_locked === 0) return true;
  return !!hasAuthorization(projectId, stageCode, actor);
}

function markSubmitted(projectId, stageCode, actor) {
  db.prepare(`
    UPDATE stage_states
    SET submitted_by = ?, submitted_at = ?, is_locked = 1, is_completed = 1, updated_at = ?
    WHERE project_id = ? AND stage_code = ?
  `).run(actor.userId, now(), now(), projectId, stageCode);
  const auth = hasAuthorization(projectId, stageCode, actor);
  if (auth) {
    db.prepare('UPDATE edit_authorizations SET used_status = ? WHERE id = ?').run('used', auth.id);
  }
}

function updateProjectProgress(projectId, stageCode) {
  const stageIndex = STAGES.indexOf(stageCode);
  const next = STAGES[Math.min(stageIndex + 1, STAGES.length - 1)];
  const completedAll = STAGES.every(code => getStageState(projectId, code)?.is_completed === 1);
  const progress = completedAll ? '项目已完成结题流程。' : `${STAGE_LABELS[stageCode]}已提交，${stageCode === 'project_closure' ? '项目已结题。' : `进入${STAGE_LABELS[next]}。`}`;
  db.prepare('UPDATE projects SET current_stage = ?, current_progress = ?, overall_status = ?, updated_at = ? WHERE id = ?')
    .run(completedAll ? 'project_closure' : next, progress, completedAll ? 'completed' : 'in_progress', now(), projectId);
}

function getProjectDetail(projectId) {
  const project = getProject(projectId);
  if (!project) return null;
  const contractConfirmation = db.prepare('SELECT * FROM contract_confirmations WHERE project_id = ?').get(projectId) || {};
  const contractSeal = db.prepare('SELECT * FROM contract_seals WHERE project_id = ?').get(projectId) || {};
  const contractDelivery = db.prepare('SELECT * FROM contract_deliveries WHERE project_id = ?').get(projectId) || {};
  const fundClaim = db.prepare('SELECT * FROM fund_claims WHERE project_id = ?').get(projectId) || {};
  const invoice = db.prepare('SELECT * FROM invoice_records WHERE project_id = ?').get(projectId) || {};
  const reimbursement = db.prepare('SELECT * FROM reimbursements WHERE project_id = ?').get(projectId) || {};
  const closure = db.prepare('SELECT * FROM project_closures WHERE project_id = ?').get(projectId) || {};
  const files = db.prepare('SELECT * FROM file_assets WHERE project_id = ? ORDER BY uploaded_at DESC').all(projectId);
  const logs = db.prepare('SELECT * FROM operation_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50').all(projectId);
  const stageStates = db.prepare('SELECT * FROM stage_states WHERE project_id = ? ORDER BY id').all(projectId);
  const reimbursedAmount = Number(reimbursement.reimbursement_amount || 0);
  return {
    project,
    stageStates,
    contract: { confirmation: contractConfirmation, seal: contractSeal, delivery: contractDelivery },
    fundClaim,
    invoice,
    reimbursement: {
      ...reimbursement,
      total_budget_amount: Number(project.total_budget_amount || 0),
      reimbursed_amount: reimbursedAmount,
      remaining_amount: Number(project.total_budget_amount || 0) - reimbursedAmount
    },
    closure,
    files,
    logs
  };
}

function saveFile({ projectId, moduleCode, fileName, contentBase64, contentType, actor }) {
  const safeDir = path.join(UPLOAD_DIR, String(projectId), moduleCode);
  fs.mkdirSync(safeDir, { recursive: true });
  const ext = path.extname(fileName) || '';
  const storedName = `${randomUUID()}${ext}`;
  const targetPath = path.join(safeDir, storedName);
  fs.writeFileSync(targetPath, Buffer.from(contentBase64, 'base64'));
  const info = db.prepare(`
    INSERT INTO file_assets (project_id, module_code, file_name, stored_name, file_path, file_size, content_type, uploaded_by, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, moduleCode, fileName, storedName, targetPath, fs.statSync(targetPath).size, contentType || 'application/octet-stream', actor.userId, now());
  return { id: Number(info.lastInsertRowid), fileName, storedName, filePath: targetPath };
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(ROOT, pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, pathname.replace(/^\//, ''));
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    notFound(res);
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf'
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function sendBootstrap(res) {
  const users = db.prepare('SELECT id, username, real_name, role FROM users WHERE status = 1 ORDER BY id').all();
  const projects = listProjects({ page: 1, pageSize: 50 }).items;
  const projectId = projects[0]?.id;
  const detail = projectId ? getProjectDetail(projectId) : null;
  json(res, 200, { users, projects, detail, stageLabels: STAGE_LABELS, stages: STAGES, needsSetup: users.length === 0 });
}

function projectListItem(project) {
  return {
    ...project,
    total_budget_amount: Number(project.total_budget_amount || 0),
    reimbursed_amount: Number((db.prepare('SELECT reimbursement_amount FROM reimbursements WHERE project_id = ?').get(project.id) || {}).reimbursement_amount || 0)
  };
}

function listProjects(params = {}) {
  const clauses = [];
  const values = [];
  if (params.project_name) {
    clauses.push('project_name LIKE ?');
    values.push('%' + params.project_name.trim() + '%');
  }
  if (params.enterprise_name) {
    clauses.push('enterprise_name LIKE ?');
    values.push('%' + params.enterprise_name.trim() + '%');
  }
  if (params.project_leader) {
    clauses.push('project_leader LIKE ?');
    values.push('%' + params.project_leader.trim() + '%');
  }
  if (params.current_stage) {
    clauses.push('current_stage = ?');
    values.push(params.current_stage);
  }
  if (params.setup_year) {
    clauses.push('setup_year = ?');
    values.push(Number(params.setup_year));
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.min(50, Math.max(1, Number(params.pageSize || 10)));
  const total = db.prepare('SELECT COUNT(*) AS count FROM projects ' + where).get(...values).count;
  const items = db.prepare('SELECT * FROM projects ' + where + ' ORDER BY id DESC LIMIT ? OFFSET ?').all(...values, pageSize, (page - 1) * pageSize).map(projectListItem);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

function initializeProjectState(projectId, adminId = null) {
  for (const stage of STAGES) {
    db.prepare('INSERT INTO stage_states (project_id, stage_code, is_locked, is_completed) VALUES (?, ?, 0, 0)').run(projectId, stage);
  }
  db.prepare('INSERT INTO contract_confirmations (project_id, responsible_user_id, responsible_name) VALUES (?, ?, ?)').run(projectId, adminId, adminId ? '???' : '');
  db.prepare('INSERT INTO contract_seals (project_id, responsible_user_id, responsible_name) VALUES (?, ?, ?)').run(projectId, adminId, adminId ? '???' : '');
  db.prepare('INSERT INTO contract_deliveries (project_id, responsible_user_id, responsible_name) VALUES (?, ?, ?)').run(projectId, adminId, adminId ? '???' : '');
  db.prepare('INSERT INTO fund_claims (project_id, responsible_user_id, responsible_name, recognized_amount) VALUES (?, ?, ?, ?)').run(projectId, adminId, adminId ? '???' : '', 0);
  db.prepare('INSERT INTO invoice_records (project_id, responsible_user_id, responsible_name) VALUES (?, ?, ?)').run(projectId, adminId, adminId ? '???' : '');
  db.prepare('INSERT INTO reimbursements (project_id, responsible_user_id, responsible_name) VALUES (?, ?, ?)').run(projectId, adminId, adminId ? '???' : '');
  db.prepare('INSERT INTO project_closures (project_id, responsible_user_id, responsible_name) VALUES (?, ?, ?)').run(projectId, adminId, adminId ? '???' : '');
}

function removeDirectorySafe(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const actor = getActor(req);

  if (pathname.startsWith('/api/')) {
    try {
      if (req.method === 'GET' && pathname === '/api/health') {
        return json(res, 200, { status: 'ok', time: now() });
      }

      if (req.method === 'GET' && pathname === '/api/bootstrap') {
        return sendBootstrap(res);
      }

      if (req.method === 'POST' && pathname === '/api/setup/admin') {
        const hasUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0;
        if (hasUsers) {
          return json(res, 400, { message: '系统已初始化，不能重复创建首个管理员' });
        }
        const body = await parseBody(req);
        if (!body.username || !body.real_name) {
          return json(res, 400, { message: '用户名和姓名不能为空' });
        }
        const result = db.prepare(`
          INSERT INTO users (username, real_name, role, password_hash, status, created_at, updated_at)
          VALUES (?, ?, 'admin', '', 1, ?, ?)
        `).run(body.username.trim(), body.real_name.trim(), now(), now());
        const adminId = Number(result.lastInsertRowid);
        return json(res, 201, {
          message: '首个管理员创建成功',
          user: { id: adminId, username: body.username.trim(), real_name: body.real_name.trim(), role: 'admin' }
        });
      }

      if (req.method === 'GET' && pathname === '/api/projects') {
        return json(res, 200, listProjects(Object.fromEntries(url.searchParams.entries())));
      }

      if (req.method === 'POST' && pathname === '/api/projects') {
        if (!requireRole(res, actor, ['admin'])) return;
        const body = await parseBody(req);
        const result = db.prepare(`
          INSERT INTO projects (project_name, enterprise_name, project_leader, setup_year, current_stage, current_progress, remark, overall_status, total_budget_amount, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'project_info', ?, ?, 'draft', ?, ?, ?, ?)
        `).run(
          body.project_name,
          body.enterprise_name,
          body.project_leader,
          Number(body.setup_year),
          body.current_progress || '?????????????',
          body.remark || '',
          Number(body.total_budget_amount || 0),
          actor.userId,
          now(),
          now()
        );
        const projectId = Number(result.lastInsertRowid);
        initializeProjectState(projectId, actor.userId);
        logAction(projectId, 'project_info', 'create', actor, '????');
        return json(res, 201, getProjectDetail(projectId));
      }

      const deleteProjectMatch = pathname.match(/^\/api\/projects\/(\d+)$/);
      if (deleteProjectMatch && req.method === 'DELETE') {
        if (!requireRole(res, actor, ['admin'])) return;
        const projectId = Number(deleteProjectMatch[1]);
        const project = getProject(projectId);
        if (!project) return notFound(res);
        const fileRows = db.prepare('SELECT * FROM file_assets WHERE project_id = ?').all(projectId);
        for (const file of fileRows) {
          if (file.file_path && fs.existsSync(file.file_path)) {
            fs.rmSync(file.file_path, { force: true });
          }
        }
        removeDirectorySafe(path.join(UPLOAD_DIR, String(projectId)));
        db.prepare('DELETE FROM contract_confirmations WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM contract_seals WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM contract_deliveries WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM fund_claims WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM invoice_records WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM reimbursements WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM project_closures WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM stage_states WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM file_assets WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM operation_logs WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM edit_authorizations WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
        logAction(projectId, 'project_info', 'delete', actor, '????');
        return json(res, 200, { message: '?????' });
      }

      const projectMatch = pathname.match(/^\/api\/projects\/(\d+)$/);
      if (req.method === 'GET' && projectMatch) {
        const detail = getProjectDetail(Number(projectMatch[1]));
        return detail ? json(res, 200, detail) : notFound(res);
      }

      const baseInfoMatch = pathname.match(/^\/api\/projects\/(\d+)\/base-info$/);
      if (baseInfoMatch && req.method === 'PUT') {
        if (!requireRole(res, actor, ['admin', 'executor'])) return;
        const projectId = Number(baseInfoMatch[1]);
        const body = await parseBody(req);
        const project = getProject(projectId);
        if (!project) return notFound(res);
        const state = getStageState(projectId, 'project_info');
        const allowed = actor.role === 'admin' || (actor.role === 'executor' && state.is_locked === 0);
        if (!allowed) return json(res, 403, { message: '当前无权修改基础信息' });
        db.prepare(`
          UPDATE projects
          SET project_name = ?, enterprise_name = ?, project_leader = ?, setup_year = ?, current_progress = ?, remark = ?, total_budget_amount = ?, updated_at = ?
          WHERE id = ?
        `).run(body.project_name, body.enterprise_name, body.project_leader, Number(body.setup_year), body.current_progress || '', body.remark || '', Number(body.total_budget_amount || 0), now(), projectId);
        logAction(projectId, 'project_info', 'edit', actor, '更新项目基础信息');
        return json(res, 200, getProjectDetail(projectId));
      }

      const submitBaseInfoMatch = pathname.match(/^\/api\/projects\/(\d+)\/base-info\/submit$/);
      if (submitBaseInfoMatch && req.method === 'POST') {
        if (!requireRole(res, actor, ['admin', 'executor'])) return;
        const projectId = Number(submitBaseInfoMatch[1]);
        const project = getProject(projectId);
        if (!project) return notFound(res);
        markSubmitted(projectId, 'project_info', actor);
        updateProjectProgress(projectId, 'project_info');
        logAction(projectId, 'project_info', 'submit', actor, '提交项目基础信息');
        return json(res, 200, getProjectDetail(projectId));
      }

      const moduleMatch = pathname.match(/^\/api\/projects\/(\d+)\/modules\/([a-z_\-]+)$/);
      if (moduleMatch && req.method === 'PUT') {
        if (!requireRole(res, actor, ['admin', 'executor'])) return;
        const projectId = Number(moduleMatch[1]);
        const moduleCode = moduleMatch[2];
        const body = await parseBody(req);
        const project = getProject(projectId);
        if (!project) return notFound(res);

        if (moduleCode === 'contract_management') {
          const responsibleUserId = Number(body.confirmation?.responsible_user_id || 0);
          if (!canEditStage(projectId, 'contract_management', actor, responsibleUserId)) {
            return json(res, 403, { message: '当前无权编辑合同管理' });
          }
          db.prepare(`UPDATE contract_confirmations SET responsible_user_id=?, responsible_name=?, confirm_time=?, final_contract_file_id=?, final_contract_file_name=?, status=?, updated_at=? WHERE project_id=?`)
            .run(body.confirmation.responsible_user_id, body.confirmation.responsible_name, body.confirmation.confirm_time, body.confirmation.final_contract_file_id || null, body.confirmation.final_contract_file_name || '', body.confirmation.status, now(), projectId);
          db.prepare(`UPDATE contract_seals SET responsible_user_id=?, responsible_name=?, seal_time=?, contract_copies=?, is_scanned=?, is_uploaded=?, scanned_file_id=?, scanned_file_name=?, updated_at=? WHERE project_id=?`)
            .run(body.seal.responsible_user_id, body.seal.responsible_name, body.seal.seal_time, Number(body.seal.contract_copies || 0), Number(body.seal.is_scanned || 0), Number(body.seal.is_uploaded || 0), body.seal.scanned_file_id || null, body.seal.scanned_file_name || '', now(), projectId);
          db.prepare(`UPDATE contract_deliveries SET responsible_user_id=?, responsible_name=?, sent_time=?, tracking_no=?, receipt_screenshot_file_id=?, receipt_screenshot_name=?, customer_confirm_file_id=?, customer_confirm_name=?, customer_confirm_status=?, updated_at=? WHERE project_id=?`)
            .run(body.delivery.responsible_user_id, body.delivery.responsible_name, body.delivery.sent_time, body.delivery.tracking_no, body.delivery.receipt_screenshot_file_id || null, body.delivery.receipt_screenshot_name || '', body.delivery.customer_confirm_file_id || null, body.delivery.customer_confirm_name || '', body.delivery.customer_confirm_status, now(), projectId);
        }

        if (moduleCode === 'fund_claim') {
          if (!canEditStage(projectId, moduleCode, actor, body.responsible_user_id)) return json(res, 403, { message: '当前无权编辑经费认领' });
          db.prepare(`UPDATE fund_claims SET responsible_user_id=?, responsible_name=?, bank_flow_screenshot_file_id=?, bank_flow_screenshot_name=?, bank_flow_no=?, apply_time=?, finance_confirm_time=?, claim_result=?, arrival_status=?, recognized_amount=?, remark=?, updated_at=? WHERE project_id=?`)
            .run(body.responsible_user_id, body.responsible_name, body.bank_flow_screenshot_file_id || null, body.bank_flow_screenshot_name || '', body.bank_flow_no || '', body.apply_time || '', body.finance_confirm_time || '', body.claim_result || '', body.arrival_status || '待到账', Number(body.recognized_amount || 0), body.remark || '', now(), projectId);
        }

        if (moduleCode === 'invoice_management') {
          if (!canEditStage(projectId, moduleCode, actor, body.responsible_user_id)) return json(res, 403, { message: '当前无权编辑开票管理' });
          db.prepare(`UPDATE invoice_records SET responsible_user_id=?, responsible_name=?, apply_time=?, invoice_type=?, invoice_preview_file_id=?, invoice_preview_name=?, customer_confirm_status=?, electronic_invoice_file_id=?, electronic_invoice_name=?, send_status=?, invoice_time=?, invoice_amount=?, updated_at=? WHERE project_id=?`)
            .run(body.responsible_user_id, body.responsible_name, body.apply_time || '', body.invoice_type || '普票', body.invoice_preview_file_id || null, body.invoice_preview_name || '', body.customer_confirm_status || '待确认', body.electronic_invoice_file_id || null, body.electronic_invoice_name || '', body.send_status || '未发送', body.invoice_time || '', Number(body.invoice_amount || 0), now(), projectId);
        }

        if (moduleCode === 'reimbursement') {
          if (!canEditStage(projectId, moduleCode, actor, body.responsible_user_id)) return json(res, 403, { message: '当前无权编辑经费报销' });
          db.prepare(`UPDATE reimbursements SET responsible_user_id=?, responsible_name=?, reimbursement_time=?, reimbursement_amount=?, ticket_type=?, payee_name=?, voucher_file_id=?, voucher_file_name=?, teacher_confirm_status=?, updated_at=? WHERE project_id=?`)
            .run(body.responsible_user_id, body.responsible_name, body.reimbursement_time || '', Number(body.reimbursement_amount || 0), body.ticket_type || '有票', body.payee_name || '', body.voucher_file_id || null, body.voucher_file_name || '', body.teacher_confirm_status || '待确认', now(), projectId);
        }

        if (moduleCode === 'project_closure') {
          if (!canEditStage(projectId, moduleCode, actor, body.responsible_user_id)) return json(res, 403, { message: '当前无权编辑项目结题' });
          db.prepare(`UPDATE project_closures SET responsible_user_id=?, responsible_name=?, closure_report_file_id=?, closure_report_name=?, apply_time=?, closure_status=?, completed_time=?, overdue_reminder=?, updated_at=? WHERE project_id=?`)
            .run(body.responsible_user_id, body.responsible_name, body.closure_report_file_id || null, body.closure_report_name || '', body.apply_time || '', body.closure_status || '待结题', body.completed_time || '', Number(body.overdue_reminder || 0), now(), projectId);
        }

        logAction(projectId, moduleCode, 'edit', actor, `更新${STAGE_LABELS[moduleCode] || moduleCode}`);
        return json(res, 200, getProjectDetail(projectId));
      }

      const submitModuleMatch = pathname.match(/^\/api\/projects\/(\d+)\/modules\/([a-z_\-]+)\/submit$/);
      if (submitModuleMatch && req.method === 'POST') {
        if (!requireRole(res, actor, ['admin', 'executor'])) return;
        const projectId = Number(submitModuleMatch[1]);
        const moduleCode = submitModuleMatch[2];
        const project = getProject(projectId);
        if (!project) return notFound(res);
        if (!isStageOpen(projectId, moduleCode) && actor.role !== 'admin') {
          return json(res, 400, { message: '前置环节未完成，当前模块不可提交' });
        }
        markSubmitted(projectId, moduleCode, actor);
        updateProjectProgress(projectId, moduleCode);
        logAction(projectId, moduleCode, 'submit', actor, `提交${STAGE_LABELS[moduleCode] || moduleCode}`);
        return json(res, 200, getProjectDetail(projectId));
      }

      const authorizationMatch = pathname.match(/^\/api\/projects\/(\d+)\/authorizations$/);
      if (authorizationMatch && req.method === 'POST') {
        if (!requireRole(res, actor, ['admin'])) return;
        const projectId = Number(authorizationMatch[1]);
        const body = await parseBody(req);
        db.prepare(`INSERT INTO edit_authorizations (project_id, stage_code, granted_to_user_id, granted_by_user_id, reason, valid_until, used_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'unused', ?)`)
          .run(projectId, body.stage_code, body.granted_to_user_id, actor.userId, body.reason || '', body.valid_until, now());
        db.prepare('UPDATE stage_states SET is_locked = 0, updated_at = ? WHERE project_id = ? AND stage_code = ?').run(now(), projectId, body.stage_code);
        logAction(projectId, body.stage_code, 'unlock', actor, `授权用户 ${body.granted_to_user_id} 修改 ${STAGE_LABELS[body.stage_code]}`);
        return json(res, 200, { message: '授权成功' });
      }

      const logsMatch = pathname.match(/^\/api\/projects\/(\d+)\/logs$/);
      if (logsMatch && req.method === 'GET') {
        const projectId = Number(logsMatch[1]);
        const logs = db.prepare('SELECT * FROM operation_logs WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
        return json(res, 200, logs);
      }

      const fileMatch = pathname.match(/^\/api\/files\/(\d+)$/);
      if (fileMatch && req.method === 'GET') {
        const file = db.prepare('SELECT * FROM file_assets WHERE id = ?').get(Number(fileMatch[1]));
        if (!file || !fs.existsSync(file.file_path)) return notFound(res);
        const download = url.searchParams.get('download') === '1';
        res.writeHead(200, {
          'Content-Type': file.content_type || 'application/octet-stream',
          'Content-Disposition': (download ? 'attachment' : 'inline') + '; filename="' + encodeURIComponent(file.file_name) + '"'
        });
        return fs.createReadStream(file.file_path).pipe(res);
      }

      if (pathname === '/api/files/upload' && req.method === 'POST') {
        if (!requireRole(res, actor, ['admin', 'executor'])) return;
        const body = await parseBody(req);
        const project = getProject(Number(body.project_id));
        if (!project) return notFound(res);
        const file = saveFile({
          projectId: Number(body.project_id),
          moduleCode: body.module_code,
          fileName: body.file_name,
          contentBase64: body.content_base64,
          contentType: body.content_type,
          actor
        });
        logAction(Number(body.project_id), body.module_code, 'upload', actor, `上传文件 ${body.file_name}`);
        return json(res, 200, file);
      }

      return notFound(res);
    } catch (error) {
      console.error(error);
      return json(res, 500, { message: error.message || '服务器异常' });
    }
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`产学研项目管理系统已启动: http://localhost:${PORT}`);
});
