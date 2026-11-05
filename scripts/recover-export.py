"""Inspect a local MAX export without modifying source ZIPs or making requests."""
import argparse, csv, hashlib, json, pathlib, zipfile

def recover(source, output):
    source, output = pathlib.Path(source), pathlib.Path(output)
    output.mkdir(parents=True, exist_ok=False)
    summary = json.loads((source/'max-archive-summary.json').read_text(encoding='utf-8-sig'))
    rows, failures = [], []
    for index, chat in enumerate(summary['chats']):
        path = chat['path']
        if pathlib.PurePosixPath(path).name != path or any(c in path for c in '\\:') or path in ('.','..'):
            raise ValueError('Unsafe chat path')
        archive = source/f'max-archive-{path}.zip'
        row = {**chat, 'archive':str(archive), 'archiveBytes':archive.stat().st_size if archive.exists() else 0}
        try:
            with zipfile.ZipFile(archive) as z:
                if sum(f.file_size for f in z.infolist()) > 8*1024**3: raise ValueError('Archive expanded size exceeds inspection limit')
                bad = z.testzip()
                if bad: raise ValueError('CRC error: '+bad)
                if z.getinfo(path+'/messages.json').file_size > 100*1024**2: raise ValueError('Chat JSON exceeds inspection limit')
                data = z.read(path+'/messages.json')
                value = json.loads(data)
                messages = value['messages']
                dates = sorted(m.get('date') for m in messages if m.get('date'))
                row.update(actualMessages=len(messages), dateFrom=dates[0] if dates else None, dateTo=dates[-1] if dates else None, jsonSha256=hashlib.sha256(data).hexdigest(), crcVerified=True)
                row['priority'] = 'check' if chat.get('complete') else 'high' if chat.get('reason') in ('scroll_container_not_found','timeout','possible_gaps') else 'unconfirmed'
                if len(messages) != chat['messages']: row['priority']='high'; row['countMismatch']=True
                target=output/'chats'/path;target.mkdir(parents=True)
                (target/'messages.json').write_bytes(data)
        except (OSError,ValueError,KeyError,zipfile.BadZipFile,RuntimeError) as error:
            row.update(priority='high',inspectionError=str(error));failures.append({'path':path,'error':str(error)})
        rows.append(row)
        if (index+1)%100==0: print('Checked archives:',index+1,flush=True)
    audit={'source':str(source),'sourceSummarySha256':hashlib.sha256((source/'max-archive-summary.json').read_bytes()).hexdigest(),'chats':rows,'errors':summary.get('errors',[]),'skippedMedia':summary.get('skippedMedia',[]),'inspectionErrors':failures,'messages':sum(r.get('actualMessages',0) for r in rows),'verifiedArchives':sum(r.get('crcVerified',False) for r in rows)}
    (output/'audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    with (output/'retry-chats.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.writer(f);writer.writerow(['archive','title','messages','date_from','date_to','reason','priority'])
        for r in rows:
            if r.get('complete') is not True or r.get('inspectionError'): writer.writerow(["'"+v if isinstance(v,str) and v.startswith(('=','+','-','@','\t','\r')) else v for v in [r['path'],r['title'],r.get('actualMessages'),r.get('dateFrom'),r.get('dateTo'),r.get('reason'),r['priority']]])
    print(json.dumps({'verifiedArchives':audit['verifiedArchives'],'messages':audit['messages'],'inspectionErrors':len(failures)},ensure_ascii=True),flush=True)
    return audit

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source');parser.add_argument('output');args=parser.parse_args();recover(args.source,args.output)
