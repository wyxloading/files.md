# CLAUDE.md

## 项目定位

files.md 在本环境中**仅作为前端静态页面应用**使用。用户通过浏览器直接打开 `web/index.html` 或使用 File System Access API 打开本地文件夹浏览 markdown 文件。

## 关键约束

- **仅前端代码有效**: 所有改动仅涉及 `web/` 目录下的 `.html`、`.js`、`.css` 文件
- **服务端代码不使用**: `server/` 目录下的 Go 代码、`cmd/`、`vendor/` 等后端相关代码不在使用范围内，不修改、不依赖、不考虑
- **不启动后端服务**: 不需要 `go run`、Docker、compose 等方式启动服务端

## 用户使用场景

用户用 files.md 浏览和管理 `daily`、`daily-doc` 等本地项目中的 markdown 文件，包括 `.run-task-state/` 等隐藏目录下的文件。
