# Exam System ExcelToPublic v2

[中文](#中文) · [日本語](#日本語) · [English](#english)

## 中文

这是一个可自行部署的多科目考试系统。管理端负责科目、账号、出题、考场和成绩；学生端负责身份确认、作答、自动保存与提交。

项目最早用于 Excel 公式考试，现在已经把通用考试流程和科目题型拆开。新增普通科目时，可以直接使用单选、多选、填空和简答题，不需要复制账号、考场或防作弊代码。

### 功能

- 科目与教师权限管理，一个教师可负责多个科目
- Excel 公式题和教师自定义题目
- 全卷发放或从题库随机抽取指定题量
- CSV、XLS、XLSX 名册导入，只读取学号和姓名
- 候考、教师放行、自动保存、超时收卷和中止考试
- 客观题自动评分、简答题人工复核、成绩导出
- 管理端支持中文、日文和英文
- 学生端语言由科目指定，学生不能自行切换

### 直接使用 Docker 镜像

需要 Docker Desktop 或 Docker Engine。公开镜像地址：

```text
ghcr.io/dumuzu/exam-system-exceltopublic-v2:latest
```

下载配置：

```bash
curl -LO https://raw.githubusercontent.com/dumuzu/exam-system-excelToPublic-v2/main/compose.yaml
curl -Lo .env.docker https://raw.githubusercontent.com/dumuzu/exam-system-excelToPublic-v2/main/.env.docker.example
```

编辑 `.env.docker`，替换所有以 `replace-` 开头的内容。然后启动：

```bash
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

管理端位于 `http://127.0.0.1:4173/admin/`，学生端位于 `http://127.0.0.1:4173/exam/`。首次登录使用 `.env.docker` 中设置的管理员账号和密码。

更新镜像：

```bash
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
```

数据库保存在 Docker 命名卷中，普通的 `down` 或更新不会删除数据。`down --volumes` 会永久删除数据库，请谨慎使用。

### 从源码构建

```bash
git clone https://github.com/dumuzu/exam-system-excelToPublic-v2.git
cd exam-system-excelToPublic-v2
cp .env.docker.example .env.docker
# 编辑 .env.docker
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.docker up -d --build
```

不使用 Docker 时，需要 Node.js 24 和 PostgreSQL：

```bash
npm ci
npm run db:migrate
npm run auth:bootstrap
npm start
```

提交代码前可运行：

```bash
npm run build:client
npm run check
npm test
npm run check:public-release
```

### 架构

```text
React 管理端 ─┐
              ├─ Node.js / TypeScript API ─ Assessment Kernel ─ PostgreSQL
学生考试端 ───┘                              ├─ Excel Adapter
                                             └─ Manual Questions Adapter
```

React 只处理界面、路由和请求状态。权限、考试状态、收卷、评分和数据库事务仍由服务端负责。前后端共享 `src/types/` 中的接口类型，网络边界使用 Zod 校验。

公开仓库不包含任何现有考试、考场、教师账号、学生名册、答卷、违规记录或成绩数据。部署者需要自行初始化管理员并建立科目。

## 日本語

自分のサーバーで運用できる、複数科目対応の試験システムです。管理画面では科目、アカウント、問題、試験会場、成績を管理します。学生画面では本人確認、解答、自動保存、提出を行います。

もともとは Excel 関数試験用のシステムでしたが、現在は試験の共通処理と科目固有の問題形式を分離しています。通常の科目では、単一選択、複数選択、穴埋め、記述問題をそのまま利用できます。

### 主な機能

- 科目別の権限管理と、教員への複数科目割り当て
- Excel 関数問題と教員作成問題
- 全問出題、または問題バンクから指定数をランダム出題
- CSV、XLS、XLSX の名簿から学籍番号と氏名だけを読み込み
- 待機、教員による入場許可、自動保存、時間切れ提出、試験中止
- 自動採点、記述問題の確認、成績 CSV 出力
- 管理画面は日本語、中国語、英語に対応
- 学生画面の言語は科目側で固定

### 公開 Docker イメージを使う

Docker Desktop または Docker Engine が必要です。

```text
ghcr.io/dumuzu/exam-system-exceltopublic-v2:latest
```

設定ファイルを取得します。

```bash
curl -LO https://raw.githubusercontent.com/dumuzu/exam-system-excelToPublic-v2/main/compose.yaml
curl -Lo .env.docker https://raw.githubusercontent.com/dumuzu/exam-system-excelToPublic-v2/main/.env.docker.example
```

`.env.docker` を開き、`replace-` で始まる値をすべて変更してから起動します。

```bash
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
```

管理画面は `http://127.0.0.1:4173/admin/`、学生画面は `http://127.0.0.1:4173/exam/` です。初回ログインには `.env.docker` で設定した管理者情報を使用します。

ソースからビルドする場合：

```bash
git clone https://github.com/dumuzu/exam-system-excelToPublic-v2.git
cd exam-system-excelToPublic-v2
cp .env.docker.example .env.docker
# .env.docker を編集
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.docker up -d --build
```

データベースは Docker ボリュームに保存されます。`docker compose down --volumes` を実行するとデータが削除されます。

管理画面は React、TypeScript、Vite、TanStack Router / Query / Table で構成されています。サーバーは Node.js と PostgreSQL を使用します。権限、試験状態、提出、採点はサーバー側が管理します。

この公開版には、元システムのアカウント、名簿、答案、成績データは含まれていません。

## English

A self-hosted examination system for multiple subjects. Administrators manage subjects and accounts, while teachers prepare papers, run exam rooms, and review results. Students use a separate interface for identity checks, answering, autosave, and submission.

The project began as an Excel formula exam. Its shared exam workflow is now separated from subject-specific question types. A regular subject can use single choice, multiple choice, fill-in-the-blank, and short-answer questions without duplicating the room, account, or integrity code.

### Features

- Subject-scoped roles and multiple subject assignments per teacher
- Excel formula questions and teacher-authored questions
- Full-paper delivery or a fixed-size random draw from a question bank
- CSV, XLS, and XLSX roster import that keeps only student ID and name
- Waiting room, teacher admission, autosave, deadline submission, and exam termination
- Automatic grading, manual review, and CSV result export
- Japanese, Simplified Chinese, and English administration UI
- Student UI language fixed by the subject configuration

### Run the public Docker image

Docker Desktop or Docker Engine is required.

```text
ghcr.io/dumuzu/exam-system-exceltopublic-v2:latest
```

Download the configuration:

```bash
curl -LO https://raw.githubusercontent.com/dumuzu/exam-system-excelToPublic-v2/main/compose.yaml
curl -Lo .env.docker https://raw.githubusercontent.com/dumuzu/exam-system-excelToPublic-v2/main/.env.docker.example
```

Open `.env.docker` and replace every value beginning with `replace-`, then start the system:

```bash
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
```

The admin UI is at `http://127.0.0.1:4173/admin/`; the student UI is at `http://127.0.0.1:4173/exam/`. Use the administrator credentials from `.env.docker` for the first sign-in.

To build from source instead:

```bash
git clone https://github.com/dumuzu/exam-system-excelToPublic-v2.git
cd exam-system-excelToPublic-v2
cp .env.docker.example .env.docker
# Edit .env.docker
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.docker up -d --build
```

PostgreSQL data is stored in a named Docker volume. Running `docker compose down --volumes` deletes that data.

The administration client uses React, TypeScript, Vite, TanStack Router, Query, and Table. The server uses Node.js and PostgreSQL. Authorization, exam state, submission, and grading remain server-side responsibilities.

The public repository contains no production accounts, rosters, attempts, answers, or grades.

## License

MIT License. Copyright © 2026 MinorCold_12.
