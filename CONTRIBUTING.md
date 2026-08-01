# 贡献指南

感谢你为 LiveSetList 提交代码、文档、界面改进或资料修正。这个仓库同时维护 React 前端、FastAPI 后端、PostgreSQL schema 和 BanG Dream! Live / setlist 资料，因此可复现性、数据来源和安全边界都很重要。

## 提交前

1. 先搜索已有的 Issue 和 Pull Request，避免重复提交。
2. 缺陷、功能建议和资料修正请优先使用对应的 Issue 模板。
3. 不要在 Issue 或 Pull Request 中提交密码、Cookie、会话令牌、个人信息、生产数据或未脱敏日志。
4. 涉及漏洞或隐私的问题不要公开披露利用细节，先联系维护者。

## 本地开发

项目根目录的 [README](README.md)、[脚本说明](scripts/README.md)、[数据库说明](backend/db/README.md) 和 `docs/` 是当前行为的主要入口。常用准备步骤如下：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt

cd ..\frontend
npm install

cd ..
python scripts/run_dev.py --test-db
```

数据库配置来自 `infra/postgres/.env.pg-migrate`，其中的本地凭据不能提交到 Git。日常开发优先使用 `--test-db`，不要直接对生产数据库做实验性修改。

## 修改约定

- 后端使用直接 SQL 和分离的数据库角色；请保持现有连接权限边界，不要引入 ORM 或绕过写入角色。
- 数据库结构变化只新增 Flyway migration，不要修改已经执行过的 migration；同时更新必要的数据库文档和部署说明。
- 如果修改 `frontend/src/components/console/setlistParser/setlist.peggy`，请在 `frontend/` 运行 `npm run generate:setlist-parser`，并提交生成文件。
- 修改用户可见界面时，请说明响应式、可访问性和交互状态是否受影响，并在 Pull Request 中附截图或录屏。
- 资料修正应给出可核查的官方来源或其他可靠来源；不要把未经核实的推测写入数据库。
- 不要提交运行时环境文件、缓存、构建产物、日志或本地数据库 dump，除非任务明确要求且已确认其中没有敏感内容。

## 检查

只要修改了业务代码、数据库、运行时配置、脚本或相关测试，提交前运行仓库统一检查：

```powershell
python scripts/run_checks.py functional
```

如果修改涉及恢复流程或 Docker 恢复集成测试，再运行：

```powershell
python scripts/run_checks.py full
```

仅修改 Markdown 或仓库元数据时，至少运行：

```powershell
git diff --check
```

并检查新增或修改的本地 Markdown 链接是否指向存在的文件。

## Pull Request

Pull Request 应尽量保持单一目的，并说明：

- 要解决的问题和实现方式；
- 影响到的前端、后端、数据库、部署或资料范围；
- 已运行的检查及结果；
- 是否包含 migration、数据修正、权限变化或兼容性影响；
- UI 变化的截图，以及资料修正使用的来源。

提交前请完成 Pull Request 模板中的检查项。维护者可能要求补充测试、文档、来源或回滚说明。

