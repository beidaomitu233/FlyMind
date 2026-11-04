import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'deploy/cloud/install-first-full-bundle.py'


class TemplateTests(unittest.TestCase):
    def test_service_templates_preserve_existing_behavior(self):
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        constants = {}
        for item in tree.body:
            if isinstance(item, ast.Assign) and len(item.targets) == 1 and isinstance(item.targets[0], ast.Name):
                if item.targets[0].id in ('APP', 'GATEWAY', 'JAVA'):
                    constants[item.targets[0].id] = ast.literal_eval(item.value)
        cases = {
            'APP': ROOT / 'deploy/cloud/flymind-application.service',
            'GATEWAY': ROOT / 'deploy/cloud/flymind-gateway.service',
            'JAVA': ROOT / 'integrations/xinghui-admin/backend/deploy/flymind-control-plane.service',
        }
        for name, path in cases.items():
            original = path.read_text(encoding='utf-8')
            original = '\n'.join(line for line in original.splitlines() if not line.startswith('#')) + '\n'
            if name != 'JAVA':
                original = original.replace('ExecStart=/usr/bin/node ', 'ExecStart=/opt/flymind/runtime/node-v22.23.3-linux-x64/bin/node ')
            self.assertEqual(constants[name], original, name)


if __name__ == '__main__':
    unittest.main()
