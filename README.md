# 产学研项目管理系统

## 1. 系统定位

本系统用于管理产学研项目从立项到结题的完整闭环流程，强调：

- 流程固定顺序：项目基础信息 -> 合同管理 -> 经费认领 -> 开票管理 -> 经费报销 -> 项目结题
- 角色权限清晰：管理员可全量维护，执行人提交后锁定，查看者只读
- 责任可追溯：每个环节必须有责任人
- 文件统一管理：所有附件走统一上传存储
- 轻量部署：前端可直接静态托管，后端可选 Node.js + SQLite

## 2. 系统结构图

```text
+-------------------------------------------------------------+
|                     产学研项目管理系统                        |
+-------------------------------------------------------------+
|  前端展示层                                                   |
|  - 首页看板                                                   |
|  - 项目列表/详情                                              |
|  - 六大业务环节表单                                           |
|  - 权限控制与只读视图                                         |
+-------------------------------------------------------------+
|  业务服务层                                                   |
|  - 认证与角色鉴权                                             |
|  - 项目流程状态机                                             |
|  - 提交锁定机制                                               |
|  - 管理员授权解锁                                             |
|  - 文件上传管理                                               |
|  - 金额统计与逾期提醒                                         |
+-------------------------------------------------------------+
|  数据持久层                                                   |
|  - SQLite / MySQL                                             |
|  - 项目主表                                                   |
|  - 各阶段业务表                                               |
|  - 文件表                                                     |
|  - 操作日志表                                                 |
|  - 授权修改记录表                                             |
+-------------------------------------------------------------+
```

## 3. 角色与权限

### 3.1 系统管理员（老师）

- 可查看、新增、编辑、删除全部项目与流程数据
- 可修改执行人已经提交的数据
- 可对已提交节点执行“授权修改”
- 可查看全部上传文件与操作日志
- 可手动推进、回退流程状态

### 3.2 项目执行人（学生 / 助理）

- 只能编辑自己负责的业务环节
- 提交后该环节自动锁定，不可自行修改
- 如需修改，必须由管理员执行授权解锁
- 不可越过顺序填写后续未开放环节

### 3.3 普通查看者

- 只能查看项目总览、当前进度、阶段状态、金额汇总
- 无新增、编辑、删除、提交权限
- 无文件上传权限

## 4. 核心业务流程

1. 创建项目基础信息
2. 完成合同管理
3. 发起并完成经费认领
4. 完成开票管理
5. 完成经费报销
6. 提交项目结题

流程约束：

- 前一环节未完成，后一环节不可提交
- 每一环节提交时校验责任人必填
- 执行人提交后进入锁定状态
- 管理员可解锁并保留授权记录

## 5. 数据库表结构

以下字段设计兼容 SQLite / MySQL，时间字段统一使用 `DATETIME`，文本说明类使用 `TEXT`。

### 5.1 `users` 用户表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| username | VARCHAR(50) | 登录账号 |
| password_hash | VARCHAR(255) | 密码哈希 |
| real_name | VARCHAR(50) | 姓名 |
| role | VARCHAR(20) | `admin` / `executor` / `viewer` |
| phone | VARCHAR(30) | 联系电话 |
| email | VARCHAR(100) | 邮箱 |
| status | TINYINT | 1启用 0停用 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### 5.2 `projects` 项目主表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| project_name | VARCHAR(200) | 项目名称 |
| enterprise_name | VARCHAR(200) | 合作企业 |
| project_leader | VARCHAR(100) | 项目负责人 |
| setup_year | INT | 立项年度 |
| current_stage | VARCHAR(30) | 当前阶段 |
| current_progress | VARCHAR(50) | 当前进度描述 |
| remark | TEXT | 备注 |
| overall_status | VARCHAR(30) | `draft` / `in_progress` / `completed` / `closed` |
| created_by | BIGINT | 创建人 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### 5.3 `project_members` 项目成员责任表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 所属项目 |
| user_id | BIGINT | 用户ID |
| stage_code | VARCHAR(30) | 负责环节编码 |
| stage_name | VARCHAR(50) | 负责环节名称 |
| is_primary | TINYINT | 是否主责任人 |
| created_at | DATETIME | 创建时间 |

### 5.4 `contract_confirmations` 合同确定表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 项目ID |
| responsible_user_id | BIGINT | 责任人 |
| confirm_time | DATETIME | 确定时间 |
| final_contract_file_id | BIGINT | 合同定稿文件 |
| status | VARCHAR(20) | `pending` / `confirmed` |
| submitted_at | DATETIME | 提交时间 |
| submitted_by | BIGINT | 提交人 |
| is_locked | TINYINT | 提交后是否锁定 |
| updated_at | DATETIME | 更新时间 |

### 5.5 `contract_seals` 合同盖章表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 项目ID |
| responsible_user_id | BIGINT | 责任人 |
| seal_time | DATETIME | 盖章时间 |
| contract_copies | INT | 合同份数 |
| is_scanned | TINYINT | 是否扫描 |
| is_uploaded | TINYINT | 是否上传 |
| scanned_file_id | BIGINT | 扫描件上传 |
| submitted_at | DATETIME | 提交时间 |
| submitted_by | BIGINT | 提交人 |
| is_locked | TINYINT | 锁定状态 |
| updated_at | DATETIME | 更新时间 |

### 5.6 `contract_deliveries` 合同寄送签收表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 项目ID |
| responsible_user_id | BIGINT | 责任人 |
| sent_time | DATETIME | 寄出时间 |
| tracking_no | VARCHAR(100) | 快递单号 |
| receipt_screenshot_file_id | BIGINT | 签收截图 |
| customer_confirm_file_id | BIGINT | 客户确认截图 |
| customer_confirm_status | VARCHAR(20) | `pending` / `confirmed` / `rejected` |
| submitted_at | DATETIME | 提交时间 |
| submitted_by | BIGINT | 提交人 |
| is_locked | TINYINT | 锁定状态 |
| updated_at | DATETIME | 更新时间 |

### 5.7 `fund_claims` 经费认领表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 项目ID |
| responsible_user_id | BIGINT | 责任人 |
| bank_flow_screenshot_file_id | BIGINT | 流水截图 |
| bank_flow_no | VARCHAR(100) | 流水单号 |
| apply_time | DATETIME | 认领申请时间 |
| finance_confirm_time | DATETIME | 财务认领时间 |
| claim_result | VARCHAR(50) | 认领结果 |
| arrival_status | VARCHAR(20) | `pending` / `arrived` / `failed` |
| remark | TEXT | 备注 |
| recognized_amount | DECIMAL(12,2) | 到账金额 |
| submitted_at | DATETIME | 提交时间 |
| submitted_by | BIGINT | 提交人 |
| is_locked | TINYINT | 锁定状态 |
| updated_at | DATETIME | 更新时间 |

### 5.8 `invoice_records` 开票管理表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 项目ID |
| responsible_user_id | BIGINT | 责任人 |
| apply_time | DATETIME | 申请时间 |
| invoice_type | VARCHAR(30) | `普通票` / `专票` / `增值税专票` |
| invoice_preview_file_id | BIGINT | 发票预览图 |
| customer_confirm_status | VARCHAR(20) | `pending` / `confirmed` / `rejected` |
| electronic_invoice_file_id | BIGINT | 电子发票 |
| send_status | VARCHAR(20) | `unsent` / `sent` / `received` |
| invoice_time | DATETIME | 开票时间 |
| invoice_amount | DECIMAL(12,2) | 开票金额 |
| submitted_at | DATETIME | 提交时间 |
| submitted_by | BIGINT | 提交人 |
| is_locked | TINYINT | 锁定状态 |
| updated_at | DATETIME | 更新时间 |

### 5.9 `reimbursements` 经费报销表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 项目ID |
| responsible_user_id | BIGINT | 责任人 |
| reimbursement_time | DATETIME | 报销时间 |
| reimbursement_amount | DECIMAL(12,2) | 报销金额 |
| ticket_type | VARCHAR(30) | `有票` / `无票劳务费` |
| payee_name | VARCHAR(100) | 收款账户人 |
| voucher_file_id | BIGINT | 凭证上传 |
| teacher_confirm_status | VARCHAR(20) | `pending` / `confirmed` / `rejected` |
| total_budget_amount | DECIMAL(12,2) | 项目总金额 |
| reimbursed_amount | DECIMAL(12,2) | 已报金额 |
| remaining_amount | DECIMAL(12,2) | 剩余金额 |
| submitted_at | DATETIME | 提交时间 |
| submitted_by | BIGINT | 提交人 |
| is_locked | TINYINT | 锁定状态 |
| updated_at | DATETIME | 更新时间 |

### 5.10 `project_closures` 项目结题表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 项目ID |
| responsible_user_id | BIGINT | 责任人 |
| closure_report_file_id | BIGINT | 结题报告上传 |
| apply_time | DATETIME | 申请时间 |
| closure_status | VARCHAR(20) | `pending` / `reviewing` / `completed` / `overdue` |
| completed_time | DATETIME | 完成时间 |
| overdue_reminder | TINYINT | 是否逾期提醒 |
| submitted_at | DATETIME | 提交时间 |
| submitted_by | BIGINT | 提交人 |
| is_locked | TINYINT | 锁定状态 |
| updated_at | DATETIME | 更新时间 |

### 5.11 `file_assets` 文件上传表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 项目ID |
| module_code | VARCHAR(50) | 所属模块 |
| business_id | BIGINT | 业务表记录ID |
| file_name | VARCHAR(255) | 原始文件名 |
| file_path | VARCHAR(500) | 存储路径 |
| file_size | BIGINT | 文件大小 |
| file_ext | VARCHAR(20) | 后缀 |
| content_type | VARCHAR(100) | MIME类型 |
| uploaded_by | BIGINT | 上传人 |
| uploaded_at | DATETIME | 上传时间 |

### 5.12 `edit_authorizations` 授权修改表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 项目ID |
| stage_code | VARCHAR(30) | 环节编码 |
| target_record_id | BIGINT | 目标记录ID |
| granted_to_user_id | BIGINT | 被授权人 |
| granted_by_user_id | BIGINT | 授权管理员 |
| reason | VARCHAR(255) | 授权原因 |
| valid_until | DATETIME | 授权有效期 |
| used_status | VARCHAR(20) | `unused` / `used` / `expired` |
| created_at | DATETIME | 创建时间 |

### 5.13 `operation_logs` 操作日志表

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 项目ID |
| module_code | VARCHAR(50) | 模块编码 |
| action_type | VARCHAR(30) | 新增/编辑/提交/删除/解锁 |
| operator_id | BIGINT | 操作人 |
| operator_name | VARCHAR(50) | 操作人姓名 |
| action_content | TEXT | 操作内容 |
| created_at | DATETIME | 操作时间 |

## 6. 前端页面描述 / 原型

### 6.1 登录页

- 账号密码登录
- 角色识别后跳转对应首页

### 6.2 首页看板（只读）

- 项目总数
- 进行中项目数
- 已结题项目数
- 本月待处理项目数
- 阶段进度统计
- 最近项目列表
- 超期提醒列表

### 6.3 项目列表页

- 按项目名称、企业、负责人、年度、当前阶段筛选
- 列表展示进度、责任人、阶段完成情况
- 查看详情入口
- 管理员可新建、编辑、删除

### 6.4 项目详情页

- 顶部显示基础信息
- 中部显示流程步骤条
- 下方分区卡片展示六大模块
- 每个模块显示字段、状态、责任人、附件
- 执行人仅能编辑本人负责且已开放的环节
- 已提交环节显示锁定标识

### 6.5 授权修改页（管理员）

- 查看已锁定环节
- 选择被授权人
- 填写授权原因与有效期
- 授权后允许该执行人一次性修改

### 6.6 日志与文件页

- 查看全部操作日志
- 统一查看上传附件
- 按项目、模块、上传人筛选

## 7. 后端业务逻辑

### 7.1 认证与权限

- 登录成功后签发 JWT / Session
- 每次接口访问校验角色
- 执行人接口必须进一步校验“是否为当前环节责任人”

### 7.2 流程状态机

定义阶段编码：

- `project_info`
- `contract_management`
- `fund_claim`
- `invoice_management`
- `reimbursement`
- `project_closure`

规则：

- `project_info` 完成后，开放 `contract_management`
- 合同管理三个子步骤全部完成后，开放 `fund_claim`
- 经费认领完成后，开放 `invoice_management`
- 开票管理完成后，开放 `reimbursement`
- 报销完成后，开放 `project_closure`

### 7.3 提交锁定机制

- 执行人保存草稿时可重复编辑
- 点击提交后：
  - 校验必填字段完整
  - 校验责任人存在
  - 写入 `submitted_at`
  - 将 `is_locked = 1`
- 锁定后普通执行人不可再修改

### 7.4 管理员授权修改

- 管理员创建授权记录
- 指定项目、环节、人员、有效期
- 执行人只有在授权有效且未使用时才可重新编辑
- 执行人再次提交后：
  - 授权状态更新为 `used`
  - 业务记录重新锁定

### 7.5 文件上传

- 上传到统一目录：`/uploads/{projectId}/{moduleCode}/`
- 文件名采用 UUID 重命名
- 数据库存原始名与存储路径
- 下载时校验登录权限

### 7.6 报销金额自动计算

计算逻辑：

- `total_budget_amount` 来源于项目总到账或预算值
- `reimbursed_amount` = 该项目全部报销记录金额累计
- `remaining_amount` = `total_budget_amount - reimbursed_amount`

### 7.7 逾期提醒

- 结题状态为未完成，且当前日期超过预设完成期限时
- 标记 `overdue_reminder = 1`
- 首页看板显示红色提醒

## 8. 推荐接口设计

### 8.1 项目接口

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{id}`
- `PUT /api/projects/{id}`
- `DELETE /api/projects/{id}`

### 8.2 合同管理接口

- `POST /api/projects/{id}/contract-confirmation`
- `POST /api/projects/{id}/contract-seal`
- `POST /api/projects/{id}/contract-delivery`

### 8.3 经费与开票接口

- `POST /api/projects/{id}/fund-claim`
- `POST /api/projects/{id}/invoice`
- `POST /api/projects/{id}/reimbursement`
- `POST /api/projects/{id}/closure`

### 8.4 授权与日志接口

- `POST /api/authorizations`
- `GET /api/authorizations`
- `GET /api/logs`
- `POST /api/files/upload`

## 9. 部署建议

轻量方案：

- 前端：单页静态页面，Nginx / 宝塔 / GitHub Pages 均可托管
- 后端：Node.js + Express
- 数据库：SQLite
- 文件：本地磁盘 `uploads` 目录

适合免费服务器的原因：

- 无复杂微服务
- SQLite 占用低
- Vue CDN 版本无构建链依赖
- 单机即可运行

## 10. 当前交付内容

- `index.html`：可直接运行的前端原型
- 本文档：系统结构、数据表、原型说明、后端逻辑

运行方式：

1. 直接浏览器打开 `index.html`
2. 或在目录执行静态服务后访问

## 11. 当前可运行版本说明

当前目录已经包含一个可直接启动的轻量全栈版本：

- `server.js`：原生 Node HTTP 服务 + 内置 `node:sqlite` 数据库
- `public/index.html`：接口驱动前端页面
- `data/system.db`：首次启动自动生成
- `uploads/`：统一文件上传目录
- `package.json`：启动脚本

### 启动方式

1. 进入目录：`D:\industry-academia-project-system`
2. 启动服务：`node server.js`
3. 浏览器访问：`http://localhost:3000`

### 默认演示角色

- 管理员：张老师
- 执行人：刘助理 / 陈同学 / 赵助理
- 查看者：普通查看者

### 当前实现说明

- 已实现项目总览、项目详情、六大流程模块、顺序提交控制
- 已实现提交锁定、管理员授权修改、统一文件上传、操作日志
- 已实现 SQLite 自动建表与初始演示数据
- 当前认证为轻量演示模式，由前端角色切换模拟请求头
- 若要上线生产，可在此基础上继续补登录密码、会话认证、分页、附件预览和下载权限细化

### 本轮继续补充的功能

已新增以下生产可用能力：

- 项目列表筛选：支持按项目名称、合作企业、负责人、当前阶段、立项年度查询
- 项目分页：支持页码与每页数量切换
- 新增项目：管理员可直接创建项目并自动初始化六大流程数据
- 删除项目：管理员可删除项目，同时清理该项目流程记录、附件记录与上传目录
- 附件预览与下载：通过文件接口统一访问已上传附件

### 新增接口

- `GET /api/projects?page=1&pageSize=10&project_name=&enterprise_name=&project_leader=&current_stage=&setup_year=`
- `POST /api/projects`
- `DELETE /api/projects/{id}`
- `GET /api/files/{id}`
- `GET /api/files/{id}?download=1`
