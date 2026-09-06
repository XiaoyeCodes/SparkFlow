import json
from pathlib import Path

import pytest

from src.ibkr_terminal.schemas import Snapshot
from src.ibkr_terminal.session import AccountSession, AccountBinding
from src.ibkr_terminal.store import SnapshotStore


def sample():
    path = Path(__file__).resolve().parents[5] / 'tests/ibkr/fixtures/snapshots.json'
    return Snapshot.model_validate(json.loads(path.read_text(encoding='utf-8'))['multiCurrency'])


def test_no_binding_no_connection_or_fabricated_values(tmp_path):
    store = SnapshotStore(tmp_path / 'state.sqlite')
    session = AccountSession('live', store)
    state = session.snapshot()
    assert state.connection == 'unconfigured'
    assert state.metrics.netLiquidation is None
    assert not state.capabilities.placeOrders
    assert state.mode == 'live'
    store.close()


def test_old_account_revision_and_decreasing_sequence_are_rejected(tmp_path):
    store = SnapshotStore(tmp_path / 'state.sqlite', allow_fixtures=True)
    session = AccountSession('paper', store)
    binding = AccountBinding(mode='paper', accountKey='paper:engineering-fixture', brokerAccount='EXPLICIT-TEST', confirmed=True)
    session.bind(binding)
    state = sample().model_copy(update={'sessionRevision': session.revision, 'sequence': 2})
    assert session.accept(state)
    assert not session.accept(state.model_copy(update={'sequence': 1}))
    assert not session.accept(state.model_copy(update={'mode': 'live'}))
    session.bind(binding.model_copy(update={'accountKey': 'paper:other', 'brokerAccount': 'OTHER-TEST'}))
    assert not session.accept(state)
    assert session.snapshot().positions == ()
    store.close()


def test_restart_restores_cache_as_stale_never_connected(tmp_path):
    path = tmp_path / 'state.sqlite'
    binding = AccountBinding(mode='paper', accountKey='paper:engineering-fixture', brokerAccount='EXPLICIT-TEST', confirmed=True)
    with SnapshotStore(path, allow_fixtures=True) as store:
        session = AccountSession('paper', store)
        session.bind(binding)
        assert session.accept(sample().model_copy(update={'sessionRevision': session.revision}))
    with SnapshotStore(path, allow_fixtures=True) as store:
        restored = AccountSession('paper', store)
        restored.bind(binding)
        assert restored.snapshot().positions
        assert restored.snapshot().state == 'stale'
        assert restored.snapshot().connection == 'reconciling'


def test_production_store_rejects_fixtures_and_bind_requires_confirmation(tmp_path):
    with SnapshotStore(tmp_path / 'state.sqlite') as store:
        with pytest.raises(ValueError, match='fixture'):
            store.save(sample())
        with pytest.raises(ValueError):
            AccountBinding(mode='live', accountKey='paper:wrong', brokerAccount='TEST', confirmed=True)
        with pytest.raises(ValueError):
            AccountBinding(mode='live', accountKey='live:test', brokerAccount='TEST', confirmed=False)


def test_account_key_cannot_be_reused_for_a_different_broker_account(tmp_path):
    path = tmp_path / 'state.sqlite'
    binding = AccountBinding(mode='paper', accountKey='paper:engineering-fixture', brokerAccount='EXPLICIT-TEST', confirmed=True)
    with SnapshotStore(path, allow_fixtures=True) as store:
        session = AccountSession('paper', store)
        session.bind(binding)
        session.accept(sample().model_copy(update={'sessionRevision': session.revision}))
    with SnapshotStore(path, allow_fixtures=True) as store:
        session = AccountSession('paper', store)
        with pytest.raises(ValueError, match='binding'):
            session.bind(binding.model_copy(update={'brokerAccount': 'OTHER-TEST'}))
        assert session.snapshot().positions == ()
