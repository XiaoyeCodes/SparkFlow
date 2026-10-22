import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from export_pdf import export_pdf

@unittest.skipUnless(importlib.util.find_spec('weasyprint'),'Optional PDF dependencies not installed')
class PDFTests(unittest.TestCase):
    def test_continuous_and_a4_exports(self):
        root=Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            for layout in ('continuous','a4'):
                out=Path(tmp)/(layout+'.pdf')
                result=export_pdf(root/'sample/output/daily60-2026-10-22.html',out,layout)
                self.assertTrue(out.read_bytes().startswith(b'%PDF'))
                self.assertGreater(result['page_count'],0)
    def test_external_resource_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'external.html';out=Path(tmp)/'out.pdf'
            source.write_text('<html><body><img src="https://example.com/not-fetched.png"></body></html>')
            with self.assertRaises(RuntimeError):export_pdf(source,out)
            self.assertFalse(out.exists())
    def test_cid_input_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'cid.html';source.write_text('<img src="cid:daily60-header">')
            with self.assertRaises(ValueError):export_pdf(source,Path(tmp)/'out.pdf')

if __name__=='__main__':unittest.main()
