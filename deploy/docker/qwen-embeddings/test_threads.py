"""Dependency-free local contract test; live model latency is tested separately."""
import importlib.util
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import Mock, patch

class App:
    def __init__(self, *_): pass
    def get(self, *_): return lambda fn: fn
    def post(self, *_): return lambda fn: fn

for threads, interop in [('2', '1'), ('3', '2')]:
    torch=SimpleNamespace(set_num_threads=Mock(), set_num_interop_threads=Mock())
    model=SimpleNamespace(encode=Mock(return_value=[[0.1]*1024]))
    modules={'flask':SimpleNamespace(Flask=App,jsonify=lambda x:x,request=None),
             'torch':torch,'sentence_transformers':SimpleNamespace(SentenceTransformer=Mock(return_value=model))}
    with patch.dict(sys.modules,modules), patch.dict(os.environ,{'EMBEDDING_TORCH_THREADS':threads,'EMBEDDING_TORCH_INTEROP_THREADS':interop}):
        spec=importlib.util.spec_from_file_location('embedding_test',Path(__file__).with_name('server.py'))
        server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
        assert server.get_model() is model
        assert server.get_model() is model
        torch.set_num_threads.assert_called_once_with(int(threads))
        torch.set_num_interop_threads.assert_called_once_with(int(interop))
        health,status=server.health()
        assert status==200 and health['dims']==1024 and health['compute_threads']==int(threads)
print('Embedding thread configuration, model reuse, dimensions and health contract passed.')
