import json
import tomllib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = ROOT / "integrations" / "python"


class PackageMetadataTests(unittest.TestCase):
    def setUp(self):
        self.metadata = tomllib.loads((PACKAGE_ROOT / "pyproject.toml").read_text())

    def test_distribution_matches_the_repository_release(self):
        repository = json.loads((ROOT / "package.json").read_text())
        project = self.metadata["project"]

        self.assertEqual(project["name"], "jet-browser")
        self.assertEqual(project["version"], repository["version"])
        self.assertEqual(project["requires-python"], ">=3.11")
        self.assertEqual(project.get("dependencies", []), [])
        self.assertEqual(project["license"], "Apache-2.0")
        self.assertEqual(
            project["urls"]["Source"],
            "https://github.com/masakaai/jet-browser",
        )

    def test_build_maps_one_typed_package_and_includes_the_policy(self):
        setuptools = self.metadata["tool"]["setuptools"]
        self.assertEqual(setuptools["packages"], ["jet_browser"])
        self.assertEqual(setuptools["package-dir"], {"jet_browser": "."})
        self.assertEqual(
            sorted(setuptools["package-data"]["jet_browser"]),
            ["py.typed", "seccomp_profile.json"],
        )


class PackagedAssetTests(unittest.TestCase):
    def test_packaged_policy_and_license_cannot_drift(self):
        self.assertEqual(
            (PACKAGE_ROOT / "seccomp_profile.json").read_bytes(),
            (ROOT / "seccomp_profile.json").read_bytes(),
        )
        self.assertEqual(
            (PACKAGE_ROOT / "LICENSE").read_bytes(),
            (ROOT / "LICENSE").read_bytes(),
        )
        self.assertTrue((PACKAGE_ROOT / "py.typed").is_file())

    def test_default_policy_resolves_inside_the_installed_package(self):
        implementation = (PACKAGE_ROOT / "jet_browser.py").read_text()
        self.assertIn(
            '_DEFAULT_SECCOMP = Path(__file__).resolve().with_name("seccomp_profile.json")',
            implementation,
        )
        self.assertNotIn('parents[2] / "seccomp_profile.json"', implementation)


class DistributionWorkflowTests(unittest.TestCase):
    def test_ci_builds_checks_and_installs_the_exact_wheel(self):
        workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
        verifier = PACKAGE_ROOT / "tests" / "verify_distribution.py"

        self.assertTrue(verifier.is_file())
        self.assertIn("python3 -m build integrations/python", workflow)
        self.assertIn("python3 -m twine check", workflow)
        self.assertIn("python3 integrations/python/tests/verify_distribution.py", workflow)
        self.assertIn("jet-browser-python-package", workflow)
        self.assertIn("actions/download-artifact@", workflow)
        self.assertIn("python3 -m pip install --no-index --no-deps", workflow)
        self.assertIn("python3 examples/python_quickstart.py --image jet-browser:ci", workflow)
        self.assertIn(
            "python3 examples/python_quickstart.py --image jet-browser:arm64 --platform linux/arm64",
            workflow,
        )

    def test_docs_offer_pip_without_weakening_the_network_boundary(self):
        documentation = (PACKAGE_ROOT / "README.md").read_text()
        root_documentation = (ROOT / "README.md").read_text()
        example = (ROOT / "examples" / "python_quickstart.py").read_text()

        install = (
            'pip install "jet-browser @ git+https://github.com/masakaai/'
            'jet-browser.git@main#subdirectory=integrations/python"'
        )
        self.assertIn(install, documentation)
        self.assertIn(install, root_documentation)
        self.assertIn("from jet_browser import JetBrowserProcess", documentation)
        self.assertIn('network="bridge"', documentation)
        self.assertIn("allow_network=True", documentation)
        self.assertIn("from jet_browser import JET_BROWSER_IMAGE, JetBrowserProcess", example)


if __name__ == "__main__":
    unittest.main()
