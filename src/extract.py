# -*- coding: utf-8 -*-
"""从 禅吞.pos 提取节点树 + 自动识别式神/御魂，输出 nodes.json"""
import json, html, sys, io, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = os.path.dirname(os.path.abspath(__file__))
POS = r"E:/下载目录/豆包/禅吞.pos"

# ---------- 1. 组合词（优先、长词先匹配）----------
# 值 = (式神列表, 御魂/术语列表)
COMBO = [
    ('禅吞',      (['禅心云外镜', '鬼王酒吞童子'], [])),
    ('鬼吞',      (['鬼王酒吞童子'], [])),
    ('神卑石',    (['神无月', '卑弥呼', '石长姬'], [])),
    ('神平',      (['神无月', '平将门'], [])),
    ('神龙',      (['神无月', '龙珏'], [])),
    ('云熊',      (['云外镜', '神酿星熊童子'], [])),
    ('离封',      (['不知火', '封阳君'], [])),
    ('狐毗',      (['不相狐禅', '毗沙门天'], [])),
    ('卑因',      (['卑弥呼', '因幡辉夜姬'], [])),
    ('须羊',      (['须佐之男', '鬼金羊'], [])),
    ('凤雪',      (['百羽凤凰火', '蝉冰雪女'], [])),
    ('神卑',      (['神无月', '卑弥呼'], [])),
    ('神石',      (['神无月', '石长姬'], [])),
    ('超毗',      ([], ['超毗(快过毗沙门天)'])),
    ('超吞',      ([], ['超吞(快过鬼吞)'])),
    ('ban须',     (['须佐之男'], [])),
    ('转体系',    ([], ['转体系'])),
]

# ---------- 2. 单词别名（长名优先）----------
ALIAS = [
    ('SSR不见岳', '不见岳'), ('SP铃彦姬', '天火命铃彦姬'), ('铃彦姬', '铃彦姬'),
    ('SP阎魔', '大夜摩天阎魔'), ('大夜摩天阎魔', '大夜摩天阎魔'), ('摩托', '大夜摩天阎魔'),
    ('炎魔', '阎魔'), ('阎魔', '阎魔'),
    ('SP雪女', '蝉冰雪女'), ('SP鬼切', '天剑韧心鬼切'), ('输出切', '天剑韧心鬼切'),
    ('奶切', '天剑韧心鬼切'), ('SP惠比寿', '晨晖惠比寿'), ('SP星熊', '神酿星熊童子'),
    ('SP铃鹿', '龙吟铃鹿御前'), ('SSR铃鹿', '铃鹿御前'), ('铃鹿', '铃鹿御前'),
    ('SP清姬', '缚骨清姬'), ('SP桃花', '灼华桃花妖'), ('SP吸血姬', '蚀月吸血姬'),
    ('SP山风', '初翎山风'), ('岚', '初翎山风'), ('SP白', '梦山白藏主'),
    ('SP凤', '百羽凤凰火'), ('百羽凤凰火', '百羽凤凰火'), ('凤凰', '百羽凤凰火'), ('凤', '百羽凤凰火'),
    ('平将门', '平将门'), ('肉平', '平将门'), ('输出平', '平将门'),
    ('石长姬', '石长姬'), ('雪御前', '雪御前'), ('面灵气', '面灵气'), ('鬼金羊', '鬼金羊'),
    ('须佐', '须佐之男'), ('大蛇', '八岐大蛇'), ('卑弥呼', '卑弥呼'), ('卑', '卑弥呼'),
    ('神无月', '神无月'), ('龙珏', '龙珏'), ('龙女', '龙珏'), ('龙', '龙珏'),
    ('不知火', '不知火'), ('离', '不知火'), ('不相狐禅', '不相狐禅'), ('狐', '不相狐禅'),
    ('孔雀', '孔雀明王'), ('咲耶', '咲耶'), ('封阳君', '封阳君'), ('思金神', '思金神'),
    ('言和', '言和'), ('鬼童丸', '鬼童丸'), ('云外镜', '云外镜'), ('云', '云外镜'),
    ('千姬', '千姬'), ('荒骷髅', '荒骷髅'), ('毗沙门天', '毗沙门天'), ('毗', '毗沙门天'),
    ('神乐', '__神乐__'), ('藤原', '__藤原道长__'), ('酒吞', '酒吞童子'),
    ('禅心云外镜', '禅心云外镜'), ('鬼王酒吞童子', '鬼王酒吞童子'),
]

# ---------- 3. 御魂 / 术语（只做文字标签，不配头像）----------
YUHUN = [
    ('出世螺', '出世螺'), ('剃魂', '薙魂'), ('薙魂', '薙魂'), ('青女房', '青女房'),
    ('共潜', '共潜'), ('蚌精', '蚌精'), ('狂骨', '狂骨'), ('骰子鬼', '骰子鬼'),
    ('奉海图', '奉海图'), ('海图', '奉海图'), ('坐地', '坐地'), ('抢速卡', '抢速卡'),
    ('挖土', '挖土'), ('协战', '协战'),
]

# 占位（阴阳师，非式神，官方图鉴无头像）
PLACEHOLDER = {'__藤原道长__': '藤原道长', '__神乐__': '神乐'}


def scan(title):
    """返回 (式神列表, 御魂列表)，按在标题中出现的先后顺序"""
    s = html.unescape(title or '')
    taken = [False] * len(s)
    toks = []  # (pos, kind, value)

    for kw, (ss, ys) in COMBO:
        i = 0
        while True:
            i = s.find(kw, i)
            if i < 0:
                break
            if not any(taken[i:i + len(kw)]):
                for j in range(i, i + len(kw)):
                    taken[j] = True
                for n in ss:
                    toks.append((i, 's', n))
                for n in ys:
                    toks.append((i, 'y', n))
            i += len(kw)

    # 御魂优先于式神（避免 "海图孔雀" 里的字被误吃）
    for kw, name in YUHUN:
        i = 0
        while True:
            i = s.find(kw, i)
            if i < 0:
                break
            if not any(taken[i:i + len(kw)]):
                for j in range(i, i + len(kw)):
                    taken[j] = True
                toks.append((i, 'y', name))
            i += len(kw)

    for kw, name in ALIAS:
        i = 0
        while True:
            i = s.find(kw, i)
            if i < 0:
                break
            if not any(taken[i:i + len(kw)]):
                for j in range(i, i + len(kw)):
                    taken[j] = True
                toks.append((i, 's', name))
            i += len(kw)

    toks.sort(key=lambda t: (t[0], 0 if t[1] == 's' else 1))
    ss, ys = [], []
    for _, kind, v in toks:
        if kind == 's':
            if v not in ss:
                ss.append(v)
        else:
            if v not in ys:
                ys.append(v)
    return ss, ys


# ---------- 4. 走树 ----------
d = json.loads(open(POS, 'r', encoding='utf-8').read())
els = d['diagram']['elements']

out = {'title': els.get('title'), 'main': None, 'floating': []}


def conv(n, depth):
    t = html.unescape(n.get('title', '') or '')
    ss, ys = scan(t)
    o = {
        'id': n.get('id'),
        't': t,
        'd': depth,
        's': n.get('style') or {},
        'ss': ss,
        'ys': ys,
        'c': [conv(c, depth + 1) for c in (n.get('children') or [])],
    }
    return o


out['main'] = conv(els, 0)
for f in (els.get('freeChildren') or []):
    out['floating'].append(conv(f, 0))

json.dump(out, open(os.path.join(ROOT, 'nodes.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

# ---------- 5. 打印核对 ----------
def show(n, dep=0, tag=''):
    ss = ','.join(n['ss']) or '-'
    ys = ','.join(n['ys']) or '-'
    bg = n['s'].get('background', '')
    print('%-58s | %-38s | %-22s | %s' % ('  ' * dep + n['t'][:56], ss[:38], ys[:22], bg))
    for c in n['c']:
        show(c, dep + 1)

print('===== MAIN =====')
show(out['main'])
print('\n===== FLOATING =====')
for f in out['floating']:
    show(f)
    print('-' * 60)

cnt = [0]


def cntn(n):
    cnt[0] += 1
    for c in n['c']:
        cntn(c)


cntn(out['main'])
for f in out['floating']:
    cntn(f)
print('\n总节点数 =', cnt[0])
