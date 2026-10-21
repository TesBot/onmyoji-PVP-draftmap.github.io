# -*- coding: utf-8 -*-
"""
《阴阳师》官方式神头像批量下载 / 增量更新
数据源：官网式神录 https://yys.163.com/shishen （接口与 CDN 路径均取自该页面的前端代码）
输出：  avatars/<稀有度>/<式神名>.png   120×120 PNG
       （联动式神另存 avatars/collab/，呱太另存 avatars/gua/，这两类与稀有度目录重叠，是副本）
       式神清单.csv、索引.html 会一并重新生成
用法：  双击运行，或  python 更新脚本.py
        新式神上线后重跑一次即可（已存在的会被覆盖，不会重复占空间）
"""
import json, os, re, csv, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.abspath(__file__))
API = 'https://g37simulator.webapp.163.com/get_heroid_list'
CDN = 'https://yys.res.netease.com/pc/zt/20161108171335/data'
UA = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Referer': 'https://yys.163.com/shishen/index.html',
}
LAB = {1: 'N', 2: 'R', 3: 'SR', 4: 'SSR', 5: 'SP', 6: 'UR'}
BAD = re.compile(r'[\\/:*?"<>|\r\n\t]+')


def fetch(url, timeout=25, tries=3):
    err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            err = e
            time.sleep(0.4 * (i + 1))
    raise err


def main():
    url = API + '?' + urllib.parse.urlencode({'rarity': 0, 'page': 1, 'per_page': 900})
    data = json.loads(fetch(url).decode('utf-8'))['data']
    print('官网返回式神数 =', len(data))

    jobs, rows = [], []
    for hid, v in data.items():
        name = (v.get('name') or '').strip()
        if not name:
            continue
        base = BAD.sub('_', name).strip().strip('.') or 'unnamed'
        rar = LAB.get(v.get('rarity'), 'OTHER')
        rows.append({'id': int(hid), 'name': name, 'rar': rar, 'icon': v.get('icon', ''),
                     'link': v.get('interactive') == 1, 'frog': v.get('material_type') == 101})
        jobs.append((f'{CDN}/shishen/{hid}.png', os.path.join(ROOT, 'avatars', rar, base + '.png')))
        if v.get('interactive') == 1:
            jobs.append((f'{CDN}/shishen/{hid}.png', os.path.join(ROOT, 'avatars', 'collab', base + '.png')))
        if v.get('material_type') == 101:
            jobs.append((f'{CDN}/shishen/{hid}.png', os.path.join(ROOT, 'avatars', 'gua', base + '.png')))
    rows.sort(key=lambda x: x['id'])
    for _, d in jobs:
        os.makedirs(os.path.dirname(d), exist_ok=True)
    print('待下载文件数 =', len(jobs))

    ok, fail = 0, []

    def work(j):
        u, d = j
        try:
            b = fetch(u)
            if len(b) < 100:
                raise ValueError('返回内容过小')
            with open(d, 'wb') as f:
                f.write(b)
            return True, d, None
        except Exception as e:
            return False, d, str(e)

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=10) as ex:
        for fu in as_completed([ex.submit(work, j) for j in jobs]):
            good, d, e = fu.result()
            if good:
                ok += 1
            else:
                fail.append((d, e))
    print('完成：成功 %d，失败 %d，用时 %.1fs' % (ok, len(fail), time.time() - t0))
    for d, e in fail[:20]:
        print('   失败', os.path.basename(d), e[:50])

    with open(os.path.join(ROOT, '式神清单.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['编号', '式神名', '稀有度', '联动', '呱', '图标名', '头像文件', '所在目录'])
        for r in rows:
            w.writerow([r['id'], r['name'], r['rar'], '是' if r['link'] else '', '是' if r['frog'] else '',
                        r['icon'], r['name'] + '.png', 'avatars/' + r['rar']])
    print('清单已更新：式神清单.csv（%d 行）' % len(rows))
    build_index(rows)


# ---------- 重建索引.html ----------
# 样式沿用现有索引.html 的 <style>，只重新生成卡片部分；
# 这样头像更新后索引页自动同步，不用手工改路径（手工改极易改坏文件名里的「呱」等字）。
ORDER = ['SP', 'SSR', 'SR', 'R', 'N', 'UR']
HEAD_FB = ('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
           '<title>阴阳师 · 式神头像总览</title><style>'
           'body{background:#0b0d12;color:#e8eaf2;font-family:"Microsoft YaHei",system-ui;padding:20px}'
           '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(94px,1fr));gap:10px}'
           '.card{border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:8px 6px;text-align:center}'
           '</style></head><body><div class="wrap">')


def build_index(rows):
    p = os.path.join(ROOT, '索引.html')
    old = open(p, encoding='utf-8').read() if os.path.exists(p) else ''
    m = re.search(r'(.*?</style></head><body><div class="wrap">)', old, re.S)
    head = m.group(1) if m else HEAD_FB

    groups = {}
    for r in rows:
        groups.setdefault(r['rar'], []).append(r)
    out = [head,
           '<h1>阴阳师 · 式神头像总览</h1>',
           '<div class="sub">来源：阴阳师官网式神录 <b>yys.163.com/shishen</b>　·　尺寸 '
           '<b>120×120 PNG</b>　·　按稀有度分目录、以式神名命名　·　共 <b>%d</b> 个式神<br>'
           '「联」= 联动式神，「呱」= 呱太（这两个分类与稀有度重叠，故另建同名目录放副本）</div>' % len(rows)]
    rar_seen = [g for g in ORDER if g in groups] + [g for g in groups if g not in ORDER]
    for g in rar_seen:
        lst = sorted(groups[g], key=lambda x: x['id'])
        out.append('<h2>%s<span class="n">%d 个</span></h2><div class="grid">' % (g, len(lst)))
        for r in lst:
            base = BAD.sub('_', r['name']).strip().strip('.') or 'unnamed'
            src = urllib.parse.quote('avatars/%s/%s.png' % (g, base))
            tags = ''
            if r['link']:
                tags += '<span class="b l">联</span>'
            if r['frog']:
                tags += '<span class="b f">呱</span>'
            out.append('<div class="card">%s<img loading="lazy" src="%s" alt="%s">'
                       '<div class="nm">%s</div><div class="id">#%d</div></div>'
                       % (tags, src, r['name'], r['name'], r['id']))
        out.append('</div>')
    out.append('</div></body></html>')

    open(p, 'w', encoding='utf-8').write('\n'.join(out))
    print('索引已重建：索引.html（%d 个式神，%d 个分组）' % (len(rows), len(rar_seen)))


if __name__ == '__main__':
    main()
