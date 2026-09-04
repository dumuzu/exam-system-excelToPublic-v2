# Exam System ExcelToPublic v2

一个可自行部署的多科目 Web 考试管理系统，采用 MIT License 开源。

本项目是从 Excel 公式考试演进而来的多科目考试平台。系统保留已经稳定的 Excel 组卷、公式计算、考试状态机、自动保存、评分和 PostgreSQL 数据流程，并以 Assessment Kernel 为边界，把科目题型能力与账号、权限、考场、防作弊、答卷和成绩等通用能力拆开。

当前已经形成可运行的完整闭环：系统管理员配置科目和账号，教师出题并生成试卷，学生进入考场作答，服务端自动保存和收卷，最后完成自动评分、人工复核与成绩查询。

## 主要能力

- 多科目管理：每个科目可配置日文、中文、英文名称、学生端显示语言和可用出题能力。
- 分级权限：支持超级管理员、科目管理员、教师、助教和监考员；普通教师只能访问被分配的科目以及自己有权管理的考试。
- 多科目分配：一个教师账号可以同时加入多个科目，并在不同科目拥有不同权限。
- 两类出题适配器：
  - `excel_formula`：Excel 公式题、选择题、确定性随机组卷和自动评分。
  - `manual_questions`：单选、多选、填空和简答题，支持全部题目或从题库随机抽取指定数量。
- 名册导入：浏览器读取 CSV、XLS、XLSX 中的学号和姓名列；原始出席文件不上传，服务端只接收标准化后的两列名单。
- 考试时长：教师可以为正式考试设置时长，默认 90 分钟；服务端以截止时间为准处理自动提交。
- 考场管理：名单确认、教师放行、试卷预生成、在线状态、暂停、恢复、中止和失败重试。
- 防作弊：全屏、焦点、剪贴板和导航信号由通用 Integrity Policy 处理；离开全屏的恢复宽限为首次 10 秒、第二次 5 秒、之后 3 秒，只有超时未恢复才记为违规。
- 可靠提交：答案采用版本化自动保存；手动提交、考试到时和教师中止都会进入同一套服务端收卷流程。
- 成绩管理：客观题和 Excel 公式题自动评分，简答题进入人工复核，教师可以逐题调整并保留审计信息。
- 多语言界面：管理端支持日文、简体中文和英文；学生端语言由科目统一指定，学生不能自行切换。

## 技术栈

| 层级 | 实现 |
| --- | --- |
| 管理端 | React 19、TypeScript、Vite、TanStack Router、TanStack Query、TanStack Table |
| 前端校验与状态 | Zod、Zustand、Sonner |
| 学生考试端 | TypeScript、原生浏览器模块、渐进式 UI 重构 |
| 服务端 | Node.js 24 原生 HTTP Server、严格 TypeScript |
| 数据库 | PostgreSQL、`pg` 连接池、顺序 SQL 迁移 |
| Excel 处理 | SheetJS CE、Decimal.js、自研公式解析与评分 |
| 部署 | Node.js 进程、Docker，或可选的 Vercel Function |
| 测试 | Node.js 内置 Test Runner、接口与业务流程集成测试 |

TypeScript 严格模式保持开启。共享 API 契约集中在 `src/types/`，运行时请求和响应使用 Zod 校验，前后端不维护两套相互漂移的接口类型。

## 整体架构

```text
管理端 React UI                    学生考试端
     │                                 │
     ├─ TanStack Router                ├─ 身份确认 / 放行
     ├─ TanStack Query                 ├─ 作答 / 自动保存
     └─ Typed API Client               └─ 提交 / 防作弊信号
                  │                    │
                  └──────── HTTP API ──┘
                              │
                    身份认证与授权策略
                              │
                       Assessment Kernel
                       ┌──────┴──────┐
                Excel Adapter   Manual Adapter
                       └──────┬──────┘
                  Attempt / Integrity / Grading
                              │
                    Repository / PostgreSQL
```

架构的核心原则是：React 只负责客户端表现层和应用层，服务端仍是权限、考试状态和数据事实的唯一可信来源。Assessment Kernel 不依赖 HTTP、React 或数据库，它通过 Adapter 统一出题校验、题纸准备、学生视图、答案校验和评分。

## 目录结构

```text
src/
├─ assessment-types/       # Excel 与教师自定义题目的适配器
├─ client/
│  ├─ app/                 # Router、Provider、Layout、路由守卫
│  ├─ features/            # 按业务垂直拆分的 React 功能模块
│  └─ shared/              # API Client、UI Primitive、Pattern、样式和 i18n
├─ core/                   # Assessment Kernel、组卷、评分、防作弊和领域规则
├─ features/               # 服务端应用用例与领域输入校验
├─ platform/               # 科目适配器与平台之间的稳定协议
├─ server/                 # HTTP、认证授权、Repository 和 PostgreSQL 实现
└─ types/
   ├─ contracts/           # 前后端共享 API 契约
   ├─ models/              # 全局与跨模块数据模型
   └─ routes/              # 类型安全的路由 Search 参数

db/
├─ migrations/             # 001 至 030 的顺序数据库迁移
└─ seeds/                  # 函数目录等基础数据

public/                    # Vite 构建产物与学生端静态资源，不作为主要手写源码
scripts/                   # 构建、迁移、审计和容量认证脚本
test/                      # 核心规则、API、数据库与完整流程测试
```

### React 管理端

管理端采用 Vertical Slice 组织方式。`accounts`、`subjects`、`exam-authoring`、`exams`、`exam-room` 和 `results` 各自维护 API、Query、组件与 Route，避免页面组件直接发起 `fetch`。

- TanStack Router 负责类型安全路由、鉴权 Loader、URL 筛选状态和页面级懒加载。
- TanStack Query 负责服务端数据、缓存、刷新和 Mutation。
- TanStack Table 负责管理端数据表格、列定义、排序和一致的对齐规则。
- Zustand 只保存侧栏折叠等纯客户端偏好，不保存考试或成绩数据。
- Sonner 提供统一的操作反馈，Zod 在网络边界校验数据。

### Assessment Kernel

`src/core/assessment-kernel.ts` 定义统一适配器接口：

1. `validateAuthoring` 校验教师的出题配置。
2. `preparePaper` 根据考试、学生和种子生成不可变题纸。
3. `createStudentView` 删除答案等服务端私有信息。
4. `validateResponse` 拒绝未知题号、错误类型和超限答案。
5. `gradeResponse` 输出适配器自己的评分结果。

新增科目题型时，只需要实现这组协议并注册 Adapter；账号、科目分配、考场、Attempt、防作弊、提交和成绩框架可以继续复用。

## 一次考试的完整流程

### 1. 系统配置

系统管理员在独立工作区维护科目、账号和科目成员关系。科目可配置学生端语言与一种或多种出题能力；系统管理员不承担日常出题和考场操作。

### 2. 教师出题

教师进入已分配科目后选择出题能力：

- Excel 公式考试从函数目录、难度和模式生成题目配置。
- 教师自定义题目可录入单选、多选、填空和简答题，并决定是否设置参考答案。
- 人工题库既可以按当前顺序发放全部题目，也可以为每名学生稳定随机抽取指定题量并随机排序。
- 教师可以设置考试时长，正式考试默认 90 分钟。

教师可以预览、保存历史配置，再创建考试准备任务。

### 3. 名册与试卷准备

浏览器从出席文件中只提取学号和姓名，按学号去重后上传标准化名单。正式考试为每名学生使用稳定种子预生成独立题纸；课堂课题可以复用共享题纸。准备过程按批次执行并经过结构校验，只有全部题纸就绪的考试才能发布。

### 4. 入场与作答

学生使用考试代码和学号确认身份，等待教师放行后开始 Attempt。服务端返回去除答案的学生题纸以及科目指定的界面语言。作答过程中答案带版本号自动保存，刷新或短暂断线后可以恢复最新服务端版本。

### 5. 提交与收卷

提交由服务端状态机统一处理：

- 学生主动提交时先确认身份和提交意图，再冻结当前答卷。
- 考试时间归零时，服务端以截止时间判断并提交过期 Attempt，不能依赖客户端计时器绕过。
- 教师中止考场时，在线端先获得短暂同步窗口，随后后台任务分批提交作答中或违规暂停的答卷。
- 已提交操作保持幂等；考场关闭后学生不能重新进入或继续保存答案。
- 单份答卷提交失败会持久化为安全诊断，教师可以单独重试，不影响其他学生。

### 6. 评分与成绩

提交完成后，服务端把保存的答案交给相应 Adapter：

- Excel 公式题、单选、多选和有参考答案的填空题可自动评分。
- 简答题和无法自动判断的题目进入 `review_required`。
- 教师复核或逐题调整后，答卷转为 `graded`。
- 成绩管理按科目和考试读取成绩、提交时间、Attempt 次数与违规记录，并支持 CSV 导出。

## 权限与安全

权限由三层共同决定：平台角色、科目成员权限和考试资源归属。前端路由守卫只改善使用体验，最终授权始终在服务端执行。

- 管理员和教师使用 PostgreSQL 持久账号、scrypt 密码哈希和可撤销的 HTTP-only 会话 Cookie。
- 所有写请求校验 CSRF Token；登录同时按账号和 IP 限流。
- 普通教师不能访问未分配科目，也不能管理不属于自己权限范围的考试。
- 超级管理员的跨科目敏感操作写入追加式审计记录。
- 学生会话与提交确认使用签名 Token；答案、参考答案和评分规则不会下发到学生端。
- CSP、安全响应头、请求体上限和数据库连接池统一在服务端配置。
- 原始名册文件只在浏览器解析，不进入服务器或数据库。

## 状态与数据模型

系统的重要状态都由服务端持久化：

```text
考试：准备中 → 已就绪 → 进行中 → 收卷中 → 已结束

答卷：等待入场 → 作答中 → 违规暂停 → 已提交 → 待复核 → 已评分
```

核心数据包括科目、账号、科目成员关系、考试配置、名册快照、预生成题纸、Attempt、答案版本、违规事件、收卷任务、逐题评分和成绩调整。数据库迁移按 `db/migrations/001...030` 顺序维护；迁移 030 为考试配置加入可配置时长。

## 容量与稳定性边界

当前自动化验证覆盖：

- 单场正式考试 200 名学生。
- 每人 50 题，共 10,000 道预生成题目，分批生成和校验。
- 多教师、多科目隔离以及每个教师同时分配多个科目。
- 自动保存版本冲突、重复提交、过期提交、中止收卷和失败重试。

这些结果证明业务流程和数据一致性可以在该规模下完成，不等同于任意网络和数据库规格下的瞬时并发 SLA。正式考试前仍应在目标 PostgreSQL 规格和真实网络条件下完成预生成、数据库审计与容量演练。

## 本地运行

需要 Node.js 24.x 和 PostgreSQL。先复制环境变量模板：

```powershell
Copy-Item .env.example .env
```

至少填写：

- `SESSION_SECRET`：32 个字符以上的随机会话密钥。
- `CRON_SECRET`：过期答卷扫描任务的独立密钥。
- `DATABASE_URL`：应用运行使用的 PostgreSQL URL；Serverless 环境建议使用连接池地址。
- `MIGRATION_DATABASE_URL`：执行数据库迁移的直连 URL，或拥有迁移权限的独立数据库账号。

首次部署到一个全新的数据库时，先执行迁移并创建第一个超级管理员：

```powershell
npm run db:migrate

$env:BOOTSTRAP_ADMIN_USERNAME = "admin"
$env:BOOTSTRAP_ADMIN_DISPLAY_NAME = "System Administrator"
$env:BOOTSTRAP_ADMIN_PASSWORD = "请替换为至少12位的高强度密码"
npm run auth:bootstrap
Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD
```

`auth:bootstrap` 只允许在系统还没有活动超级管理员时执行。之后的账号和科目分配应在系统管理页面完成，不要在脚本或仓库中保存密码。

安装、检查并启动：

```powershell
npm install
npm run check
npm test
npm run db:audit
npm start
```

默认入口：

- 管理端：`http://127.0.0.1:4173/admin/`
- 学生端：`http://127.0.0.1:4173/exam/`
- 健康检查：`http://127.0.0.1:4173/api/health`

不要提交 `.env`、数据库连接串、会话密钥或生产账号。生产环境不得启用 `ENABLE_TEST_ADMIN`。

迁移只创建数据库结构、通用函数目录、题型蓝图和一个通用的“表計算演習 / 电子表格练习 / Spreadsheet Practice”科目。公开仓库不包含任何现有考试、考场、教师账号、学生名册、答卷、违规记录或成绩数据；`test/` 中仅使用生成的虚构测试数据，首次管理员必须由部署者自行初始化。

## 测试与发布检查

```powershell
npm run typecheck        # 服务端、浏览器与 React 严格类型检查
npm run build:client     # 生成 React 管理端和学生端浏览器资源
npm run check            # 类型、构建产物和工程约束的综合检查
npm run check:public-release # 检查私有路径、数据文件、内部文档和业务数据写入
npm test                 # 全量领域与 API 回归测试
npm run db:audit         # 只读数据库稳定性审计
```

重点流程测试包括：

- `test/automatic-grading-workflow.test.ts`：Excel 出题、组卷、提交、自动评分和调分。
- `test/manual-assessment-api.test.ts`：四类人工题、发布、学生提交与人工复核。
- `test/exam-preparation.test.ts`：200 人、10,000 道题的批量试卷准备。
- `test/student-api.test.ts`：学生身份、放行、保存和提交接口。
- `test/exam-event-lifecycle.test.ts`：超时、中止、强制收卷、禁止重入和幂等。
- `test/postgres-submission-persistence.test.ts`：PostgreSQL 提交持久化契约。

## 部署方式

系统本身是标准 Node.js HTTP 服务，不依赖 Vercel。无论选择哪种平台，都应先执行数据库迁移、初始化管理员，并通过 `npm run check`、`npm test` 和 `npm run db:audit`。

### Node.js 进程

在 Linux、Windows Server、云主机或支持常驻 Node.js 进程的平台上，可以直接运行：

```bash
npm ci --omit=dev
HOST=0.0.0.0 PORT=4173 npm start
```

生产环境应在应用前配置 Nginx、Caddy 或平台负载均衡器，提供 HTTPS、请求超时与访问日志。`/api/health` 可作为健康检查地址。

### Docker

仓库提供完整的 Docker Compose 初始化流程，包含 PostgreSQL、环境校验、顺序迁移、首个管理员初始化和应用健康检查。先复制专用模板：

```powershell
Copy-Item .env.docker.example .env.docker
```

Linux/macOS 使用 `cp .env.docker.example .env.docker`。打开 `.env.docker`，替换所有以 `replace-` 开头的值；数据库密码请只使用字母、数字、下划线和连字符。然后执行：

```bash
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
```

访问 `http://127.0.0.1:4173/admin/`，使用 `.env.docker` 中的初始管理员登录。首次登录成功后，应从 `.env.docker` 删除 `BOOTSTRAP_ADMIN_PASSWORD`；再次运行同一条启动命令时，初始化任务会识别已有管理员并安全跳过。

查看日志和停止服务：

```bash
docker compose --env-file .env.docker logs -f app
docker compose --env-file .env.docker down
```

`down` 会保留 PostgreSQL 命名卷。只有明确要永久删除全部数据库内容时才使用 `docker compose --env-file .env.docker down --volumes`。PostgreSQL 默认不向宿主机开放 5432 端口；应用只发布 `APP_PORT`。不要提交 `.env.docker`，也不要把密码写进镜像。

如需使用托管 PostgreSQL 或自行编排容器，仍可按上一节分别执行 `npm run db:migrate`、`npm run auth:bootstrap` 和 `npm start`，不强制采用仓库内置数据库。

### Vercel（可选）

如果部署者选择 Vercel，`api/index.ts` 和 `vercel.json` 可以把同一请求处理器运行成 Vercel Function。Serverless 环境建议为 `DATABASE_URL` 使用 PostgreSQL 连接池地址，迁移仍应通过直连地址在部署前单独执行。Vercel 只是一个可选适配器，不是系统运行前提。

部署完成后检查 `/api/health`，再用隔离的测试考试完成入场、保存、提交和成绩读取冒烟测试。

## 扩展新科目

如果新科目可以使用单选、多选、填空和简答题，只需为科目启用 `manual_questions`，不需要复制考场或防作弊代码。

如果新科目需要全新的题纸或评分方式：

1. 在 `src/assessment-types/` 新建 Adapter。
2. 实现 Assessment Kernel 的出题校验、题纸准备、学生视图、答案校验和评分接口。
3. 在共享类型中增加明确的数据模型与 Zod Schema。
4. 注册 Adapter，并为科目开放对应出题能力。
5. 增加从出题到成绩的完整流程测试。

不要把科目规则写进通用的账号、考场或 Attempt 模块，也不要在 React 组件中复制服务端权限与评分逻辑。

## 当前边界

- 学生身份目前以考试代码、名单学号、教师现场确认和放行为主，尚未接入学校邮箱验证码。
- 学生端仍在当前稳定考试界面上渐进优化，没有进行高风险的整体重写。
- Excel 公式支持受控白名单和课程所需组合，不追求完整复刻桌面版 Excel。
- 正式使用前仍需对真实题库语言、留学生可读性、备份恢复和目标并发进行考前复核。

---

Copyright © 2026 MinorCold_12. Released under the MIT License.
