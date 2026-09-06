import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from src.ibkr_terminal.schemas import Snapshot

FIXTURES = Path(__file__).resolve().parents[5] / 'tests/ibkr/fixtures/snapshots.json'


def samples():
    return json.loads(FIXTURES.read_text(encoding='utf-8'))


def test_all_seven_contract_samples_validate():
    cases = samples()
    assert set(cases) == {'empty', 'disconnected', 'delayed', 'multiCurrency', 'partialFill', 'permissionRequired', 'timeout'}
    for payload in cases.values():
        snapshot = Snapshot.model_validate(payload)
        assert snapshot.source == 'fixture'
        assert snapshot.testData is True
        assert snapshot.capabilities.placeOrders is False
    assert cases['empty']['connection'] == 'connected'
    assert cases['disconnected']['connection'] == 'disconnected'
    assert cases['disconnected']['metrics']['netLiquidation'] is None
    assert cases['partialFill']['orders'][0]['filled'] == '2'
    assert cases['timeout']['orders'][0]['submission'] == 'UNKNOWN'


@pytest.mark.parametrize('change', [
    {'testData': False},
    {'metrics': {'netLiquidation': 'NaN'}},
    {'mode': 'live'},
    {'capabilities': {'placeOrders': True, 'shareWithAi': False}},
])
def test_fixture_cannot_claim_production_identity_or_invalid_money(change):
    payload = copy.deepcopy(samples()['empty'])
    payload.update(change)
    with pytest.raises(ValidationError):
        Snapshot.model_validate(payload)


def test_position_cannot_leak_another_account():
    payload = copy.deepcopy(samples()['multiCurrency'])
    payload['positions'][0]['accountKey'] = 'paper:someone-else'
    with pytest.raises(ValidationError):
        Snapshot.model_validate(payload)


def test_float_money_is_rejected_instead_of_silently_rounding():
    payload = copy.deepcopy(samples()['empty'])
    payload['metrics']['netLiquidation'] = 0.1
    with pytest.raises(ValidationError):
        Snapshot.model_validate(payload)
