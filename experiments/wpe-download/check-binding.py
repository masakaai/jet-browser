"""Isolated fixture: WebDriver launch capability -> exact private directory.
Run only inside masaka-harness-evaluate-test with the probe launcher installed.
"""
import json
import pathlib
import time
import urllib.request
import urllib.error
import uuid
import sys
import subprocess

def request(path, data=None, method=None):
    req = urllib.request.Request('http://127.0.0.1:9515' + path,
        data=None if data is None else json.dumps(data).encode(),
        headers={'Content-Type': 'application/json'}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=35) as response:
            return json.load(response)['value']
    except urllib.error.HTTPError as error:
        error.payload = json.load(error)['value']
        print(json.dumps({'webdriverError': error.payload}), file=sys.stderr)
        raise

records = []
for index in range(2):
    token = str(uuid.uuid4())
    root = pathlib.Path('/var/lib/masaka-downloads') / token
    assert not root.exists()
    session = request('/session', {'capabilities': {'alwaysMatch': {'wpe:browserOptions': {
        'binary': '/usr/lib/x86_64-linux-gnu/wpe-webkit-2.0/MiniBrowser',
        'args': ['--masaka-download-token=' + token, '--headless', '--automation', '--size=1280x800']
    }}}})['sessionId']
    prefix = '/session/' + session
    content = 'bound native download 中文 ' + str(index)
    try:
        request(prefix + '/url', {'url': 'https://example.com'})
        assert root.is_dir() and not root.is_symlink()
        assert root.stat().st_mode & 0o777 == 0o750
        point = request(prefix + '/execute/sync', {'script': '''
            const a=document.createElement('a');a.download='same-name.txt';
            a.href=URL.createObjectURL(new Blob([arguments[0]],{type:'text/plain'}));
            a.textContent='Download';document.body.replaceChildren(a);
            const r=a.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
        ''', 'args': [content]})
        request(prefix + '/actions', {'actions': [{'type': 'pointer', 'id': 'test-mouse',
            'parameters': {'pointerType': 'mouse'}, 'actions': [
                {'type': 'pointerMove', 'origin': 'viewport', 'duration': 16, **point},
                {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0}]}]})
        for attempt in range(30):
            events = [line.split('\t') for line in (root/'events.tsv').read_text().splitlines()]
            finished = [event for event in events if event[0] == 'finished']
            if finished:
                break
            time.sleep(.2)
        assert len(finished) == 1 and finished[0][3] == '0'
        download = root/finished[0][1]
        assert download.read_bytes() == content.encode()
        # Actual runtime worker UID, not root-only evidence.
        assert subprocess.check_output(['runuser', '-u', 'worker', '--', 'cat', str(download)]) == content.encode()
        subprocess.run(['runuser', '-u', 'worker', '--', 'test', '-r', str(root/'events.tsv')], check=True)
        assert subprocess.run(['runuser', '-u', 'worker', '--', 'test', '-w', str(root)]).returncode != 0
        records.append({'sessionId': session, 'token': token, 'root': str(root), 'downloadId': download.name})
    finally:
        request(prefix, method='DELETE')
assert records[0]['root'] != records[1]['root']
for index, record in enumerate(records):
    assert (pathlib.Path(record['root'])/record['downloadId']).read_text() == 'bound native download 中文 ' + str(index)
negative_tokens = [] if '--positive-only' in sys.argv else [records[0]['token'], '../escape']
for bad_token in negative_tokens:
    try:
        unexpected = request('/session', {'capabilities': {'alwaysMatch': {'wpe:browserOptions': {
            'binary': '/usr/lib/x86_64-linux-gnu/wpe-webkit-2.0/MiniBrowser',
            'args': ['--masaka-download-token=' + bad_token, '--headless', '--automation']
        }}}})
    except urllib.error.HTTPError as error:
        failure = error.payload
        assert failure['error'] == 'session not created'
    else:
        request('/session/' + unexpected['sessionId'], method='DELETE')
        raise AssertionError('Unsafe token unexpectedly created a session')
assert (pathlib.Path(records[0]['root'])/records[0]['downloadId']).read_text() == 'bound native download 中文 0'
print(json.dumps({'verdict': 'validated', 'scope': 'two sequential isolated launches, exact directories and real worker read permissions', 'negativeTokensTested': bool(negative_tokens), 'records': records}))
