# -*- coding: utf-8 -*-
import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

d = json.loads(open(r"E:/下载目录/豆包/禅吞.pos", 'r', encoding='utf-8').read())
els = d['diagram']['elements']

print("=== THEME ===")
th = json.loads(els['theme'])
print(json.dumps(th, ensure_ascii=False, indent=1)[:2500])

print("\n=== freeChildren ===")
fc = els.get('freeChildren') or []
print("count:", len(fc))
def show(n, dep=0):
    print("  "*dep, repr(n.get('title')), '| pos=', n.get('pos'), '| children=', len(n.get('children') or []))
    for c in n.get('children') or []:
        show(c, dep+1)
for n in fc:
    show(n)

print("\n=== meta ===")
print(json.dumps(d.get('meta'), ensure_ascii=False)[:800])

print("\n=== 节点 style 全集 ===")
seen = {}
def walk(n, dep=0):
    st = n.get('style') or {}
    key = json.dumps(st, ensure_ascii=False, sort_keys=True)
    seen.setdefault(key, [0, []])
    seen[key][0] += 1
    if len(seen[key][1]) < 2:
        seen[key][1].append((dep, n.get('title')))
    for c in n.get('children') or []:
        walk(c, dep+1)
walk(els)
for k, (cnt, ex) in sorted(seen.items(), key=lambda x: -x[1][0]):
    print(cnt, k, ex)

print("\n=== 全部节点 props keys ===")
keys = set()
def walk2(n):
    keys.update(n.keys())
    for c in n.get('children') or []:
        walk2(c)
walk2(els)
print(keys)
