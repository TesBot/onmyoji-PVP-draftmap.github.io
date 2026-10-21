# 翻牌上卡导引图

> `onmyoji-PVP-draftmap.github.io` · 网易阴阳师斗技上卡思维导图框架

《阴阳师》斗技「禅吞」体系的翻牌/上卡决策导引图框架。
 ~你可以自由配置编辑你的思维导图，可以自由导出并分享~
 在线访问：<https://tesbot.github.io/onmyoji-PVP-draftmap.github.io/>
 
<img width="2541" height="1245" alt="image" src="https://github.com/user-attachments/assets/857b6b42-21d1-417b-a442-369e2c7b1169" />


## 能做什么

- 多方案切换、拖动排序，方案级导出 / 导入
- 节点可视化编辑，带式神头像选择器（支持简称，输「炎魔」出阎魔）
- 汇合复用：多条敌方路径指向同一套我方方案时，全图只画一个框 + 虚线箭头
- 拖节点自由布局（记偏移量，自动布局照算）、节点右键菜单
- 每方案一张式神配置表（御魂 / 指标 / 号位 / 其他要求）
- 一键「只看体系」（收成骨架）/「全部展开」（全摊开）
- 暗色主题；导出三种产物：JSON / 单 HTML（自带头像）/ PNG

## 打开方式

| 方式 | 说明 |
| --- | --- |
| HTTP 预览 | `python -m http.server 8123` 后访问 `http://127.0.0.1:8123/index.html` |
| 双击 `index.html` | `file://` 可用，页面自动退回内嵌配置并挂上头像包 |
| `dist/单文件-自带头像.html` | 头像已内联，不依赖旁边任何目录，双击即开 |

## 操作速查

画布

| 手势 | 效果 |
| --- | --- |
| 单击（带子框） | 收起 / 展开子框，右上角显示数量徽标 |
| 双击 | 打开右侧编辑面板 |
| 拖动节点 | 自由摆放；右键菜单「复位位置」可放回自动排位 |
| 右键节点 | 编辑 / 添加子节点 / 添加同级节点 / 复位位置 / 删除节点 |
| 单击空白 | 关闭编辑面板 |
| 滚轮 / 拖动 / 方向键 | 缩放 / 平移 |

顶栏四个按钮：**适应窗口** ｜ **只看体系** ｜ **全部展开** ｜ **暗色**。
「只看体系」把所有一级以下的框连同子孙一起收起，之后可逐级点开；「全部展开」一气全部摊开。
两者是一对，哪个符合当前状态就点亮哪个，手工折过几处之后两个都不亮。

方案栏右侧：`＋ 新建` / `复制` / `导出` / `导入`；标签可拖动排序、双击重命名。

方案分两类：**示例**（写在 `config.json` 里，随页面发布，不会丢）与**自建**（存在浏览器本地，清缓存会丢，建议导出 JSON 备份）。

### 导出三种产物

| 产物 | 说明 |
| --- | --- |
| JSON | 单方案数据，可再导入，也能直接粘进 `config.json` 的 `schemes` |
| 单 HTML | 只读查看版，头像固化在内，双击即开；不写入浏览器 |
| PNG | 按布局重画，下方拼接该方案的式神配置表 |

## 目录结构

```
.
├── index.html                页面入口（构建产物，Pages 托管它）
├── config.json               数据源：文案 / 字段 / 布局 / 样式 / 方案节点
├── assets/
│   ├── shishen/avatars/      276 张 120×120 官方式神头像（按稀有度分目录）
│   ├── shishen/更新脚本.py    从官网增量下载头像并重建清单与索引页
│   └── avatars-inline.js      头像 dataURL 包（导出与 file:// 打开时用它）
├── src/                      构建与校验脚本（不参与发布）
│   ├── template_cfg.html     页面模板（渲染引擎）
│   ├── build_config.py       nodes.json + 头像库 → config.json
│   ├── build_cfg.py          config.json + 模板 → index.html
│   ├── build_singlefile.js   index.html + 头像包 → 单文件版（不需要浏览器）
│   ├── build_standalone.js   自包含预览版（需 Chrome）→ build_avpack.js 抽头像包
│   ├── check_cfg.js          Node DOM 桩校验
│   ├── neg_check.js          反向验证：还原旧 bug，确认断言抓得住
│   ├── shot.js               无头 Chrome 冒烟（自带静态服务）
│   └── probe_ctx.js          定向排查：真实浏览器试右键菜单 / 拖节点
└── dist/                     打包产物（不进仓库）
```

## 构建与校验

```bash
python src/build_config.py     # 改了 nodes.json 或头像库后跑
python src/build_cfg.py        # 产出 index.html

node src/check_cfg.js          # ALL CHECKS PASSED
node src/neg_check.js          # 每例都「断言生效」
node src/shot.js               # SMOKE ALL PASSED
node src/build_singlefile.js   # 生成 dist/单文件-自带头像.html
node src/verify_singlefile.js  # 校验单文件版是不是当前版
```

## 配置速览

`config.json` 顶层区块：

| 区块 | 作用 |
| --- | --- |
| `meta` | 页面标题（页头与浏览器标签名同源） |
| `ui` | 顶栏按钮（含分组 `group` / 连体 `seg`）、交互开关、单击转折叠延迟 `clickFoldDelay` |
| `layout` | 间距、列模式、缩放范围、共享节点渲染方式（`sharedNodeMode`: `merge` / `collapse`） |
| `style` | 字号、节点与头像尺寸、阵营配色、明暗主题变量 |
| `assets` | 头像目录与索引（名字 → 相对路径） |
| `aliases` | 简称 → 正式式神名 |
| `yuhun` | 御魂 / 术语词表（只做文字标签，不当式神） |
| `schemes` | 方案列表：`builtin` 示例标记、`rev` 内容版本、节点表 `nodes` |
| `activeScheme` | 当前方案 id（导出页面配置时会剔除） |

节点字段：`id` / `title`（描述）/ `camp`（阵营）/ `hand`（手数）/ `shishen` / `yuhun` / `note` / `children`；
拖过位置的节点另带 `dx` / `dy` 偏移量。

页面配置改由 `config.json` 维护，改完重跑 `build_cfg.py` 生效。
顶栏按钮与视图设置一律以发布版为准，浏览器里存的旧快照不会把新版压回去。

### 把自建方案固化成示例方案

1. 选中方案 → 「导出」→ 得到单方案 JSON
2. 粘进 `config.json` 的 `schemes` 数组并加 `"builtin": true`
3. `python src/build_cfg.py`，提交推送（`build_config.py` 会自动补 `rev`）

## 素材与许可

代码 MIT（见 `LICENSE`）。`assets/shishen/avatars/` 内为《阴阳师》官方式神头像，
版权归网易所有，仅作个人整理与查阅使用。
