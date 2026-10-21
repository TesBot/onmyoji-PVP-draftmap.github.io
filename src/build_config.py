# -*- coding: utf-8 -*-
"""
生成 config.json —— 配置驱动版页面的数据源。
输入：nodes.json（extract.py 从 禅吞.pos 解析）+ 本地头像库
输出：config.json（默认值、别名表、头像索引、决策图数据）

数据结构预留 schemes 数组：本轮只装「示例方案-禅吞」一个方案，
后续加多方案标签切换无需改动结构。
"""
import json, os, sys, io, hashlib
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 目录约定：src/ 放脚本，仓库根放 index.html 与 config.json，assets/ 放素材
HERE = os.path.dirname(os.path.abspath(__file__))            # src/
ROOT = os.path.dirname(HERE)                                 # 仓库根
NODES = os.path.join(HERE, 'nodes.json')
AVROOT = os.path.join(ROOT, 'assets', 'shishen', 'avatars')
AVDIR_REL = 'assets/shishen/avatars'                             # config.json 里的相对路径
OUT = os.path.join(ROOT, 'config.json')

# ---------- 别名表（与 extract.py 同源，供编辑器输入简称时自动展开）----------
COMBO = [
    ('禅吞', ['禅心云外镜', '鬼王酒吞童子']), ('鬼吞', ['鬼王酒吞童子']),
    ('神卑石', ['神无月', '卑弥呼', '石长姬']), ('神卑', ['神无月', '卑弥呼']),
    ('神石', ['神无月', '石长姬']), ('神平', ['神无月', '平将门']),
    ('神龙', ['神无月', '龙珏']), ('云熊', ['云外镜', '神酿星熊童子']),
    ('离封', ['不知火', '封阳君']), ('狐毗', ['不相狐禅', '毗沙门天']),
    ('卑因', ['卑弥呼', '因幡辉夜姬']), ('须羊', ['须佐之男', '鬼金羊']),
    ('凤雪', ['百羽凤凰火', '蝉冰雪女']), ('ban须', ['须佐之男']),
]
ALIAS = [
    ('SSR不见岳', ['不见岳']), ('SP铃彦姬', ['天火命铃彦姬']), ('铃彦姬', ['铃彦姬']),
    ('SP阎魔', ['大夜摩天阎魔']), ('摩托', ['大夜摩天阎魔']), ('炎魔', ['阎魔']), ('阎魔', ['阎魔']),
    ('SP雪女', ['蝉冰雪女']), ('SP鬼切', ['天剑韧心鬼切']), ('输出切', ['天剑韧心鬼切']),
    ('奶切', ['天剑韧心鬼切']), ('SP惠比寿', ['晨晖惠比寿']), ('SP星熊', ['神酿星熊童子']),
    ('SP铃鹿', ['龙吟铃鹿御前']), ('SSR铃鹿', ['铃鹿御前']), ('铃鹿', ['铃鹿御前']),
    ('SP清姬', ['缚骨清姬']), ('SP桃花', ['灼华桃花妖']), ('SP吸血姬', ['蚀月吸血姬']),
    ('SP山风', ['初翎山风']), ('岚', ['初翎山风']), ('SP白', ['梦山白藏主']),
    ('SP凤', ['百羽凤凰火']), ('凤凰', ['百羽凤凰火']), ('凤', ['百羽凤凰火']),
    ('平将门', ['平将门']), ('肉平', ['平将门']), ('输出平', ['平将门']),
    ('石长姬', ['石长姬']), ('雪御前', ['雪御前']), ('面灵气', ['面灵气']), ('鬼金羊', ['鬼金羊']),
    ('须佐', ['须佐之男']), ('大蛇', ['八岐大蛇']), ('卑弥呼', ['卑弥呼']), ('卑', ['卑弥呼']),
    ('神无月', ['神无月']), ('龙珏', ['龙珏']), ('龙女', ['龙珏']), ('龙', ['龙珏']),
    ('不知火', ['不知火']), ('离', ['不知火']), ('不相狐禅', ['不相狐禅']), ('狐', ['不相狐禅']),
    ('孔雀', ['孔雀明王']), ('咲耶', ['咲耶']), ('封阳君', ['封阳君']), ('思金神', ['思金神']),
    ('言和', ['言和']), ('鬼童丸', ['鬼童丸']), ('云外镜', ['云外镜']), ('云', ['云外镜']),
    ('千姬', ['千姬']), ('荒骷髅', ['荒骷髅']), ('毗沙门天', ['毗沙门天']), ('毗', ['毗沙门天']),
    ('神乐', ['__神乐__']), ('藤原', ['__藤原道长__']), ('酒吞', ['酒吞童子']),
    ('禅心云外镜', ['禅心云外镜']), ('鬼王酒吞童子', ['鬼王酒吞童子']),
]
YUHUN = ['出世螺', '薙魂', '剃魂', '青女房', '共潜', '蚌精', '狂骨', '骰子鬼', '奉海图', '海图',
         '坐地', '抢速卡', '挖土', '协战', '转体系', '超吞', '超毗']
PLACEHOLDERS = {'__藤原道长__': '阴阳师 · 藤原道长', '__神乐__': '阴阳师 · 神乐'}

# ---------- 头像索引 ----------
avatar_index = {}
for d in ['SP', 'SSR', 'SR', 'R', 'N', 'UR', 'collab', 'gua']:   # collab=联动, gua=呱
    p = os.path.join(AVROOT, d)
    if not os.path.isdir(p):
        continue
    for fn in sorted(os.listdir(p)):
        if fn.lower().endswith('.png') and fn[:-4] not in avatar_index:
            avatar_index[fn[:-4]] = '%s/%s/%s' % (AVDIR_REL, d, fn)

# ---------- 决策图：嵌套树 -> 扁平 id 索引（DAG 就绪）----------
nodes_src = json.load(open(NODES, encoding='utf-8'))
flat, seq = {}, [0]


def camp_of(style):
    bg = (style or {}).get('background', '')
    return {'#F6DCD8': 'enemy', '#DCE9F7': 'mine', '#367AE7': 'root'}.get(bg, '')


def conv(n, force_camp=None):
    seq[0] += 1
    nid = 'n%d' % seq[0]
    flat[nid] = {
        'id': nid,
        'title': n['t'],
        'camp': force_camp or camp_of(n.get('s')) or 'neutral',
        'hand': None,
        'shishen': n.get('ss') or [],
        'yuhun': n.get('ys') or [],
        'note': '',
        'children': [conv(c) for c in (n.get('c') or [])],
    }
    return nid


start = conv(nodes_src['main'])
floating = [conv(f, 'free') for f in (nodes_src.get('floating') or [])]

aliases = {}
for k, v in COMBO:
    aliases.setdefault(k, v)
for k, v in ALIAS:
    aliases.setdefault(k, v)

config = {
    'meta': {'title': '翻牌上卡导引图', 'version': 1},

    'ui': {
        'showHeader': True,
        'buttons': [
            {'id': 'fit',   'label': '适应窗口', 'action': 'view',         'show': True},
            {'id': 'fold',  'label': '只看体系', 'action': 'foldTop',      'show': True},
            {'id': 'theme', 'label': '暗色',     'action': 'toggleTheme',  'show': True},
        ],
        'interaction': {
            'clickFold': True, 'dblclickFocus': True, 'wheelZoom': True,
            'dragPan': True, 'keyboardPan': True,
            # nodeDrag：允许按住节点框拖到别处（只记偏移量，不推翻自动布局）。
            # 关掉它的话，节点位置就永远由自动布局说了算。
            'nodeDrag': True,
        },
        'clickFoldDelay': 160,
    },

    'layout': {
        # rev：视图设置的版本号。老访客浏览器里存的是上一版的 layout，
        # 只要本地那份比这里旧，就整体换成发布版（见 validate 里的 syncLayoutRev），
        # 免得「以前存过的 collapse」把新版默认的 merge 又压回去。
        'rev': 1,
        'hGap': 54, 'vGap': 13, 'branchGap': 26, 'groupGap': 120,
        'padX': 30, 'padTop': 40, 'canvasPad': 60,
        'defaultExpanded': True,
        'zoneEnabled': True,
        'sharedNodeMode': 'merge',      # merge=共享节点只画一次，其他分支补虚线箭头指过来
        'sharedTitleMax': 10,           # 汇合点图内文字截断长度（0 = 不截断，悬停看全文）
        'columnMode': 'depth',
        'readableScale': 0.85,
        'minScale': 0.15, 'maxScale': 3,
        'fitThreshold': 0.5,
        'lineWidth': 2,
    },

    'style': {
        'font': {'node': 15, 'branch': 17, 'root': 22, 'chip': 12, 'badge': 11},
        'lineHeight': 1.45,
        'node': {'minWidth': 190, 'maxWidth': 404, 'padX': 12, 'padTop': 9, 'padBottom': 10, 'radius': 7},
        'avatar': {'size': 40, 'gap': 6, 'radius': 7, 'marginBottom': 8},
        'camp': {
            'enemy':   {'bg': '#F6DCD8', 'fg': '#7A1F16', 'border': '#B03A2E', 'line': '#B03A2E'},
            'mine':    {'bg': '#DCE9F7', 'fg': '#1B3F6B', 'border': '#2C5F9E', 'line': '#2C5F9E'},
            'neutral': {'bg': '#E7EBED', 'fg': '#1F2328', 'border': '#C7CDD2', 'line': '#3679E7'},
            'root':    {'bg': '#367AE7', 'fg': '#FFFFFF', 'border': '#3679E7', 'line': '#3679E7'},
            'free':    {'bg': '',        'fg': '',        'border': '#3679E7', 'line': '#3679E7'},
        },
        'theme': {
            'light': {'page': '#FFFFFF', 'panel': '#F4F6F8', 'text': '#1F2328',
                      'border': '#D7DCE2', 'line': '#3679E7',
                      'neutralBg': '#E7EBED', 'neutralFg': '#1F2328', 'neutralBorder': '#C7CDD2'},
            'dark':  {'page': '#0F1419', 'panel': '#161B22', 'text': '#E6EDF3',
                      'border': '#2C3540', 'line': '#5C9BF5',
                      'neutralBg': '#2A323B', 'neutralFg': '#E6EDF3', 'neutralBorder': '#3A444F'},
        },
        'startTheme': 'light',
        'chipBg': 'rgba(127,127,127,.15)',
        'badgeBg': '#3679E7', 'badgeFg': '#FFFFFF',
        'missing': {'mark': '?', 'borderStyle': 'dashed', 'bg': 'rgba(176,58,46,.10)'},
        'zoneBg': 'rgba(127,127,127,.045)', 'zoneBorder': 'rgba(127,127,127,.10)', 'zoneRadius': 12,
    },

    'assets': {
        'avatarDir': AVDIR_REL,
        'avatarIndex': avatar_index,
        'placeholders': PLACEHOLDERS,
    },

    'aliases': aliases,
    'yuhun': YUHUN,

    'schemes': [
        {'id': 'chantun', 'name': '示例方案-禅吞', 'builtin': True,
         'start': start, 'floating': floating, 'nodes': flat,
         # 示例方案预填两行式神配置：既是范例，也用来演示「简称 -> 自动带头像」
         'sheet': {'headers': ['式神', '指标', '御魂套装', '246号位', '其他要求'],
                   'rows': [['阎魔', '速度', '散件', '速XX', '攻击>4600'],
                            ['鬼吞', '生命', '火灵+防御两件套', '速生生', '速度>210']]}},
    ],
    'activeScheme': 'chantun',
}


def scheme_rev(sc):
    """内置方案的内容指纹：内容一改 rev 就变，页面据此把新版内置方案同步给老访客。
    注意 sheet（式神配置表）也算内容 —— 漏掉它的话，只改了配置表的老访客会一直看着旧数据。"""
    core = {'start': sc['start'], 'floating': sc['floating'], 'nodes': sc['nodes'],
            'sheet': sc.get('sheet')}
    raw = json.dumps(core, ensure_ascii=False, sort_keys=True)
    return hashlib.md5(raw.encode('utf-8')).hexdigest()[:10]


for _sc in config['schemes']:
    if _sc.get('builtin'):
        _sc['rev'] = scheme_rev(_sc)

json.dump(config, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('已生成', OUT, '(%.1f KB)' % (os.path.getsize(OUT) / 1024))
print('节点 %d 个 | 头像索引 %d 条 | 别名 %d 条 | 方案 %d 个'
      % (len(flat), len(avatar_index), len(aliases), len(config['schemes'])))
for _sc in config['schemes']:
    print('  方案 %-16s %s rev=%s' % (_sc['id'], '固化' if _sc.get('builtin') else '本地',
                                   _sc.get('rev', '-')))
