"""LabVIEW Python Node functions; native HTTP Client VIs use the same API.

Run on the same workstation as labview_gateway. Secrets come only from the
process environment. These functions never embed credentials into URLs.
"""
import json
import os
import uuid
from urllib.request import Request, urlopen


def call(path, body=None):
    key = os.environ.get('AMR_LABVIEW_API_KEY', '')
    if len(key) < 32:
        raise ValueError('Configure the private LabVIEW API key')
    request = Request('http://127.0.0.1:8766'+path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization':'Bearer '+key, 'Content-Type':'application/json'})
    with urlopen(request, timeout=5) as response:
        return response.read().decode()


def current_context():
    return call('/context')


def request_review(review_id):
    # Generate once in LabVIEW and reuse the ID on a network retry.
    if not isinstance(review_id, str) or len(review_id) != 32:
        raise ValueError('Provide the saved review ID from new_review_id()')
    return call('/reviews', {'review_id':review_id})


def new_review_id():
    return uuid.uuid4().hex


def decide(review_id, decision, action, operator, reason):
    return call('/reviews/'+review_id+'/decision',
                dict(decision=decision, action=action, operator=operator, reason=reason))


def review_status(review_id):
    return call('/reviews/'+review_id)
