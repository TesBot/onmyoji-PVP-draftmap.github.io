# -*- coding: utf-8 -*-
import json, html, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

P = r"E:/下载目录/豆包/禅吞.pos"
raw = open(P, 'r', encoding='utf-8').read()
d = json.loads(raw)

diag = d['diagram']
els = diag['elements']
print("top keys:", list(d.keys()))
print("diagram keys:", list(diag.keys()))
print("elements keys:", list(els.keys()))
for k, v in els.items():
    if k != 'children':
        print("  ", k, "=", repr(v)[:200])

def walk(n, depth=0, path=""):
    t = html.unescape(n.get('title', '') or '')
    st = n.get('style') or {}
    bg = st.get('background', '')
    yield (depth, t, bg, n.get('id'))
    for c in n.get('children') or []:
        yield from walk(c, depth+1)

rows = list(walk(els))
print("\n=== 节点总数:", len(rows), "===")
for depth, t, bg, nid in rows:
    print("%s%-46s | bg=%-9s | id=%s" % ("  "*depth, t, bg, nid))
