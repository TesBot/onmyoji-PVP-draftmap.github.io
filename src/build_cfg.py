# -*- coding: utf-8 -*-
"""把 config.json 注入 template_cfg.html，产出仓库根目录的 index.html（GitHub Pages 入口）"""
import os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))            # src/
ROOT = os.path.dirname(HERE)                                 # 仓库根
TPL = os.path.join(HERE, 'template_cfg.html')
CFG = os.path.join(ROOT, 'config.json')
OUT = os.path.join(ROOT, 'index.html')

cfg_txt = open(CFG, encoding='utf-8').read()
# 防止内容里出现 </script> 破坏嵌入块
safe = cfg_txt.replace('</', '<\\/')

tpl = open(TPL, encoding='utf-8').read()
assert '/*__EMBED__*/{}' in tpl, '模板里找不到嵌入占位符'
tpl = tpl.replace('/*__EMBED__*/{}', safe, 1)

open(OUT, 'w', encoding='utf-8').write(tpl)
print('已生成', OUT, '(%.1f KB)' % (os.path.getsize(OUT) / 1024))
