# 单元测试契约

本项目的单元测试规范，供所有 Agent / 开发者遵循。**目标：2 分钟读完，长期稳定，可跨会话复用。**

## 运行方式

| 命令 | 用途 |
|------|------|
| `npm test` | 本地跑全量测试（开发时直接用） |
| `npm run test:ci` | **给 Agent 用的一键判定**：只输出 `TESTS_PASS` 或 `TESTS_FAIL` + 失败尾部。绿了就不再往下查；红了才 `cat /tmp/test-output.txt` 定位失败。 |
| `npm run lint` | 类型检查（`tsc --noEmit`） |

给 Agent 的调用协议：
1. 执行 `npm run test:ci`
2. 看进程最终信号 `TESTS_PASS` / `TESTS_FAIL`
3. **`TESTS_PASS` → 立即结束，不要读取测试明细，不消耗 token**
4. `TESTS_FAIL` → 才 `cat /tmp/test-output.txt` 查看失败项并修复

## 目录与命名

- 测试文件统一存放到被测源码的**同级 `__tests__/` 子目录**。
- 命名：一个被测文件对应一个测试文件，`<source>.test.ts`（或 `.test.tsx`）。
  - 例：`services/stockSync.ts` → `services/__tests__/stockSync.test.ts`
- 规则在 `vitest.config.ts` 集中声明（glob + `node` 环境 + `@` 别名）。

## 共享工具

- 假数据构造器必须集中放 `services/__tests__/test-utils.ts`，**禁止各测试文件复制**：
  - `mkTrade(over?)` → 造一条交易记录
  - `mkStock(code, name, over?)` → 造一只股票
- 需要称重的通用 helper 也放这里。

## 测什么（测试金字塔）

- **优先测纯逻辑**：`services/*.ts` 里的纯函数——重点覆盖**边界场景**（空输入、超卖截断、浮点、乱序、软删/挂单过滤）。
- **组件层**：仅对含复杂逻辑分支的组件用测试库（如 `@testing-library/react`），不强制每个组件都测。
- **不测**：真实 UI 渲染、打通外部 API 的链路。

## 断言 / 写法规范

- 结构：`describe(被测函数) → it(行为描述)`，`it` 描述用中文、以行为为导向。
- **浮点一律 `toBeCloseTo(预期, 精度)`**，不写 `toBe(23.33)`。
- 一个 `it` 只断言一个行为。
- cicd 覆盖率阈值：**当前不设硬性门槛**，按"核心记账/同步逻辑优先覆盖边界"的策略补充用例。

## 新增测试 5 步（checklist）

1. 在被测模块同级建 `__tests__/<name>.test.ts`
2. 从 `test-utils.ts` import `mkTrade`/`mkStock`（不手写工厂）
3. 用 `describe` + 中文行为描述写用例，覆盖空/边界/浮点场景
4. 本地跑 `npm test` 确认通过
5. 收尾确认 `npx tsc --noEmit` 无新增类型错误