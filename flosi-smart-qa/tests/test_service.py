import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from smartqa.provider import Provider, LOCAL_MODEL
from smartqa.server import make_handler

class ProviderFaults(unittest.TestCase):
    def test_documented_llama_cpp_reasoning_budget_wire_field(self):
        seen=[]
        p=Provider(thinking=True,reasoning_budget=128,transport=lambda body:seen.append(body) or {})
        p.complete('s','u')
        self.assertEqual(seen[0]['reasoning_budget_tokens'],128)
        self.assertNotIn('reasoning_budget',seen[0])
        self.assertTrue(seen[0]['chat_template_kwargs']['enable_thinking'])

    def test_http_429_does_not_read_body_or_retry_and_stops_next_attempt(self):
        class Poison(io.BytesIO):
            def read(self, *a):
                raise AssertionError('error body must not be read')
        calls=[]
        def transport(body):
            calls.append(body)
            raise urllib.error.HTTPError('http://127.0.0.1',429,'rate limited',{},Poison())
        p=Provider(transport=transport)
        self.assertEqual(p.complete('s','u')['error'],'http_429')
        self.assertEqual(p.complete('s','u')['error'],'http_429')
        self.assertEqual(len(calls),1)

    def test_timeout_and_network_stop_and_keep_cost_unknown_for_external(self):
        for exc in [TimeoutError(), urllib.error.URLError('fixture')]:
            calls=[]
            def transport(body):
                calls.append(body);raise exc
            p=Provider(transport=transport)
            self.assertEqual(p.complete('s','u')['status'],'error')
            self.assertEqual(p.complete('s','u')['status'],'error')
            self.assertEqual(len(calls),1)

    def test_duplicate_response_is_not_accepted_as_fresh(self):
        payload={'model':LOCAL_MODEL,'id':'duplicate', 'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2},
                 'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':'{}'}}]}
        p=Provider(transport=lambda _:payload)
        self.assertEqual(p.complete('s','u')['status'],'ok')
        self.assertEqual(p.complete('s','u')['error'],'duplicate_response')

class LocalBoundary(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.provider=Provider(transport=lambda _: {'model':LOCAL_MODEL,'id':'1', 'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2},
            'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':'{"uncertain":false,"edits":[]}'}}]})
        self.server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(self.provider,None,Path(self.directory.name),0))
        port=self.server.server_port
        self.server.RequestHandlerClass=make_handler(self.provider,None,Path(self.directory.name),port)
        self.url=f'http://127.0.0.1:{port}'
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.directory.cleanup()

    def test_cross_origin_cannot_trigger_provider(self):
        request=urllib.request.Request(self.url+'/api/correct',data=b'{"text":"test"}',headers={'Content-Type':'application/json','Origin':'https://evil.example'})
        with self.assertRaises(urllib.error.HTTPError) as error:self.opener.open(request)
        self.assertEqual(error.exception.code,403);error.exception.close()
        self.assertEqual(self.provider.attempts,0)

    def test_static_traversal_and_dns_rebinding_rejected(self):
        for path,headers,expected in [('/../assets.json',{},404),('/api/status',{'Host':'evil.example'},403)]:
            request=urllib.request.Request(self.url+path,headers=headers)
            with self.assertRaises(urllib.error.HTTPError) as error:self.opener.open(request)
            self.assertEqual(error.exception.code,expected);error.exception.close()

    def test_real_http_text_contract_and_opt_in_evidence(self):
        request=urllib.request.Request(self.url+'/api/correct',data=json.dumps({'text':'No abrir todavía.','saveEvidence':True}).encode(),
            headers={'Content-Type':'application/json','Origin':self.url})
        with self.opener.open(request) as response:body=json.load(response)
        self.assertEqual(body['text'],'No abrir todavía.')
        self.assertTrue((Path(body['savedEvidence'])/'result.json').is_file())
        self.assertEqual(len(list(Path(self.directory.name).rglob('result.json'))),1)

    def test_oversized_body_is_rejected_before_inference(self):
        request=urllib.request.Request(self.url+'/api/correct',data=b'{}',headers={'Content-Type':'application/json','Origin':self.url,'Content-Length':str(41*1024*1024)})
        with self.assertRaises(urllib.error.HTTPError) as error:self.opener.open(request)
        self.assertEqual(error.exception.code,413);error.exception.close()
        self.assertEqual(self.provider.attempts,0)

if __name__=='__main__':unittest.main()
