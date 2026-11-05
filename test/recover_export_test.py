import importlib.util,json,pathlib,tempfile,unittest,zipfile
spec=importlib.util.spec_from_file_location('recovery',pathlib.Path(__file__).parents[1]/'scripts/recover-export.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
TEST_ROOT=pathlib.Path(__file__).resolve().parents[1]/'output/recovery-tests'
TEST_ROOT.mkdir(parents=True,exist_ok=True)
class RecoveryTests(unittest.TestCase):
 def make(self,root):
  source=root/'source';source.mkdir();chat={'path':'001-chat','title':'Чат','messages':1,'complete':False,'reason':'timeout'}
  (source/'max-archive-summary.json').write_text(json.dumps({'chats':[chat],'errors':[]}),encoding='utf-8')
  with zipfile.ZipFile(source/'max-archive-001-chat.zip','w') as z:z.writestr('001-chat/messages.json',json.dumps({'messages':[{'date':'2026-11-03','text':'Точный исходный текст'}]},ensure_ascii=False))
  return source
 def test_recovers_exact_json_and_never_overwrites_existing_output(self):
  with tempfile.TemporaryDirectory(dir=TEST_ROOT) as tmp:
   root=pathlib.Path(tmp);source=self.make(root);before=(source/'max-archive-001-chat.zip').read_bytes();audit=module.recover(source,root/'out')
   self.assertEqual(audit['messages'],1);self.assertEqual(audit['chats'][0]['priority'],'high');self.assertFalse(audit['chats'][0]['complete']);self.assertEqual(before,(source/'max-archive-001-chat.zip').read_bytes())
   with self.assertRaises(FileExistsError):module.recover(source,root/'out')
 def test_corrupt_zip_is_recorded_without_claiming_recovered_messages(self):
  with tempfile.TemporaryDirectory(dir=TEST_ROOT) as tmp:
   root=pathlib.Path(tmp);source=self.make(root);(source/'max-archive-001-chat.zip').write_bytes(b'not a zip');audit=module.recover(source,root/'out');self.assertEqual(audit['messages'],0);self.assertEqual(len(audit['inspectionErrors']),1)
if __name__=='__main__':unittest.main()
