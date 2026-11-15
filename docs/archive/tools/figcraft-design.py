"""Create editable SyncFu design frames through FigCraft's local command registry.
Run only against the confined FigCraft session on 127.0.0.1:7979.
"""
import json
import socket
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'design-streamline'
commands = []
serial = 0

def add(command, params, name=None):
    global serial
    serial += 1
    key = name or f'layer_{serial}'
    commands.append({'command': command, 'params': params, 'as': key})
    return {'$ref': key}

def rect(parent, x, y, w, h, color, radius=0, stroke=None, name=None, kind='rectangle'):
    props = {'fill': color, 'cornerRadius': radius}
    if stroke: props.update(stroke=stroke, strokeWeight=1)
    return add('node.create', {'type': kind, 'parent': parent, 'x': x, 'y': y, 'width': w, 'height': h, 'name': name or 'Surface', 'props': props, 'select': False})

def text(parent, value, x, y, w, size, color, bold=False, align='left', name=None):
    return add('text.create', {'text': value, 'parent': parent, 'x': x, 'y': y, 'width': w, 'name': name or value, 'props': {'fontFamily': 'PingFang SC', 'fontStyle': 'Semibold' if bold else 'Regular', 'fontSize': size, 'lineHeight': f'{int(size*1.5)}px', 'fill': color, 'textAlign': align}, 'select': False})

def button(parent, value, x, y, w, color, ink, border=None):
    frame = rect(parent, x,y,w,38,color,10,border, value, 'frame')
    text(frame,value,8,8,w-16,14,ink,True,'center')
    return frame

palettes = {
 'light': dict(canvas='#F5F6F8', panel='#FFFFFF', ink='#191C24', muted='#657083', line='#E5E8F0', accent='#3457F6', tint='#EEF2FF', warning='#9C6714'),
 'dark': dict(canvas='#151820', panel='#1D222D', ink='#F1F3FA', muted='#AAB4C8', line='#343D50', accent='#9DB2FF', tint='#29354F', warning='#E8BE77'),
}
masters = {}
for ti,(theme,p) in enumerate(palettes.items()):
 for vi,(kind,label,color) in enumerate([('create','新增',p['accent']),('update','更新',p['muted']),('conflict','待决定',p['warning'])]):
    master=add('node.create',{'type':'component','x':ti*1200,'y':1740+vi*90,'width':832,'height':66,'name':f'File row/{theme}/{kind}','props':{'fill':p['panel']},'select':False})
    rect(master,0,65,832,1,p['line'])
    rect(master,12,23,17,17,p['panel'] if kind=='conflict' else p['accent'],5,p['line'] if kind=='conflict' else None)
    if kind!='conflict':text(master,'✓',12,20,17,12,p['panel'] if theme=='light' else p['canvas'],True,'center')
    rect(master,47,17,24,30,p['tint'],5)
    text(master,'≡',51,18,17,18,p['accent'],False,'center')
    fields={'Filename':text(master,'文件名称.md',86,10,330,15,p['ink'],True), 'Path':text(master,'所在文件夹',86,33,330,12,p['muted']), 'Destination':text(master,'→ 书房 Windows',535,23,176,13,p['muted']), 'Size':text(master,'12.4 KB',725,23,90,13,p['muted'],False,'right')}
    text(master,label,439,23,85,13,color,True)
    for name,layer in fields.items():add('component.addProperty',{'id':master,'name':name,'type':'text','layer':layer})
    masters[(theme,kind)] = master

screens={}
def screen(theme,x,y,name,conflict=False):
 p=palettes[theme]
 frame=add('frame.create',{'x':x,'y':y,'width':1120,'height':760,'name':name,'props':{'fill':p['panel'],'cornerRadius':18,'clip':True},'select':False},name=f'screen_{theme}_{len(screens)}')
 rect(frame,0,0,184,760,p['canvas'])
 rect(frame,184,0,1,760,p['line'])
 rect(frame,22,28,29,29,p['accent'],9)
 text(frame,'⇄',24,27,25,20,p['panel'] if theme=='light' else p['canvas'],True,'center')
 text(frame,'SyncFu',62,27,100,20,p['ink'],True)
 text(frame,'文件夹',24,112,100,12,p['muted'])
 text(frame,'＋',145,106,24,20,p['muted'],False,'center')
 for i,(label,status) in enumerate([('研究资料','2 项待决定'),('精选照片','已同步'),('项目归档','手动镜像')]):
    yy=148+i*74
    if i==0:rect(frame,14,yy,156,61,p['panel'],12,p['line'])
    text(frame,'▱',25,yy+12,25,22,p['accent'] if i==0 else p['muted'])
    text(frame,label,56,yy+11,108,14,p['ink'],i==0)
    text(frame,status,56,yy+34,108,12,p['muted'])
 text(frame,'＋ 添加文件夹',27,612,142,13,p['muted'])
 rect(frame,24,679,136,1,p['line'])
 text(frame,'设备',27,704,40,13,p['muted']);text(frame,'历史',76,704,40,13,p['muted']);text(frame,'设置',125,704,40,13,p['muted'])
 text(frame,'研究资料',220,76,370,30,p['ink'],True)
 button(frame,'↻  检查变化',936,78,148,p['panel'],p['ink'],p['line'])
 route=rect(frame,220,145,864,112,p['canvas'],16,name='Direction workbench',kind='frame')
 rect(route,22,24,34,34,p['panel'],10,p['line']);text(route,'▱',27,25,24,23,p['ink'],False,'center')
 text(route,'我的 MacBook',69,20,180,15,p['ink'],True);text(route,'Documents  ⌄',69,47,170,13,p['muted'])
 rect(route,610,24,34,34,p['panel'],10,p['line']);text(route,'▣',615,27,24,19,p['ink'],False,'center')
 text(route,'书房 Windows',657,20,190,15,p['ink'],True);text(route,'Documents  ⌄',657,47,170,13,p['muted'])
 rect(route,253,38,18,1,p['line']);rect(route,579,38,17,1,p['line'])
 rect(route,278,19,294,40,p['line'],11)
 for i,(label,width) in enumerate([('双向',84),('单向更新',112),('镜像',90)]):
    xx=282+[0,84,196][i]
    if i==0:rect(route,xx,23,width,32,p['panel'],8)
    text(route,label,xx,27,width,13,p['accent'] if i==0 else p['muted'],i==0,'center')
 text(route,'↔',395,70,60,19,p['accent'],True,'center')
 text(route,'● 在线',22,81,90,12,p['muted']);text(route,'● 在线',745,81,95,12,p['muted'],False,'right')
 text(frame,'文件变化',220,291,180,19,p['ink'],True)
 text(frame,'8 项',321,295,60,13,p['muted'])
 button(frame,'全部  8',220,329,91,p['tint'],p['accent'])
 button(frame,'待决定  2',319,329,120,p['panel'],p['muted'])
 button(frame,'⌕  搜索文件',879,329,165,p['panel'],p['muted'],p['line'])
 text(frame,'⋯',1057,329,28,22,p['muted'],True,'center')
 text(frame,'文件名 / 位置',306,385,295,12,p['muted']);text(frame,'变化',659,385,90,12,p['muted']);text(frame,'目标',755,385,150,12,p['muted']);text(frame,'大小',963,385,80,12,p['muted'],False,'right')
 rows=[('update','阅读笔记.md','笔记 / 分布式系统','→ 书房 Windows','12.2 KB'),('create','十一月计划.md','笔记','→ 书房 Windows','2.4 KB'),('conflict','论文初稿.docx','草稿 / 论文','比较并决定','46.7 KB'),('create','系统设计.pdf','参考文献','← 我的 MacBook','2.1 MB')]
 for i,(kind,filename,path,target,size) in enumerate(rows):
    instance=add('instance.create',{'component':masters[(theme,kind)],'parent':frame,'x':220,'y':408+i*66})
    add('instance.setProperties',{'ids':[instance],'properties':{'Filename':filename,'Path':path,'Destination':target,'Size':size}})
 rect(frame,184,689,936,1,p['line']);text(frame,'已选 5 项',220,714,110,15,p['ink'],True);text(frame,'2 项待决定',343,716,190,13,p['muted'])
 button(frame,'同步所选   ↗',903,703,181,p['accent'],p['panel'] if theme=='light' else p['canvas'])
 if conflict:
    overlay=rect(frame,184,0,936,760,'#111827',0,name='Modal backdrop');add('node.set',{'id':overlay,'props':{'opacity':0.18}})
    modal=rect(frame,302,151,666,450,p['panel'],20,p['line'],name='Conflict decision',kind='frame')
    text(modal,'论文初稿.docx',28,22,510,24,p['ink'],True);text(modal,'草稿 / 论文',28,62,460,13,p['muted']);text(modal,'×',606,22,28,22,p['muted'],False,'center')
    for i,(device,detail) in enumerate([('我的 MacBook','44.1 KB'),('书房 Windows','46.7 KB')]):
      xx=28+i*308;rect(modal,xx,105,292,150,p['canvas'],12);text(modal,device,xx+18,121,255,15,p['ink'],True);text(modal,detail,xx+18,159,255,28,p['ink'],True);text(modal,'内容不同',xx+18,207,255,13,p['muted'])
      button(modal,'使用此版本',xx,273,292,p['panel'],p['ink'],p['line'])
    rect(modal,28,331,610,1,p['line']);button(modal,'稍后处理  ⌄',28,353,224,p['canvas'],p['muted']);text(modal,'覆盖前先备份',400,364,236,13,p['muted'],False,'right')
 screens[name]=frame
 return frame
screen('light',0,0,'Core — Light')
screen('dark',1200,0,'Core — Dark')
screen('light',0,840,'Conflict — Light',True)

def request(method,params,timeout=300000):
 with socket.create_connection(('127.0.0.1',7979),timeout=10) as s:
  s.settimeout(timeout/1000+10);f=s.makefile('rwb');f.write((json.dumps({'id':1,'method':method,'params':params,'timeoutMs':timeout})+'\n').encode());f.flush();result=json.loads(f.readline())
  if not result.get('ok'):raise RuntimeError(result)
  return result['result']

if __name__=='__main__':
 before=request('document.inspect',{'depth':1,'outline':True})
 if before.get('dirty'):raise RuntimeError('Refusing to overwrite a dirty design; inspect the live document first.')
 result=request('engine.execute',{'agent':'Claude Code','command':'command.batch','params':{'label':'SyncFu core workflow and reusable components','commands':commands}})
 print(json.dumps({'steps':len(commands),'result':result},ensure_ascii=False)[:1200])
 request('engine.execute',{'agent':'Claude Code','command':'file.save','params':{'path':str(OUT/'SyncFu-Focused-Transfer.figcraft')}})
 document=request('document.inspect',{'depth':1,'outline':True})
 (OUT/'document-outline.json').write_text(json.dumps(document,ensure_ascii=False,indent=2)+'\n')
 frames=document['pages'][0].get('children',[])
 for node in frames:
  if node.get('name') in screens:
   name={'Core — Light':'core-light','Core — Dark':'core-dark','Conflict — Light':'conflict-light'}[node['name']]
   request('ui.render',{'ids':[node['id']],'path':str(OUT/f'{name}.png'),'scale':1})
 print(json.dumps({'saved':str(OUT/'SyncFu-Focused-Transfer.figcraft'),'frames':[(n.get('id'),n.get('name')) for n in frames]},ensure_ascii=False))
