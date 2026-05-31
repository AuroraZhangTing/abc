const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const STAGES = [
  { code: 'project_info', label: '项目基础信息' },
  { code: 'contract_draft', label: '合同定稿' },
  { code: 'contract_stamp', label: '合同盖章' },
  { code: 'contract_delivery', label: '合同寄送与签收' },
  { code: 'fund_claim', label: '经费认领' },
  { code: 'invoice', label: '发票管理' },
  { code: 'closure', label: '项目结题' }
];

const STAGE_LABELS = Object.fromEntries(STAGES.map(item => [item.code, item.label]));
const STAGE_ORDER = STAGES.map(item => item.code);

function now() {
  return new Date().toISOString();
}

function daysBetween(isoA, isoB = now()) {
  if (!isoA) return 0;
  return Math.floor((new Date(isoB).getTime() - new Date(isoA).getTime()) / 86400000);
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function serveNotFound(res) {
  json(res, 404, { message: 'Not Found' });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 25 * 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function authFromRequest(req) {
  const role = req.headers['x-role'] || 'viewer';
  const userId = Number(req.headers['x-user-id'] || 0);
  const realName = req.headers['x-user-name'] || '访客';
  return { role, userId, realName };
}

function requireRole(res, actor, roles) {
  if (!roles.includes(actor.role)) {
    json(res, 403, { message: '权限不足' });
    return false;
  }
  return true;
}

function defaultStore() {
  return {
    meta: { nextUserId: 1, nextProjectId: 1, nextFileId: 1, nextLogId: 1 },
    users: [],
    projects: [],
    files: [],
    logs: []
  };
}

function ensureProjectShape(project) {
  const baseStage = () => ({
    responsibleId: null,
    responsibleName: '',
    date: '',
    submitted: false,
    submittedAt: '',
    submittedBy: null,
    locked: false,
    remark: ''
  });

  const contractDraft = { ...baseStage(), fileId: null, fileName: '', date: '', remark: '' };
  const contractStamp = { ...baseStage(), copies: 0, isStamped: false, isScanned: false, isUploaded: false };
  const contractDelivery = { ...baseStage(), trackingNo: '', receiptFileId: null, receiptFileName: '', customerConfirmed: false, customerConfirmFileId: null, customerConfirmFileName: '' };
  const fundClaim = { ...baseStage(), screenshotFileId: null, screenshotFileName: '', bankFlowNo: '', arrivalStatus: '未到账', virtualAmount: 0 };
  const invoice = { ...baseStage(), invoiceType: '普票', previewFileId: null, previewFileName: '', customerConfirmStatus: '待确认', sendStatus: '未发送' };
  const closure = { ...baseStage(), reportFileId: null, reportFileName: '', closureStatus: '未结题' };

  return {
    id: project.id,
    projectName: project.projectName || '',
    enterpriseName: project.enterpriseName || '',
    projectLeader: project.projectLeader || '',
    startTime: project.startTime || '',
    currentStage: project.currentStage || 'project_info',
    status: project.status || '进行中',
    remark: project.remark || '',
    virtualAccountAmount: Number(project.virtualAccountAmount || 0),
    projectInfo: project.projectInfo || { submitted: false, submittedAt: '', submittedBy: null, locked: false },
    contract: project.contract || { draft: contractDraft, stamp: contractStamp, delivery: contractDelivery },
    fundClaim: project.fundClaim || fundClaim,
    invoice: project.invoice || invoice,
    closure: project.closure || closure,
    createdBy: project.createdBy || null,
    createdAt: project.createdAt || now(),
    updatedAt: project.updatedAt || now()
  };
}

function normalizeProject(project) {
  const p = ensureProjectShape(project);
  p.contract.draft = { ...ensureProjectShape({}).contract.draft, ...(p.contract.draft || {}) };
  p.contract.stamp = { ...ensureProjectShape({}).contract.stamp, ...(p.contract.stamp || {}) };
  p.contract.delivery = { ...ensureProjectShape({}).contract.delivery, ...(p.contract.delivery || {}) };
  p.fundClaim = { ...ensureProjectShape({}).fundClaim, ...(p.fundClaim || {}) };
  p.invoice = { ...ensureProjectShape({}).invoice, ...(p.invoice || {}) };
  p.closure = { ...ensureProjectShape({}).closure, ...(p.closure || {}) };
  return p;
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) {
    const store = defaultStore();
    saveStore(store);
    return store;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    const store = { ...defaultStore(), ...parsed };
    store.meta = { ...defaultStore().meta, ...(parsed.meta || {}) };
    store.users = Array.isArray(parsed.users) ? parsed.users : [];
    store.projects = Array.isArray(parsed.projects) ? parsed.projects.map(normalizeProject) : [];
    store.files = Array.isArray(parsed.files) ? parsed.files : [];
    store.logs = Array.isArray(parsed.logs) ? parsed.logs : [];
    return store;
  } catch (error) {
    const store = defaultStore();
    saveStore(store);
    return store;
  }
}

let store = loadStore();

function saveStore(nextStore = store) {
  const tmp = STORE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(nextStore, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_PATH);
}

function persist() {
  saveStore(store);
}

function logAction(projectId, moduleCode, actionType, actor, content) {
  store.logs.unshift({
    id: store.meta.nextLogId++,
    projectId,
    moduleCode,
    actionType,
    operatorId: actor.userId,
    operatorName: actor.realName,
    actionContent: content,
    createdAt: now()
  });
  persist();
}

function getActiveUsers() {
  return store.users.filter(user => Number(user.status) === 1);
}

function getUserById(id) {
  return store.users.find(user => user.id === Number(id));
}

function listUsers() {
  return store.users.map(user => ({ ...user }));
}

function listProjects() {
  return store.projects.map(project => projectSummary(project));
}

function projectSummary(project) {
  const p = normalizeProject(project);
  const currentStage = getCurrentStageCode(p);
  const status = p.closure.submitted && p.closure.closureStatus === '已结题' ? '已完成' : (isOverdue(p) ? '逾期' : '进行中');
  return {
    id: p.id,
    projectName: p.projectName,
    enterpriseName: p.enterpriseName,
    projectLeader: p.projectLeader,
    startTime: p.startTime,
    currentStage,
    currentStageLabel: STAGE_LABELS[currentStage] || currentStage,
    status,
    virtualAccountAmount: Number(p.virtualAccountAmount || 0),
    progressText: progressText(p),
    overdue: isOverdue(p),
    updatedAt: p.updatedAt,
    contractDone: p.contract.draft.submitted && p.contract.stamp.submitted && p.contract.delivery.submitted,
    fundClaimDone: p.fundClaim.submitted,
    invoiceDone: p.invoice.submitted,
    closureDone: p.closure.submitted && p.closure.closureStatus === '已结题'
  };
}

function progressText(project) {
  const p = normalizeProject(project);
  const current = getCurrentStageCode(p);
  if (p.closure.submitted && p.closure.closureStatus === '已结题') return '项目已结题';
  return `当前阶段：${STAGE_LABELS[current] || current}`;
}

function getCurrentStageCode(project) {
  const p = normalizeProject(project);
  if (!p.projectInfo.submitted) return 'project_info';
  if (!p.contract.draft.submitted) return 'contract_draft';
  if (!p.contract.stamp.submitted) return 'contract_stamp';
  if (!p.contract.delivery.submitted) return 'contract_delivery';
  if (!p.fundClaim.submitted) return 'fund_claim';
  if (!p.invoice.submitted) return 'invoice';
  if (!p.closure.submitted) return 'closure';
  return p.closure.closureStatus === '已结题' ? 'completed' : 'closure';
}

function isOverdue(project) {
  const p = normalizeProject(project);
  if (p.closure.submitted && p.closure.closureStatus === '已结题') return false;
  return daysBetween(p.startTime || p.createdAt) > 120;
}

function getProjectById(id) {
  return store.projects.find(project => project.id === Number(id));
}

function getProjectDetail(id) {
  const project = getProjectById(id);
  if (!project) return null;
  const p = normalizeProject(project);
  const files = store.files.filter(file => file.projectId === p.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const logs = store.logs.filter(log => log.projectId === p.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return {
    project: p,
    currentStage: getCurrentStageCode(p),
    currentStageLabel: STAGE_LABELS[getCurrentStageCode(p)] || getCurrentStageCode(p),
    overdue: isOverdue(p),
    stageOrder: STAGES,
    stageLabels: STAGE_LABELS,
    files,
    logs
  };
}

function canEdit(project, stageCode, actor) {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'executor') return false;
  const p = normalizeProject(project);
  if (stageCode === 'project_info') return !p.projectInfo.locked;
  const map = {
    contract_draft: p.contract.draft,
    contract_stamp: p.contract.stamp,
    contract_delivery: p.contract.delivery,
    fund_claim: p.fundClaim,
    invoice: p.invoice,
    closure: p.closure
  };
  const stage = map[stageCode];
  return stage && !stage.locked;
}

function validateNextOrder(project, stageCode) {
  const p = normalizeProject(project);
  const order = STAGE_ORDER;
  const idx = order.indexOf(stageCode);
  if (idx <= 0) return true;
  for (let i = 0; i < idx; i += 1) {
    const prev = order[i];
    if (prev === 'project_info' && !p.projectInfo.submitted) return false;
    if (prev === 'contract_draft' && !p.contract.draft.submitted) return false;
    if (prev === 'contract_stamp' && !p.contract.stamp.submitted) return false;
    if (prev === 'contract_delivery' && !p.contract.delivery.submitted) return false;
    if (prev === 'fund_claim' && !p.fundClaim.submitted) return false;
    if (prev === 'invoice' && !p.invoice.submitted) return false;
  }
  return true;
}

function submitStage(project, stageCode, actor) {
  const p = normalizeProject(project);
  const updateStageCommon = stage => {
    stage.submitted = true;
    stage.submittedAt = now();
    stage.submittedBy = actor.userId;
    stage.locked = true;
  };

  if (stageCode === 'project_info') updateStageCommon(p.projectInfo);
  if (stageCode === 'contract_draft') updateStageCommon(p.contract.draft);
  if (stageCode === 'contract_stamp') updateStageCommon(p.contract.stamp);
  if (stageCode === 'contract_delivery') updateStageCommon(p.contract.delivery);
  if (stageCode === 'fund_claim') updateStageCommon(p.fundClaim);
  if (stageCode === 'invoice') updateStageCommon(p.invoice);
  if (stageCode === 'closure') updateStageCommon(p.closure);

  project.updatedAt = now();
  project.currentStage = getCurrentStageCode(p);
  project.status = isOverdue(p) ? '逾期' : (p.closure.submitted && p.closure.closureStatus === '已结题' ? '已完成' : '进行中');
  Object.assign(project, p);
  persist();
  logAction(project.id, stageCode, 'submit', actor, `提交 ${STAGE_LABELS[stageCode] || stageCode}`);
}

function resetStage(project, stageCode) {
  const p = normalizeProject(project);
  const stage = {
    project_info: p.projectInfo,
    contract_draft: p.contract.draft,
    contract_stamp: p.contract.stamp,
    contract_delivery: p.contract.delivery,
    fund_claim: p.fundClaim,
    invoice: p.invoice,
    closure: p.closure
  }[stageCode];
  if (!stage) return false;
  stage.submitted = false;
  stage.submittedAt = '';
  stage.submittedBy = null;
  stage.locked = false;
  project.updatedAt = now();
  project.currentStage = getCurrentStageCode(p);
  project.status = isOverdue(p) ? '逾期' : '进行中';
  Object.assign(project, p);
  persist();
  return true;
}

function createProject(body, actor) {
  const project = normalizeProject({
    id: store.meta.nextProjectId++,
    projectName: body.project_name || '',
    enterpriseName: body.enterprise_name || '',
    projectLeader: body.project_leader || '',
    startTime: body.start_time || now().slice(0, 10),
    currentStage: 'project_info',
    status: '进行中',
    remark: body.remark || '',
    virtualAccountAmount: Number(body.virtual_account_amount || 0),
    projectInfo: { submitted: false, submittedAt: '', submittedBy: null, locked: false },
    contract: undefined,
    fundClaim: undefined,
    invoice: undefined,
    closure: undefined,
    createdBy: actor.userId,
    createdAt: now(),
    updatedAt: now()
  });
  store.projects.unshift(project);
  persist();
  logAction(project.id, 'project_info', 'create', actor, `创建项目 ${project.projectName}`);
  return project;
}

function updateProjectBaseInfo(project, body, actor) {
  const p = normalizeProject(project);
  p.projectName = body.project_name ?? p.projectName;
  p.enterpriseName = body.enterprise_name ?? p.enterpriseName;
  p.projectLeader = body.project_leader ?? p.projectLeader;
  p.startTime = body.start_time ?? p.startTime;
  p.remark = body.remark ?? p.remark;
  p.virtualAccountAmount = Number(body.virtual_account_amount ?? p.virtualAccountAmount ?? 0);
  p.updatedAt = now();
  Object.assign(project, p);
  persist();
  logAction(project.id, 'project_info', 'edit', actor, '更新项目基础信息');
}

function saveStageFields(project, stageCode, body, actor) {
  const p = normalizeProject(project);
  if (stageCode === 'contract_draft') {
    Object.assign(p.contract.draft, {
      responsibleId: body.responsible_id ?? p.contract.draft.responsibleId,
      responsibleName: body.responsible_name ?? p.contract.draft.responsibleName,
      date: body.date ?? p.contract.draft.date,
      remark: body.remark ?? p.contract.draft.remark,
      fileId: body.file_id ?? p.contract.draft.fileId,
      fileName: body.file_name ?? p.contract.draft.fileName
    });
  }
  if (stageCode === 'contract_stamp') {
    Object.assign(p.contract.stamp, {
      responsibleId: body.responsible_id ?? p.contract.stamp.responsibleId,
      responsibleName: body.responsible_name ?? p.contract.stamp.responsibleName,
      date: body.date ?? p.contract.stamp.date,
      copies: Number(body.copies ?? p.contract.stamp.copies ?? 0),
      isStamped: Boolean(body.is_stamped ?? p.contract.stamp.isStamped),
      isScanned: Boolean(body.is_scanned ?? p.contract.stamp.isScanned),
      isUploaded: Boolean(body.is_uploaded ?? p.contract.stamp.isUploaded)
    });
  }
  if (stageCode === 'contract_delivery') {
    Object.assign(p.contract.delivery, {
      responsibleId: body.responsible_id ?? p.contract.delivery.responsibleId,
      responsibleName: body.responsible_name ?? p.contract.delivery.responsibleName,
      date: body.date ?? p.contract.delivery.date,
      trackingNo: body.tracking_no ?? p.contract.delivery.trackingNo,
      receiptFileId: body.receipt_file_id ?? p.contract.delivery.receiptFileId,
      receiptFileName: body.receipt_file_name ?? p.contract.delivery.receiptFileName,
      customerConfirmed: Boolean(body.customer_confirmed ?? p.contract.delivery.customerConfirmed),
      customerConfirmFileId: body.customer_confirm_file_id ?? p.contract.delivery.customerConfirmFileId,
      customerConfirmFileName: body.customer_confirm_file_name ?? p.contract.delivery.customerConfirmFileName
    });
  }
  if (stageCode === 'fund_claim') {
    Object.assign(p.fundClaim, {
      responsibleId: body.responsible_id ?? p.fundClaim.responsibleId,
      responsibleName: body.responsible_name ?? p.fundClaim.responsibleName,
      date: body.date ?? p.fundClaim.date,
      bankFlowNo: body.bank_flow_no ?? p.fundClaim.bankFlowNo,
      arrivalStatus: body.arrival_status ?? p.fundClaim.arrivalStatus,
      virtualAmount: Number(body.virtual_amount ?? p.fundClaim.virtualAmount ?? 0),
      screenshotFileId: body.screenshot_file_id ?? p.fundClaim.screenshotFileId,
      screenshotFileName: body.screenshot_file_name ?? p.fundClaim.screenshotFileName
    });
  }
  if (stageCode === 'invoice') {
    Object.assign(p.invoice, {
      responsibleId: body.responsible_id ?? p.invoice.responsibleId,
      responsibleName: body.responsible_name ?? p.invoice.responsibleName,
      date: body.date ?? p.invoice.date,
      invoiceType: body.invoice_type ?? p.invoice.invoiceType,
      customerConfirmStatus: body.customer_confirm_status ?? p.invoice.customerConfirmStatus,
      sendStatus: body.send_status ?? p.invoice.sendStatus,
      previewFileId: body.preview_file_id ?? p.invoice.previewFileId,
      previewFileName: body.preview_file_name ?? p.invoice.previewFileName
    });
  }
  if (stageCode === 'closure') {
    Object.assign(p.closure, {
      responsibleId: body.responsible_id ?? p.closure.responsibleId,
      responsibleName: body.responsible_name ?? p.closure.responsibleName,
      date: body.date ?? p.closure.date,
      closureStatus: body.closure_status ?? p.closure.closureStatus,
      reportFileId: body.report_file_id ?? p.closure.reportFileId,
      reportFileName: body.report_file_name ?? p.closure.reportFileName
    });
  }
  p.updatedAt = now();
  Object.assign(project, p);
  persist();
  logAction(project.id, stageCode, 'edit', actor, `更新 ${STAGE_LABELS[stageCode] || stageCode}`);
}

function saveFile({ projectId, moduleCode, fileName, contentType, contentBase64, actor }) {
  const safeProject = path.join(UPLOAD_DIR, String(projectId), moduleCode);
  fs.mkdirSync(safeProject, { recursive: true });
  const ext = path.extname(fileName) || '';
  const storedName = `${randomUUID()}${ext}`;
  const filePath = path.join(safeProject, storedName);
  fs.writeFileSync(filePath, Buffer.from(contentBase64, 'base64'));
  const record = {
    id: store.meta.nextFileId++,
    projectId: Number(projectId),
    moduleCode,
    fileName,
    storedName,
    filePath,
    contentType: contentType || 'application/octet-stream',
    size: fs.statSync(filePath).size,
    uploadedBy: actor.userId,
    uploadedAt: now()
  };
  store.files.unshift(record);
  persist();
  logAction(Number(projectId), moduleCode, 'upload', actor, `上传文件 ${fileName}`);
  return record;
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname.replace(/^\//, ''));
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return serveNotFound(res);
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };
  res.writeHead(200, { 'Content-Type': map[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function bootstrapPayload(projectId = null) {
  const users = getActiveUsers().map(user => ({
    id: user.id,
    username: user.username,
    realName: user.realName,
    role: user.role,
    status: user.status
  }));
  const projects = listProjects();
  const targetId = projectId ? Number(projectId) : projects[0]?.id || null;
  const detail = targetId ? getProjectDetail(targetId) : null;
  return {
    needsSetup: store.users.length === 0,
    users,
    projects,
    detail,
    stageLabels: STAGE_LABELS,
    stages: STAGES
  };
}

function queryProjects(searchParams) {
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const items = listProjects().filter(project => {
    if (!q) return true;
    return [project.projectName, project.enterpriseName, project.projectLeader, project.currentStageLabel, project.status].join(' ').toLowerCase().includes(q);
  });
  return { items, total: items.length };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const actor = authFromRequest(req);

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, { status: 'ok', time: now() });
    }

    if (pathname === '/api/bootstrap' && req.method === 'GET') {
      return json(res, 200, bootstrapPayload(url.searchParams.get('projectId')));
    }

    if (pathname === '/api/setup/admin' && req.method === 'POST') {
      if (store.users.length > 0) return json(res, 400, { message: '系统已初始化，不能重复创建首个管理员' });
      const body = await parseBody(req);
      if (!body.username || !body.real_name) return json(res, 400, { message: '用户名和姓名不能为空' });
      const user = {
        id: store.meta.nextUserId++,
        username: String(body.username).trim(),
        realName: String(body.real_name).trim(),
        role: 'admin',
        status: 1,
        createdAt: now(),
        updatedAt: now()
      };
      store.users.push(user);
      persist();
      return json(res, 201, { message: '首个管理员创建成功', user });
    }

    if (pathname === '/api/users' && req.method === 'GET') {
      if (!requireRole(res, actor, ['admin'])) return;
      return json(res, 200, { items: listUsers() });
    }

    if (pathname === '/api/users' && req.method === 'POST') {
      if (!requireRole(res, actor, ['admin'])) return;
      const body = await parseBody(req);
      if (!body.username || !body.real_name) return json(res, 400, { message: '账号和姓名不能为空' });
      if (store.users.some(user => user.username === String(body.username).trim())) return json(res, 400, { message: '账号已存在' });
      const user = {
        id: store.meta.nextUserId++,
        username: String(body.username).trim(),
        realName: String(body.real_name).trim(),
        role: ['admin', 'executor', 'viewer'].includes(body.role) ? body.role : 'viewer',
        status: Number(body.status ?? 1),
        createdAt: now(),
        updatedAt: now()
      };
      store.users.push(user);
      persist();
      return json(res, 201, { user });
    }

    const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (userMatch && req.method === 'PUT') {
      if (!requireRole(res, actor, ['admin'])) return;
      const user = getUserById(userMatch[1]);
      if (!user) return serveNotFound(res);
      const body = await parseBody(req);
      user.username = String(body.username || user.username).trim();
      user.realName = String(body.real_name || user.realName).trim();
      user.role = ['admin', 'executor', 'viewer'].includes(body.role) ? body.role : user.role;
      user.status = Number(body.status ?? user.status ?? 1);
      user.updatedAt = now();
      persist();
      return json(res, 200, { user });
    }

    if (userMatch && req.method === 'DELETE') {
      if (!requireRole(res, actor, ['admin'])) return;
      const user = getUserById(userMatch[1]);
      if (!user) return serveNotFound(res);
      const adminCount = store.users.filter(item => item.role === 'admin' && Number(item.status) === 1).length;
      if (user.role === 'admin' && adminCount <= 1) {
        return json(res, 400, { message: '至少保留一个启用中的管理员账号' });
      }
      store.users = store.users.filter(item => item.id !== user.id);
      persist();
      return json(res, 200, { message: '用户已删除' });
    }

    if (pathname === '/api/projects' && req.method === 'GET') {
      return json(res, 200, queryProjects(url.searchParams));
    }

    if (pathname === '/api/projects' && req.method === 'POST') {
      if (!requireRole(res, actor, ['admin', 'executor'])) return;
      const body = await parseBody(req);
      const project = createProject(body, actor);
      return json(res, 201, { project, detail: getProjectDetail(project.id) });
    }

    const projectMatch = pathname.match(/^\/api\/projects\/(\d+)$/);
    if (projectMatch && req.method === 'GET') {
      const detail = getProjectDetail(projectMatch[1]);
      if (!detail) return serveNotFound(res);
      return json(res, 200, detail);
    }

    if (projectMatch && req.method === 'DELETE') {
      if (!requireRole(res, actor, ['admin'])) return;
      const projectId = Number(projectMatch[1]);
      const project = getProjectById(projectId);
      if (!project) return serveNotFound(res);
      const relatedFiles = store.files.filter(file => file.projectId === projectId);
      for (const file of relatedFiles) {
        if (fs.existsSync(file.filePath)) fs.rmSync(file.filePath, { force: true });
      }
      fs.rmSync(path.join(UPLOAD_DIR, String(projectId)), { recursive: true, force: true });
      store.files = store.files.filter(file => file.projectId !== projectId);
      store.logs = store.logs.filter(log => log.projectId !== projectId);
      store.projects = store.projects.filter(item => item.id !== projectId);
      persist();
      return json(res, 200, { message: '项目已删除' });
    }

    const baseInfoMatch = pathname.match(/^\/api\/projects\/(\d+)\/base-info$/);
    if (baseInfoMatch && req.method === 'PUT') {
      const project = getProjectById(baseInfoMatch[1]);
      if (!project) return serveNotFound(res);
      if (!canEdit(project, 'project_info', actor)) return json(res, 403, { message: '当前无权编辑基础信息' });
      const body = await parseBody(req);
      updateProjectBaseInfo(project, body, actor);
      return json(res, 200, { detail: getProjectDetail(project.id) });
    }

    const submitBaseInfoMatch = pathname.match(/^\/api\/projects\/(\d+)\/base-info\/submit$/);
    if (submitBaseInfoMatch && req.method === 'POST') {
      const project = getProjectById(submitBaseInfoMatch[1]);
      if (!project) return serveNotFound(res);
      if (!canEdit(project, 'project_info', actor)) return json(res, 403, { message: '当前无权提交基础信息' });
      submitStage(project, 'project_info', actor);
      return json(res, 200, { detail: getProjectDetail(project.id) });
    }

    const moduleMatch = pathname.match(/^\/api\/projects\/(\d+)\/modules\/([a-z_\-]+)$/);
    if (moduleMatch && req.method === 'PUT') {
      const project = getProjectById(moduleMatch[1]);
      if (!project) return serveNotFound(res);
      const stageCode = moduleMatch[2];
      if (!STAGE_ORDER.includes(stageCode)) return json(res, 400, { message: '未知阶段' });
      if (!validateNextOrder(project, stageCode)) return json(res, 400, { message: '前置阶段未完成，不能编辑当前模块' });
      if (!canEdit(project, stageCode, actor)) return json(res, 403, { message: '当前无权编辑该模块' });
      const body = await parseBody(req);
      saveStageFields(project, stageCode, body, actor);
      return json(res, 200, { detail: getProjectDetail(project.id) });
    }

    const submitModuleMatch = pathname.match(/^\/api\/projects\/(\d+)\/modules\/([a-z_\-]+)\/submit$/);
    if (submitModuleMatch && req.method === 'POST') {
      const project = getProjectById(submitModuleMatch[1]);
      if (!project) return serveNotFound(res);
      const stageCode = submitModuleMatch[2];
      if (!STAGE_ORDER.includes(stageCode)) return json(res, 400, { message: '未知阶段' });
      if (!validateNextOrder(project, stageCode)) return json(res, 400, { message: '前置阶段未完成，不能提交当前模块' });
      if (!canEdit(project, stageCode, actor)) return json(res, 403, { message: '当前无权提交该模块' });
      submitStage(project, stageCode, actor);
      return json(res, 200, { detail: getProjectDetail(project.id) });
    }

    const resetMatch = pathname.match(/^\/api\/projects\/(\d+)\/reset-stage$/);
    if (resetMatch && req.method === 'POST') {
      if (!requireRole(res, actor, ['admin'])) return;
      const project = getProjectById(resetMatch[1]);
      if (!project) return serveNotFound(res);
      const body = await parseBody(req);
      if (!STAGE_ORDER.includes(body.stage_code)) return json(res, 400, { message: '未知阶段' });
      resetStage(project, body.stage_code);
      logAction(project.id, body.stage_code, 'reset', actor, `重置 ${STAGE_LABELS[body.stage_code] || body.stage_code}`);
      return json(res, 200, { detail: getProjectDetail(project.id) });
    }

    if (pathname === '/api/files/upload' && req.method === 'POST') {
      if (!requireRole(res, actor, ['admin', 'executor'])) return;
      const body = await parseBody(req);
      const project = getProjectById(body.project_id);
      if (!project) return serveNotFound(res);
      const file = saveFile({
        projectId: project.id,
        moduleCode: body.module_code,
        fileName: body.file_name,
        contentType: body.content_type,
        contentBase64: body.content_base64,
        actor
      });
      return json(res, 200, file);
    }

    const fileMatch = pathname.match(/^\/api\/files\/(\d+)$/);
    if (fileMatch && req.method === 'GET') {
      const file = store.files.find(item => item.id === Number(fileMatch[1]));
      if (!file || !fs.existsSync(file.filePath)) return serveNotFound(res);
      const download = url.searchParams.get('download') === '1';
      res.writeHead(200, {
        'Content-Type': file.contentType || 'application/octet-stream',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(file.fileName)}"`
      });
      return fs.createReadStream(file.filePath).pipe(res);
    }

    return serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error);
    return json(res, 500, { message: error.message || '服务器异常' });
  }
});

server.listen(PORT, () => {
  console.log(`产学研项目管理系统已启动: http://localhost:${PORT}`);
});



